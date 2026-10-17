/**
 * Always-mounted, zero-UI feeder for the browser relay store (change:
 * fix-empty-status-subcard).
 *
 * Claimed on the `shell-headless` slot, so the shell mounts it exactly once for
 * the app's lifetime — independent of layout, selection and session count. It is
 * the SOLE caller of `useRelayStatusFeed`; the badge, pane tab and tab label only
 * read the store. That is what lets the badge's `shouldRender` gate hide the
 * STATUS subcard at zero tabs without losing the first `browser_relay_status`.
 *
 * Also mounts `OperatorHostCarrier` (a second always-mounted, zero-UI concern; renders
 * nothing outside the Electron main window) so no second manifest claim is needed.
 *
 * Manifest claim: `{ "slot": "shell-headless", "component": "BrowserRelayFeed" }`.
 */
import type React from "react";
import { OperatorHostCarrier } from "./OperatorHostCarrier.js";
import { useRelayStatusFeed } from "./relay-store.js";

export function BrowserRelayFeed(): React.ReactElement | null {
  useRelayStatusFeed();
  // Same always-mounted, zero-UI lifetime: the Electron operator host carrier
  // (inert without `window.piDashboard.browserHost`). See change: add-operator-browser-relay.
  return <OperatorHostCarrier />;
}
