/**
 * Active-session caps with graceful reclaim (D9, D11).
 *
 * `createCapsAdmission` returns an `admit(key)` gate for the acquire path. It
 * counts ONLY `ephemeral` active sessions. When admitting would exceed a cap it
 * reclaims the OLDEST safely-quiescent candidate first; if every candidate is
 * busy it throws a structured `CapacityError` and terminates nothing. The
 * GLOBAL cap is the hard security bound against a caller that spoofs
 * `visitorId`s (an over-global breach reclaims across ALL visitors); the
 * per-visitor cap is fairness for trusted identities (reclaims within the
 * visitor). Reaper and caps share a `reclaimGuard` set so they never
 * double-select the same victim.
 *
 * See OpenSpec change: add-embed-session-lifecycle.
 */
import type { EmbedLifecycleConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { visitorIdOf } from "./identity-key.js";

/** Structured capacity error — no active session was terminated (X3). */
export class CapacityError extends Error {
  readonly code = "EMBED_CAPACITY";
  constructor(message = "embedded-session capacity reached") {
    super(message);
    this.name = "CapacityError";
  }
}

/** A candidate the caps gate may count and (if quiescent) reclaim. */
export interface CapSessionInfo {
  sessionId: string;
  visitorId: string;
  quiescent: boolean;
  lastActivityAt?: number;
}

export interface CapsDeps {
  config: () => EmbedLifecycleConfig;
  /** Currently-active EPHEMERAL sessions (durable sessions are never listed). */
  listEphemeralActive: () => readonly CapSessionInfo[];
  /** Graceful reclaim (killBySessionId) of the chosen victim. */
  reclaim: (sessionId: string) => Promise<void>;
  /** Shared with the reaper so both never double-select a victim. */
  reclaimGuard?: Set<string>;
  /** Fires when an acquire is rejected for capacity (diagnostics). */
  onCapacityReject?: () => void;
}

export interface CapsAdmission {
  admit: (key: string) => Promise<void>;
}

export function createCapsAdmission(deps: CapsDeps): CapsAdmission {
  const guard = deps.reclaimGuard ?? new Set<string>();

  async function admit(key: string): Promise<void> {
    const cfg = deps.config();
    const visitorId = visitorIdOf(key);
    // Exclude sessions already being reclaimed by the reaper or a prior admit.
    const active = deps.listEphemeralActive().filter((s) => !guard.has(s.sessionId));
    const globalCount = active.length;
    const perVisitorCount = active.filter((s) => s.visitorId === visitorId).length;

    const overGlobal = globalCount >= cfg.maxActiveEmbedSessionsGlobal;
    const overVisitor = perVisitorCount >= cfg.maxActiveEmbedSessionsPerVisitor;
    if (!overGlobal && !overVisitor) return; // slot available

    // Reclaim pool: the GLOBAL breach is adversarial → reclaim across ALL
    // visitors; a per-visitor breach reclaims only within that visitor.
    const pool = overGlobal ? active : active.filter((s) => s.visitorId === visitorId);
    const victim = pool
      .filter((s) => s.quiescent)
      .sort((a, b) => (a.lastActivityAt ?? 0) - (b.lastActivityAt ?? 0))[0];

    if (!victim) {
      deps.onCapacityReject?.();
      throw new CapacityError();
    }

    guard.add(victim.sessionId);
    try {
      await deps.reclaim(victim.sessionId);
    } finally {
      guard.delete(victim.sessionId);
    }
  }

  return { admit };
}
