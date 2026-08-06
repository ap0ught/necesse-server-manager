/**
 * Strip ANSI escape sequences from a line of console text.
 *
 * The console panel is a plain-text log by design — it has no terminal emulator
 * and no colour support. Child processes (SteamCMD most visibly, and the game
 * server) still emit ANSI SGR colour sequences on stdout even when it is not a
 * TTY, e.g. `\u001b[0mIPC function call took too long...`. Printed verbatim
 * these render as a literal ESC byte and `[0m...` garbage.
 *
 * We strip here (at the display boundary), not in the daemon. The daemon's
 * `process-manager.ts` deliberately keeps raw lines because it parses the
 * ANSI-prefixed game output for ready/shutdown detection — that data is the
 * source of truth and must stay unmodified.
 */
// CSI: ESC [ params ; intermediate final — e.g. \x1b[0m, \x1b[32m, \x1b[?25h
const ANSI_RE = /\u001b\[[0-9;<>?]*[ -/]*[@-~]/g;
// OSC: ESC ] ... terminated by BEL or ESC-backslash (title sequences)
const OSC_RE = /\u001b\][^\u001b\u0007]*(?:\u0007|\u001b\\)/g;

export function stripAnsi(line: string): string {
  return line.replace(ANSI_RE, "").replace(OSC_RE, "").replace(/\u001b/g, "");
}
