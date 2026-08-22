/**
 * Provisional registration: announcing intent to serve a session, without
 * claiming it.
 *
 * An explicit move (D11) needs the target to prove it can serve BEFORE the
 * origin lets go. A plain second `session_register` cannot express that — B4:
 * `decideClaim` fast-accepts a same-pid newcomer with no probe (and a move is
 * same-pid by construction), then `connections.set()` hands over routing the
 * instant the register lands, after which the origin's sends are dropped by the
 * ownership gate. The origin is severed before the target has done anything.
 *
 * So a provisional register claims NOTHING: no routing entry, no contention
 * slot, no heartbeat. It returns the target's instance id — the fact the origin
 * needs to verify identity — and a token. Routing transfers only on commit.
 *
 * Two properties are load-bearing and easy to lose:
 *
 *   - **A provisional refusal is not a `register_rejected`.** The bridge treats
 *     that message as terminal and sets `intentionalClose`, so a refused move
 *     would kill the session it was trying to preserve (9.3a-i).
 *   - **A refusal discloses nothing about the session.** Otherwise the mode is
 *     an oracle for enumerating live sessions (9.3a-iv). The true cause goes to
 *     the server log, the same asymmetry the bridge upgrade gate already uses.
 *
 * See change: add-pi-gateway-transport-identity (D11; task 9.3a).
 */

import { randomBytes } from "node:crypto";

/** How long an unclaimed provisional survives before it is discarded. */
export const PROVISIONAL_TTL = 30_000;

type ProvisionalRefusalCause =
  | "no-such-session"
  | "session-live-elsewhere"
  | "expired"
  | "unknown-token"
  | "already-committed";

interface ProvisionalEntry {
  sessionId: string;
  instanceId: string;
  openedAt: number;
  committed: boolean;
}

/** What the caller is told. Deliberately carries no detail. */
interface ProvisionalRejectedWire {
  type: "provisional_rejected";
}

export interface ProvisionalRegistry {
  open(input: { sessionId: string; instanceId: string }): { token: string; instanceId: string };
  commit(token: string): { ok: true } | { ok: false; cause: ProvisionalRefusalCause };
  abandon(token: string): void;
  isCommitted(token: string): boolean;
  size(): number;
  refuseForWire(input: {
    sessionId: string;
    cause: ProvisionalRefusalCause;
  }): ProvisionalRejectedWire;
}

export function createProvisionalRegistry(opts: {
  now?: () => number;
  ttlMs?: number;
  log?: (line: string) => void;
}): ProvisionalRegistry {
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? PROVISIONAL_TTL;
  const log = opts.log ?? ((line: string) => console.warn(line));
  const entries = new Map<string, ProvisionalEntry>();

  /** Discard everything past its TTL. Expiry and failure are the same fate. */
  const sweep = (): void => {
    const cutoff = now() - ttl;
    for (const [token, entry] of entries) {
      if (entry.openedAt <= cutoff) entries.delete(token);
    }
  };

  return {
    open({ sessionId, instanceId }) {
      sweep();
      const token = randomBytes(18).toString("base64url");
      entries.set(token, { sessionId, instanceId, openedAt: now(), committed: false });
      return { token, instanceId };
    },

    commit(token) {
      // Look up BEFORE sweeping: sweeping first collapses "expired" into
      // "unknown token", and those are different operational facts — one means
      // the move took too long, the other means the token was never ours.
      const entry = entries.get(token);
      sweep();
      if (!entry) return { ok: false, cause: "unknown-token" };
      if (entry.committed) return { ok: false, cause: "already-committed" };
      if (now() - entry.openedAt > ttl) {
        entries.delete(token);
        return { ok: false, cause: "expired" };
      }
      entry.committed = true;
      return { ok: true };
    },

    abandon(token) {
      entries.delete(token);
    },

    isCommitted(token) {
      return entries.get(token)?.committed === true;
    },

    size() {
      sweep();
      return entries.size;
    },

    refuseForWire({ sessionId, cause }) {
      // Cause + subject server-side only. The wire response is a constant, so
      // two refusals cannot be differenced into an existence check.
      log(`[gateway] provisional refused: session=${sessionId} cause=${cause}`);
      return { type: "provisional_rejected" };
    },
  };
}
