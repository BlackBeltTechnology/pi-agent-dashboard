/**
 * App-level channel for the cold-start recovery offer. The server broadcasts
 * one `recovery_offer` (and replays it on connect) when ≥1 session was
 * interrupted by an unclean host shutdown and the setting is `"ask"`.
 * `useMessageHandler` pushes it here; `<RecoveryOfferHost>` (mounted near the
 * app root) subscribes and renders a sticky top-right notification.
 *
 * Unlike `spawn-error-toast-bus`, there is NO auto-dismiss timer — a recovery
 * offer must not silently time out. It clears on an explicit user action
 * (reopen / dismiss) or when the user resumes any session (the offer has
 * served its purpose → no nag). Shown once per dirty boot.
 *
 * See change: reopen-sessions-after-shutdown.
 */
import type { RecoveryCandidate } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

export interface RecoveryOffer {
  candidates: RecoveryCandidate[];
}

type Listener = (offer: RecoveryOffer | null) => void;

let current: RecoveryOffer | null = null;
const listeners = new Set<Listener>();

export function setRecoveryOffer(candidates: RecoveryCandidate[]): void {
  if (candidates.length === 0) {
    clearRecoveryOffer();
    return;
  }
  current = { candidates };
  emit();
}

/** Explicit dismiss / reopen, or auto-dismiss when a session is resumed. */
export function clearRecoveryOffer(): void {
  if (current === null) return;
  current = null;
  emit();
}

export function subscribeRecoveryOffer(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => { listeners.delete(listener); };
}

function emit(): void {
  for (const l of listeners) {
    try { l(current); } catch { /* swallow */ }
  }
}

export function __resetRecoveryOfferBusForTests(): void {
  current = null;
  listeners.clear();
}
