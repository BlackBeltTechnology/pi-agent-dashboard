/**
 * Session action handlers: send_prompt, abort, resume, spawn, shutdown, flow_control.
 */
import type { BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { BrowserHandlerContext } from "./handler-context.js";
import { spawnPiSession } from "../process-manager.js";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { createBranchedSessionFile } from "../session-file-reader.js";
import {
  isProcessAlive as platformIsProcessAlive,
  killPidWithGroup,
} from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import {
  findPidByMarker,
  isProcessLikePi,
} from "@blackbelt-technology/pi-dashboard-shared/platform/process-identify.js";

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
    try {
      killPidWithGroup(pid, "SIGTERM");
    } catch {
      try { process.kill(pid, "SIGTERM"); } catch { /* ignore */ }
    }
  }
  return true;
}

export async function handleSendPrompt(
  msg: Extract<BrowserToServerMessage, { type: "send_prompt" }>,
  ctx: BrowserHandlerContext,
): Promise<void> {
  const { sessionManager, piGateway, headlessPidRegistry, pendingResumeRegistry, pendingDashboardSpawns, broadcast } = ctx;
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
  const { ws, sessionManager, pendingForkRegistry, headlessPidRegistry, pendingDashboardSpawns, sendTo } = ctx;
  const session = sessionManager.get(msg.sessionId);
  if (!session) {
    sendTo(ws, { type: "resume_result", sessionId: msg.sessionId, success: false, message: "Session not found" });
    return;
  }
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
  const { ws, headlessPidRegistry, pendingDashboardSpawns, sendTo } = ctx;
  const config = loadConfig();
  const spawnResult = await spawnPiSession(msg.cwd, { strategy: config.spawnStrategy });
  if (spawnResult.process && spawnResult.pid) {
    headlessPidRegistry.register(spawnResult.pid, msg.cwd, spawnResult.process);
  }
  if (spawnResult.dashboardSpawned && spawnResult.success) {
    pendingDashboardSpawns?.set(msg.cwd, (pendingDashboardSpawns?.get(msg.cwd) ?? 0) + 1);
  }
  sendTo(ws, { type: "spawn_result", cwd: msg.cwd, success: spawnResult.success, message: spawnResult.message });
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

/**
 * Check if a PID belongs to a pi/node process. Delegates to
 * `platform/process-identify.ts` — no direct platform branching here.
 * See change: consolidate-windows-spawn-and-platform-handlers.
 */
function isPiProcess(pid: number): boolean {
  return isProcessLikePi(pid);
}

/**
 * Check if a process is still alive.
 * Delegates to the shared platform primitive.
 */
function isProcessAlive(pid: number): boolean {
  return platformIsProcessAlive(pid);
}

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

  // Step 1: SIGTERM
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Process already dead
    sessionManager.update(msg.sessionId, { status: "ended", endedAt: Date.now() });
    broadcast({ type: "session_updated", sessionId: msg.sessionId, updates: { status: "ended", endedAt: Date.now() } });
    sendTo(ws, { type: "force_kill_result", sessionId: msg.sessionId, success: true, message: "Process already exited" });
    return;
  }

  // Also kill via headless registry if applicable
  headlessPidRegistry.killBySessionId(msg.sessionId);

  // Step 2: Wait 2s, then SIGKILL if still alive
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      if (isProcessAlive(pid)) {
        // Safety check: verify PID still belongs to a pi process
        if (isPiProcess(pid)) {
          try {
            process.kill(pid, "SIGKILL");
          } catch { /* already dead */ }
        }
      }
      resolve();
    }, 2000);
  });

  sessionManager.update(msg.sessionId, { status: "ended", endedAt: Date.now() });
  broadcast({ type: "session_updated", sessionId: msg.sessionId, updates: { status: "ended", endedAt: Date.now() } });
  sendTo(ws, { type: "force_kill_result", sessionId: msg.sessionId, success: true });
}
