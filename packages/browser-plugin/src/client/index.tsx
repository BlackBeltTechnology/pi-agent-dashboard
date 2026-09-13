/**
 * Client entry barrel for the browser-plugin.
 *
 * Exports the slot components referenced by the `pi-dashboard-plugin` manifest
 * claims (BrowserSettings, LiveViewTile). The generated plugin-registry
 * imports these by name. Components are placeholders until workstream 4.
 * See change: add-browser-relay (task 2.1).
 */
export { catalog } from "../i18n.js";
export { BrowserSettings } from "./BrowserSettings.js";
export { LiveViewTile } from "./LiveViewTile.js";
export { isLiveViewActive } from "./live-view-gate.js";
