/**
 * App-level channel for the sudo credential prompt. `useMessageHandler` pushes
 * `sudo_credential_request/_dismiss/_cache` frames here; `<SudoCredentialHost>`
 * subscribes and renders the modal + Forget chip. The snapshot holds ONLY
 * request metadata (callId/commands/prompt) and the server-pushed cache expiry —
 * never a password.
 *
 * See change: add-sudo-credential-prompt.
 */
import type { SudoCredentialRequestBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

export type SudoCredentialRequest = Omit<SudoCredentialRequestBrowserMessage, "type">;

export interface SudoCredentialSnapshot {
  /** Pending prompts, oldest first (one per session, server-enforced). */
  requests: SudoCredentialRequest[];
  /** Latest pushed cache expiry per session; absent = nothing cached. */
  cache: Record<string, number>;
}

type Listener = (snapshot: SudoCredentialSnapshot) => void;

const EMPTY: SudoCredentialSnapshot = { requests: [], cache: {} };
let current: SudoCredentialSnapshot = EMPTY;
const listeners = new Set<Listener>();

function emit(next: SudoCredentialSnapshot): void {
  current = next;
  for (const l of listeners) {
    try { l(current); } catch { /* swallow */ }
  }
}

export function setSudoCredentialRequest(req: SudoCredentialRequest): void {
  const rest = current.requests.filter((r) => !(r.sessionId === req.sessionId && r.callId === req.callId));
  emit({ ...current, requests: [...rest, req] });
}

export function dismissSudoCredentialRequest(sessionId: string, callId: string): void {
  const requests = current.requests.filter((r) => !(r.sessionId === sessionId && r.callId === callId));
  if (requests.length !== current.requests.length) emit({ ...current, requests });
}

export function setSudoCredentialCache(sessionId: string, expiresAt: number | null): void {
  const cache = { ...current.cache };
  if (expiresAt === null) delete cache[sessionId];
  else cache[sessionId] = expiresAt;
  emit({ ...current, cache });
}

export function subscribeSudoCredential(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => { listeners.delete(listener); };
}

/**
 * Production reset for a committed server switch: drops pending requests and
 * cache metadata (both belong to the previous server) but KEEPS subscribers so
 * the mounted host keeps listening. NOT for a same-server connection outage.
 */
export function resetSudoCredentialBusForServerSwitch(): void {
  emit(EMPTY);
}

/** Test-only reset. */
export function __resetSudoCredentialBus(): void {
  current = EMPTY;
  listeners.clear();
}
