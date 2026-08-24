/**
 * Bridge-connection contention: the pure decision logic behind the
 * one-live-bridge-per-session-id invariant, plus the contention record and the
 * per-session-id rate limiter that D6 requires.
 *
 * Kept out of `pi-gateway.ts` so the two-factor liveness rule is testable
 * against synthetic sockets: the decisive "OPEN but not writable" state is not
 * constructible from a real client socket.
 *
 * See change: fix-duplicate-bridge-registration (D1, D2, D4, D6).
 */

/** Bounded window the gateway waits for an incumbent's pong. */
export const CONTENTION_PROBE_WINDOW = 5_000;

/** How long a contention record stays live before it expires on its own. */
export const CONTENTION_RECORD_TTL = 60_000;

/** At most one refusal log line + health entry per session id per this window. */
export const CONTENTION_RATE_LIMIT = 5_000;

/** The minimum shape of a socket the contention rule inspects. */
export interface ProbeableSocket {
  readyState: number;
  _socket?: { destroyed?: boolean; writable?: boolean } | null;
}

/** `ws.OPEN`, inlined so this module stays free of the `ws` import. */
export const WS_OPEN = 1;

/**
 * The gateway's own two-factor liveness rule, as already encoded by the ping
 * reaper: a socket is live when its TCP transport is intact, even if it is too
 * busy to answer a pong.
 */
export function isSocketAlive(ws: ProbeableSocket): boolean {
  const socket = ws._socket;
  return !!socket && !socket.destroyed && !!socket.writable;
}

export type ClaimDecision =
  /**
   * The newcomer announced INTENT only (D11, task 9.3a-v). It claims no
   * routing entry and no contention slot, and — critically — never reaches the
   * same-pid fast-accept below: a move is the same pi process by construction,
   * so that exemption would hand over routing with no probe at all.
   */
  | { outcome: "provisional" }
  /** The newcomer takes the routing entry; no incumbent to displace. */
  | { outcome: "accept"; reason: "unheld" | "same-socket" | "incumbent-closed" | "placeholder" | "same-pid" }
  /** The incumbent must be probed before the claim can be decided. */
  | { outcome: "probe" }
  /** The incumbent keeps the entry; the newcomer is refused terminally. */
  | { outcome: "refuse"; reason: "incumbent-alive" }
  /** The incumbent is dead; terminate it and hand the entry to the newcomer. */
  | { outcome: "displace"; reason: "incumbent-dead" };

export interface ClaimInput {
  /** The socket currently holding the routing entry, if any. */
  incumbent: ProbeableSocket | undefined;
  /** The socket attempting to claim the id. */
  newcomer: ProbeableSocket;
  /** `source` of the session the gateway has recorded for this id. */
  incumbentSource?: string;
  /** pid the gateway recorded for the incumbent (from a completed register). */
  incumbentPid?: number;
  /** pid the newcomer self-reports on its register message. */
  newcomerPid?: number;
  /**
   * The newcomer is announcing intent to serve, not claiming the session.
   * Short-circuits every other branch, including the unheld fast path — a
   * provisional must claim nothing in EVERY case, not just the remembered ones.
   */
  provisional?: boolean;
}

/**
 * Decide a claim *before* any probe. Returns `probe` when the outcome depends
 * on demonstrated liveness; the caller then resolves it with
 * {@link resolveProbe}.
 */
export function decideClaim(input: ClaimInput): ClaimDecision {
  const { incumbent, newcomer, incumbentSource, incumbentPid, newcomerPid } = input;

  // First, before anything can claim: intent is not a claim (task 9.3a-v).
  if (input.provisional) return { outcome: "provisional" };

  if (!incumbent) return { outcome: "accept", reason: "unheld" };
  if (incumbent === newcomer) return { outcome: "accept", reason: "same-socket" };
  if (incumbent.readyState !== WS_OPEN) return { outcome: "accept", reason: "incumbent-closed" };

  // An auto-created placeholder never carries a recorded pid, so it can never
  // satisfy the same-pid exemption — and is never a protected incumbent.
  if (incumbentSource === "unknown") return { outcome: "accept", reason: "placeholder" };

  // Same-process reconnect: the same pi whose previous close frame was lost.
  // Self-reported, so used ONLY to avoid a permanent refusal, never to grant one.
  if (newcomerPid !== undefined && incumbentPid !== undefined && newcomerPid === incumbentPid) {
    return { outcome: "accept", reason: "same-pid" };
  }

  return { outcome: "probe" };
}

/**
 * The post-probe half of D1's two-factor rule.
 *
 * - pong → alive and serving → refuse the newcomer.
 * - no pong but TCP still writable → *busy*, not dead → refuse the newcomer.
 * - neither → dead → displace it.
 */
export function resolveProbe(
  incumbent: ProbeableSocket,
  pongedWithinWindow: boolean,
): ClaimDecision {
  if (pongedWithinWindow) return { outcome: "refuse", reason: "incumbent-alive" };
  if (isSocketAlive(incumbent)) return { outcome: "refuse", reason: "incumbent-alive" };
  return { outcome: "displace", reason: "incumbent-dead" };
}

/** Render a pid for the refusal log line; an unknown pid must not omit the field. */
export function formatPid(pid: number | undefined): string {
  return pid === undefined ? "unknown" : String(pid);
}

/**
 * The refusal log line. Deliberately NOT of the form
 * `[gateway] session registered: <id> cwd=<cwd>` so it is greppable as its own
 * signal — the incident's single distinguishing symptom was that the two were
 * indistinguishable.
 */
export function formatContentionLine(
  sessionId: string,
  incumbentPid: number | undefined,
  newcomerPid: number | undefined,
): string {
  return `[gateway] contention refused: ${sessionId} incumbentPid=${formatPid(incumbentPid)} newcomerPid=${formatPid(newcomerPid)}`;
}

export interface ContentionRecord {
  sessionId: string;
  incumbentPid?: number;
  newcomerPid?: number;
  at: number;
  refusals: number;
}

/**
 * Contention records + cumulative counter + per-id rate limit.
 *
 * A record is a *recorded event*, not a live routing state (D4): with D0/D1 the
 * map cannot hold a usurper, so it is cleared by whichever comes first —
 * reclaim, TTL expiry, incumbent disconnect, or session end.
 */
export function createContentionTracker(now: () => number = Date.now) {
  const records = new Map<string, ContentionRecord>();
  const lastEmit = new Map<string, number>();
  let totalRefusals = 0;

  function expire() {
    const t = now();
    for (const [sid, rec] of records) {
      if (t - rec.at >= CONTENTION_RECORD_TTL) records.delete(sid);
    }
  }

  return {
    /**
     * Record a refusal. Always counts; returns whether this refusal should be
     * *emitted* (log line + health entry), which is rate-limited per session id
     * so an old bridge that ignores the rejection cannot flood either surface.
     */
    record(sessionId: string, incumbentPid?: number, newcomerPid?: number): boolean {
      const t = now();
      totalRefusals++;
      const existing = records.get(sessionId);
      records.set(sessionId, {
        sessionId,
        incumbentPid,
        newcomerPid,
        at: t,
        refusals: (existing?.refusals ?? 0) + 1,
      });
      const last = lastEmit.get(sessionId);
      if (last !== undefined && t - last < CONTENTION_RATE_LIMIT) return false;
      lastEmit.set(sessionId, t);
      return true;
    },

    /** True when a live (unexpired) contention record exists for the id. */
    isContended(sessionId: string): boolean {
      expire();
      return records.has(sessionId);
    },

    get(sessionId: string): ContentionRecord | undefined {
      expire();
      return records.get(sessionId);
    },

    /** Clear on reclaim, incumbent disconnect, or session end. */
    clear(sessionId: string): void {
      records.delete(sessionId);
      lastEmit.delete(sessionId);
    },

    /** The currently contended ids, for `/api/health`. */
    contendedIds(): string[] {
      expire();
      return [...records.keys()];
    },

    /** Cumulative for the process lifetime; never reset by expiry. */
    count(): number {
      return totalRefusals;
    },
  };
}

export type ContentionTracker = ReturnType<typeof createContentionTracker>;
