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
 *      The bridge reloads in-process by self-dispatching its
 *      `/__dashboard_reload` command (pi >= 0.84.2). At most one forwarded
 *      reload is in flight per session; a server deadline backstops the
 *      bridge's feedback (see "Forwarded-reload watch" below).
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
 * agent turn. (Measured on pi < 0.84.2. Since 0.84.2 the RPC-mode `prompt()`
 * path DOES honor `expandPromptTemplates` — which is what change
 * `retire-slash-dispatch-via-expand-prompt-templates` relies on for extension
 * slash commands via `pi.sendUserMessage`; this is about the `/__dashboard_reload`
 * sentinel, which is still never written to the keeper.) A pi BUILT-IN (`/help`)
 * written to the same socket behaved
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
export const RELOAD_IN_PROGRESS_MESSAGE = "A reload is already in progress for this session.";

/**
 * Deadline for the bridge's terminal `/reload` feedback after a forward. Above
 * the bridge's own 60 s finish timeout plus reconnect slack, so the two never
 * race into a double feedback.
 */
export const FORWARDED_RELOAD_DEADLINE_MS = 75_000;
export const RELOAD_DEADLINE_MESSAGE =
  "Reload did not report completion within 75 s — check the pi terminal.";

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
/**
 * Respawns currently in flight, keyed by session id.
 *
 * Without this, two reloads that arrive before the first respawn registers its
 * new PID both observe the OLD pid, both kill it, and both call
 * `spawnPiSession` — leaving one orphaned pi process the registry no longer
 * tracks (it only remembers the last registration). Concurrent callers now
 * await the SAME respawn instead of starting a competing one.
 *
 * Keyed per session, cleared in `finally`, so a failed respawn does not wedge
 * the session against future reloads.
 */
const inFlightRespawns = new Map<string, Promise<void>>();

/**
 * Forwarded-reload watch (design D5). One entry per session with a forwarded
 * `/reload` whose terminal feedback has not arrived. Independent of connection
 * state: the reload itself unregisters and re-registers the session. Cleared
 * only by `settleForwardedReload` or the deadline. In-memory by design — a
 * server restart drops pending watches and emits nothing.
 */
const forwardedReloads = new Map<string, { timer: ReturnType<typeof setTimeout>; armedAt: number }>();

/**
 * Sessions whose deadline expired: the bridge's late terminal feedback is
 * dropped (the server already reported `error`). TTL-bounded; cleared by the
 * next arm, so a retry's truthful feedback is never eaten.
 */
const expiredForwardedReloads = new Map<string, ReturnType<typeof setTimeout>>();

function clearExpiredMark(sessionId: string): void {
  const t = expiredForwardedReloads.get(sessionId);
  if (t !== undefined) {
    clearTimeout(t);
    expiredForwardedReloads.delete(sessionId);
  }
}

function armForwardedReload(
  sessionId: string,
  emitCommandFeedback: DispatchReloadContext["emitCommandFeedback"],
): void {
  clearExpiredMark(sessionId);
  const timer = setTimeout(() => {
    if (forwardedReloads.get(sessionId)?.timer !== timer) return;
    forwardedReloads.delete(sessionId);
    console.warn(`[reload] forwarded reload deadline expired for session ${sessionId}`);
    emitCommandFeedback(sessionId, RELOAD_COMMAND, "error", RELOAD_DEADLINE_MESSAGE);
    const ttl = setTimeout(() => expiredForwardedReloads.delete(sessionId), FORWARDED_RELOAD_DEADLINE_MS);
    ttl.unref?.();
    expiredForwardedReloads.set(sessionId, ttl);
  }, FORWARDED_RELOAD_DEADLINE_MS);
  timer.unref?.();
  forwardedReloads.set(sessionId, { timer, armedAt: Date.now() });
  console.log(`[reload] forwarded reload armed for session ${sessionId}`);
}

/**
 * Called for every terminal `/reload` `command_feedback` from a bridge.
 *   - `"settled"`: a live watch was cleared; pass the event through.
 *   - `"drop"`: the deadline already reported for this session; drop it.
 *   - `"none"`: no watch; pass the event through.
 */
export function settleForwardedReload(sessionId: string): "settled" | "drop" | "none" {
  const watch = forwardedReloads.get(sessionId);
  if (watch) {
    clearTimeout(watch.timer);
    forwardedReloads.delete(sessionId);
    console.log(`[reload] forwarded reload settled for session ${sessionId}`);
    return "settled";
  }
  if (expiredForwardedReloads.has(sessionId)) {
    clearExpiredMark(sessionId);
    console.warn(`[reload] dropped late reload feedback for session ${sessionId}`);
    return "drop";
  }
  return "none";
}

/** True when `data` is a terminal `/reload` `command_feedback` payload. */
export function isTerminalReloadFeedback(data: unknown): boolean {
  const d = data as { command?: unknown; status?: unknown } | null | undefined;
  return d?.command === RELOAD_COMMAND && (d.status === "completed" || d.status === "error");
}

/**
 * Event-wiring hook for an inbound bridge `event_forward`, run BEFORE the
 * replay-skip early return. Returns `"handled"` when the caller must stop:
 * the event was a late terminal `/reload` feedback (dropped), or it arrived
 * inside a replay-skip window and was persisted + broadcast here, since the
 * skip path would otherwise discard it. `"continue"` otherwise.
 * See change: fix-terminal-session-dashboard-reload (D5).
 */
export function routeReloadFeedback(
  sessionId: string,
  event: { eventType: string; data?: unknown },
  opts: { inReplaySkipWindow: boolean; persistAndBroadcast: () => void },
): "handled" | "continue" {
  if (event.eventType !== "command_feedback" || !isTerminalReloadFeedback(event.data)) return "continue";
  if (settleForwardedReload(sessionId) === "drop") return "handled";
  if (opts.inReplaySkipWindow) {
    opts.persistAndBroadcast();
    return "handled";
  }
  return "continue";
}

/** Test-only: drop every watch and expired mark. */
export function _resetForwardedReloads(): void {
  for (const w of forwardedReloads.values()) clearTimeout(w.timer);
  forwardedReloads.clear();
  for (const t of expiredForwardedReloads.values()) clearTimeout(t);
  expiredForwardedReloads.clear();
}

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

  // ── Join an in-flight respawn BEFORE the PID gate. The kill half of a
  // respawn removes the old PID, so a concurrent reload that checked the
  // registry first would see no PID, fall through the ladder, and report a
  // spurious error — or, if it arrived a moment earlier, start a competing
  // spawn. "A respawn is already running for this session" is the stronger
  // fact and is therefore checked first.
  const inFlight = inFlightRespawns.get(sessionId);
  if (inFlight) {
    await inFlight;
    return "respawn";
  }

  // ── Ladder step 2: kill-and-respawn, the only real reload for a headless
  // session. The busy decision above was made with connection awareness the
  // respawn helper lacks, so its own streaming guard is suppressed.
  if (ctx.headlessPidRegistry.getPid(sessionId) !== undefined) {
    const run = ctx
      .respawn(sessionId, { ignoreStreamingGuard: true })
      .finally(() => inFlightRespawns.delete(sessionId));
    inFlightRespawns.set(sessionId, run);
    await run;
    return "respawn";
  }

  // ── At most one forwarded reload in flight per session. Checked before the
  // connection probe: the reload itself briefly unregisters the session.
  // See change: fix-terminal-session-dashboard-reload (D5).
  if (forwardedReloads.has(sessionId)) {
    ctx.emitCommandFeedback(sessionId, RELOAD_COMMAND, "error", RELOAD_IN_PROGRESS_MESSAGE);
    return "refused";
  }

  // ── Ladder step 3: forward to the bridge (terminal-hosted). Gated on
  // `sendToSession`'s RETURN VALUE, not the connection probe alone: the socket
  // can close between the two.
  if (connected && ctx.sendToSession(sessionId, RELOAD_COMMAND)) {
    armForwardedReload(sessionId, ctx.emitCommandFeedback);
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
