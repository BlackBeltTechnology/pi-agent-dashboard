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

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function useEmbedMode(): boolean {
  const search = useSearch();
  const flag = new URLSearchParams(search).get("embed");
  const store = storage();
  if (flag === "1") store?.setItem(EMBED_STORAGE_KEY, "1");
  else if (flag === "0") store?.removeItem(EMBED_STORAGE_KEY);
  return store?.getItem(EMBED_STORAGE_KEY) === "1";
}
