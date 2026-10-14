import type { SessionStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/**
 * Reconciled composer liveness. A KNOWN server `DashboardSession.status` is
 * authoritative (it survives browser replay gaps and is healed by the bridge
 * heartbeat); the event-sourced reducer status is the fallback only when no
 * server record exists yet. `"active"` is the registered resting state, never
 * liveness, so it maps to `"idle"`. The composer value `"ended"` therefore
 * means terminal.
 *
 * Derivation only — the transcript stays a function of real events.
 * See change: fix-composer-liveness-on-reload (design.md D3).
 */
export type ComposerStatus = "idle" | "streaming" | "ended";

export function composerLiveness(
  reducerStatus: ComposerStatus,
  serverStatus: SessionStatus | undefined,
): ComposerStatus {
  if (serverStatus === undefined) return reducerStatus;
  if (serverStatus === "ended") return "ended";
  if (serverStatus === "streaming") return "streaming";
  return "idle"; // "idle" | "active"
}

/**
 * ONE working predicate for every composer control (Stop / Force-Stop,
 * stop-after-turn, session-actions strip, session card). A recorded provider
 * retry counts as working unless the session is terminal.
 * See change: fix-composer-liveness-on-reload (design.md D7).
 */
export function isComposerWorking(status: SessionStatus, retrying: boolean): boolean {
  return status === "streaming" || (retrying && status !== "ended");
}
