import { describe, it, expect } from "vitest";
import { stripAnsi } from "../src/ansi";

describe("stripAnsi", () => {
  it("removes SGR colour sequences", () => {
    expect(stripAnsi("\u001b[0mReset")).toBe("Reset");
    expect(stripAnsi("\u001b[32mgreen\u001b[0m")).toBe("green");
    expect(stripAnsi("\u001b[1;31m bold red \u001b[0m")).toBe(" bold red ");
  });

  it("removes bare reset codes with no parameters (\x1b[m)", () => {
    expect(stripAnsi("\u001b[mok")).toBe("ok");
  });

  it("removes the exact SteamCMD line from the bug report", () => {
    const line = "\u001b[0mIPC function call IClientUtils::GetSteamRealm took too long: 48 msec";
    expect(stripAnsi(line)).toBe("IPC function call IClientUtils::GetSteamRealm took too long: 48 msec");
  });

  it("removes cursor and mode CSI sequences", () => {
    expect(stripAnsi("\u001b[?25lhidden cursor\u001b[?25h")).toBe("hidden cursor");
    expect(stripAnsi("\u001b[2Kclear line\u001b[K")).toBe("clear line");
  });

  it("removes OSC title sequences", () => {
    expect(stripAnsi("\u001b]0;server title\u0007body")).toBe("body");
  });

  it("removes a lone ESC byte left behind when a sequence is split across chunks", () => {
    expect(stripAnsi("half\u001b")).toBe("half");
  });

  it("leaves plain text untouched", () => {
    expect(stripAnsi("no escapes here")).toBe("no escapes here");
  });
});
