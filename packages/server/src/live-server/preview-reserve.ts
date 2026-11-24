/**
 * The one reserve-path decision shared by the REST route and the bridge handler (D9). The server decides; the bridge
 * only forwards the answer. Order: port gate → tier-5 viewer present → reservation bounds. When no viewer exists nothing is
 * reserved (so no bound is wasted); at a bound the caller starts at root and says why.
 * See change: serve-live-previews-on-capability-origin (D9).
 */
import type { PreviewPathStore, Reserver } from "./preview-path-store.js";

export interface PreviewReserveDeps {
  store: PreviewPathStore;
  /** Is any connected browser a tier-5 viewer? (decided from the live socket set, per call) */
  hasTier5Viewer: () => boolean;
  /** Why the port may not be a preview target (SSRF gate + `ownPorts`), or `null`. */
  portRefusal: (port: number) => string | null;
}

export type PreviewReserveOutcome =
  | { kind: "invalid-port"; error: string }
  | { kind: "no-viewer" }
  | { kind: "limit" }
  | { kind: "ok"; path: string; expiresAt: number };

export const isValidPort = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 65535;

export function reservePreviewPath(deps: PreviewReserveDeps, port: unknown, reserver: Reserver, requestId?: string): PreviewReserveOutcome {
  if (!isValidPort(port)) return { kind: "invalid-port", error: "port must be an integer 1-65535" };
  const refusal = deps.portRefusal(port);
  if (refusal) return { kind: "invalid-port", error: refusal };
  if (!deps.hasTier5Viewer()) return { kind: "no-viewer" };
  const r = deps.store.reserve(port, reserver, requestId);
  if (!r.ok) return { kind: "limit" };
  return { kind: "ok", path: `/preview/${r.pid}/`, expiresAt: r.expiresAt };
}
