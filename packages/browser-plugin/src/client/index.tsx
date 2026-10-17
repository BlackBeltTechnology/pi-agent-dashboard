/**
 * Client entry barrel for the browser-plugin.
 *
 * Exports the components referenced by the `pi-dashboard-plugin` manifest
 * claims: BrowserSettings, BrowserRelayBadge (session-card-badge menu, gated by
 * `hasRelayTabsForBadge`), BrowserRelayFeed (`shell-headless` store feeder) and the
 * `editor-pane-tab` pair BrowserPaneTab / BrowserTabLabel. `OperatorHostCarrier` is
 * mounted by `BrowserRelayFeed` (always-mounted; Electron only). The generated
 * plugin-registry imports these by name.
 * See change: add-browser-relay; add-browser-editor-pane-tab.
 */
export { catalog } from "../i18n.js";

import { getRelayStatus, hasRelayTabs } from "./relay-store.js";

export { BrowserRelayBadge } from "./BrowserRelayBadge.js";
export { BrowserRelayFeed } from "./BrowserRelayFeed.js";
export { BrowserTabLabel } from "./BrowserTabLabel.js";
export { OperatorHostCarrier } from "./OperatorHostCarrier.js";

/**
 * `shouldRender` gate for the `session-card-badge` claim: true iff the relay
 * snapshot lists at least one tab — the same condition (`hasRelayTabs`) under
 * which `BrowserRelayBadge` renders. Ignores the session (relay status is
 * global). See change: fix-empty-status-subcard.
 */
export const hasRelayTabsForBadge = (): boolean => hasRelayTabs(getRelayStatus());
