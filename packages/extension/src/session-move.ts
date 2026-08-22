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

import { isRemoteEndpoint } from "./remote-registration-gate.js";

/**
 * Whether the session's `.jsonl` can follow it to `targetUrl` (task 9.8).
 *
 * Decided from the endpoint's LOCALITY, not by asking the target: a unix socket
 * or a loopback dial is the same host, therefore the same filesystem, therefore
 * the same absolute `sessionFile` path. A remote target is a different disk,
 * and the transcript stays behind — history and resume do not follow.
 *
 * Deliberately NOT implemented by sending the path to the target and asking it
 * to stat: a path on the wire is the exact shape `decideTranscriptRequest`
 * refuses (task 11.3), and re-introducing it here for a convenience warning
 * would reopen it as a probing primitive.
 */
export function assessTranscriptFollow(input: {
  targetUrl: string;
  sessionFile?: string;
}): { follows: boolean; warning?: string } {
  if (!input.sessionFile) {
    return {
      follows: false,
      warning: "this session has no transcript file, so no history will follow the move",
    };
  }
  if (isRemoteEndpoint(input.targetUrl)) {
    return {
      follows: false,
      warning:
        `the target ${input.targetUrl} is on another host: the transcript stays on this machine, ` +
        "so history and resume will not follow the move",
    };
  }
  return { follows: true };
}

/** The slice of `ConnectionManager` a move needs. */
export interface MovableConnection {
  connect(): void;
  disconnect(): void;
  send(message: unknown): void;
  readonly isConnected: boolean;
  /** Register the inbound handler for this connection's frames. */
  onMessage(handler: (msg: unknown) => void): void;
}

type MoveFailureCause =
  | "refused"
  | "identity-mismatch"
  | "timeout"
  | "transport"
  | "move-in-progress";

type MoveResult = { ok: true; instanceId: string } | { ok: false; cause: MoveFailureCause };

/** How long the whole handshake may take before it is abandoned. */
const MOVE_TIMEOUT = 30_000;

export interface MoveCoordinator {
  begin(input: { targetUrl: string; expectInstanceId: string }): Promise<MoveResult>;
  /**
   * The endpoint a completed move pinned, or `undefined` if no move has
   * completed (task 9.2).
   *
   * **Process-lifetime only, by decision.** A move is a runtime act, not a
   * config change: nothing is written to disk, so a restarted pi re-resolves
   * through the normal D3 ladder. A persisted pin would also have to be given a
   * rung on that ladder, and any rung above `PI_DASHBOARD_URL` would resurrect
   * the silent-override class this change exists to remove.
   *
   * Feeds `decideRetarget({ pinned })` — the EXISTING stickiness gate — rather
   * than adding a second, competing notion of pinning.
   */
  pinnedEndpoint(): string | undefined;
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
  /** The session's transcript path, used only to warn about what will not follow (9.8). */
  sessionFile?: string;
  /** Surfaced to the user before the move proceeds. */
  warn?: (line: string) => void;
}): MoveCoordinator {
  const timeoutMs = opts.timeoutMs ?? MOVE_TIMEOUT;
  const log = opts.log ?? ((line: string) => console.log(line));

  // The single source of truth for "who is serving". Never inferred from
  // socket state: during the overlap BOTH sockets are open.
  let active: MovableConnection = opts.origin;
  let inFlight = false;
  let pinned: string | undefined;

  return {
    owner() {
      return active === opts.origin ? "origin" : "target";
    },

    pinnedEndpoint() {
      return pinned;
    },

    send(message) {
      active.send(message);
    },

    async begin({ targetUrl, expectInstanceId }) {
      // Two concurrent moves would race to reassign `active`, and the loser
      // would leave a live connection nobody owns.
      if (inFlight) return { ok: false, cause: "move-in-progress" };
      inFlight = true;

      // Warn, do not block (task 9.8). Moving a session whose history cannot
      // follow is a legitimate thing to want; silently discovering it
      // afterwards is not.
      const follow = assessTranscriptFollow({ targetUrl, sessionFile: opts.sessionFile });
      if (follow.warning) {
        (opts.warn ?? log)(`[dashboard] session move warning: ${follow.warning}`);
      }

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

        // Tell the ORIGIN where the session went, in the one window where
        // both facts are known and it can still be reached: after the commit
        // succeeded, before its connection is released. Skipping this is what
        // makes a clean move look like a crash (task 9.3).
        try {
          opts.origin.send({
            type: "session_moved",
            sessionId: opts.sessionId,
            instanceId: outcome.instanceId,
            endpoint: targetUrl,
          });
        } catch {
          // Best-effort: the move already succeeded, and failing to narrate it
          // must not undo it.
        }

        // The single swap instant. The origin closes only after ownership has
        // already moved, so no frame can be written to a closing socket.
        active = target;
        // Pin the destination so the stickiness rule keeps the session here:
        // without it a reconnect could resolve straight back to the instance
        // the user just moved off (task 9.2).
        pinned = targetUrl;
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
