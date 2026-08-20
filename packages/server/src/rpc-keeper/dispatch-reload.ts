/**
 * The single server-side reload entry point.
 *
 * Every reload trigger — the reload button / `/reload` in the composer,
 * `scripts/reload-all.sh`, the pi retry-policy settings save, package
 * install/remove, and `POST /api/resources/reload` — routes through
 * `dispatchReload`. (pi-core update is a *runtime swap*, not a reload, and
 * is routed to `respawn` directly by its own call site.)
 *
 * Resolution ladder (design.md D1):
 *   1. live keeper → write the `/__dashboard_reload` pi RPC line to the
 *      keeper UDS. pi's RPC mode runs that line through `session.prompt()`
 *      WITH command handling, so the registered handler executes and calls
 *      `ctx.reload()` inside the running process. No kill, no bridge hop,
 *      no dependence on a TUI bootstrap.
 *   2. no keeper but a headless PID → forward over the bridge when one is
 *      live, else (or when the forward fails) kill-and-respawn.
 *   3. neither → forward to the bridge (terminal-hosted case), else an
 *      honest terminal `error`. A session with NO registered PID is NEVER
 *      respawned: doing so would spawn a second pi process against a
 *      terminal-hosted session's file.
 *
 * Busy sessions are refused, never dispatched (design.md D9): pi runs an
 * extension command immediately even mid-run, and `ctx.reload()`
 * invalidates the active runner, destroying in-flight work. The refusal
 * deliberately does NOT fire on a *stale* `streaming` — a session whose
 * bridge died before `agent_end` is pinned there forever and is exactly the
 * session the respawn fallback exists for.
 *
 * Feedback contract: exactly one terminal `command_feedback` per reload,
 * always keyed `/reload` regardless of the internal command name dispatched.
 * `completed` on the keeper path means "pi RECEIVED the line", not "the
 * reload finished" — a handler failure after delivery is not observable
 * today (pi writes `extension_error` to stdout, the keeper discards it).
 *
 * See change: fix-out-of-band-reload.
 */
import { randomUUID } from "node:crypto";
import type { HeadlessPidRegistry } from "../spawn-process/headless-pid-registry.js";
import { buildPiRpcLine } from "./dispatch-router.js";

/** The command every reload's terminal feedback is keyed by. */
const RELOAD_COMMAND = "/reload";
/** The pi command name actually dispatched over the keeper UDS. */
export const RELOAD_DISPATCH_COMMAND = "/__dashboard_reload";

/** Mirrors pi's own TUI refusal wording. */
export const RELOAD_BUSY_MESSAGE =
  "Wait for the current response to finish before reloading.";
export const RELOAD_COMPACTING_MESSAGE =
  "Wait for context compaction to finish before reloading.";
const RELOAD_NO_PATH_MESSAGE =
  "No reload path available for this session (no keeper, no headless process, no bridge connection).";
const RELOAD_SESSION_NOT_FOUND_MESSAGE = "Session not found";

/** What `dispatchReload` actually did. Returned for fan-out accounting. */
export type ReloadOutcome =
  /** Written to the keeper UDS — reloaded in-process. */
  | "keeper"
  /** Kill-and-respawn fallback taken. */
  | "respawn"
  /** Forwarded to the bridge over the session WebSocket. */
  | "forwarded"
  /** Refused because the session is busy (streaming / compacting). */
  | "refused"
  /** No path available, or every attempted path failed. */
  | "error";

/** Minimal session shape the ladder reads. */
interface ReloadSessionSnapshot {
  status: string;
  compacting?: boolean;
}

export interface DispatchReloadContext {
  headlessPidRegistry: Pick<
    HeadlessPidRegistry,
    "hasKeeper" | "getPid" | "writeRpc" | "listSessions"
  >;
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
 * is a last-known value that may never advance, and refusing on it would
 * make the session permanently unreloadable.
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
 * bridge connection UNION everything the registry knows is alive. The union
 * is what makes the fallback reachable from an automated trigger — a
 * keeper-backed session with a dead bridge is invisible to
 * `getConnectedSessionIds()` and stamped `ended` in `sessionManager`.
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

  const hasPid = ctx.headlessPidRegistry.getPid(sessionId) !== undefined;

  // ── Ladder step 1: in-process dispatch over the keeper UDS ────────────
  if (ctx.headlessPidRegistry.hasKeeper(sessionId)) {
    return dispatchViaKeeper(sessionId, ctx, hasPid);
  }

  // ── Ladder steps 2/3: forward over the bridge when one is live ────────
  // The fallback is gated on `sendToSession`'s RETURN VALUE, not on the
  // connection probe alone: the socket can close between the two.
  if (connected && ctx.sendToSession(sessionId, RELOAD_COMMAND)) {
    return "forwarded";
  }

  if (hasPid) return respawnFallback(sessionId, ctx);

  ctx.emitCommandFeedback(
    sessionId,
    RELOAD_COMMAND,
    "error",
    RELOAD_NO_PATH_MESSAGE,
  );
  return "error";
}

/**
 * Ladder step 1. Write the reload line to the keeper UDS.
 *
 * Both failure modes — a throw and a `false` return — mean the same thing:
 * the keeper we probed a moment ago is not usable now. With a headless PID we
 * still have a way to reload (respawn); without one there is nothing left to
 * try, so the reason is reported rather than swallowed.
 */
async function dispatchViaKeeper(
  sessionId: string,
  ctx: DispatchReloadContext,
  hasPid: boolean,
): Promise<ReloadOutcome> {
  const line = buildPiRpcLine(RELOAD_DISPATCH_COMMAND, randomUUID());
  let ok: boolean;
  try {
    ok = await ctx.headlessPidRegistry.writeRpc(sessionId, line);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return keeperUnusable(sessionId, ctx, hasPid, `Failed to write RPC line: ${reason}`);
  }
  if (!ok) {
    // Keeper socket gone between the probe and the write.
    return keeperUnusable(sessionId, ctx, hasPid, "RPC keeper unavailable for this session");
  }
  ctx.emitCommandFeedback(sessionId, RELOAD_COMMAND, "completed");
  return "keeper";
}

function keeperUnusable(
  sessionId: string,
  ctx: DispatchReloadContext,
  hasPid: boolean,
  reason: string,
): Promise<ReloadOutcome> {
  if (hasPid) return respawnFallback(sessionId, ctx);
  ctx.emitCommandFeedback(sessionId, RELOAD_COMMAND, "error", reason);
  return Promise.resolve("error");
}

/**
 * Take the kill-and-respawn fallback. The busy decision was already made by
 * the ladder (with connection awareness), so the respawn helper's own
 * `streaming` guard is suppressed — otherwise a bridge-dead session pinned
 * at `streaming` would be dead-lettered, which is precisely the session the
 * fallback exists to rescue (design.md D4).
 */
async function respawnFallback(
  sessionId: string,
  ctx: DispatchReloadContext,
): Promise<ReloadOutcome> {
  await ctx.respawn(sessionId, { ignoreStreamingGuard: true });
  return "respawn";
}
