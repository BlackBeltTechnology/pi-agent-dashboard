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
 * Also mounts `OperatorHostCarrier` — a second always-mounted, zero-UI concern —
 * so no second manifest claim is needed. It is lazy-loaded and only inside the
 * Electron main window (`window.piDashboard.browserHost`), so every other client
 * keeps it out of the cold-landing entry chunk (`mdi-chunk-size` cap).
 * See change: add-operator-browser-relay.
 *
 * Manifest claim: `{ "slot": "shell-headless", "component": "BrowserRelayFeed" }`.
 */
import type React from "react";
import { lazy, Suspense } from "react";
import { getBrowserHost } from "./browser-host.js";
import { useRelayStatusFeed } from "./relay-store.js";

const LazyCarrier = lazy(() => import("./OperatorHostCarrier.js").then((m) => ({ default: m.OperatorHostCarrier })));

export function BrowserRelayFeed(): React.ReactElement | null {
  useRelayStatusFeed();
  if (!getBrowserHost()) return null;
  return (
    <Suspense fallback={null}>
      <LazyCarrier />
    </Suspense>
  );
}
