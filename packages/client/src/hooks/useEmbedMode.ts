/**
 * Embed mode: `?embed=1` turns the session-list chrome off for this TAB;
 * `?embed=0` turns it back on. The flag lives in `sessionStorage`, so in-app
 * navigation (which builds query-less paths) and a same-tab OAuth round trip
 * keep it, while an independent tab never inherits it. Read synchronously in
 * render so the first paint is already embedded (no sidebar flash).
 * See change: add-session-ui-deep-links-for-agents (D5).
 */
import { useSearch } from "wouter";

export const EMBED_STORAGE_KEY = "pi-dash-embed";

/**
 * Per-tab fallback for when `sessionStorage` is unavailable or throws (blocked
 * storage, quota, sandboxed frame): module state is per page load, i.e. per tab.
 */
let memoryFlag = false;

function readFlag(): boolean {
  try {
    return window.sessionStorage.getItem(EMBED_STORAGE_KEY) === "1";
  } catch {
    return memoryFlag;
  }
}

function writeFlag(on: boolean): void {
  memoryFlag = on;
  try {
    if (on) window.sessionStorage.setItem(EMBED_STORAGE_KEY, "1");
    else window.sessionStorage.removeItem(EMBED_STORAGE_KEY);
  } catch {
    // memoryFlag carries the state for this tab
  }
}

export function useEmbedMode(): boolean {
  const search = useSearch();
  const flag = new URLSearchParams(search).get("embed");
  if (flag === "1" || flag === "0") writeFlag(flag === "1");
  // The explicit URL flag always wins; otherwise the sticky per-tab state.
  return flag === "1" ? true : flag === "0" ? false : readFlag();
}
