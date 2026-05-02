/**
 * Session sync: register, replay, and handle session changes.
 * Extracted from bridge.ts for clarity.
 */
import type { BridgeContext } from "./bridge-context.js";
import { getCurrentModelString, extractFirstMessage, filterHiddenCommands } from "./bridge-context.js";
import { detectSessionSource } from "./source-detector.js";
import { replayEntriesAsEvents } from "@blackbelt-technology/pi-dashboard-shared/state-replay.js";
import { gatherGitInfo, gatherJjInfo } from "./vcs-info.js";
import type { FlowInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/**
 * Send full state sync to the server (session_register, commands, flows, models).
 * Called on initial connect and reconnect.
 */
export function sendStateSync(
  bc: BridgeContext,
  getFlowsList: () => FlowInfo[],
): void {
  const model = getCurrentModelString(bc);
  const thinkingLevel = (bc.pi as any).getThinkingLevel?.() ?? undefined;
  bc.lastModel = model;
  bc.lastThinkingLevel = thinkingLevel;

  const sessionFile = bc.lastSessionFile ?? bc.cachedCtx?.sessionManager?.getSessionFile?.() ?? undefined;
  const sessionDir = bc.lastSessionDir ?? bc.cachedCtx?.sessionManager?.getSessionDir?.() ?? undefined;
  const firstMessage = extractFirstMessage(bc.cachedCtx);

  // Include eventCount so server can skip event wipe on reconnect
  let eventCount: number | undefined;
  try {
    const entries = bc.cachedCtx?.sessionManager?.getBranch?.();
    if (entries) eventCount = entries.length;
  } catch { /* ignore */ }

  // Tag the very first sendStateSync after process boot as "spawn";
  // every subsequent invocation (driven by WebSocket reconnect after a
  // dashboard restart) is a "reattach". Server applies the configured
  // `reattachPlacement` policy on "reattach".
  // See change: reattach-move-to-front.
  const registerReason: "spawn" | "reattach" = bc.hasRegisteredOnce ? "reattach" : "spawn";

  bc.connection.send({
    type: "session_register",
    sessionId: bc.sessionId,
    cwd: process.cwd(),
    name: bc.pi.getSessionName() ?? undefined,
    source: detectSessionSource(bc.cachedHasUI, sessionFile),
    model,
    thinkingLevel,
    sessionFile,
    sessionDir,
    firstMessage,
    eventCount,
    pid: process.pid,
    registerReason,
  });

  bc.hasRegisteredOnce = true;

  const commands = filterHiddenCommands(bc.pi.getCommands());
  bc.connection.send({ type: "commands_list", sessionId: bc.sessionId, commands });

  // Send flows list
  const flows = getFlowsList();
  bc.connection.send({ type: "flows_list", sessionId: bc.sessionId, flows });

  if (bc.cachedModelRegistry) {
    try {
      const models = bc.cachedModelRegistry.getAvailable().map((m: any) => ({
        provider: m.provider,
        id: m.id,
      }));
      bc.connection.send({ type: "models_list", sessionId: bc.sessionId, models });
    } catch { /* ignore */ }
  }
}

/**
 * Replay all session entries as protocol events.
 */
export function replaySessionEntries(bc: BridgeContext): void {
  try {
    const entries = bc.cachedCtx?.sessionManager?.getBranch?.();
    if (!entries || entries.length === 0) return;
    const events = replayEntriesAsEvents(bc.sessionId, entries);
    for (const msg of events) {
      bc.connection.send(msg);
    }
  } catch { /* ignore */ }
}

/**
 * Handle session change (new/fork/resume): unregister old, register new, replay, sync.
 * Called from session_start when event.reason indicates a session switch.
 */
export function handleSessionChange(
  bc: BridgeContext,
  ctx: any,
  getFlowsList: () => FlowInfo[],
): void {
  bc.connection.send({ type: "session_unregister", sessionId: bc.sessionId });

  bc.sessionId = ctx.sessionManager.getSessionId();
  bc.lastSessionFile = ctx.sessionManager.getSessionFile?.() ?? undefined;
  bc.lastSessionDir = ctx.sessionManager.getSessionDir?.() ?? undefined;
  const firstMessage = extractFirstMessage(ctx);

  bc.lastFirstMessage = firstMessage;
  bc.lastGitBranch = undefined;
  bc.lastGitPrNumber = undefined;
  bc.lastSessionName = bc.pi.getSessionName() ?? "";
  bc.lastModel = getCurrentModelString(bc);
  bc.lastThinkingLevel = (bc.pi as any).getThinkingLevel?.() ?? undefined;

  // Include eventCount for consistency (session switch/fork changes sessionId,
  // so the server will wipe regardless, but include for completeness)
  let eventCount: number | undefined;
  try {
    const entries = ctx.sessionManager?.getBranch?.();
    if (entries) eventCount = entries.length;
  } catch { /* ignore */ }

  // handleSessionChange always mints a fresh sessionId (new/fork/resume),
  // so registerReason is unconditionally "spawn" — even after the bridge
  // has previously reattached. See change: reattach-move-to-front.
  bc.connection.send({
    type: "session_register",
    sessionId: bc.sessionId,
    cwd: ctx.cwd,
    name: bc.lastSessionName || undefined,
    source: detectSessionSource(bc.cachedHasUI, bc.lastSessionFile),
    model: bc.lastModel,
    thinkingLevel: bc.lastThinkingLevel,
    sessionFile: bc.lastSessionFile,
    sessionDir: bc.lastSessionDir,
    firstMessage,
    eventCount,
    pid: process.pid,
    registerReason: "spawn",
  });

  replaySessionEntries(bc);
  bc.connection.send({ type: "replay_complete", sessionId: bc.sessionId });

  // Send git info
  const gitInfo = gatherGitInfo(ctx.cwd);
  if (gitInfo) {
    bc.lastGitBranch = gitInfo.gitBranch;
    bc.lastGitPrNumber = gitInfo.gitPrNumber;
    bc.connection.send({ type: "git_info_update", sessionId: bc.sessionId, ...gitInfo });
  }

  const commands = filterHiddenCommands(bc.pi.getCommands());
  bc.connection.send({ type: "commands_list", sessionId: bc.sessionId, commands });

  const flows = getFlowsList();
  bc.connection.send({ type: "flows_list", sessionId: bc.sessionId, flows });

  if (bc.cachedModelRegistry) {
    try {
      const models = bc.cachedModelRegistry.getAvailable().map((m: any) => ({
        provider: m.provider,
        id: m.id,
      }));
      bc.connection.send({ type: "models_list", sessionId: bc.sessionId, models });
    } catch { /* ignore */ }
  }
}
