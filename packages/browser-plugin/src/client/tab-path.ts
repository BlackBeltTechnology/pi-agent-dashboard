/**
 * The pane-tab path of a relay tab: `browser:<instanceId>:<tabId>`.
 * Shared by the badge menu (opener), the tab body and the tab label.
 * See change: add-browser-editor-pane-tab.
 */
export const BROWSER_TAB_PREFIX = "browser";

export function browserTabPath(instanceId: string, tabId: number): string {
  return `${BROWSER_TAB_PREFIX}:${instanceId}:${tabId}`;
}

/** `{instanceId, tabId}` of a `browser:<instanceId>:<tabId>` path, or `null`. */
export function parseBrowserTabPath(path: string): { instanceId: string; tabId: number } | null {
  if (!path.startsWith(`${BROWSER_TAB_PREFIX}:`)) return null;
  const rest = path.slice(BROWSER_TAB_PREFIX.length + 1);
  const i = rest.lastIndexOf(":");
  if (i <= 0) return null;
  const instanceId = rest.slice(0, i);
  const tabId = Number(rest.slice(i + 1));
  if (!Number.isInteger(tabId) || String(tabId) !== rest.slice(i + 1)) return null;
  return { instanceId, tabId };
}
