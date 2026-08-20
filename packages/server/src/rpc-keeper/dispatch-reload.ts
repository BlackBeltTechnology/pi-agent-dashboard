/**
 * The single server-side reload entry point.
 *
 * Every reload trigger — the reload button / `/reload` in the composer,
 * `scripts/reload-all.sh`, the pi retry-policy settings save, package
 * install/remove, and `POST /api/resources/reload` — routes through
 * `dispatchReload`. (pi-core update is a *runtime swap*, not a reload, and is
 * routed to `respawnForRuntimeSwap` directly by its own call site.)
 *
 * Resolution ladder:
 *   1. Busy (streaming with a live bridge, or compacting) → refuse. Respawning
 *      mid-run destroys in-flight work. The refusal deliberately does NOT fire
 *      on a *stale* `streaming` — a session whose bridge died before
 *      `agent_end` is pinned there forever and is exactly what the respawn
 *      path exists to rescue.
 *   2. Headless PID → kill-and-respawn. This is the only mechanism that
 *      actually reloads a headless session (see below).
 *   3. No PID but a live bridge → forward `/reload` (terminal-hosted case).
 *      The bridge reloads in-process IF a human once typed
 *      `/__dashboard_reload` in its TUI, and reports an honest error if not.
 *   4. Neither → a terminal `error`. A session with NO registered PID is NEVER
 *      respawned: that would start a second pi process against a
 *      terminal-hosted session's file.
 *
 * ## Why there is no in-process path for headless sessions
 *
 * An earlier revision wrote `/__dashboard_reload` to the session's RPC keeper,
 * on the claim that pi's RPC mode runs a dispatched line through
 * `session.prompt()` WITH command handling. Measured in the docker harness
 * with `keeperLog.capturePiOutput = true`: it does not. pi delivered the
 * literal text to the MODEL as an ordinary user prompt and produced a full
 * agent turn. A pi BUILT-IN (`/help`) written to the same socket behaved
 * identically, so this is not the `__` prefix and not our registration.
 *
 * Dispatching a reload that way would inject a junk user message into the
 * operator's transcript, burn a model round-trip, and report `completed`
 * because the socket write succeeded — strictly worse than the silent no-op it
 * was meant to fix. Do not reintroduce it without re-measuring pi first.
 *
 * Feedback contract: exactly one terminal `command_feedback` per reload,
 * always keyed `/reload` regardless of which path resolved it.
 *
 * See change: fix-out-of-band-reload.
 */
import type { HeadlessPidRegistry } from "../spawn-process/headless-pid-registry.js";

/** The command every reload's terminal feedback is keyed by. */
const RELOAD_COMMAND = "/reload";

/** Mirrors pi's own TUI refusal wording. */
export const RELOAD_BUSY_MESSAGE =
  "Wait for the current response to finish before reloading.";
export const RELOAD_COMPACTING_MESSAGE =
  "Wait for context compaction to finish before reloading.";
const RELOAD_NO_PATH_MESSAGE =
  "No reload path available for this session (no headless process, no bridge connection).";
const RELOAD_SESSION_NOT_FOUND_MESSAGE = "Session not found";

/** What `dispatchReload` actually did. Returned for fan-out accounting. */
export type ReloadOutcome =
  /** Kill-and-respawn ran. */
  | "respawn"
  /** Forwarded to the bridge over the session WebSocket. */
  | "forwarded"
  /** Refused because the session is busy (streaming / compacting). */
  | "refused"
  /** No path available. */
  | "error";

/** Minimal session shape the ladder reads. */
interface ReloadSessionSnapshot {
  status: string;
  compacting?: boolean;
}

export interface DispatchReloadContext {
  headlessPidRegistry: Pick<HeadlessPidRegistry, "getPid" | "listSessions">;
  getSession(sessionId: string): ReloadSessionSnapshot | undefined;
  isSessionConnected(sessionId: string): boolean;
  /** Returns false when the socket is closed/absent — the reload was NOT delivered. */
  sendToSession(sessionId: string, text: string): boolean;
  /**
   * Kill-and-respawn the headless pi process. Emits its own terminal
   * `command_feedback`, so callers must not emit a second one.
   * `ignoreStreamingGuard` is set by the ladder, which has already made the
   * busy decision with connection awareness the respawn helper lacks.
   */
  respawn(
    sessionId: string,
    opts: { ignoreStreamingGuard: boolean },
  ): Promise<void>;
  /** Persist + broadcast a terminal `command_feedback` for `sessionId`. */
  emitCommandFeedback(
    sessionId: string,
    command: string,
    status: "completed" | "error",
    message?: string,
  ): void;
}

/**
 * True when a reload must be refused rather than delivered.
 *
 * Compaction always refuses. `streaming` refuses only while a live bridge
 * connection makes the status trustworthy: with the bridge down, `streaming`
 * is a last-known value that may never advance, and refusing on it would make
 * the session permanently unreloadable.
 */
function isReloadBusy(
  session: ReloadSessionSnapshot,
  connected: boolean,
): false | { message: string } {
  if (session.compacting === true) return { message: RELOAD_COMPACTING_MESSAGE };
  if (session.status === "streaming" && connected) {
    return { message: RELOAD_BUSY_MESSAGE };
  }
  return false;
}

/**
 * The session ids a reload fan-out should target: everything with a live
 * bridge connection UNION everything the registry knows is alive. The union is
 * what makes the respawn path reachable from an automated trigger — a headless
 * session with a dead bridge is invisible to `getConnectedSessionIds()` and
 * stamped `ended` in `sessionManager`, yet its pi is alive and respawnable.
 */
export function reloadTargetSessionIds(
  connectedIds: readonly string[],
  registry: Pick<HeadlessPidRegistry, "listSessions">,
): string[] {
  const ids = new Set<string>(connectedIds);
  for (const entry of registry.listSessions()) ids.add(entry.sessionId);
  return [...ids];
}

export async function dispatchReload(
  sessionId: string,
  ctx: DispatchReloadContext,
): Promise<ReloadOutcome> {
  const session = ctx.getSession(sessionId);
  const connected = ctx.isSessionConnected(sessionId);

  if (!session) {
    ctx.emitCommandFeedback(
      sessionId,
      RELOAD_COMMAND,
      "error",
      RELOAD_SESSION_NOT_FOUND_MESSAGE,
    );
    return "error";
  }

  const busy = isReloadBusy(session, connected);
  if (busy) {
    ctx.emitCommandFeedback(sessionId, RELOAD_COMMAND, "error", busy.message);
    return "refused";
  }

  // ── Ladder step 2: kill-and-respawn, the only real reload for a headless
  // session. The busy decision above was made with connection awareness the
  // respawn helper lacks, so its own streaming guard is suppressed.
  if (ctx.headlessPidRegistry.getPid(sessionId) !== undefined) {
    await ctx.respawn(sessionId, { ignoreStreamingGuard: true });
    return "respawn";
  }

  // ── Ladder step 3: forward to the bridge (terminal-hosted). Gated on
  // `sendToSession`'s RETURN VALUE, not the connection probe alone: the socket
  // can close between the two.
  if (connected && ctx.sendToSession(sessionId, RELOAD_COMMAND)) {
    return "forwarded";
  }

  // ── Ladder step 4: nothing left to try. Never respawn a PID-less session.
  ctx.emitCommandFeedback(
    sessionId,
    RELOAD_COMMAND,
    "error",
    RELOAD_NO_PATH_MESSAGE,
  );
  return "error";
}
