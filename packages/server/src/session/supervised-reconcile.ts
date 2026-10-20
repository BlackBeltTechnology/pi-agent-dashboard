/**
 * Revisioned reconciliation of a session's Supervised-mode state between the
 * bridge (its session-file entry, reported on register / `supervised_state`) and
 * the server (its persisted `.meta.json` copy). Pure.
 *
 * Rule (design D4, test-plan E31): every flip carries a per-session monotonic
 * `rev` (0 / absent = "no flip recorded"). The higher `rev` wins, so an OFF the
 * server holds but the bridge missed is not reverted. When the order is unknown
 * — equal `rev` with different values, or exactly one side has no `rev` — the
 * restrictive value (Supervised, `on: true`) wins. When neither side has ever
 * flipped (both `rev` 0) there is no conflict to resolve and the bridge's value
 * (its config default) stands. The winner's `rev` is the larger of the two.
 *
 * See change: add-supervised-tool-approval (design D4).
 */
import type { SupervisedState } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";

export interface SupervisedSide {
  on: boolean;
  /** Absent / 0 / non-positive = no flip recorded on that side. */
  rev?: number;
}

const revOf = (s: SupervisedSide): number => (Number.isInteger(s.rev) && (s.rev as number) > 0 ? (s.rev as number) : 0);

/**
 * Reconcile the bridge's reported state with the server's stored one.
 * `server` undefined (never persisted) → the bridge's state stands.
 */
export function reconcileSupervised(bridge: SupervisedSide, server: SupervisedSide | undefined): SupervisedState {
  const bRev = revOf(bridge);
  if (!server) return { on: bridge.on, rev: bRev };
  const sRev = revOf(server);
  const rev = Math.max(bRev, sRev);
  if (bRev === 0 && sRev === 0) return { on: bridge.on, rev };
  if (bRev === 0 || sRev === 0) return { on: true, rev };
  if (bRev > sRev) return { on: bridge.on, rev };
  if (sRev > bRev) return { on: server.on, rev };
  return { on: bridge.on || server.on, rev };
}
