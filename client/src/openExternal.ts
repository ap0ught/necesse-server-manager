import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Opens a URL in the OS's browser. Under Tauri the webview must not navigate
 * to an external scheme itself - the opener plugin hands the URL to the OS
 * instead. Outside Tauri (a plain browser tab, or jsdom during tests) the
 * plugin has no host to talk to, so the URL opens in a new tab directly.
 *
 * Returns nothing: a click can never leave the UI in an error state.
 */
export function openExternal(url: string): void {
  if ("__TAURI_INTERNALS__" in window) {
    openUrl(url).catch(() => {});
  } else {
    window.open(url, "_blank", "noopener,noreferrer")?.focus();
  }
}
