import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFile } from "node:child_process";
import { listJavaProcesses, parsePsOutput } from "../src/orphan.js";

// What `ps -eo pid=,args=` actually emits: no header, a left-padded pid field,
// then the full command line (which may contain spaces).
const PS_SAMPLE = [
  "    114 /usr/lib/jvm/java -Xmx2G -jar /home/marc/.local/share/Necesse/Server.jar -nogui",
  "   2210 nginx",
  "   9090 python3 ./serve.py -jar /opt/Server.jar",
].join("\n") + "\n";

vi.mock("node:child_process", () => ({
  // vi.mock replaces the module, so util.promisify on the mock lacks Node's
  // custom promisify(execFile) handling. The default promisify expects a
  // single result argument: cb(null, { stdout, stderr }).
  execFile: vi.fn((...args: unknown[]) => {
    const cb = args.pop() as (e: Error | null, out: { stdout: string; stderr: string }) => void;
    cb(null, { stdout: PS_SAMPLE, stderr: "" });
  }),
}));

describe("listJavaProcesses (POSIX branch)", () => {
  const execFileMock = vi.mocked(execFile);

  beforeEach(() => {
    execFileMock.mockClear();
  });

  it("runs `ps -eo pid=,args=` on a POSIX host and parses its output", async () => {
    const procs = await listJavaProcesses("linux");
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = execFileMock.mock.calls[0] as unknown as [string, string[]];
    expect(cmd).toBe("ps");
    expect(args).toEqual(["-eo", "pid=,args="]);
    expect(procs.map((p) => p.pid)).toEqual([114]);
  });

  it("keeps the full command line (spaces included) so Server.jar matching can find it", async () => {
    const [server] = await listJavaProcesses("linux");
    expect(server).toEqual({
      pid: 114,
      commandLine: "/usr/lib/jvm/java -Xmx2G -jar /home/marc/.local/share/Necesse/Server.jar -nogui",
    });
  });
});

describe("parsePsOutput", () => {
  it("drops blank lines and a pid with no command line", () => {
    expect(parsePsOutput("\n  123\n456 prog arg\n\n")).toEqual([{ pid: 456, commandLine: "prog arg" }]);
  });

  it("surfaces a server that would be adopted as an orphan across a restart", () => {
    const line = "    114 /home/server/jre/bin/java -jar /opt/Necesse/Server.jar -nogui";
    expect(parsePsOutput(line)).toEqual([
      { pid: 114, commandLine: "/home/server/jre/bin/java -jar /opt/Necesse/Server.jar -nogui" },
    ]);
  });
});