/**
 * Viewer-facing redaction (change: add-browser-editor-pane-tab, D7).
 *
 * The extension's connect page URL carries the pairing `token=` and the relay
 * guid (inside `mcpRelayUrl=…/<guid>`). Nothing viewer-facing may ever carry
 * it: status broadcast, `/api/browser/profiles`, audit detail, and the
 * `editor_tab_open` path. The only intentional egress of the guid is the
 * `connect` response's `cdpUrl`, to the caller that asked for it.
 */
import { PLAYWRIGHT_EXTENSION_ID } from "./connect.js";

const EXTENSION_SCHEME = "chrome-extension:";

/** Strip `?query` and `#fragment` from a `chrome-extension:` URL; others untouched. */
export function redactExtensionUrl(url: string): string {
  if (typeof url !== "string" || !url.toLowerCase().startsWith(EXTENSION_SCHEME)) return url;
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** True for the Playwright extension's `connect.html` page (any query/fragment). */
export function isRelayConnectPage(url: string | undefined): boolean {
  if (typeof url !== "string") return false;
  return redactExtensionUrl(url).toLowerCase() === `chrome-extension://${PLAYWRIGHT_EXTENSION_ID}/connect.html`;
}
