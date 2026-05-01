/**
 * Session action handlers: send_prompt, abort, resume, spawn, shutdown, flow_control.
 */
import type { BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { BrowserHandlerContext } from "./handler-context.js";
import { spawnPiSession } from "../process-manager.js";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { createBranchedSessionFile } from "../session-file-reader.js";
import {
  killPidWithGroup,
  killProcess,
} from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import {
  findPidByMarker,
} from "@blackbelt-technology/pi-dashboard-shared/platform/process-identify.js";
import { shouldInterceptReload } from "./session-action-helpers.js";

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
  ctx: BrowserHandlerContext,
  sessionId: string,
  status: "started" | "completed" | "error",
  message?: string,
): void {
  const event = {
    eventType: "command_feedback",
    timestamp: Date.now(),
    data: { command: "/reload", status, ...(message ? { message } : {}) },
  };
  const seq = ctx.eventStore.insertEvent(sessionId, event);
  ctx.broadcast({ type: "event", sessionId, seq, event } as any);
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
 * See change: headless-reload-via-respawn.
 */
export async function handleHeadlessReload(
  msg: Extract<BrowserToServerMessage, { type: "send_prompt" }>,
  ctx: BrowserHandlerContext,
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
  if (session.status === "streaming") {
    emitCommandFeedback(
      ctx,
      msg.sessionId,
      "error",
      "Wait for the current response to finish before reloading.",
    );
    return;
  }

  emitCommandFeedback(ctx, msg.sessionId, "started");

  // SIGTERM the old headless pi. No-op if already dead (idempotency guard).
  headlessPidRegistry.killBySessionId(msg.sessionId);

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
    headlessPidRegistry.register(spawnResult.pid, session.cwd, spawnResult.process);
  }

  emitCommandFeedback(ctx, msg.sessionId, "completed");
}

export async function handleSendPrompt(
  msg: Extract<BrowserToServerMessage, { type: "send_prompt" }>,
  ctx: BrowserHandlerContext,
): Promise<void> {
  const { sessionManager, piGateway, headlessPidRegistry, pendingResumeRegistry, pendingResumeIntents, pendingDashboardSpawns, broadcast } = ctx;

  // Intercept `/reload` on active headless sessions — forward the request to
  // our kill-and-respawn handler instead of routing the prompt to the bridge
  // (the bridge has no programmatic reload path on RPC).
  // See change: headless-reload-via-respawn.
  if (shouldInterceptReload(msg, headlessPidRegistry)) {
    await handleHeadlessReload(msg, ctx);
    return;
  }

  const promptSession = sessionManager.get(msg.sessionId);

  if (promptSession?.status === "ended") {
    if (!promptSession.sessionFile) {
      console.error(`[dashboard] auto-resume failed: no session file for session ${msg.sessionId}`);
      return;
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
      headlessPidRegistry.register(spawnResult.pid, promptSession.cwd, spawnResult.process);
    }
  } else {
    const sent = piGateway.sendToSession(msg.sessionId, {
      type: "send_prompt",
      sessionId: msg.sessionId,
      text: msg.text,
      images: msg.images,
    });
    if (!sent) {
      console.error(`[dashboard] send_prompt failed: no bridge connection for session ${msg.sessionId}`);
    }
  }
}

export async function handleResumeSession(
  msg: Extract<BrowserToServerMessage, { type: "resume_session" }>,
  ctx: BrowserHandlerContext,
): Promise<void> {
  const { ws, sessionManager, pendingForkRegistry, headlessPidRegistry, pendingDashboardSpawns, pendingResumeIntents, sendTo } = ctx;
  const session = sessionManager.get(msg.sessionId);
  if (!session) {
    sendTo(ws, { type: "resume_result", sessionId: msg.sessionId, success: false, message: "Session not found" });
    return;
  }
  // Resolve placement intent. Old browsers omit the field; default to
  // "front" so they keep getting today's behavior. Drag-to-resume sends
  // "keep" so the dropped slot is preserved through the resume round-trip.
  // See change: differentiate-resume-intent-by-trigger.
  const placement: "front" | "keep" = msg.placement ?? "front";
  if (!session.sessionFile) {
    sendTo(ws, { type: "resume_result", sessionId: msg.sessionId, success: false, message: "Session file is unknown (pre-migration session)" });
    return;
  }
  if (msg.mode === "continue" && session.status !== "ended") {
    sendTo(ws, { type: "resume_result", sessionId: msg.sessionId, success: false, message: "Session is already active" });
    return;
  }
  if (session.resuming) {
    sendTo(ws, { type: "resume_result", sessionId: msg.sessionId, success: false, message: "Session is already being resumed" });
    return;
  }
  if (msg.mode === "fork" && pendingForkRegistry) {
    pendingForkRegistry.recordFork(session.cwd, msg.sessionId);
  }

  // For fork-from-message: create a pruned session file first
  let forkSessionFile = session.sessionFile;
  if (msg.mode === "fork" && msg.entryId) {
    try {
      forkSessionFile = createBranchedSessionFile(session.sessionFile, msg.entryId);
    } catch (err: any) {
      sendTo(ws, { type: "resume_result", sessionId: msg.sessionId, success: false, message: `Fork from entry failed: ${err.message}` });
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
  if (result.dashboardSpawned && result.success) {
    pendingDashboardSpawns?.set(session.cwd, (pendingDashboardSpawns?.get(session.cwd) ?? 0) + 1);
  }
  if (result.process && result.pid) {
    headlessPidRegistry.register(result.pid, session.cwd, result.process);
  }
  sendTo(ws, { type: "resume_result", sessionId: msg.sessionId, success: result.success, message: result.message });
}

export async function handleSpawnSession(
  msg: Extract<BrowserToServerMessage, { type: "spawn_session" }>,
  ctx: BrowserHandlerContext,
): Promise<void> {
  const { ws, headlessPidRegistry, pendingDashboardSpawns, pendingAttachRegistry, sendTo } = ctx;
  const config = loadConfig();
  const strategy = config.spawnStrategy ?? "tmux";

  // Queue the optional attach intent BEFORE awaiting the spawn so a fast
  // bridge `session_register` cannot lose the intent. See change:
  // add-folder-task-checker-and-spawn-attach.
  if (typeof msg.attachProposal === "string" && msg.attachProposal.length > 0) {
    pendingAttachRegistry?.enqueue(msg.cwd, msg.attachProposal);
  }

  // Catch both thrown exceptions and { success: false } results; surface as
  // spawn_error so the UI can render a retryable banner instead of failing
  // silently. Previous behaviour left the user staring at an empty state
  // when pi itself was broken in the target folder.
  try {
    const spawnResult = await spawnPiSession(msg.cwd, { strategy });
    if (spawnResult.process && spawnResult.pid) {
      headlessPidRegistry.register(spawnResult.pid, msg.cwd, spawnResult.process);
    }
    if (spawnResult.dashboardSpawned && spawnResult.success) {
      pendingDashboardSpawns?.set(msg.cwd, (pendingDashboardSpawns?.get(msg.cwd) ?? 0) + 1);
    }
    sendTo(ws, { type: "spawn_result", cwd: msg.cwd, success: spawnResult.success, message: spawnResult.message });
    if (!spawnResult.success) {
      sendTo(ws, { type: "spawn_error", cwd: msg.cwd, strategy, message: spawnResult.message });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stderr = err instanceof Error && "stderr" in err ? String((err as { stderr: unknown }).stderr).slice(-2048) : undefined;
    sendTo(ws, { type: "spawn_result", cwd: msg.cwd, success: false, message });
    sendTo(ws, { type: "spawn_error", cwd: msg.cwd, strategy, message, stderr });
  }
}

export function handleShutdown(
  msg: Extract<BrowserToServerMessage, { type: "shutdown" }>,
  ctx: BrowserHandlerContext,
): void {
  const { sessionManager, piGateway, headlessPidRegistry, broadcast } = ctx;
  piGateway.sendToSession(msg.sessionId, { type: "shutdown", sessionId: msg.sessionId });
  headlessPidRegistry.killBySessionId(msg.sessionId);
  killHeadlessBySessionId(msg.sessionId);
  sessionManager.unregister(msg.sessionId);
  broadcast({ type: "session_removed", sessionId: msg.sessionId });
}

export function handleAbort(
  msg: Extract<BrowserToServerMessage, { type: "abort" }>,
  ctx: BrowserHandlerContext,
): void {
  ctx.piGateway.sendToSession(msg.sessionId, { type: "abort", sessionId: msg.sessionId });
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
 * Pure predicate: does a `ps`/cmdline output string look like a pi/node process?
 * Re-exported from `platform/process-identify.ts` for backwards compat with
 * any external consumer of this handler.
 */
export { isPiCommandLine } from "@blackbelt-technology/pi-dashboard-shared/platform/process-identify.js";

export async function handleForceKill(
  msg: Extract<BrowserToServerMessage, { type: "force_kill" }>,
  ctx: BrowserHandlerContext,
): Promise<void> {
  const { sessionManager, piGateway, headlessPidRegistry, broadcast, sendTo, ws } = ctx;
  const session = sessionManager.get(msg.sessionId);
  if (!session) {
    sendTo(ws, { type: "force_kill_result", sessionId: msg.sessionId, success: false, message: "Session not found" });
    return;
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
  headlessPidRegistry.killBySessionId(msg.sessionId);

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
