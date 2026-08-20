/**
 * Session action handlers: send_prompt, abort, resume, spawn, shutdown, flow_control.
 */
import { existsSync } from "node:fs";
import type { BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";
import {
  isProcessAlive,
  killPidWithGroup,
  killProcess,
} from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import {
  findPidByMarker,
} from "@blackbelt-technology/pi-dashboard-shared/platform/process-identify.js";
import {
  type DispatchReloadContext,
  dispatchReload,
} from "../rpc-keeper/dispatch-reload.js";
import { createBranchedSessionFile } from "../session/session-file-reader.js";
import { keeperOptsFromSpawnResult } from "../spawn-process/headless-pid-registry.js";
import { getKeeperManager, spawnPiSession } from "../spawn-process/process-manager.js";
import { appendSpawnFailure } from "../spawn-process/spawn-failure-log.js";
import { preflightSpawn } from "../spawn-process/spawn-preflight.js";
import { armSpawnWatchdog, getSpawnRegisterWatchdog } from "../spawn-process/spawn-register-watchdog.js";
import { deriveSpawnCorrelationTtlMs } from "../spawn-process/spawn-recovery-window.js";
import type { BrowserHandlerContext } from "./handler-context.js";
import { isBareReloadCommand } from "./session-action-helpers.js";

/**
 * Status message + code emitted when fork is attempted on a session whose
 * `.jsonl` does not exist on disk yet (empty session, no persisted entries).
 * The dashboard silently degrades to a fresh spawn in the same cwd — fork
 * has no history to copy, so the user-meaningful semantic of "fork" and
 * "new" is identical here. The structured code lets the client surface a
 * non-blocking toast.
 * See change: fix-fork-empty-session-silent-timeout.
 */
export const FORK_DEGRADED_TO_NEW_MESSAGE =
  "Started a fresh session \u2014 the source had no persisted history to fork from.";
export const FORK_DEGRADED_TO_NEW_CODE = "FORK_DEGRADED_TO_NEW";

/**
 * The slice of `BrowserHandlerContext` the reload path actually needs.
 *
 * Narrower than the full handler context on purpose: the automated fan-out
 * triggers live in `server.ts` and `routes/`, where there is no browser
 * WebSocket to hang a full `BrowserHandlerContext` off. Without this slice
 * those call sites could not share the ladder, which is exactly how they
 * ended up hand-rolling `sendToSession` loops that bypassed it.
 *
 * See change: fix-out-of-band-reload.
 */
export type ReloadHostContext = Pick<
  BrowserHandlerContext,
  "sessionManager" | "eventStore" | "piGateway" | "headlessPidRegistry" | "broadcast"
>;

/**
 * Respawn a headless session because its pi-core BINARY changed.
 *
 * Shares the mechanism with a reload but not the policy: a reload of a BUSY
 * session is refused (respawning mid-stream destroys in-flight work), whereas
 * a runtime swap cannot be deferred that way — the operator has replaced the
 * binary under every running session, so this path respawns unconditionally,
 * including connected and streaming ones. Sessions that cannot be swapped
 * report `error` rather than silently succeeding (design.md D6).
 *
 * See change: fix-out-of-band-reload.
 */
export async function respawnForRuntimeSwap(
  sessionId: string,
  ctx: ReloadHostContext,
): Promise<void> {
  // A session with no registered PID is not ours to respawn: spawning here
  // would start a SECOND pi process against a terminal-hosted session's file.
  // Reported as an error rather than silently succeeding, so a pi-core swap
  // never claims to have swapped a session it structurally cannot swap.
  if (ctx.headlessPidRegistry.getPid(sessionId) === undefined) {
    emitCommandFeedback(
      ctx,
      sessionId,
      "error",
      "Not a headless session — pi-core update cannot swap its runtime",
    );
    return;
  }
  await handleHeadlessReload(
    { type: "send_prompt", sessionId, text: "/reload" } as any,
    ctx,
    { ignoreStreamingGuard: true },
  );
}

/**
 * Find headless pi PIDs associated with a session-id marker and kill them.
 * Delegates platform branching to `platform/process-identify.ts` — Windows
 * returns `[]` because command-line lookup isn't viable; Windows kills go
 * through `headlessPidRegistry` instead.
 * See change: consolidate-windows-spawn-and-platform-handlers.
 */
function killHeadlessBySessionId(sessionId: string): boolean {
  const pids = findPidByMarker(sessionId);
  if (pids.length === 0) return false;
  for (const pid of pids) {
    // `killPidWithGroup` is the canonical platform helper. Failures here
    // (e.g. ESRCH because the process is already dead) are non-fatal —
    // the caller treats "no matching PID" and "PID already dead" the
    // same way. Log and continue. See change:
    // route-kill-paths-through-platform.
    try {
      killPidWithGroup(pid, "SIGTERM");
    } catch (err) {
      console.warn(
        `[dashboard] killHeadlessBySessionId: killPidWithGroup(${pid}) failed:`,
        err,
      );
    }
  }
  return true;
}

/**
 * Emit a `command_feedback` DashboardEvent to all subscribed browsers.
 * Mirrors what the bridge's command-handler does for TUI `/reload`, but from
 * the server side for the headless-reload path.
 *
 * See change: headless-reload-via-respawn.
 */
function emitCommandFeedback(
  ctx: ReloadHostContext,
  sessionId: string,
  status: "started" | "completed" | "error",
  message?: string,
  command = "/reload",
): void {
  const event = {
    eventType: "command_feedback",
    timestamp: Date.now(),
    data: { command, status, ...(message ? { message } : {}) },
  };
  const seq = ctx.eventStore.insertEvent(sessionId, event);
  ctx.broadcast({ type: "event", sessionId, seq, event } as any);
}

/**
 * Bind a `BrowserHandlerContext` to the reload ladder's dependency surface.
 *
 * Exported so the fan-out call sites in `server.ts` and
 * `resource-activation-routes.ts` reload through exactly the same ladder as
 * the reload button, instead of each hand-rolling a `sendToSession` loop that
 * bypasses the interception entirely.
 *
 * See change: fix-out-of-band-reload.
 */
export function buildDispatchReloadContext(
  ctx: ReloadHostContext,
): DispatchReloadContext {
  return {
    headlessPidRegistry: ctx.headlessPidRegistry,
    getSession: (sid) => ctx.sessionManager.get(sid),
    isSessionConnected: (sid) => ctx.piGateway.isSessionConnected(sid),
    sendToSession: (sid, text) =>
      ctx.piGateway.sendToSession(sid, {
        type: "send_prompt",
        sessionId: sid,
        text,
      }),
    respawn: (sid, opts) =>
      handleHeadlessReload(
        { type: "send_prompt", sessionId: sid, text: "/reload" } as any,
        ctx,
        opts,
      ),
    emitCommandFeedback: (sid, command, status, message) =>
      emitCommandFeedback(ctx, sid, status, message, command),
  };
}

/**
 * Headless-session `/reload` handler.
 *
 * pi-coding-agent 0.68.0 has no programmatic reload path accessible to an
 * extension in RPC mode:
 *   - `ExtensionContext` (delivered to `session_start`) has no `reload` field
 *   - The RPC protocol has no `{type:"reload"}` command
 *   - The `globalThis[RELOAD_KEY]` bootstrap requires a human to type
 *     `/__dashboard_reload` in pi's TUI, which headless sessions lack.
 *
 * Instead, the server achieves a reload-equivalent outcome by killing the
 * headless pi process and respawning it with `--session <file>`, which
 * re-hydrates the same `sessionId` and entry list. Because
 * `memorySessionManager.register` carries accumulated state (tokens, cost,
 * context usage, attachedProposal) when the same sessionId re-registers,
 * the user-visible session state survives the respawn.
 *
 * Since change: fix-out-of-band-reload this is reached through
 * `dispatchReload` (which owns the busy decision) and through
 * `respawnForRuntimeSwap` for a pi-core binary swap — but it remains the
 * DEFAULT mechanism for a headless session, because pi's RPC `{type:"prompt"}`
 * performs no slash-command dispatch and there is therefore no in-process path
 * to reach. See `rpc-keeper/dispatch-reload.ts` for the measurement.
 *
 * See change: headless-reload-via-respawn.
 */
export async function handleHeadlessReload(
  msg: Extract<BrowserToServerMessage, { type: "send_prompt" }>,
  ctx: ReloadHostContext,
  opts: {
    /**
     * Skip the `status === "streaming"` refusal. Set by callers that have
     * already made the busy decision with information this helper lacks:
     * `dispatchReload` (a bridge-dead session pinned at a stale `streaming`
     * must stay respawnable, design.md D4) and the pi-core runtime swap (the
     * process is being replaced, not reloaded under a live runner, D6).
     */
    ignoreStreamingGuard?: boolean;
  } = {},
): Promise<void> {
  const { sessionManager, headlessPidRegistry } = ctx;
  const session = sessionManager.get(msg.sessionId);
  if (!session) {
    emitCommandFeedback(ctx, msg.sessionId, "error", "Session not found");
    return;
  }
  if (!session.sessionFile) {
    emitCommandFeedback(
      ctx,
      msg.sessionId,
      "error",
      "No session file — cannot respawn on reload",
    );
    return;
  }
  if (session.status === "streaming" && !opts.ignoreStreamingGuard) {
    emitCommandFeedback(
      ctx,
      msg.sessionId,
      "error",
      "Wait for the current response to finish before reloading.",
    );
    return;
  }

  emitCommandFeedback(ctx, msg.sessionId, "started");

  // SIGTERM → 2 s → SIGKILL the old headless pi. No-op if already dead
  // (idempotency guard). See change: fix-keeper-kill-escalation.
  await headlessPidRegistry.killBySessionId(msg.sessionId);

  // Respawn with the same session file. The new pi process re-hydrates the
  // same sessionId, the bridge re-registers, and the server preserves
  // accumulated state (tokens/cost/context/attachedProposal).
  let spawnResult: Awaited<ReturnType<typeof spawnPiSession>>;
  try {
    spawnResult = await spawnPiSession(session.cwd, {
      sessionFile: session.sessionFile,
      mode: "continue",
      strategy: "headless",
    });
    // Headless reload is a spawn entry point: arm so a refused duplicate is
    // reclaimed. See change: fix-duplicate-bridge-registration (D0/D2).
    armSpawnWatchdog(session.cwd, "headless", spawnResult);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[dashboard] headless reload spawn failed: ${message}`);
    const endedAt = Date.now();
    sessionManager.update(msg.sessionId, { status: "ended", endedAt });
    ctx.broadcast({
      type: "session_updated",
      sessionId: msg.sessionId,
      updates: { status: "ended", endedAt },
    });
    emitCommandFeedback(ctx, msg.sessionId, "error", message);
    return;
  }

  if (!spawnResult.success) {
    console.error(
      `[dashboard] headless reload spawn failed: ${spawnResult.message}`,
    );
    const endedAt = Date.now();
    sessionManager.update(msg.sessionId, { status: "ended", endedAt });
    ctx.broadcast({
      type: "session_updated",
      sessionId: msg.sessionId,
      updates: { status: "ended", endedAt },
    });
    emitCommandFeedback(ctx, msg.sessionId, "error", spawnResult.message);
    return;
  }

  if (spawnResult.pid && spawnResult.process) {
    headlessPidRegistry.register(
      spawnResult.pid,
      session.cwd,
      spawnResult.process,
      spawnResult.spawnToken,
      keeperOptsFromSpawnResult(spawnResult),
    );
  }

  emitCommandFeedback(ctx, msg.sessionId, "completed");
}

export async function handleSendPrompt(
  msg: Extract<BrowserToServerMessage, { type: "send_prompt" }>,
  ctx: BrowserHandlerContext,
): Promise<void> {
  const { sessionManager, piGateway, headlessPidRegistry, pendingResumeRegistry, pendingResumeIntents, pendingDashboardSpawns, broadcast } = ctx;

  // Route the bare `/reload` through the single server-side reload entry
  // point: busy → refuse, headless PID → respawn, live bridge → forward, else
  // an honest error. Routing here (rather than only in the four automated
  // fan-outs) is what makes every trigger converge on one observable outcome.
  // See change: fix-out-of-band-reload.
  if (isBareReloadCommand(msg)) {
    await dispatchReload(msg.sessionId, buildDispatchReloadContext(ctx));
    return;
  }

  const promptSession = sessionManager.get(msg.sessionId);

  // Reopen path fires for a cleanly-ended session OR a crash-orphaned "zombie":
  // a dashboard-spawned session stuck at status "active" whose process is gone
  // (no bridge + no keeper). Without the zombie arm the send fell through to
  // `sendToSession` → "no bridge connection" and the prompt was dropped forever,
  // because the auto-resume was gated on status==="ended" alone. See change:
  // resume-zombie-active-session.
  if (
    promptSession &&
    (promptSession.status === "ended" ||
      shouldReopenDashboardZombie(
        promptSession,
        isSessionProcessGone(msg.sessionId, (id) => piGateway.isSessionConnected(id)),
      ))
  ) {
    // Normalize a zombie's stale "active" to "ended" so the rest of this block
    // drives the SAME proven ended→alive resume flow (pendingResume + continue).
    if (promptSession.status !== "ended") {
      sessionManager.update(msg.sessionId, { status: "ended" });
    }
    if (!promptSession.sessionFile) {
      console.error(`[dashboard] auto-resume failed: no session file for session ${msg.sessionId}`);
      return;
    }
    // Third continue-spawn site, so it needs D5's file guard too: a stale
    // zombie record whose sessionFile a live bridge already serves under
    // another id would otherwise mint a second pi against that transcript —
    // the incident's exact shape. See change:
    // fix-duplicate-bridge-registration (D5).
    if (promptSession.sessionFile) {
      const liveHolder = ctx.piGateway.findLiveSessionBySessionFile?.(promptSession.sessionFile);
      if (liveHolder && liveHolder !== msg.sessionId) {
        console.error(
          `[dashboard] refusing reopen of ${msg.sessionId}: session file already served by live session ${liveHolder}`,
        );
        emitCommandFeedback(
          ctx,
          msg.sessionId,
          "error",
          `Session file is already served by live session ${liveHolder}`,
        );
        return;
      }
    }
    const alreadyResuming = promptSession.resuming;
    pendingResumeRegistry.record(promptSession.cwd, {
      text: msg.text,
      images: msg.images,
      oldSessionId: msg.sessionId,
      sessionFile: promptSession.sessionFile,
    });
    if (alreadyResuming) return;
    // Tag the resume intent as "front" so the upcoming ended→alive
    // transition surfaces this card at the top of the alive tier. The
    // user is actively typing into this session; surfacing it matches
    // their mental model. See change: differentiate-resume-intent-by-trigger.
    pendingResumeIntents?.record(msg.sessionId, "front");
    sessionManager.update(msg.sessionId, { resuming: true });
    broadcast({ type: "session_updated", sessionId: msg.sessionId, updates: { resuming: true } });
    const autoResumeConfig = loadConfig();
    const spawnResult = await spawnPiSession(promptSession.cwd, {
      sessionFile: promptSession.sessionFile,
      mode: "continue",
      strategy: autoResumeConfig.spawnStrategy,
    });
    // No browser socket on this path — the reclaim runs regardless.
    armSpawnWatchdog(promptSession.cwd, autoResumeConfig.spawnStrategy as any, spawnResult);
    if (!spawnResult.success) {
      console.error(`[dashboard] auto-resume spawn failed: ${spawnResult.message}`);
      pendingResumeRegistry.consume(promptSession.cwd);
      sessionManager.update(msg.sessionId, { resuming: false });
      broadcast({ type: "session_updated", sessionId: msg.sessionId, updates: { resuming: false } });
    }
    if (spawnResult.dashboardSpawned && spawnResult.success) {
      pendingDashboardSpawns?.set(promptSession.cwd, (pendingDashboardSpawns?.get(promptSession.cwd) ?? 0) + 1);
    }
    if (spawnResult.process && spawnResult.pid) {
      headlessPidRegistry.register(
        spawnResult.pid,
        promptSession.cwd,
        spawnResult.process,
        spawnResult.spawnToken,
        keeperOptsFromSpawnResult(spawnResult),
      );
    }
  } else {
    const sent = piGateway.sendToSession(msg.sessionId, {
      type: "send_prompt",
      sessionId: msg.sessionId,
      text: msg.text,
      images: msg.images,
      delivery: msg.delivery,
    });
    if (!sent) {
      console.error(`[dashboard] send_prompt failed: no bridge connection for session ${msg.sessionId}`);
    }
  }
}

/**
 * Is a process carrier still holding this session? Keeper sidecar probe
 * (keeper PID + pi PID). Never throws — an unprobeable carrier reads as dead
 * so a genuine loss is never blocked from resuming.
 * See change: fix-recovery-exit-intent (task 6.1).
 */
function isSessionCarrierAlive(sessionId: string): boolean {
  try {
    return getKeeperManager().isKeeperAlive(sessionId);
  } catch {
    return false;
  }
}

/**
 * A session's process is provably GONE when neither a live bridge nor a live
 * keeper carries it. Distinguishes a genuinely-running session from a crash/
 * OOM/kill-9 "zombie" whose stale record never transitioned to "ended".
 * Reopening a zombie recovers it; reopening a LIVE session double-spawns (the
 * gateway session→connection map is last-write-wins → routing breaks), which is
 * why the bridge check is included, not just the keeper probe.
 * See change: resume-zombie-active-session.
 */
export function isSessionProcessGone(
  sessionId: string,
  isBridgeConnected: (id: string) => boolean,
  isCarrierAlive: (id: string) => boolean = isSessionCarrierAlive,
): boolean {
  return !isBridgeConnected(sessionId) && !isCarrierAlive(sessionId);
}

/**
 * Should a send with no live bridge REOPEN the session instead of dropping the
 * prompt? True only for a dashboard-spawned zombie: not cleanly "ended", its
 * process gone, and a `sessionFile` to continue from. Scoped to
 * `source === "dashboard"` so a cli/TUI session with a transient bridge drop is
 * never given a headless twin (the TUI owns its own lifecycle).
 * See change: resume-zombie-active-session.
 */
export function shouldReopenDashboardZombie(
  session: { status: string; source: string; sessionFile?: string | null },
  processGone: boolean,
): boolean {
  return (
    session.status !== "ended" &&
    session.source === "dashboard" &&
    !!session.sessionFile &&
    processGone
  );
}

export async function handleResumeSession(
  msg: Extract<BrowserToServerMessage, { type: "resume_session" }>,
  ctx: BrowserHandlerContext,
): Promise<void> {
  const { ws, sessionManager, pendingForkRegistry, headlessPidRegistry, pendingDashboardSpawns, pendingResumeIntents, pendingClientCorrelations, sendTo } = ctx;
  const session = sessionManager.get(msg.sessionId);
  if (!session) {
    sendTo(ws, { type: "resume_result", sessionId: msg.sessionId, success: false, message: "Session not found", code: "resume.session_not_found", requestId: msg.requestId });
    return;
  }
  // Resolve placement intent. Old browsers omit the field; default to
  // "front" so they keep getting today's behavior. Drag-to-resume sends
  // "keep" so the dropped slot is preserved through the resume round-trip.
  // See change: differentiate-resume-intent-by-trigger.
  const placement: "front" | "keep" = msg.placement ?? "front";
  if (!session.sessionFile) {
    sendTo(ws, { type: "resume_result", sessionId: msg.sessionId, success: false, message: "Session file is unknown (pre-migration session)", code: "resume.session_file_unknown", requestId: msg.requestId });
    return;
  }
  // Reject "already active" ONLY when the process is genuinely live. A zombie
  // (stale "active" status, dead bridge + keeper) must fall through to the
  // reopen path below, or it can never be recovered. See change:
  // resume-zombie-active-session.
  if (
    msg.mode === "continue" &&
    session.status !== "ended" &&
    !isSessionProcessGone(msg.sessionId, (id) => ctx.piGateway.isSessionConnected(id))
  ) {
    sendTo(ws, { type: "resume_result", sessionId: msg.sessionId, success: false, message: "Session is already active", code: "resume.already_active", requestId: msg.requestId });
    return;
  }
  // Session-file-keyed twin of the guard above — the actual mint point of the
  // incident's duplicate. Both guard sites must carry it or the hole stays
  // open on the other. See change: fix-duplicate-bridge-registration (D5).
  if (msg.mode === "continue") {
    const liveHolder = ctx.piGateway.findLiveSessionBySessionFile?.(session.sessionFile);
    if (liveHolder && liveHolder !== msg.sessionId) {
      sendTo(ws, {
        type: "resume_result",
        sessionId: msg.sessionId,
        success: false,
        message: `Session file is already served by live session ${liveHolder}`,
        code: "resume.session_file_already_live",
        requestId: msg.requestId,
      });
      return;
    }
  }
  // Defense-in-depth against the Class-2 double-spawn race: while a cold-start
  // recovery candidate's liveness is still unresolved (grace window open), a
  // surviving bridge may be about to reattach. Reopening now would spawn a
  // second pi for a sessionId whose process is alive, and the gateway
  // session→connection map is last-write-wins → message routing breaks. Refuse
  // until liveness is finalized (the UI shows a "verifying" state meanwhile).
  // See change: fix-recovery-offer-bridge-liveness-gate.
  if (msg.mode === "continue" && ctx.isRecoveryLivenessPending?.(msg.sessionId)) {
    sendTo(ws, { type: "resume_result", sessionId: msg.sessionId, success: false, message: "Verifying whether this session is still running…", code: "resume.already_resuming", requestId: msg.requestId });
    return;
  }
  if (session.resuming) {
    sendTo(ws, { type: "resume_result", sessionId: msg.sessionId, success: false, message: "Session is already being resumed", code: "resume.already_resuming", requestId: msg.requestId });
    return;
  }
  // Last line of defence before we spawn: PROBE the process rather than trust
  // upstream state. Every guard above reads in-memory status or a timing
  // window — exactly the assumptions that broke in this bug's lineage and
  // produced a second pi for one sessionId (gateway session→connection map is
  // last-write-wins, so message routing dies). A live keeper means the session
  // never needed reopening. See change: fix-recovery-exit-intent (D7).
  if (msg.mode === "continue" && isSessionCarrierAlive(msg.sessionId)) {
    console.info(`[recovery] refused reopen of ${msg.sessionId}: keeper still alive`);
    sendTo(ws, { type: "resume_result", sessionId: msg.sessionId, success: false, message: "This session is still running", code: "resume.already_active", requestId: msg.requestId });
    return;
  }
  // Fork preflight: silent-degrade when the source session has no on-disk
  // JSONL yet (empty session, no persisted entries). `pi --fork <missing>`
  // would crash silently and produce a 30s register-timeout; instead we
  // spawn a fresh pi in the same cwd and surface `code: FORK_DEGRADED_TO_NEW`
  // so the client can render a non-blocking toast. The parent's
  // attachedProposal (if any) is inherited via `pendingAttachRegistry`
  // since fork's own inheritance path doesn't run on this branch.
  // See change: fix-fork-empty-session-silent-timeout.
  if (msg.mode === "fork" && session.sessionFile && !existsSync(session.sessionFile)) {
    // Inherit attachedProposal from parent so the new session still
    // tracks the change the user was working on.
    const pendingAttachRegistry = ctx.pendingAttachRegistry;
    if (session.attachedProposal && pendingAttachRegistry) {
      pendingAttachRegistry.enqueue(session.cwd, session.attachedProposal);
    }
    const degradeConfig = loadConfig();
    // Fresh spawn: no sessionFile, no mode — just `pi --mode rpc`.
    const degradeResult = await spawnPiSession(session.cwd, {
      strategy: degradeConfig.spawnStrategy,
    });
    // Zombie reopen is a spawn entry point.
    const degradeTimeoutMs = armSpawnWatchdog(
      session.cwd,
      degradeConfig.spawnStrategy as any,
      degradeResult,
      ws,
      degradeConfig.spawnRegisterTimeoutMs,
    );
    if (degradeResult.process && degradeResult.pid) {
      headlessPidRegistry.register(
        degradeResult.pid,
        session.cwd,
        degradeResult.process,
        degradeResult.spawnToken,
        keeperOptsFromSpawnResult(degradeResult),
      );
    }
    if (msg.requestId && degradeResult.spawnToken && pendingClientCorrelations && degradeTimeoutMs !== undefined) {
      // TTL derived from the SAME timeout that armed the watchdog above, so the
      // correlation always outlives the recovery window.
      // See change: fix-spawn-correlation-ttl-coupling (D1).
      pendingClientCorrelations.record(
        degradeResult.spawnToken,
        msg.requestId,
        deriveSpawnCorrelationTtlMs(degradeTimeoutMs),
      );
    }
    if (degradeResult.dashboardSpawned && degradeResult.success) {
      pendingDashboardSpawns?.set(
        session.cwd,
        (pendingDashboardSpawns?.get(session.cwd) ?? 0) + 1,
      );
    }
    sendTo(ws, {
      type: "resume_result",
      sessionId: msg.sessionId,
      success: degradeResult.success,
      message: degradeResult.success ? FORK_DEGRADED_TO_NEW_MESSAGE : degradeResult.message,
      requestId: msg.requestId,
      ...(degradeResult.success ? { code: FORK_DEGRADED_TO_NEW_CODE } : {}),
    });
    return;
  }
  // For fork-from-message: create a pruned session file first
  let forkSessionFile = session.sessionFile;
  if (msg.mode === "fork" && msg.entryId) {
    try {
      forkSessionFile = createBranchedSessionFile(session.sessionFile, msg.entryId);
    } catch (err: any) {
      sendTo(ws, { type: "resume_result", sessionId: msg.sessionId, success: false, message: `Fork from entry failed: ${err.message}`, requestId: msg.requestId });
      return;
    }
  }

  // Tag the user-resume intent BEFORE spawning so the `onChange`
  // ended→alive branch in `server.ts` can distinguish a user-initiated
  // resume from a bridge auto-reattach on dashboard reboot, and choose
  // placement (front vs. keep) appropriately. The fork path also tags
  // but the tag is harmless: forks create new session ids that never
  // appear in the ended→alive branch.
  // See changes: preserve-session-order-on-reboot,
  //              differentiate-resume-intent-by-trigger.
  pendingResumeIntents?.record(msg.sessionId, placement);
  const resumeConfig = loadConfig();
  const result = await spawnPiSession(session.cwd, {
    sessionFile: forkSessionFile,
    mode: msg.mode,
    strategy: resumeConfig.spawnStrategy,
  });
  // WebSocket drag-to-resume / fork is a spawn entry point.
  const resumeTimeoutMs = armSpawnWatchdog(
    session.cwd,
    resumeConfig.spawnStrategy as any,
    result,
    ws,
    resumeConfig.spawnRegisterTimeoutMs,
  );
  // Record fork parent keyed by spawn token (was: keyed by cwd, racy on
  // multi-fork-in-same-cwd). See change: spawn-correlation-token.
  if (msg.mode === "fork" && pendingForkRegistry && result.spawnToken) {
    pendingForkRegistry.recordFork(
      result.spawnToken,
      msg.sessionId,
      deriveSpawnCorrelationTtlMs(resumeTimeoutMs ?? resumeConfig.spawnRegisterTimeoutMs),
    );
  }
  // Record client-correlation so the eventual session_added carries
  // spawnRequestId. See change: spawn-correlation-token.
  if (msg.requestId && result.spawnToken && pendingClientCorrelations && resumeTimeoutMs !== undefined) {
    pendingClientCorrelations.record(
      result.spawnToken,
      msg.requestId,
      deriveSpawnCorrelationTtlMs(resumeTimeoutMs),
    );
  }
  if (result.dashboardSpawned && result.success) {
    pendingDashboardSpawns?.set(session.cwd, (pendingDashboardSpawns?.get(session.cwd) ?? 0) + 1);
  }
  if (result.process && result.pid) {
    headlessPidRegistry.register(
      result.pid,
      session.cwd,
      result.process,
      result.spawnToken,
      keeperOptsFromSpawnResult(result),
    );
  }
  sendTo(ws, { type: "resume_result", sessionId: msg.sessionId, success: result.success, message: result.message, requestId: msg.requestId });
}

export async function handleSpawnSession(
  msg: Extract<BrowserToServerMessage, { type: "spawn_session" }>,
  ctx: BrowserHandlerContext,
): Promise<void> {
  const { ws, headlessPidRegistry, pendingDashboardSpawns, pendingAttachRegistry, pendingInitialPromptRegistry, pendingWorktreeBaseRegistry, pendingClientCorrelations, sendTo } = ctx;
  const config = loadConfig();
  const strategy = config.spawnStrategy ?? "tmux";

  // Queue the optional attach intent BEFORE awaiting the spawn so a fast
  // bridge `session_register` cannot lose the intent. See change:
  // add-folder-task-checker-and-spawn-attach. NOTE: at this point we don't
  // yet have a spawnToken (spawn hasn't run); we enqueue by cwd-FIFO and
  // re-record by token after spawnPiSession returns. See change:
  // spawn-correlation-token.
  if (typeof msg.attachProposal === "string" && msg.attachProposal.length > 0) {
    pendingAttachRegistry?.enqueue(msg.cwd, msg.attachProposal);
  }

  // Worktree base intent — same race-safe FIFO enqueue pattern as
  // attachProposal. Consumed by event-wiring's session_register hook to
  // write `.meta.json#gitWorktreeBase` so the WORKSPACE-subcard pill
  // can render `created from <base>` on later renders.
  // See change: add-worktree-spawn-dialog.
  if (typeof msg.gitWorktreeBase === "string" && msg.gitWorktreeBase.length > 0) {
    pendingWorktreeBaseRegistry?.enqueue(msg.cwd, msg.gitWorktreeBase);
  }

  // Initial-prompt intent — same race-safe FIFO enqueue pattern. Consumed by
  // event-wiring's session_register hook to dispatch the first prompt (e.g.
  // `/skill:project-init` from the no-hook Initialize button).
  // See change: project-init-skill-and-profiles.
  if (typeof msg.initialPrompt === "string" && msg.initialPrompt.length > 0) {
    pendingInitialPromptRegistry?.enqueue(msg.cwd, msg.initialPrompt);
  }

  // ── Preflight: fast synchronous checks before spawning. See change: spawn-failure-diagnostics.
  const preflightResolver = new ToolResolver({ processExecPath: process.execPath, useLoginShell: false });
  const preflight = preflightSpawn(msg.cwd, { resolver: preflightResolver });
  if (!preflight.ok) {
    const message = preflight.reasons.map((r) => r.message).join("; ");
    sendTo(ws, { type: "spawn_result", cwd: msg.cwd, success: false, message, requestId: msg.requestId });
    sendTo(ws, { type: "spawn_error", cwd: msg.cwd, strategy, message, code: "PREFLIGHT_FAILED", reasons: preflight.reasons });
    appendSpawnFailure({
      ts: new Date().toISOString(),
      cwd: msg.cwd,
      strategy,
      code: "PREFLIGHT_FAILED",
      message,
      reasons: preflight.reasons,
    });
    return;
  }

  // Catch both thrown exceptions and { success: false } results; surface as
  // spawn_error so the UI can render a retryable banner instead of failing
  // silently. Previous behaviour left the user staring at an empty state
  // when pi itself was broken in the target folder.
  try {
    const spawnResult = await spawnPiSession(msg.cwd, { strategy });
    if (spawnResult.process && spawnResult.pid) {
      headlessPidRegistry.register(
        spawnResult.pid,
        msg.cwd,
        spawnResult.process,
        spawnResult.spawnToken,
        keeperOptsFromSpawnResult(spawnResult),
      );
    }
    // Record client-correlation so the eventual session_added carries
    // spawnRequestId. See change: spawn-correlation-token.
    if (msg.requestId && spawnResult.spawnToken && pendingClientCorrelations) {
      // `config` is the same read used to arm this spawn's watchdog below.
      // See change: fix-spawn-correlation-ttl-coupling (D1).
      pendingClientCorrelations.record(
        spawnResult.spawnToken,
        msg.requestId,
        deriveSpawnCorrelationTtlMs(config.spawnRegisterTimeoutMs),
      );
    }
    if (spawnResult.dashboardSpawned && spawnResult.success) {
      pendingDashboardSpawns?.set(msg.cwd, (pendingDashboardSpawns?.get(msg.cwd) ?? 0) + 1);
    }
    sendTo(ws, {
      type: "spawn_result",
      cwd: msg.cwd,
      success: spawnResult.success,
      message: spawnResult.message,
      requestId: msg.requestId,
      ...(spawnResult.pid ? { pid: spawnResult.pid } : {}),
    });
    if (!spawnResult.success) {
      sendTo(ws, {
        type: "spawn_error",
        cwd: msg.cwd,
        strategy,
        message: spawnResult.message,
        ...(spawnResult.code ? { code: spawnResult.code } : {}),
        ...(spawnResult.stderr ? { stderr: spawnResult.stderr } : {}),
      });
      appendSpawnFailure({
        ts: new Date().toISOString(),
        cwd: msg.cwd,
        strategy,
        code: spawnResult.code ?? "SPAWN_ERRNO",
        message: spawnResult.message,
        ...(spawnResult.stderr ? { stderrTail: spawnResult.stderr } : {}),
      });
    } else {
      // Arm watchdog for every successful spawn. See change: spawn-failure-diagnostics.
      const watchdog = getSpawnRegisterWatchdog();
      watchdog.arm({
        pid: spawnResult.pid,
        cwd: msg.cwd,
        mechanism: strategy as import("@blackbelt-technology/pi-dashboard-shared/platform/spawn-mechanism.js").SpawnMechanism,
        logPath: spawnResult.logPath,
        // Read-on-arm: pass current config value so a Settings change takes effect
        // on the next spawn without a server restart. See change: spawn-failure-diagnostics (fix W1).
        timeoutMs: config.spawnRegisterTimeoutMs,
        ws,
        spawnToken: spawnResult.spawnToken,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stderr = err instanceof Error && "stderr" in err ? String((err as { stderr: unknown }).stderr).slice(-2048) : undefined;
    sendTo(ws, { type: "spawn_result", cwd: msg.cwd, success: false, message, requestId: msg.requestId });
    sendTo(ws, { type: "spawn_error", cwd: msg.cwd, strategy, message, code: "SPAWN_ERRNO", stderr });
    appendSpawnFailure({
      ts: new Date().toISOString(),
      cwd: msg.cwd,
      strategy,
      code: "SPAWN_ERRNO",
      message,
      ...(stderr ? { stderrTail: stderr } : {}),
    });
  }
}

/**
 * Grace period the advisory `shutdown` message gets to make pi exit on its own
 * before the kill ladder is used.
 *
 * Shutdown is the POLITE path — a clean pi exit flushes state that SIGTERM does
 * not — so the ladder is a backstop, never the opening move. Kept short because
 * the E2E reap awaits `session_removed` per session and pays this per test.
 *
 * See change: fix-tmux-session-shutdown-leak (design D6).
 */
const SHUTDOWN_GRACE_MS = 1_500;
const SHUTDOWN_GRACE_POLL_MS = 100;

/** Resolves once the PID is gone, or after `graceMs`. */
async function waitForExit(pid: number, graceMs: number): Promise<boolean> {
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, SHUTDOWN_GRACE_POLL_MS));
  }
  return !isProcessAlive(pid);
}

/** Everything ending a session needs. Deliberately narrower than the handler context. */
export interface ShutdownSessionDeps {
  sessionManager: BrowserHandlerContext["sessionManager"];
  piGateway: BrowserHandlerContext["piGateway"];
  headlessPidRegistry: BrowserHandlerContext["headlessPidRegistry"];
  broadcast: BrowserHandlerContext["broadcast"];
  metaPersistence?: BrowserHandlerContext["metaPersistence"];
}

export async function handleShutdown(
  msg: Extract<BrowserToServerMessage, { type: "shutdown" }>,
  ctx: BrowserHandlerContext,
): Promise<void> {
  await shutdownSession(msg.sessionId, ctx);
}

/**
 * End a session: ask politely, then make sure, then report.
 *
 * Shared because there are TWO entry points — the browser `shutdown` message
 * and `POST /api/session/:id/shutdown` — and they were parallel
 * implementations that drifted. REST omitted the liveness write (#449, so a
 * REST-closed session came back as a cold-start recovery candidate) and, once
 * the WS path learned to terminate any spawn strategy, it kept leaking a
 * tmux-spawned `pi` exactly as the WS path used to (#452). One body, two
 * callers, no third divergence.
 *
 * See change: fix-tmux-session-shutdown-leak (task 7.4).
 */
export async function shutdownSession(
  sessionId: string,
  deps: ShutdownSessionDeps,
): Promise<void> {
  const msg = { sessionId };
  const { sessionManager, piGateway, headlessPidRegistry, broadcast, metaPersistence } = deps;
  const session = sessionManager.get(msg.sessionId);
  // Durably clear the liveness marker with a manual reason so cold start does
  // NOT treat this intentional close as an interrupted-session recovery
  // candidate. See change: reopen-sessions-after-shutdown.
  const shutdownFile = session?.sessionFile;
  if (shutdownFile && metaPersistence) {
    metaPersistence.setLiveness(shutdownFile, { live: false, closedReason: "manual" });
  }
  piGateway.sendToSession(msg.sessionId, { type: "shutdown", sessionId: msg.sessionId });
  // Escalates SIGTERM → 2 s → SIGKILL via shared killProcess ladder.
  // See change: fix-keeper-kill-escalation.
  await headlessPidRegistry.killBySessionId(msg.sessionId);
  killHeadlessBySessionId(msg.sessionId);

  // ---- Terminate whatever strategy spawned this session -------------------
  // Both paths above are headless-only: the registry has no entry for a
  // tmux/wt/wsl-tmux session, and `killHeadlessBySessionId` resolves PIDs via
  // `findPidByMarker(sessionId)`, which finds nothing because a tmux pane runs
  // `cd <cwd> && pi` with no session id on the command line. So shutdown used to
  // unregister and broadcast while the process kept running — the UI reported
  // success and a ~127 MB pi survived (issue #452; measured 21 panes = 21
  // resident pi = 0 session records).
  //
  // `handleForceKill` never had this problem because it keys on the PID the
  // server already stores from `session_register`. Shutdown now does the same,
  // which makes it strategy-agnostic by construction rather than by enumerating
  // strategies. Killing pi also collapses its tmux pane: the pane's shell exits
  // when its command does, and `remain-on-exit` is off.
  //
  // See change: fix-tmux-session-shutdown-leak (design D6).
  const pid = session?.pid;
  if (pid !== undefined) {
    const exitedGracefully = await waitForExit(pid, SHUTDOWN_GRACE_MS);
    if (!exitedGracefully) {
      // Same ladder force-kill uses: SIGTERM → 2 s → SIGKILL, tree-killing on
      // Windows via taskkill /F /T.
      await killProcess(pid, { timeoutMs: 2000 });
    }
    if (isProcessAlive(pid)) {
      // C2 — never report a clean removal for a process that outlived its
      // shutdown. Reporting success we have not verified is what let this bug
      // hide for so long.
      //
      // The record is still released: retaining it would wedge the session in
      // the UI with no way to clear it but force-kill, and stall the E2E reap,
      // which awaits `session_removed` per session (design D3 — failure must be
      // non-blocking). But a log line only reaches whoever reads the server log,
      // so clients are told explicitly too, ALONGSIDE `session_removed` rather
      // than instead of it.
      console.error(
        `[dashboard] shutdown(${msg.sessionId}): process ${pid} survived SIGTERM→SIGKILL; ` +
          `the session record is being released but the process is ORPHANED. ` +
          `See openspec change fix-tmux-session-shutdown-leak.`,
      );
      broadcast({ type: "session_orphaned", sessionId: msg.sessionId, pid });
    }
  }

  sessionManager.unregister(msg.sessionId);
  broadcast({ type: "session_removed", sessionId: msg.sessionId });
}

export function handleAbort(
  msg: Extract<BrowserToServerMessage, { type: "abort" }>,
  ctx: BrowserHandlerContext,
): void {
  ctx.piGateway.sendToSession(msg.sessionId, { type: "abort", sessionId: msg.sessionId });
}

/**
 * Graceful stop-after-turn: forward to the bridge, which sets a per-session
 * flag and shuts down cleanly at the next turn_end. Distinct from abort
 * (mid-stream interrupt) and force_kill (SIGKILL).
 * See change: adopt-pi-071-072-073-features.
 */
export function handleStopAfterTurn(
  msg: Extract<BrowserToServerMessage, { type: "stop_after_turn" }>,
  ctx: BrowserHandlerContext,
): void {
  ctx.piGateway.sendToSession(msg.sessionId, { type: "stop_after_turn", sessionId: msg.sessionId });
}

// ── Follow-up queue mutation forwarders (bridge-owned buffer) ─────────────
//
// These five handlers forward bridge-owned-buffer mutation messages to the
// session's bridge. The bridge mutates `bridgeFollowUp` locally; nothing
// touches pi. The OLD pi-mutation message types from Phase 3
// (`clear_steering_queue`, `clear_followup_slot`, `edit_followup_slot`)
// remain permanently deleted. Steer mutation is never exposed.
//
// See change: rework-mid-turn-prompt-queue.

export function handleClearFollowupEntries(
  msg: Extract<BrowserToServerMessage, { type: "clear_followup_entries" }>,
  ctx: BrowserHandlerContext,
): void {
  if (!ctx.sessionManager.get(msg.sessionId)) return;
  ctx.piGateway.sendToSession(msg.sessionId, {
    type: "clear_followup_entries",
    sessionId: msg.sessionId,
    indices: msg.indices,
  });
}

export function handleEditFollowupEntry(
  msg: Extract<BrowserToServerMessage, { type: "edit_followup_entry" }>,
  ctx: BrowserHandlerContext,
): void {
  if (!ctx.sessionManager.get(msg.sessionId)) return;
  ctx.piGateway.sendToSession(msg.sessionId, {
    type: "edit_followup_entry",
    sessionId: msg.sessionId,
    index: msg.index,
    text: msg.text,
    images: msg.images,
  });
}

export function handleRemoveFollowupEntry(
  msg: Extract<BrowserToServerMessage, { type: "remove_followup_entry" }>,
  ctx: BrowserHandlerContext,
): void {
  if (!ctx.sessionManager.get(msg.sessionId)) return;
  ctx.piGateway.sendToSession(msg.sessionId, {
    type: "remove_followup_entry",
    sessionId: msg.sessionId,
    index: msg.index,
  });
}

export function handlePromoteFollowupEntry(
  msg: Extract<BrowserToServerMessage, { type: "promote_followup_entry" }>,
  ctx: BrowserHandlerContext,
): void {
  if (!ctx.sessionManager.get(msg.sessionId)) return;
  ctx.piGateway.sendToSession(msg.sessionId, {
    type: "promote_followup_entry",
    sessionId: msg.sessionId,
    index: msg.index,
  });
}



export function handleFlowControl(
  msg: Extract<BrowserToServerMessage, { type: "flow_control" }>,
  ctx: BrowserHandlerContext,
): void {
  ctx.piGateway.sendToSession(msg.sessionId, { type: "flow_control", sessionId: msg.sessionId, action: msg.action });
}

export function handleKillProcess(
  msg: Extract<BrowserToServerMessage, { type: "kill_process" }>,
  ctx: BrowserHandlerContext,
): void {
  ctx.piGateway.sendToSession(msg.sessionId, { type: "kill_process", sessionId: msg.sessionId, pgid: msg.pgid });
}

/**
 * Forward a browser subagent-resync request to the owning bridge. The bridge
 * replies with the latest retained snapshot as a synthetic subagent_started
 * event_forward, or no-ops for an unknown/finished agent.
 * See change: fix-subagent-live-detail-reliability (D2).
 */
export function handleSubagentResyncRequest(
  msg: Extract<BrowserToServerMessage, { type: "subagent_resync_request" }>,
  ctx: BrowserHandlerContext,
): void {
  // Requester-scoped delivery (C5): remember who asked, and pass the token to
  // the bridge so it can echo it on the reply. A client that sends no token
  // still works — its reply takes the ordinary broadcast path.
  // See change: reduce-subagent-details-payload.
  // The WS path casts parsed JSON straight to the message union, so these two
  // fields are untrusted: validate their RUNTIME shape before they reach the
  // registry or the bridge. A malformed token degrades to fan-out delivery
  // rather than poisoning the registry.
  const requestId =
    typeof msg.requestId === "string" && msg.requestId.length > 0 ? msg.requestId : undefined;
  const reason = msg.reason === "open" || msg.reason === "cadence" ? msg.reason : undefined;
  if (requestId) ctx.recordResyncRequester?.(requestId, ctx.ws);
  ctx.piGateway.sendToSession(msg.sessionId, {
    type: "subagent_resync_request",
    sessionId: msg.sessionId,
    agentId: msg.agentId,
    ...(requestId ? { requestId } : {}),
    ...(reason ? { reason } : {}),
  });
}

/**
 * Pure predicate: does a `ps`/cmdline output string look like a pi/node process?
 * Re-exported from `platform/process-identify.ts` for backwards compat with
 * any external consumer of this handler.
 */
export { isPiCommandLine } from "@blackbelt-technology/pi-dashboard-shared/platform/process-identify.js";

export async function handleForceKill(
  msg: Extract<BrowserToServerMessage, { type: "force_kill" }>,
  ctx: BrowserHandlerContext,
): Promise<void> {
  const { sessionManager, piGateway, headlessPidRegistry, broadcast, sendTo, ws, metaPersistence } = ctx;
  const session = sessionManager.get(msg.sessionId);
  if (!session) {
    sendTo(ws, { type: "force_kill_result", sessionId: msg.sessionId, success: false, message: "Session not found", code: "resume.session_not_found" });
    return;
  }

  // Force-kill is an intentional close: durably clear the liveness marker
  // with a manual reason so cold start does not offer to reopen it.
  // See change: reopen-sessions-after-shutdown.
  if (session.sessionFile && metaPersistence) {
    metaPersistence.setLiveness(session.sessionFile, { live: false, closedReason: "manual" });
  }

  // Force-close the bridge WebSocket regardless of PID availability
  piGateway.closeSession(msg.sessionId);

  const pid = session?.pid;
  if (!pid) {
    // No PID — we can only close the WebSocket
    sessionManager.update(msg.sessionId, { status: "ended", endedAt: Date.now() });
    broadcast({ type: "session_updated", sessionId: msg.sessionId, updates: { status: "ended", endedAt: Date.now() } });
    sendTo(ws, { type: "force_kill_result", sessionId: msg.sessionId, success: true, message: "WebSocket closed (no PID available)" });
    return;
  }

  // Delegate the full SIGTERM → wait → SIGKILL escalation to the
  // platform helper so Windows uses `taskkill /F /T /PID <pid>`
  // (genuine tree kill) and POSIX keeps the 2s grace window.
  // See change: route-kill-paths-through-platform.
  //
  // PID-safety check: skip SIGKILL escalation on Unix when the PID
  // no longer resembles a pi process. We can't pass this check INTO
  // killProcess without a plugin, so: if `killProcess` reports forced
  // SIGKILL and isPiProcess says no, we still accept the result —
  // the process was either a pi leaf or a recycled PID, and either
  // way the session is ended. On Windows `taskkill /F /T` is atomic
  // so the check isn't meaningful.
  const killResult = await killProcess(pid, { timeoutMs: 2000 });

  // Also kill any headless-registered siblings (same session ID).
  // See change: fix-keeper-kill-escalation (await for SIGKILL escalation).
  await headlessPidRegistry.killBySessionId(msg.sessionId);

  const endedAt = Date.now();
  sessionManager.update(msg.sessionId, { status: "ended", endedAt });
  broadcast({ type: "session_updated", sessionId: msg.sessionId, updates: { status: "ended", endedAt } });

  if (!killResult.ok) {
    // Process was already dead when the kill was issued.
    sendTo(ws, { type: "force_kill_result", sessionId: msg.sessionId, success: true, message: "Process already exited" });
    return;
  }
  const suffix = killResult.forced ? " (SIGKILL)" : "";
  sendTo(ws, { type: "force_kill_result", sessionId: msg.sessionId, success: true, message: `Process terminated${suffix}` });
}
