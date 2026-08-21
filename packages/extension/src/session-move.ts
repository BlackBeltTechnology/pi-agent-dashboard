/**
 * Explicit session move: overlap the two connections, then commit (D11).
 *
 * `ConnectionManager` owns exactly one socket, and `updateUrl()` sets the URL
 * and immediately tears the socket down. That is a GAP, not a handover — the
 * origin dies before the target exists, and whatever is sent meanwhile is
 * buffered against a socket that never returns.
 *
 * So the move is coordinated ABOVE the connection rather than inside it: two
 * connections exist briefly, and the swap happens at a single instant. The
 * invariant that matters is send ownership (task 9.3c):
 *
 *   **exactly one connection owns sends at every instant.**
 *
 * Two owners duplicates a prompt; zero owners drops it. Both fail silently,
 * which is why ownership is an explicit piece of state here and not an
 * emergent consequence of which sockets happen to be open.
 *
 * The sequencing is deliberately pessimistic — the origin keeps serving until
 * the target has *proven* it can take over:
 *
 *   1. connect the target and open a PROVISIONAL registration (claims nothing);
 *   2. verify the answering instance is the one we expect (D14 — an address is
 *      not an identity);
 *   3. commit; only now does ownership move and the origin close.
 *
 * Every failure — refusal, wrong identity, timeout, transport error — takes the
 * same path: drop the target, keep the origin, stay usable. A move that cannot
 * complete must be a no-op, never an outage.
 *
 * See change: add-pi-gateway-transport-identity (tasks 9.3b, 9.3c).
 */

/** The slice of `ConnectionManager` a move needs. */
export interface MovableConnection {
  connect(): void;
  disconnect(): void;
  send(message: unknown): void;
  readonly isConnected: boolean;
  /** Register the inbound handler for this connection's frames. */
  onMessage(handler: (msg: unknown) => void): void;
}

export type MoveFailureCause =
  | "refused"
  | "identity-mismatch"
  | "timeout"
  | "transport"
  | "move-in-progress";

export type MoveResult = { ok: true; instanceId: string } | { ok: false; cause: MoveFailureCause };

/** How long the whole handshake may take before it is abandoned. */
export const MOVE_TIMEOUT = 30_000;

export interface MoveCoordinator {
  begin(input: { targetUrl: string; expectInstanceId: string }): Promise<MoveResult>;
  /** Route a frame to whichever connection currently owns sends. */
  send(message: unknown): void;
  owner(): "origin" | "target";
}

export function createMoveCoordinator(opts: {
  origin: MovableConnection;
  sessionId: string;
  connect: (url: string) => MovableConnection;
  timeoutMs?: number;
  log?: (line: string) => void;
}): MoveCoordinator {
  const timeoutMs = opts.timeoutMs ?? MOVE_TIMEOUT;
  const log = opts.log ?? ((line: string) => console.log(line));

  // The single source of truth for "who is serving". Never inferred from
  // socket state: during the overlap BOTH sockets are open.
  let active: MovableConnection = opts.origin;
  let inFlight = false;

  return {
    owner() {
      return active === opts.origin ? "origin" : "target";
    },

    send(message) {
      active.send(message);
    },

    async begin({ targetUrl, expectInstanceId }) {
      // Two concurrent moves would race to reassign `active`, and the loser
      // would leave a live connection nobody owns.
      if (inFlight) return { ok: false, cause: "move-in-progress" };
      inFlight = true;

      const target = opts.connect(targetUrl);

      /** Every failure exits here: target dropped, origin untouched. */
      const abort = (cause: MoveFailureCause): MoveResult => {
        log(`[dashboard] session move aborted: ${opts.sessionId} -> ${targetUrl} (${cause})`);
        try {
          target.disconnect();
        } catch {
          /* the target is being discarded; a failure to close it changes nothing */
        }
        inFlight = false;
        return { ok: false, cause };
      };

      try {
        const outcome = await new Promise<MoveResult>((resolve) => {
          let settled = false;
          const settle = (r: MoveResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(r);
          };

          const timer = setTimeout(() => settle({ ok: false, cause: "timeout" }), timeoutMs);
          (timer as { unref?: () => void }).unref?.();

          target.onMessage((raw) => {
            const msg = raw as { type?: string; instanceId?: string; token?: string };
            if (msg?.type === "provisional_rejected") return settle({ ok: false, cause: "refused" });
            if (msg?.type !== "provisional_accepted") return;

            // Reaching the expected ADDRESS is not reaching the expected
            // dashboard: only the instance id distinguishes a same-address
            // impostor (D14).
            if (msg.instanceId !== expectInstanceId) {
              return settle({ ok: false, cause: "identity-mismatch" });
            }

            // Committed: the target has proven it can serve. Ownership moves
            // here, and only here.
            target.send({
              type: "session_move_commit",
              sessionId: opts.sessionId,
              token: msg.token,
            });
            settle({ ok: true, instanceId: msg.instanceId });
          });

          target.connect();
        });

        if (!outcome.ok) return abort(outcome.cause);

        // The single swap instant. The origin closes only after ownership has
        // already moved, so no frame can be written to a closing socket.
        active = target;
        opts.origin.disconnect();
        log(`[dashboard] session moved: ${opts.sessionId} -> ${targetUrl} (${outcome.instanceId})`);
        inFlight = false;
        return outcome;
      } catch {
        return abort("transport");
      }
    },
  };
}
