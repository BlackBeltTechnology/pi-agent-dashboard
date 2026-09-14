/**
 * Client entry barrel for the browser-plugin.
 *
 * Exports the slot components referenced by the `pi-dashboard-plugin` manifest
 * claims (BrowserSettings, LiveViewTile, BrowserRelayBadge) plus the
 * content-view predicate. The generated plugin-registry imports these by name.
 * See change: add-browser-relay (tasks 2.1, 4.1–4.3).
 */
export { catalog } from "../i18n.js";
export { BrowserRelayBadge } from "./BrowserRelayBadge.js";
export { BrowserSettings } from "./BrowserSettings.js";
export { LiveViewTile } from "./LiveViewTile.js";
export { isLiveViewActive } from "./live-view-gate.js";
