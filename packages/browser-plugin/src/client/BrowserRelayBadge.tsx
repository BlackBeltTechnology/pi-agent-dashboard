/**
 * Session-card badge for the browser relay (change: add-browser-relay, task
 * 4.3 / design D3).
 *
 * This component is the ALWAYS-MOUNTED `browser_relay_status` subscriber: the
 * sidebar renders the session-card-badge slot for every session, so the shell
 * WebSocket is observed even while the content-view tile is not mounted. It
 * feeds the module-level relay store, whose `bumpSlotClaimsVersion()` call is
 * what re-evaluates the `content-view` predicate (`isLiveViewActive`).
 *
 * Purely presentational otherwise: the pill is hidden (`null`) until ≥1 live
 * instance has ≥1 tab. All store logic lives in `relay-store.ts`.
 *
 * Manifest claim: `{ "slot": "session-card-badge", "component": "BrowserRelayBadge" }`.
 *
 * See change: add-browser-relay (task 4.3).
 */
import { usePluginMessage, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type {
  BrowserRelayStatusMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type React from "react";
import { setRelayStatus, useRelayStatus } from "./relay-store.js";

export function BrowserRelayBadge(_props: {
  session: DashboardSession;
}): React.ReactElement | null {
  const t = useT();
  // The subscription is the point: this instance is mounted for every session
  // card, so the global status keeps flowing even when no tile is open.
  usePluginMessage<BrowserRelayStatusMessage>("browser_relay_status", setRelayStatus);
  const status = useRelayStatus();

  const tabCount = (status?.instances ?? []).reduce((n, instance) => n + instance.tabs.length, 0);
  if (tabCount === 0) return null;

  return (
    <span
      data-testid="browser-relay-badge"
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-[var(--accent-soft)] text-[var(--accent-text)]"
    >
      {t("relayBadge", { n: tabCount }, `${tabCount} browser tabs`)}
    </span>
  );
}
