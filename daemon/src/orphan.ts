import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface ProcessInfo {
  pid: number;
  commandLine: string;
}

/**
 * Lists running java processes. Platform-specific because the two OSes expose
 * command lines through different tools: Windows needs WMI (a `java.exe`
 * command line is not reliably readable via `win32_`), POSIX gives it to us
 * straight from `ps -eo pid=,args=`.
 *
 * @param platform_ Overridable so tests can drive the POSIX branch on any host.
 */
export async function listJavaProcesses(
  platform_: string = process.platform,
): Promise<ProcessInfo[]> {
  return platform_ === "win32" ? listWindowsJavaProcesses() : listPosixJavaProcesses();
}

/** Windows: WMI reports `java.exe`/`javaw.exe`, minus the hosts that hide there. */
async function listWindowsJavaProcesses(): Promise<ProcessInfo[]> {
  const { stdout } = await run(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='java.exe' OR Name='javaw.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
    ],
    { windowsHide: true },
  );
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as
    | { ProcessId: number; CommandLine: string | null }
    | { ProcessId: number; CommandLine: string | null }[];
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr.map((p) => ({ pid: p.ProcessId, commandLine: p.CommandLine ?? "" }));
}

/**
 * POSIX: `ps` always carries the full command line, trusted over /proc because
 * it is present on every host this daemon targets (Linux, macOS) and needs no
 * permission. Every java process is captured, whether or not it is the game;
 * `findOrphanServer` does the Server.jar filtering downstream.
 */
async function listPosixJavaProcesses(): Promise<ProcessInfo[]> {
  const { stdout } = await run("ps", ["-eo", "pid=,args="]);
  return parsePsOutput(stdout);
}

/**
 * Parses `ps -eo pid=,args=` output: one line per process, no header, pid in
 * the leading field and the whole command line after it (which may contain
 * spaces). Pure so the exact output shape the daemon depends on is locked down
 * in tests without shelling out.
 */
export function parsePsOutput(stdout: string): ProcessInfo[] {
  const out: ProcessInfo[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    const space = line.indexOf(" ");
    if (space <= 0) continue; // empty line, or a pid with no command line to match
    const pid = Number(line.slice(0, space));
    if (!Number.isFinite(pid)) continue;
    out.push({ pid, commandLine: line.slice(space + 1).trim() });
  }
  return out;
}

export async function findOrphanServer(
  listProcesses: () => Promise<ProcessInfo[]>,
  serverJar: string,
): Promise<ProcessInfo | null> {
  let procs: ProcessInfo[];
  try {
    procs = await listProcesses();
  } catch {
    // Not being able to enumerate is not the same as there being no orphan,
    // but it must not prevent the daemon from starting.
    return null;
  }
  const needle = serverJar.toLowerCase();
  return procs.find((p) => p.commandLine.toLowerCase().includes(needle)) ?? null;
}