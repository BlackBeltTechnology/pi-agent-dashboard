/**
 * Client entry barrel for the browser-plugin.
 *
 * Exports the components referenced by the `pi-dashboard-plugin` manifest
 * claims: BrowserSettings, BrowserRelayBadge (session-card-badge menu) and the
 * `editor-pane-tab` pair BrowserPaneTab / BrowserTabLabel. The generated
 * plugin-registry imports these by name.
 * See change: add-browser-relay; add-browser-editor-pane-tab.
 */
export { catalog } from "../i18n.js";
export { BrowserPaneTab } from "./BrowserPaneTab.js";
export { BrowserRelayBadge } from "./BrowserRelayBadge.js";
export { BrowserSettings } from "./BrowserSettings.js";
export { BrowserTabLabel } from "./BrowserTabLabel.js";
