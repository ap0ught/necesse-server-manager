import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConsolePanel } from "../src/ConsolePanel";
import type { ConsoleEntry } from "../src/useDaemon";

function makeLines(n: number): ConsoleEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    line: `line ${i}`,
    ts: new Date(i).toISOString(),
    kind: "server" as const,
  }));
}

// jsdom does not implement layout, so scrollHeight/clientHeight are always 0.
// Stub them per-test to simulate a scrolled body.
function stubScrollMetrics(el: HTMLElement, { scrollHeight, clientHeight, scrollTop }: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(el, "scrollTop", { value: scrollTop, configurable: true, writable: true });
}

describe("ConsolePanel", () => {
  it("renders every line", () => {
    render(<ConsolePanel lines={makeLines(3)} />);
    expect(screen.getByText("line 0")).toBeTruthy();
    expect(screen.getByText("line 2")).toBeTruthy();
  });

  it("does not show a jump-to-latest button while following", () => {
    render(<ConsolePanel lines={makeLines(3)} />);
    expect(screen.queryByRole("button", { name: /jump to latest/i })).toBeNull();
  });

  it("offers a way back to the latest once the user scrolls away from the bottom", () => {
    const { container } = render(<ConsolePanel lines={makeLines(3)} />);
    const body = container.querySelector(".console-body") as HTMLElement;
    stubScrollMetrics(body, { scrollHeight: 1000, clientHeight: 200, scrollTop: 0 });
    fireEvent.scroll(body);
    expect(screen.getByRole("button", { name: /jump to latest/i })).toBeTruthy();
  });

  it("re-engages following once the user clicks back to latest", () => {
    const { container } = render(<ConsolePanel lines={makeLines(3)} />);
    const body = container.querySelector(".console-body") as HTMLElement;
    stubScrollMetrics(body, { scrollHeight: 1000, clientHeight: 200, scrollTop: 0 });
    fireEvent.scroll(body);
    fireEvent.click(screen.getByRole("button", { name: /jump to latest/i }));
    expect(screen.queryByRole("button", { name: /jump to latest/i })).toBeNull();
  });

  it("strips ANSI escapes SteamCMD emits so lines read as plain text", () => {
    render(
      <ConsolePanel
        lines={[
          { line: "\u001b[0mIPC function call IClientUtils::GetSteamRealm took too long: 48 msec", ts: "", kind: "task" },
          { line: "\u001b[32mgreen\u001b[0m ok", ts: "", kind: "task" },
          { line: "\u001b[0mWaiting for user info...\u001b[0mOK", ts: "", kind: "server" },
        ]}
      />,
    );
    expect(screen.getByText("IPC function call IClientUtils::GetSteamRealm took too long: 48 msec")).toBeTruthy();
    expect(screen.getByText("green ok")).toBeTruthy();
    expect(screen.getByText("Waiting for user info...OK")).toBeTruthy();
    // No raw ESC bytes or CSI leftovers anywhere in the rendered output.
    expect(screen.queryByText(/\u001b|\[0m/)).toBeNull();
  });
});
