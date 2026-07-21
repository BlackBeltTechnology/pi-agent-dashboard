import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/**
 * Pure helper producing a stable string fingerprint of the position-affecting
 * state of the currently selected session card.
 *
 * The fingerprint changes if and only if the selected card's position in the
 * session list could have changed: `status`, `hidden`, `cwd`, or its index
 * inside its folder's `sessionOrderMap` slice.
 *
 * Returns `null` when there is no selection or the selection is not in
 * `sessions` (filtered out, not yet loaded, or unregistered).
 *
 * Consumers must additionally suppress scroll on `selectedId` change (user
 * click); this helper does NOT carry that information — it only signals that
 * something position-affecting changed.
 *
 * See change: auto-scroll-selected-session-card.
 */
export function selectedCardScrollFingerprint(
  selectedId: string | undefined,
  sessions: DashboardSession[],
  sessionOrderMap: Map<string, string[]> | undefined,
): string | null {
  if (!selectedId) return null;
  const s = sessions.find((x) => x.id === selectedId);
  if (!s) return null;
  const order = sessionOrderMap?.get(s.cwd);
  const orderIdx = order?.indexOf(selectedId) ?? -1;
  return `${selectedId}|${s.status}|${s.hidden ? 1 : 0}|${s.cwd}|${orderIdx}`;
}
