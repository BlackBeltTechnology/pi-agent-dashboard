/**
 * PI Dashboard Bridge Extension
 *
 * Global extension that connects to the dashboard server,
 * forwards all pi events, and relays commands back.
 */

import { appendIdentityLog } from "./bridge-identity-log.js";
import { bridgeExtensionIdentity } from "./extension-identity.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureConfig, loadConfig, } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { shouldActivateBridge } from "./bridge-activation.js";
import { rendezvousEndpoint } from "@blackbelt-technology/pi-dashboard-shared/rendezvous.js";
import type { FlowInfo, } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AbortLatch } from "./abort-latch.js";
import { type AutoNamer, createAutoNamer, type PersistedNamerState, type StreamSimpleFn } from "./auto-session-namer.js";
import type { BridgeContext } from "./bridge-context.js";
import { extractLatestTurnWindow, } from "./bridge-context.js";
import { mintBridgeTicket, readDeviceToken, withTicket } from "./bridge-ticket-client.js";
import {
  buildUserMessageContent,
  createCommandHandler,
  tryExecSlashTemplate,
  validateImages,
} from "./command-handler.js";
import { buildSessionContextText, runForkSubagentDraft } from "./commit-draft-agent.js";
import { ConnectionManager, type WatchdogFireInfo } from "./connection.js";
import {
  createTerminalReload,
  isBridgeReentry,
  RELOAD_COMMAND_NAME,
} from "./terminal-reload.js";
import { toCustomEntryForward, toCustomMessageForward } from "./custom-entry-forward.js";
import { registerDashboardContextInjector } from "./dashboard-context-injector.js";
import { runDevBuild } from "./dev-build.js";
import { EmptyActionableGuard, } from "./empty-actionable-guard.js";
import { resolveGuardConfig } from "./empty-actionable-guard-config.js";
import { instanceIdFileForSocket, resolveEndpoint } from "./endpoint-resolution.js";
import { mapEventToProtocol, } from "./event-forwarder.js";
import {
  FLOW_EVENT_MAP,
  registerEventBusForwarding,
  SUBAGENT_EVENT_MAP,
} from "./flow-event-wiring.js";
import { createFollowupBuffer } from "./followup-buffer.js";
import { createPollingHolder, drainDisposables, ensureDisposable, teardownPreviousIncarnation } from "./bridge-polling.js";
import { createGitTracker, type GitTracker } from "./git-tracker.js";
import { createPrStatusScheduler, type PrStatusScheduler } from "./pr-status.js";
import * as git from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import { localCredentialPlan } from "./local-token-header.js";
import { inlineMessageText, type ReadFileOutcome } from "./markdown-image-inliner.js";
import { createMcpDashboardRegistrar, type McpRegistrationApi, } from "./mcp-token-delivery.js";
import { createPluginRequestClient, installPluginRequest } from "./plugin-request-client.js";
import { COALESCE_WINDOW_MS, MessageUpdateCoalescer } from "./message-update-coalescer.js";
import { resetReconnectCaches as _resetReconnectCaches, sendCwdMissingIfChanged as _sendCwdMissingIfChanged, sendModelUpdateIfChanged as _sendModelUpdateIfChanged, sendPiVersionIfChanged as _sendPiVersionIfChanged, sendSessionNameIfChanged as _sendSessionNameIfChanged } from "./model-tracker.js";
import { createPathGate } from "./path-gate/index.js";
import { Suppression } from "./path-gate/suppression.js";
import { emitPendingPrompts } from "./pending-prompt-emitter.js";
import { readPiRetrySettings } from "./pi-retry-settings.js";
import { getOwnPgid, } from "./process-scanner.js";
import { expandPromptTemplateFromDisk } from "./prompt-expander.js";
import { activate as activateProviderRegister, buildProviderCatalogue, onProviderChanged, reloadProviders, toModelInfo } from "./provider-register.js";
import { httpBaseUrlFor, isRemoteEndpoint } from "./remote-registration-gate.js";
import { RetryTracker } from "./retry-tracker.js";
import { activate as activateRoleManager, resolveNamingModel } from "./role-manager.js";
import { replaySessionEntries as _replaySessionEntries, sendStateSync as _sendStateSync, filterByEnabledModels } from "./session-sync.js";
import { tryDispatchExtensionCommand } from "./slash-dispatch.js";
import { UsageDrain, drainUsageAndSend, makeCacheWarmingDecisionHandler, } from "./usage-drain.js";
import { flushBufferedSubagentFrames, } from "./subagent-forward-sites.js";
import { PluginForwardRegistry } from "./plugin-event-forward-registry.js";
import { SubagentFrameBuffer } from "./subagent-frame-buffer.js";
import { stripForForward } from "./subagent-frame-strip.js";
import { FanoutAdmissionGate, resolveAdmissionConfig } from "./subagent-fanout-admission.js";
import { SaturationSampler } from "./subagent-saturation.js";
import { SubagentTickThrottle } from "./subagent-tick-throttle.js";
import { createTransportDiagnostics } from "./transport-diagnostics.js";
import { refreshUiModules, type UiModulesBridgeCtx } from "./ui-modules.js";
import { createInstance, type BridgeState } from "./bridge-handlers/instance.js";
import { registerSessionInfoChanged, registerProjectTrust, registerSessionStart, registerTurnEnd, registerSessionShutdown } from "./bridge-handlers/lifecycle.js";
import { registerEnrichedForwarders, registerPassThroughForwarders } from "./bridge-handlers/forwarders.js";
import { handleInboundMessage } from "./bridge-handlers/dispatch.js";

/**
 * Formats the state behind a watchdog force-close for `server.log`.
 *
 * Shared by the primary connection and the `/dashboard-connect` move target:
 * after a move the target IS the live connection, so omitting it there would
 * silence exactly the socket under observation.
 */
function formatWatchdogFire(w: WatchdogFireInfo): string {
  return (
    `silent=${w.silentForMs}ms threshold=${w.watchdogTimeout}ms ` +
    `readyState=${w.readyState} inboundQueue=${w.inboundQueueDepth} ` +
    `refusedInbound=${w.refusedInbound} maxTickDrift=${w.maxTickDriftMs}ms`
  );
} // platform-branch-ok: Windows-safe default (costly PowerShell Get-CimInstance)



// Use `process` (not `globalThis`) to survive jiti module cache invalidation
// AND to share state across isolated extension contexts (vm sandboxes).
const BRIDGE_KEY = "__pi_dashboard_bridge__";
function getBridgeState(): BridgeState {
  if (!(process as any)[BRIDGE_KEY]) {
    (process as any)[BRIDGE_KEY] = {};
  }
  return (process as any)[BRIDGE_KEY];
}

export default function (pi: ExtensionAPI) {
  // Per-process opt-out, decided before ANY registration: an inert bridge
  // registers no tool/command/handler/MCP and never connects or auto-starts.
  // Dashboard spawns stamp PI_DASHBOARD_BRIDGE=on. See change: add-bridge-env-opt-out.
  if (!shouldActivateBridge(process.env, () => loadConfig().bridge)) return;
  try {
    // Activate provider management before bridge init so providers are
    // registered before session_start fires and models_list is sent.
    activateProviderRegister(pi);

    // Activate role manager: registers `roles:*` handlers that back
    // Settings → Roles. Relocated from pi-flows per OpenSpec change
    // `adopt-model-resolve-handler-and-roles-ownership`; the legacy `flow:`
    // prefix was dropped in `add-agent-role-model-tools` (design D11).
    activateRoleManager(pi);

    // Anthropic-messages payload transforms (system prompt rewrite + tool
    // filter/remap) are handled by the installed @benvargas/pi-claude-code-use
    // package when present. No local duplication here.

    initBridge(pi);
  } catch (err) {
    // Never crash the host pi agent — dashboard is non-essential
    console.error("[dashboard] Bridge init failed:", err);
  }
}





function initBridge(pi: ExtensionAPI) {
  const prev = getBridgeState();

  // If bridge is already active for a different pi instance (e.g. a subagent
  // loading extensions in the same process), skip initialization to avoid
  // invalidating the parent session's bridge connection and event forwarding.
  // `session_shutdown{reason:"reload"}` releases `prev.pi`, so the reloaded
  // main session (a fresh ExtensionAPI) is not mistaken for a subagent.
  // See change: fix-terminal-session-dashboard-reload (D4).
  // Re-init teardown (cleanup, connections, timers, disposables) runs only for a
  // genuine re-init; a subagent re-entry returns here untouched. Seam:
  // `bridge-polling.ts`. See change: optimize-polling-hot-paths (D11).
  if (!teardownPreviousIncarnation(prev, () => isBridgeReentry(prev, pi))) {
    return;
  }

  // Bump generation so stale listeners from previous initBridge calls bail out
  const generation = (prev.generation ?? 0) + 1;
  prev.generation = generation;
  prev.pi = pi;
  const inst = createInstance(pi, generation, prev);
  /** Return true if this bridge instance is still the active one */
  const isActive = (): boolean => inst.isActive();

  inst.sessionId = prev.sessionId ?? crypto.randomUUID();
  inst.attachedChange = prev.attachedChange ?? null;
  inst.sessionReady = false; // true after session_start has run
  // Non-message usage drain cursor (usage / compaction / branch_summary
  // entries → `usage_recorded`). Baselined at every session_start (init,
  // reload, new/fork/resume) from the same snapshot as `usageSeed`; a
  // reconnect never touches it. See change: count-non-message-usage.
  const usageDrain = new UsageDrain();
  inst.usageDrain = usageDrain;
  function drainUsage(ctx: any): void {
    if (!inst.sessionReady) return;
    drainUsageAndSend(usageDrain, (ctx ?? inst.cachedCtx)?.sessionManager, (m) => inst.connection.send(m));
  }
  inst.drainUsage = drainUsage;
  // → inst.lastSessionFile (BridgeInstance field; unset until assigned)
  // → inst.lastSessionDir (BridgeInstance field; unset until assigned)
  // → inst.lastFirstMessage (BridgeInstance field; unset until assigned)
  // ctx.cwd is a guarded getter on ExtensionRunner that throws once the session
  // is replaced (new/fork/resume/reload). Poll timers must read this cached copy
  // instead of the captured ctx, or they crash the host after a session change.
  // See change: fix-stale-ctx-cwd-crash.
  // → inst.cachedCwd (BridgeInstance field; unset until assigned)
  inst.pendingDefaultModel = null; // non-null if default model not yet applied (custom provider not ready)

  /** Try to apply the default model from config. Returns the model string if not found (pending), null if applied or no default. */
  function applyDefaultModel(): string | null {
    const freshConfig = loadConfig();
    if (!freshConfig.defaultModel || !inst.cachedModelRegistry) return null;
    const slashIdx = freshConfig.defaultModel.indexOf("/");
    if (slashIdx <= 0) return null;
    const provider = freshConfig.defaultModel.slice(0, slashIdx);
    const modelId = freshConfig.defaultModel.slice(slashIdx + 1);
    try {
      const found = inst.cachedModelRegistry.find(provider, modelId);
      if (found) {
        (pi as any).setModel(found).then(() => {
          // Apply the configured default thinking level alongside the default
          // model. setModel preserves the current level, so an explicit call is
          // required. pi.setThinkingLevel is synchronous and clamps the level to
          // the model's capabilities. Empty value = "do not override".
          // See change: add-default-thinking-level.
          const level = freshConfig.defaultThinkingLevel;
          if (level) (pi as any).setThinkingLevel?.(level);
          setTimeout(() => sendModelUpdateIfChanged(), 50);
        }).catch(() => {});
        return null; // applied
      }
    } catch { /* ignore */ }
    return freshConfig.defaultModel; // not found yet — pending
  }
  inst.applyDefaultModel = applyDefaultModel;

  /** Query pi-flows for available flows via synchronous event RPC */
  function getFlowsList(): FlowInfo[] {
    const probe: any = {};
    try {
      pi.events?.emit("flow:list-flows", probe);
    } catch { /* ignore */ }
    return (probe.flows as FlowInfo[] | undefined) ?? [];
  }
  inst.getFlowsList = getFlowsList;

  /** Send flows_list message to the dashboard server */
  function sendFlowsList() {
    const flows = getFlowsList();
    console.error(`[dashboard] sendFlowsList: ${flows.length} flows, sessionId=${inst.sessionId.slice(0,8)}`);
    inst.connection.send({ type: "flows_list", sessionId: inst.sessionId, flows });
  }
  inst.sendFlowsList = sendFlowsList;


  inst.heartbeatTimer = null;
  inst.gitPollTimer = null;
  // Adaptive async process-scan scheduler (replaces the fixed setInterval).
  // See change: optimize-polling-hot-paths.
  const polling = createPollingHolder();
  inst.polling = polling;
  // Per-session git tracker (facts cache, HEAD branch, async status probe);
  // renewed at every session_start / session change. See change:
  // optimize-polling-hot-paths.
  inst.previousProcessPids = ""; // JSON-stringified PID set for diff
  const trackedPgids = new Set<number>();
  inst.trackedPgids = trackedPgids; // PGIDs captured during bash tool calls
  // PIDs of subprocesses the bridge has spawned itself (dashboard server,
  // RPC keeper). Threaded into `scanChildProcesses` as `excludedPgids` so
  // bridge infrastructure never surfaces in the process list.
  // See change: tighten-process-list-ux.
  const selfSpawnedPgids = new Set<number>();
  inst.selfSpawnedPgids = selfSpawnedPgids;
  // Seed pi's OWN process-group id so pi-self + same-group plugin/MCP
  // sidecars (context-mode bun, etc.) never enter `trackedPgids` or the
  // process list. Cached one-shot `ps` lookup; no-op on Windows.
  // See change: classify-process-list-entries.
  {
    const ownPgid = getOwnPgid();
    if (ownPgid !== undefined) selfSpawnedPgids.add(ownPgid);
  }
  let lastGitBranch: string | undefined;
  let lastGitPrJson: string | undefined; // see change: redesign-composer-session-strip
  // Async PR-status scheduler: `gh pr view` off the 30 s tick, own ≥120 s
  // cadence + forced refresh on `git_info_refresh`. Timers are registered in
  // the bridge-timer registry so a reload cannot leak them; probe completion
  // re-runs the one git change-detector. See change:
  // redesign-composer-session-strip (D5).
  const unregisterTimer = (timer: ReturnType<typeof setTimeout>) => {
    const timers = getBridgeState().timers;
    const index = timers ? timers.indexOf(timer as unknown as ReturnType<typeof setInterval>) : -1;
    if (index !== -1) timers!.splice(index, 1);
  };
  // One-shot timers leave the registry when they fire as well as when they
  // are cleared, so a long-lived session never accumulates dead handles.
  const setRegisteredTimeout = (fn: () => void, ms: number): ReturnType<typeof setTimeout> => {
    const timer = setTimeout(() => {
      unregisterTimer(timer);
      fn();
    }, ms);
    getBridgeState().timers!.push(timer as unknown as ReturnType<typeof setInterval>);
    return timer;
  };
  inst.setRegisteredTimeout = setRegisteredTimeout;
  const clearRegisteredTimeout = (timer: ReturnType<typeof setTimeout>): void => {
    clearTimeout(timer);
    unregisterTimer(timer);
  };
  inst.clearRegisteredTimeout = clearRegisteredTimeout;
  const registerDisposable = (fn: () => void): void => {
    (getBridgeState().disposables ??= []).push(fn);
  };
  // ONE stable disposer, (re-)ensured on every session_start: a shutdown drains
  // and empties the list, and this incarnation may start a new session after it.
  const disposePolling = () => polling.disposeAll();
  const ensurePollingDisposable = () => ensureDisposable(getBridgeState(), disposePolling);
  inst.ensurePollingDisposable = ensurePollingDisposable;
  ensurePollingDisposable();
  /** Dispose the previous tracker and start a fresh one for the incoming session. */
  function renewGitTracker(): GitTracker {
    ensurePollingDisposable();
    return polling.replaceGitTracker(createGitTracker({
      getBc: () => syncBc(),
      applyBc: (bc) => applyBc(bc),
      isActive,
      setTimer: setRegisteredTimeout,
      clearTimer: clearRegisteredTimeout,
    }));
  }
  inst.renewGitTracker = renewGitTracker;
  const prStatus: PrStatusScheduler = createPrStatusScheduler({
    probe: (cwd) => git.prStatusAsync({ cwd }),
    // A reload starts a new bridge incarnation; the old scheduler must not
    // keep probing into the new timer registry. See change:
    // redesign-composer-session-strip (doubt-review #2).
    alive: isActive,
    onChange: () => {
      if (isActive()) polling.gitTracker?.sendCached();
    },
    setTimer: setRegisteredTimeout,
    clearTimer: clearRegisteredTimeout,
  });
  inst.prStatus = prStatus;
  let lastGitWorktreeJson: string | undefined; // see change: add-worktree-spawn-dialog
  let lastGitStatusJson: string | undefined; // see change: add-session-uncommitted-indicator-and-commit
  let lastCwdMissing: boolean | undefined; // see change: add-worktree-lifecycle-actions
  // → inst.lastSessionName (BridgeInstance field; unset until assigned)
  // ── add-auto-session-naming ────────────────────────────────────────────
  // Global auto-naming toggle, relayed by the server via `preferences_update`.
  // Default true so a bridge that registers before the first push still names.
  inst.autoNameSessions = true;
  // → inst.autoNamer (BridgeInstance field; unset until assigned)
  // The namer's durable state set is carried across reload as VALUES, never as
  // the namer object: its closures would retain a stale connection, session id
  // and ctx. See change: fix-auto-naming-reasoning-model (design D7).
  inst.namerState = prev.namerState;
  // Lazily-loaded pi-ai streamSimple (null = load attempted and failed).
  let piAiStreamSimple: StreamSimpleFn | null | undefined;
  inst.cachedHasUI = prev.hasUI;
  inst.cachedModelRegistry = prev.modelRegistry;
  inst.cachedCtx = prev.ctx;
  // → inst.lastModel (BridgeInstance field; unset until assigned)
  // → inst.lastThinkingLevel (BridgeInstance field; unset until assigned)
  let hasRegisteredOnce = false; // see change: reattach-move-to-front
  // Capture-once "was this pi dashboard-spawned?" boolean, read BEFORE the
  // single-use `PI_DASHBOARD_SPAWN_TOKEN` is scrubbed on first register.
  // Persisted on BridgeState (`prev`) so a reload/reattach — which re-runs
  // this module after the env was scrubbed — keeps the correct value instead
  // of regressing to false. See change: fix-spawn-token-env-leak.
  if (prev.dashboardSpawned === undefined) {
    prev.dashboardSpawned = !!process.env.PI_DASHBOARD_SPAWN_TOKEN;
  }
  const dashboardSpawned = prev.dashboardSpawned;
  inst.dashboardSpawned = dashboardSpawned;

  // Capture the cwd at bridge ACTIVATION (module scope). `project_trust` fires
  // during resource-loader reload — BEFORE `session_start` reaches extension
  // handlers — so a cwd captured at session_start would still be undefined
  // when the trust handler runs. For a fresh headless spawn this IS the
  // dashboard-provided spawn cwd. See change: adopt-pi-074-080-features (A.3).
  const activationCwd = process.cwd();
  inst.activationCwd = activationCwd;

  // → inst.promptBus (BridgeInstance field; unset until assigned)

  // Provider-retry synthesis tracker. pi's ExtensionAPI does not expose
  // `auto_retry_*` events, so the bridge synthesizes them by OBSERVING pi's
  // real event shape: one full agent_start…agent_end cycle PER attempt, with a
  // single agent_settled as the sole terminal signal. `maxAttempts`/`delayMs`
  // are sourced READ-ONLY from pi's retry settings for the display countdown;
  // the bridge never writes them. See change: retry-forever-with-stop-control.
  const retryTracker = new RetryTracker(readPiRetrySettings({ cwd: activationCwd }));
  inst.retryTracker = retryTracker;
  // Empty-actionable-turn guard: when a terminal turn is a clean-but-empty
  // `stop` (thinking-only, no text, no tool call), continue-or-surface instead
  // of idling silently. Provider-agnostic. See change:
  // fix-gemini-subagent-silent-tool-schema-failure.
  const guardConfig = resolveGuardConfig();
  const emptyActionableGuard = new EmptyActionableGuard(guardConfig.mode, guardConfig.retryCap);
  inst.emptyActionableGuard = emptyActionableGuard;
  // Abort latch: keeps a user abort latched so a provider backoff that
  // outlives the 2 s persistent-abort scheduler still stops pi's retry.
  // Set on abort; cleared on a new user prompt or terminal agent_end; honored
  // on every observed resumption of the aborted turn. See change:
  // unify-error-retry-lifecycle (design D3b).
  const abortLatch = new AbortLatch();
  inst.abortLatch = abortLatch;

  // Subagent live-detail reliability: retain subagent frames emitted while the
  // bridge is not ready (buffer-and-flush on re-register, D1) and keep the
  // latest snapshot of each running subagent for the resync responder (D2).
  // See change: fix-subagent-live-detail-reliability.
  const subagentFrameBuffer = new SubagentFrameBuffer();
  inst.subagentFrameBuffer = subagentFrameBuffer;

  // Dashboard MCP server registration with pi's built-in MCP. The bearer lives
  // only in this registrar and pi's registration — never in process.env.
  // See change: migrate-mcp-to-pi-builtin (D1).
  const mcpRegistrar = createMcpDashboardRegistrar({
    pi: pi as unknown as McpRegistrationApi,
    sessionId: () => inst.sessionId,
    reportUnavailable: (reason) => {
      inst.connection.send({
        type: "plugin_pi_message",
        sessionId: inst.sessionId,
        pluginId: "mcp-server",
        messageType: "mcp/registration-unavailable",
        payload: { reason },
      });
    },
    log: console,
  });
  inst.mcpRegistrar = mcpRegistrar;

  // Bound the Agent-tick rate on the `tool_execution_update` carrier. That
  // carrier has no throttle anywhere on its path, so its rate is the
  // subagent's raw session-event rate; the sibling `subagents:*` carrier is
  // already coalesced to 250 ms by the producer and is what paces the LIVE
  // render, so this window costs replay staleness, not liveness.
  //
  // `windowMs` comes from the shared dashboard config, read once here at
  // bridge init (`0` = disabled, the byte-identical rollback path). `send` and
  // `canSend` deliberately resolve `connection` / `sessionReady` / `sessionId`
  // at CALL time: all three can move while a frame is held, and a captured
  // reference would send over a dead connection or under a stale session.
  // See change: reduce-bridge-tick-bandwidth (D2/D3/D4).
  const subagentTickThrottle = new SubagentTickThrottle<unknown>({
    windowMs: loadConfig().subagentTickThrottleMs,
    send: (msg) => inst.connection.send(msg),
    canSend: (frameSessionId) => isActive() && inst.sessionReady && frameSessionId === inst.sessionId,
  });
  inst.subagentTickThrottle = subagentTickThrottle;

  // Bound the bridge's per-token streaming cost. pi's `message_update` carries
  // the FULL accumulated text snapshot, so forwarding each one synchronously
  // paid a `JSON.stringify` per source token on pi's own event loop — O(N²)
  // bytes for an N-token turn. Only contiguous `text_*` snapshots coalesce;
  // thinking/toolcall/unknown sub-events flush first and forward immediately so
  // they stay lossless and in source order.
  //
  // `send` resolves `connection` / `sessionReady` at CALL time: both can move
  // while a snapshot is parked, and a captured reference would write a stale
  // snapshot over a dead socket. The inliner moves INTO the send callback so it
  // runs once per flushed window instead of once per token, still ahead of the
  // snapshot that references its assets. `setTimer`/`clearTimer` own the single
  // armed window and keep it in the bridge-timer registry so a reload cannot
  // leak it.
  // See change: coalesce-bridge-message-update-snapshots (D1–D7).
  const coalescer = new MessageUpdateCoalescer<Record<string, unknown>>({
    windowMs: COALESCE_WINDOW_MS,
    isActive: () => isActive() && inst.sessionReady,
    send: (event) => {
      if (!isActive() || !inst.sessionReady) return;
      maybeInlineAssistantImages(event);
      inst.connection.send(mapEventToProtocol(inst.sessionId, event));
    },
    setTimer: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      getBridgeState().timers!.push(timer as unknown as ReturnType<typeof setInterval>);
      return timer;
    },
    clearTimer: (timer) => {
      clearTimeout(timer);
      const timers = getBridgeState().timers;
      const index = timers ? timers.indexOf(timer as unknown as ReturnType<typeof setInterval>) : -1;
      if (index !== -1) timers!.splice(index, 1);
    },
  });
  inst.coalescer = coalescer;

  // Per-message generation for the coalescing barrier. Distinct from the
  // bridge-instance `generation` above, which only changes on `initBridge` and
  // so gives no intra-session ordering. Incremented on EVERY `message_start`
  // (user, assistant and — for the barrier only — `system`): a retry chain or a
  // new turn must reset the barrier too. A `system` message reaches the barrier
  // and then returns, so it opens an identity no `message_update` can ever
  // match (pi emits its start/end adjacently — see
  // filter-system-role-message-forwarding design D2). Folded into the message
  // key rather than compared standalone, because a `message_update` carries no
  // generation of its own — an update can only be stamped with the counter's
  // current value.
  // See change: coalesce-bridge-message-update-snapshots (D4).
  inst.assistantMessageGen = 0;

  /**
   * Identity of a message for the barrier: `<gen>:<role>:<timestamp>`.
   * `message.id` is unusable — pi stamps it only at post-handler persistence.
   */
  const messageKeyOf = (gen: number, message: unknown): string => coalescer.keyOf(gen, message);
  inst.messageKeyOf = messageKeyOf;

  // Bridge-owned queue structures with TWO different ownership models:
  //
  // • bridgeSteering (pi-OWNED + SHADOW) — mirrors pi's Agent.steeringQueue.
  //   Mutated only by `recordSteerSent` (on bridge-originated steer sends) +
  //   drain-by-message_start-matcher (when pi delivers a queued steer entry,
  //   the matching text is spliced).
  //
  // • bridgeFollowUp (BRIDGE-OWNED BUFFER) — authoritative store for
  //   dashboard-originated follow-up entries while the agent is streaming.
  //   Pi never sees these entries until `drainFollowupQueue()` ships them
  //   one-at-a-time on `agent_end`. Mutated by `bufferFollowupSend`,
  //   `drainFollowupQueue`, and the four mutation handlers (edit / remove /
  //   promote / clear).
  //
  //   Entries carry their image attachments (`{ text, images? }`) and the
  //   buffer is bounded in BYTES as well as depth; the state itself lives in
  //   `followup-buffer.ts` so the admission arithmetic is testable and the
  //   ceiling injectable. See change: fix-bridge-followup-image-drop.
  //
  // Both feed the same `queue_update` ExtensionToServerMessage.
  //
  // Steer is permanently pi-owned + display-only (steer drains too fast at
  // turn_end for mutation UI to matter; user direction).
  //
  // See change: rework-mid-turn-prompt-queue (spec mid-turn-prompt-queue).
  inst.bridgeSteering = [];
  const bridgeFollowUp = createFollowupBuffer();
  inst.bridgeFollowUp = bridgeFollowUp;
  function emitQueueUpdate(): void {
    if (!isActive() || !inst.sessionReady) return;
    inst.connection.send({
      type: "queue_update",
      sessionId: inst.sessionId,
      steering: [...inst.bridgeSteering],
      // Views only: text + image COUNT. Image bytes never cross the wire.
      followUp: bridgeFollowUp.views(),
    });
  }
  inst.emitQueueUpdate = emitQueueUpdate;
  /**
   * Surface a refusal to the user. Every follow-up refusal path emits one:
   * a bare `console.warn` is invisible in the dashboard, which is the same
   * defect class this change exists to fix (design D4).
   */
  function sendCommandFeedback(command: string, message: string): void {
    if (!isActive() || !inst.sessionReady) return;
    inst.connection.send({
      type: "event_forward",
      sessionId: inst.sessionId,
      event: {
        eventType: "command_feedback",
        timestamp: Date.now(),
        data: { command, status: "error", message },
      },
    });
  }
  inst.sendCommandFeedback = sendCommandFeedback;
  function recordSteerSent(text: string): void {
    // Only record when the agent was actually streaming at send time. Idle
    // sends start a new turn directly — pi doesn't queue them, so the
    // shadow queue must not show a chip. See change: add-followup-edit-and-steer-cancel.
    if (!getBridgeState().isAgentStreaming) return;
    inst.bridgeSteering.push(text);
    emitQueueUpdate();
  }
  /**
   * Push a follow-up entry into the bridge-owned buffer.
   *
   * Replaces the prior `recordFollowupSent` shadow-mirror. Semantics flipped:
   * the OLD function was called AFTER `pi.sendUserMessage(_, {deliverAs:"followUp"})`
   * and recorded what pi already received. The NEW function is called INSTEAD
   * of that pi call — pi never sees the entry until the drain loop ships it.
   *
   * The `isAgentStreaming` gate is defense-in-depth (callers already gate on
   * `wasStreaming === true` before invoking this function).
   *
   * Image attachments ride the entry and are delivered when the drain ships
   * it. They are validated HERE rather than at drain time so the byte
   * accounting reflects what will actually be sent, and so a bad attachment is
   * reported while the user is still looking at the composer (design D7).
   *
   * Refused entries are refused WHOLE — images are never stripped to make an
   * entry fit, because delivering a prompt whose attachment vanished is the
   * original bug. See change: fix-bridge-followup-image-drop.
   */
  function bufferFollowupSend(text: string, images?: unknown): void {
    if (!getBridgeState().isAgentStreaming) return;
    const { valid, dropped } = validateImages(images);
    const admitted = bridgeFollowUp.push({
      text,
      ...(valid.length > 0 ? { images: valid } : {}),
    });
    if (!admitted.ok) {
      console.warn("[dashboard] follow-up buffer refused entry:", admitted.message);
      sendCommandFeedback("send_prompt", admitted.message);
      return;
    }
    // Reported only once the entry is actually queued: a refused entry is not
    // in the queue at all, so telling the user which of its attachments were
    // dropped is noise on top of the refusal.
    if (dropped.length > 0) {
      sendCommandFeedback(
        "send_prompt",
        `${dropped.length} attachment(s) dropped: ${dropped.join("; ")}`,
      );
    }
    emitQueueUpdate();
  }
  /**
   * Drain loop: on `agent_end`, pop the front of `bridgeFollowUp` and ship it
   * to pi as a fresh-turn `sendUserMessage` (no `deliverAs`). Pop-before-send
   * invariant: the entry is shifted off the buffer BEFORE the pi call. If
   * `pi.sendUserMessage` throws, the entry is LOST by design (double-shipping
   * is worse than dropping).
   *
   * Gates (all must pass): re-entrancy lock, idle, pi.hasPendingMessages,
   * non-empty buffer. One entry per agent_end — the next agent_end re-enters
   * this function for the next entry (natural serialization).
   *
   * See change: rework-mid-turn-prompt-queue (design.md D2).
   */
  let isDraining = false;
  /**
   * Drain the bridge-owned follow-up buffer by handing one entry to pi
   * as a fresh-turn `sendUserMessage` (no `deliverAs`).
   *
   * Why no `deliverAs`: pi's agent loop calls `getFollowUpMessages()` only
   * while the loop is active. Once `agent_end` fires and the loop's
   * `executor` returns, pi's `finishRun()` flips `isStreaming = false` and
   * `activeRun = undefined`. After that point, anything queued into pi's
   * internal followUpQueue NEVER drains — pi has stopped reading it.
   * (Verified at pi-coding-agent pi-agent-core/agent.js: `finishRun()` clears
   * `isStreaming` + `activeRun`, and `getFollowUpMessages` is only supplied to
   * the loop while a run is active. Re-verified against pi 0.84.1 — behaviour
   * unchanged, line numbers moved. See change: update-pi-core-0-84-adopt-apis.)
   *
   * Two retry loops handle the transition window correctly:
   *  - retryCount tracks how many setTimeout retries we've done
   *  - if pi.isStreaming is still true (transition), we wait + retry
   *  - once truly idle, sendUserMessage(entry) starts a fresh turn
   *
   * See change: rework-mid-turn-prompt-queue (post-smoke fix #3).
   */
  function drainFollowupQueue(retryCount = 0): void {
    if (isDraining) return;
    if (bridgeFollowUp.length === 0) return;

    // TUI-coexistence gate: if pi has its own queued items (TUI alt+enter
    // sends), wait for pi to drain those first via its own loop. The
    // method lives on `ctx` (verified at pi 0.76.0 extensions/types.d.ts:227).
    if (typeof inst.cachedCtx?.hasPendingMessages === "function") {
      try {
        if (inst.cachedCtx.hasPendingMessages()) return;
      } catch { /* probe failure non-fatal */ }
    }

    // Idle gate: pi flips isStreaming=false in finishRun() AFTER the
    // executor returns from runAgentLoop. queueMicrotask runs inside the
    // executor (too early), so we use setTimeout to escape the loop AND
    // poll for isIdle with bounded retries.
    const idle = (() => {
      try { return inst.cachedCtx?.isIdle?.() === true; } catch { return false; }
    })();
    if (!idle) {
      if (retryCount < 20) { // ~2s total (20 × 100ms)
        setTimeout(() => drainFollowupQueue(retryCount + 1), 100);
      } else {
        console.warn("[dashboard] drainFollowupQueue: pi never idled after 2s; giving up");
      }
      return;
    }

    isDraining = true;
    try {
      // POP FIRST. Once shifted, the entry exists only on this stack frame.
      const entry = bridgeFollowUp.shift()!;
      // Emit immediately so wire-state matches buffer-state BEFORE the pi call.
      emitQueueUpdate();

      // Hand to pi as a fresh turn (no deliverAs). Pi is now idle, so
      // pi.sendUserMessage starts a new run via Agent.prompt().
      //
      // NO send options, deliberately: `{deliverAs:"followUp"}` here is a
      // known-broken path (pi has already exited `getFollowUpMessages()`, so
      // the entry would never drain). `buildUserMessageContent` supplies the
      // content shape WITHOUT inheriting the steer/idle send options.
      // See change: fix-bridge-followup-image-drop (design D6).
      try {
        (pi.sendUserMessage as any)(buildUserMessageContent(entry.text, entry.images));
      } catch (err) {
        console.warn(
          "[dashboard] drainFollowupQueue: pi.sendUserMessage threw — entry lost:",
          err,
        );
        // INTENTIONAL: no re-push. Double-shipping is worse than dropping.
      }
    } finally {
      isDraining = false;
    }
  }
  inst.drainFollowupQueue = drainFollowupQueue;
  /**
   * System-originated follow-up enqueue. Unlike `bufferFollowupSend`, this
   * does NOT gate on `isAgentStreaming` — it is called by plugin bridges
   * (via the `dashboard:enqueue-followup` pi.event) AFTER `agent_end` has
   * fired, by which point `isAgentStreaming` is already `false` and the
   * streaming gate would silently discard the entry.
   *
   * Routes through the SINGLE existing `drainFollowupQueue` path so a
   * plugin-requested continuation cannot race or double-inject against
   * user follow-ups: both share the one `bridgeFollowUp` buffer and the
   * `isDraining` lock, shipping one entry per `agent_end`.
   *
   * Text-only by design — the plugin path has no image source — so it wraps
   * into a `{ text }` entry. Subject to BOTH buffer bounds, with the refusal
   * reported under its OWN command name (`enqueue_followup`): a refused system
   * nudge is a lost plugin continuation, and attributing it to `send_prompt`
   * would misreport a programmatic refusal as a user action (design D8).
   *
   * Schedules `drainFollowupQueue(0)` via
   * `setTimeout(…, 0)` so the drain re-runs AFTER the async judge verdict
   * resolves (the bridge's own `agent_end` drain already ran against an
   * empty buffer by then).
   *
   * Generic infrastructure — not goal-specific. See change:
   * add-goal-continuation-plugin (design.md Decision 2).
   */
  function enqueueSystemFollowup(text: string): void {
    if (typeof text !== "string" || text.length === 0) return;
    const admitted = bridgeFollowUp.push({ text });
    if (!admitted.ok) {
      console.warn("[dashboard] follow-up buffer refused system entry:", admitted.message);
      sendCommandFeedback("enqueue_followup", admitted.message);
      return;
    }
    emitQueueUpdate();
    setTimeout(() => drainFollowupQueue(0), 0);
  }
  inst.enqueueSystemFollowup = enqueueSystemFollowup;
  /**
   * Mirror of pi's `_getUserMessageText` (pi-coding-agent agent-session.js).
   * Used by the per-entry shadow-queue drain matcher in the `message_start`
   * handler. Joining all text blocks (and dropping non-text content) keeps
   * matching parity with pi's internal queue logic.
   */
  function extractUserMessageText(message: any): string {
    if (!message || message.role !== "user") return "";
    const content = message.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .filter((c: any) => c && c.type === "text")
      .map((c: any) => c.text ?? "")
      .join("");
  }
  inst.extractUserMessageText = extractUserMessageText;

  // rewriteFollowupQueue removed. The clear-then-replay strategy was broken
  // by construction (pi.clearFollowUpQueue is not on the ExtensionAPI, so the
  // "clear" step was a no-op and the replay just appended ghosts to pi's real
  // queue). See change: honest-mid-turn-queue-surface.

  /** Forward a synthesized auto_retry_* event using the standard event_forward shape. */
  const sendSyntheticRetryEvent = (eventType: string, data: Record<string, unknown>): void => {
    if (!isActive() || !inst.sessionReady) return;
    // A synthesized retry event renders as a chat row, so a parked snapshot must
    // still land first. See change: coalesce-bridge-message-update-snapshots (D5).
    coalescer.flush();
    inst.connection.send({
      type: "event_forward",
      sessionId: inst.sessionId,
      event: { eventType, timestamp: Date.now(), data },
    });
  };
  inst.sendSyntheticRetryEvent = sendSyntheticRetryEvent;

  // ── Per-message entry id tracking (for fix-per-message-fork) ──
  // Pi 0.69+ awaits extension handlers BEFORE sessionManager.appendMessage runs,
  // which means getLeafId() at emit time returns the previous leaf, not the
  // entry id of the message currently being emitted. We solve this by:
  //  1. Wrapping ctx.sessionManager.appendMessage at session_start to stamp
  //     the just-generated entry id onto the message object reference.
  //  2. Deferring the message_end enrichment-and-send via setTimeout(0) so
  //     the awaited dispatcher unwinds and appendMessage runs in between.
  //  3. Stamping a nonce on message_start/message_end events; emitting an
  //     entry_persisted event after appendMessage so the client reducer can
  //     back-fill user-message ChatMessage.entryId.
  // See change: fix-per-message-fork.
  const idByMessage = new WeakMap<object, string>();
  inst.idByMessage = idByMessage;
  const pendingNonces = new WeakMap<object, string>();
  inst.pendingNonces = pendingNonces;
  let nonceCounter = 0;
  const nextNonce = (): string => `n-${++nonceCounter}-${Date.now()}`;
  inst.nextNonce = nextNonce;
  inst.appendMessageWrapped = false;
  inst.lastWrappedSm = null;

  // ---------------------------------------------------------------------
  // Markdown-image inliner state (chat-markdown-local-images-and-math).
  // Per-sessionId set of asset hashes for which an `asset_register` has
  // already been emitted on this WebSocket. Survives across message events
  // within the same session; reset when the session id changes (in
  // session_start). The Map keys are sessionId strings.
  // ---------------------------------------------------------------------
  const emittedAssetHashesBySession = new Map<string, Set<string>>();
  function getEmittedAssetHashes(sid: string): Set<string> {
    let s = emittedAssetHashesBySession.get(sid);
    if (!s) {
      s = new Set<string>();
      emittedAssetHashesBySession.set(sid, s);
    }
    return s;
  }
  inst.getEmittedAssetHashes = getEmittedAssetHashes;

  /**
   * Synchronous fs probe + read for the inliner. Wraps `fs.statSync` /
   * `fs.readFileSync` and maps Node errno strings to the
   * `ReadFileOutcome.kind` enum used by the pure inliner. Order: stat
   * first so directories report EISDIR even when the path has no file
   * extension.
   */
  function inlinerReadFile(absolutePath: string): ReadFileOutcome {
    try {
      const st = fs.statSync(absolutePath);
      if (st.isDirectory()) return { ok: false, kind: "EISDIR" };
      if (!st.isFile()) return { ok: false, kind: "EOTHER" };
      const bytes = fs.readFileSync(absolutePath);
      return { ok: true, bytes };
    } catch (err: any) {
      const code = err?.code;
      if (code === "ENOENT") return { ok: false, kind: "ENOENT" };
      if (code === "EACCES") return { ok: false, kind: "EACCES" };
      if (code === "EISDIR") return { ok: false, kind: "EISDIR" };
      return { ok: false, kind: "EOTHER" };
    }
  }
  inst.inlinerReadFile = inlinerReadFile;

  /**
   * Apply the markdown-image inliner to an assistant message_update /
   * message_end event. Mutates `event.message.content` in place (string
   * → rewritten string; array<{type:"text",text}> → rewritten text in
   * each text block). Emits `asset_register` messages BEFORE returning so
   * the caller's subsequent `connection.send(eventForward)` lands AFTER
   * the assets it references. User-role and thinking events are no-ops.
   */
  function maybeInlineAssistantImages(event: any): void {
    const msg = event?.message;
    if (!msg || typeof msg !== "object") return;
    if (msg.role !== "assistant") return;
    // Use the *current* live cwd if available; fall back to the bridge
    // process cwd. The inliner resolves relative `./pic.png` against this.
    const cwd = (inst.cachedCtx?.cwd as string | undefined) ?? process.cwd();
    const alreadyEmitted = getEmittedAssetHashes(inst.sessionId);
    const allAssets: { hash: string; mimeType: string; data: string }[] = [];

    const rewriteOne = (text: string): string => {
      const r = inlineMessageText(text, {
        readFile: inlinerReadFile,
        cwd,
        alreadyEmitted,
      });
      for (const a of r.assetsToEmit) allAssets.push(a);
      return r.rewritten;
    };

    if (typeof msg.content === "string") {
      msg.content = rewriteOne(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block && typeof block === "object" && block.type === "text" && typeof block.text === "string") {
          block.text = rewriteOne(block.text);
        }
      }
    }

    // Send each new asset BEFORE the (rewritten) message event lands.
    for (const a of allAssets) {
      inst.connection.send({
        type: "asset_register",
        sessionId: inst.sessionId,
        hash: a.hash,
        mimeType: a.mimeType,
        data: a.data,
      });
    }
  }
  inst.maybeInlineAssistantImages = maybeInlineAssistantImages;

  /**
   * Wrap ctx.sessionManager.appendMessage once per session so that when pi
   * generates an entry id we capture it in the WeakMap and emit
   * entry_persisted to the server.
   */
  function wrapAppendMessageForCtx(ctx: any): void {
    const sm = ctx?.sessionManager;
    if (!sm || typeof sm.appendMessage !== "function") return;
    // Re-wrap when sessionManager identity changes (session replacement).
    if (sm === inst.lastWrappedSm && inst.appendMessageWrapped) return;
    const original = sm.appendMessage.bind(sm);
    sm.appendMessage = (msg: any, ...rest: any[]) => {
      const result = original(msg, ...rest);
      try {
        if (msg && typeof msg === "object" && typeof msg.id === "string") {
          idByMessage.set(msg as object, msg.id);
          const nonce = pendingNonces.get(msg as object);
          if (nonce && inst.sessionReady && isActive()) {
            const ev = {
              type: "entry_persisted",
              entryId: msg.id,
              nonce,
            };
            inst.connection.send(mapEventToProtocol(inst.sessionId, ev));
            pendingNonces.delete(msg as object);
          }
        }
      } catch (err) {
        console.error("[dashboard] entry_persisted emit failed:", err);
      }
      return result;
    };
    inst.lastWrappedSm = sm;
    inst.appendMessageWrapped = true;
  }
  inst.wrapAppendMessageForCtx = wrapAppendMessageForCtx;

  inst.customPersistenceWrapped = false;
  inst.customWrappedSm = null;

  /**
   * Wrap the sessionManager custom-persistence methods so the bridge can
   * forward BOTH custom surfaces at the single chokepoint where pi commits
   * them (change: render-inline-reasoning-and-custom-entries, D2):
   *
   * - `appendCustomMessageEntry` (pi.sendMessage) → synthesized `message_end`
   *   with `message.role === "custom"` — pi's idle-path sendMessage emits
   *   message_start/end to INTERNAL listeners only, so the enriched loop
   *   never sees it (and is guarded against double-forwarding the
   *   agent-loop path above).
   * - `appendCustomEntry` (pi.appendEntry) → `custom_entry` protocol event —
   *   pi does not dispatch `entry_appended` to extensions at all.
   *
   * pi-flows' `flow-event` entries are excluded inside the shared mapper
   * (they are appended live by pi-flows itself; forwarding would
   * double-render beside the dedicated flow card).
   */
  function wrapCustomPersistenceForCtx(ctx: any): void {
    const sm = ctx?.sessionManager;
    if (!sm || typeof sm.appendCustomMessageEntry !== "function" || typeof sm.appendCustomEntry !== "function") {
      return;
    }
    // Re-wrap when sessionManager identity changes (session replacement).
    if (sm === inst.customWrappedSm && inst.customPersistenceWrapped) return;
    const origMessage = sm.appendCustomMessageEntry.bind(sm);
    sm.appendCustomMessageEntry = (customType: any, content: any, display: any, details: any) => {
      const entryId = origMessage(customType, content, display, details);
      // Chat-row ordering: this sink is OUTSIDE the two event loops, so it needs
      // its own flush. See change: coalesce-bridge-message-update-snapshots (D5).
      coalescer.flush();
      try {
        const forward = toCustomMessageForward({ customType, content, display, details, entryId });
        if (forward && inst.sessionReady && isActive()) {
          inst.connection.send({
            type: "event_forward",
            sessionId: inst.sessionId,
            event: {
              eventType: "message_end",
              timestamp: Date.now(),
              data: { type: "message_end", message: forward.message, entryId: forward.entryId },
            },
          });
        }
      } catch (err) {
        console.error("[dashboard] custom message forward failed:", err);
      }
      return entryId;
    };
    const origEntry = sm.appendCustomEntry.bind(sm);
    sm.appendCustomEntry = (customType: any, data: any) => {
      const entryId = origEntry(customType, data);
      // Chat-row ordering: the second out-of-loop sink. See D5.
      coalescer.flush();
      try {
        const forward = toCustomEntryForward({ type: "custom", customType, data, id: entryId });
        if (forward && inst.sessionReady && isActive()) {
          inst.connection.send({
            type: "event_forward",
            sessionId: inst.sessionId,
            event: {
              eventType: "custom_entry",
              timestamp: Date.now(),
              data: { type: "custom_entry", ...forward },
            },
          });
        }
      } catch (err) {
        console.error("[dashboard] custom entry forward failed:", err);
      }
      return entryId;
    };
    inst.customWrappedSm = sm;
    inst.customPersistenceWrapped = true;
  }
  inst.wrapCustomPersistenceForCtx = wrapCustomPersistenceForCtx;

  /** Wrap a callback so errors log instead of crashing the host pi agent. */
  function safe<T extends (...args: any[]) => any>(fn: T): T {
    return ((...args: any[]) => {
      try {
        const result = fn(...args);
        if (result && typeof result.catch === "function") {
          return result.catch((err: unknown) => {
            console.error("[dashboard]", err);
          });
        }
        return result;
      } catch (err) {
        console.error("[dashboard]", err);
      }
    }) as T;
  }
  inst.safe = safe;

  // Load config to determine WebSocket URL
  ensureConfig();
  const config = loadConfig();
  inst.config = config;
  // The ONE place an endpoint is chosen (D3, task 3.1). Explicit configuration
  // is pinned and outranks everything; the HOME-derived rendezvous record is
  // the default; discovery may only suggest. The legacy
  // `ws://localhost:<configured piPort>` is the last resort, kept so a new
  // bridge still works against a dashboard that predates the record (task 8.3).
  const rendezvous = rendezvousEndpoint();
  inst.rendezvous = rendezvous;
  const endpointChoice = resolveEndpoint({
    socketEnv: process.env.PI_DASHBOARD_SOCKET,
    urlEnv: process.env.PI_DASHBOARD_URL,
    record: rendezvous ?? undefined,
  });
  inst.endpointChoice = endpointChoice;
  // The instance this bridge believes it is talking to (task 3.4). Any
  // re-target is judged against THIS id, not against the endpoint string —
  // the same instance may legitimately move, and a different instance may
  // legitimately answer at the same endpoint.
  inst.registeredInstanceId = endpointChoice.available
    ? endpointChoice.instanceId
    : undefined;
  // A socket-pinned bridge learns its instance from the FILESYSTEM, beside the
  // socket it was pinned to. Without this every dashboard-spawned session
  // answered `/dashboard-where` with `instance: unverified`, because only the
  // record-sourced path carried an id — and the record could not be used here,
  // since it names the HOME's owner rather than whichever instance owns this
  // socket. Best-effort: a missing or unreadable file leaves the id unset,
  // which is the honest answer and exactly today's behaviour.
  // See change: add-pi-gateway-transport-identity (task 9.6).
  if (inst.registeredInstanceId === undefined && endpointChoice.available && process.env.PI_DASHBOARD_SOCKET) {
    const idFile = instanceIdFileForSocket(process.env.PI_DASHBOARD_SOCKET);
    if (idFile) {
      try {
        const id = fs.readFileSync(idFile, "utf8").trim();
        if (id) inst.registeredInstanceId = id;
      } catch {
        /* absent or unreadable — stay unverified rather than guess */
      }
    }
  }
  // `let`: a completed move re-points this, so diagnostics and `/dashboard-where`
  // report where the session actually IS rather than where it started.
  // biome-ignore lint/style/useConst: reassigned by the move command.
  inst.dashboardUrl = endpointChoice.available
    ? endpointChoice.url
    : `ws://localhost:${config.piPort}`;
  // Pinned endpoints refuse every re-target, including a discovered one (D3).
  const endpointPinned = endpointChoice.available && endpointChoice.pinned;
  inst.endpointPinned = endpointPinned;
  // Task 10.1: log the winning precedence rule, or diagnosing "it connected to
  // the wrong dashboard" means guessing which source won.
  const endpointDetail = `${inst.dashboardUrl} (source=${
    endpointChoice.available ? endpointChoice.source : "legacy-config-piPort"
  } pinned=${endpointPinned})`;
  console.log(`[dashboard] endpoint ${endpointDetail}`);
  // ...and again over the wire, because the line above is discarded under the
  // default `capturePiOutput:false` (task 10.5).
  const transportDiagnostics = createTransportDiagnostics();
  inst.transportDiagnostics = transportDiagnostics;
  transportDiagnostics.record({ event: "endpoint_resolved", detail: endpointDetail });

  /**
   * Mint a fresh, single-use bridge ticket for a REMOTE endpoint.
   *
   * Returns undefined for a local endpoint (nothing to mint) and THROWS when a
   * remote endpoint cannot be authorised, so ConnectionManager retries on its
   * backoff rather than dialling a credential-less upgrade the gateway will
   * refuse. The reason is logged once per attempt: "refused" here means the
   * bearer is missing, unpaired or revoked, which is an operator problem and
   * must not be reported as an unreachable dashboard.
   */
  async function prepareRemoteUpgrade(endpoint: string): Promise<{ url?: string } | undefined> {
    if (!isRemoteEndpoint(endpoint)) return undefined;
    const httpBase = httpBaseUrlFor(endpoint);
    if (!httpBase) return undefined;
    const minted = await mintBridgeTicket({ httpBase, token: readDeviceToken() });
    if (!minted.ok) {
      console.error(`[dashboard] bridge ticket ${minted.cause}: ${minted.reason}`);
      throw new Error(minted.reason);
    }
    return { url: withTicket(endpoint, minted.ticket) };
  }

  // Long-lived ctx wrapper for the Extension UI System (Phase 1) — see
  // change: add-extension-ui-modal. `getSessionId` reads the closed-over
  // `sessionId` so the helper always uses the current value (which is
  // mutated when `event.reason ∈ {"new","fork","resume"}` fires).
  const uiModulesBridgeCtx: UiModulesBridgeCtx = {
    pi: pi as any,
    connection: { send: (msg: unknown) => inst.connection.send(msg) },
    getSessionId: () => inst.sessionId,
  };
  inst.uiModulesBridgeCtx = uiModulesBridgeCtx;

  // `let`, not `const`: a completed move REBINDS this to the target's
  // connection, and every closure in this module captured the BINDING rather
  // than the value, so all ~100 `connection.send(...)` sites follow the session
  // to its new dashboard without being rewritten (task 9.4).
  // biome-ignore lint/style/useConst: reassigned by the move command below.
  // Private plugin request/reply lane (bridge half). The global symbol is
  // installed only while the socket is open; a close fails pending calls
  // `disconnected`. See change: expose-plugin-credential-and-oauth-seams (D7).
  // Non-buffering send: a request must never be replayed after a reconnect.
  const pluginRequests = createPluginRequestClient({ send: (m) => inst.connection.sendIfOpen(m) });
  inst.pluginRequests = pluginRequests;
  let uninstallPluginRequest: (() => void) | null = null;
  const pluginLaneUp = (): void => {
    uninstallPluginRequest?.();
    uninstallPluginRequest = installPluginRequest(pluginRequests.request);
  };
  const pluginLaneDown = (): void => {
    uninstallPluginRequest?.();
    uninstallPluginRequest = null;
    pluginRequests.failAll("disconnected");
  };

  // Agent path gate: asks the operator before read/write/edit leave the session's
  // roots. Created before the connection so the close handler can reset it.
  // See change: ask-agent-file-access-in-chat.
  const pathGate = createPathGate({
    suppression: (getBridgeState().pathGateSuppression ??= new Suppression()),
    getSessionId: () => inst.sessionId,
    getPromptBus: () => inst.promptBus,
    send: (m) => inst.connection.sendIfOpen(m),
    readConfig: () => loadConfig().agentPathGate,
    getCwd: () => inst.cachedCwd ?? process.cwd(),
    getSessionDir: () => {
      try {
        return inst.cachedCtx?.sessionManager?.getSessionDir?.();
      } catch {
        return undefined;
      }
    },
    log: (line) => console.log(line),
    notify: (message) => {
      try {
        inst.cachedCtx?.ui?.notify?.(message, "warning");
      } catch {
        /* best effort */
      }
    },
  });
  inst.pathGate = pathGate;

  inst.connection = new ConnectionManager({
    url: inst.dashboardUrl,
    // fix-bridge-mdns-migration-hijack (D5): every migration decision —
    // accepted or refused, including a reversibility fallback — is reported
    // through this single chokepoint. `console.log` serves capture-enabled
    // runs; `bridge_diagnostic` serves the default, where pi's stdout is
    // discarded and server.log is the only durable record. A re-target
    // cannot occur without a corresponding record.
    onMigrationEvent: (r) => {
      const detail = `${r.from} -> ${r.to} (${r.trigger}): ${r.accepted ? "accepted" : "refused"} — ${r.reason}`;
      console.log(`[dashboard] bridge migration ${detail}`);
      transportDiagnostics.record({
        event: r.accepted ? "retarget_accepted" : "retarget_refused",
        detail,
      });
    },
    // D6 (task 5.3): a LOOPBACK TCP dial carries a PROOF of possession of this
    // HOME's local token (never the token), bound to the address actually
    // reached — the credential that replaces the socket's file mode where there
    // is no socket (Windows, or a sun_path fallback). Planned per dial, so each
    // attempt has a fresh nonce; nothing is planned over a socket or for a
    // remote endpoint. A bridge MARKED by its spawner also verifies the server
    // counter-proof before `open`. See change: loopback-credential-proof (D6, D7).
    planDial: (base) => localCredentialPlan(base),
    onIdentityFailure: (report) => {
      console.error(`[dashboard] server identity check failed (${report.cause}) at ${report.endpoint}`);
      appendIdentityLog(report);
    },
    // Every accepted re-target (and every reversal) re-derives these from the
    // endpoint actually being dialled — a loopback proof must never ride a
    // dial to a discovered remote host, and a remote candidate needs its own
    // bridge ticket. (CodeRabbit review, fix-bridge-mdns-migration-hijack.)
    credentialsFor: (u) => ({
      planDial: (base) => localCredentialPlan(base),
      prepare: () => prepareRemoteUpgrade(u),
    }),
    // A REMOTE endpoint needs a bridge ticket per attempt (§6 made TCP bridge
    // auth mandatory). Local dials — unix socket or loopback — are authorised
    // by file mode or the local token and mint nothing.
    // See change: add-pi-gateway-transport-identity (D10b).
    prepareConnect: () => prepareRemoteUpgrade(inst.dashboardUrl),
    // Attribute every force-close. `record` flushes through the live socket
    // when one is still OPEN (the callback runs BEFORE teardown) and falls
    // back to the buffer otherwise, so the report survives either way.
    onWatchdogFire: (w) => {
      const detail = formatWatchdogFire(w);
      console.log(`[dashboard] watchdog force-close ${detail}`);
      transportDiagnostics.record({ event: "watchdog_force_close", detail });
    },
    // Routing field for a drop report — the reporting bridge's OWN session,
    // never the id the dropped message named.
    // See change: fix-spawn-correlation-ttl-coupling (D6).
    getSessionId: () => inst.sessionId,
    // Lane lifecycle follows the CURRENT connection only: after a
    // `/dashboard-connect` move, `connection` is rebound to the target.
    onOpen: () => {
      if (!isActive() || inst.connection !== primaryConnection) return;
      pluginLaneUp();
      // `onReconnect` skips the FIRST open, so plugin latest/stream messages
      // retained before it would wait for the next emission. Drain after the
      // manager flushes its buffered register frame (microtask).
      // See change: add-plugin-bridge-contributions.
      queueMicrotask(() => {
        if (!isActive() || inst.connection !== primaryConnection) return;
        try {
          pluginForwardRegistry.flush();
        } catch {
          /* registry not yet initialised (declared later in initBridge) */
        }
      });
    },
    onClose: () => {
      if (inst.connection !== primaryConnection) return;
      pluginLaneDown();
      pathGate.reset();
    },
    onMessage: safe(async (data: unknown) => {
    return handleInboundMessage(inst, data);
  }),
    onReconnect: safe(() => {
      if (!isActive()) return; // Stale listener guard
      // A reconnect is a TRANSPORT boundary, not a session boundary: the live
      // content is still valid (dropping it would lose the tail of an in-flight
      // turn) but must never land after the replay below. Flush it first.
      // See change: coalesce-bridge-message-update-snapshots (D8).
      coalescer.flush();
      // Reset caches that aren't persisted server-side so the upcoming
      // 30s tick (and the inline calls below) re-emit the live state.
      const _bc = syncBc();
      _resetReconnectCaches(_bc);
      applyBc(_bc);
      sendStateSync();
      // The server does not persist `piVersion` / `piBelowFloor`; re-send now
      // rather than on the next poll tick. See change: update-pi-core-1-0-adopt-apis.
      sendPiVersionIfChanged();
      // Force-emit git state for the active session’s cwd. The bridge
      // doesn't have direct ctx here, so we walk the active session.
      try {
        const activeId = (pi as any).getCurrentSessionId?.();
        const activeCtx = activeId ? (pi as any).getCtx?.(activeId) : (inst.cachedCtx as any);
        if (activeCtx?.cwd) {
          // First evaluation again: the server lost its git state with the connection.
          const gbc = syncBc();
          polling.gitTracker?.evaluateFirst(gbc, activeCtx.cwd);
          applyBc(gbc);
          sendCwdMissingIfChanged(activeCtx.cwd);
        }
      } catch { /* probe failure non-fatal */ }
      replaySessionEntries();
      // Flush subagent frames buffered while the socket was down (D1). Unlike
      // session_start, a transient WS reconnect keeps `sessionReady` true, so
      // the intercept routes those frames into the per-agent buffer; drain them
      // now that the transport is open again. See change:
      // fix-subagent-live-detail-reliability.
      flushPendingSubagentFrames();
      // Re-send pending PromptBus requests so dashboard dialogs survive browser refresh.
      // Synchronous within this tick to prevent TUI respond() from interleaving.
      // Client-side dedup by requestId prevents double-rendering. Shared with the
      // prompt_resync_request handler so the two frames cannot drift (D7).
      // See change: fix-pending-prompt-lost-on-replay.
      if (inst.promptBus) {
        emitPendingPrompts(inst.promptBus, (m) => inst.connection.send(m as any), inst.sessionId);
      }
      inst.connection.send({ type: "replay_complete", sessionId: inst.sessionId });
      // If agent is mid-turn, send synthetic agent_start so server sets status to "streaming"
      if (getBridgeState().isAgentStreaming) {
        inst.connection.send(mapEventToProtocol(inst.sessionId, { type: "agent_start" }));
      }
      // Extension UI System (Phase 1): re-probe modules after every
      // reconnect so the server-side cache stays accurate. The probe is
      // synchronous and re-runs the listener stack each call.
      // See change: add-extension-ui-modal.
      refreshUiModules(uiModulesBridgeCtx);
    }),
    // The idle half of the reconnect heal. The `agent_start` above re-asserts
    // `streaming` when mid-turn; without this branch a `streaming` latched by
    // an `agent_end` lost in the drop is never corrected.
    //
    // Spelled as a heartbeat, NOT a synthetic `agent_end`: that event carries
    // run-boundary side effects (unread stamping, card reordering, OpenSpec
    // proposal clearing) a correction must not fire (design D3).
    //
    // Sent from the POST-FLUSH hook so a real buffered `agent_end` is still
    // processed first and still stamps unread (design D8).
    //
    // See change: fix-stuck-streaming-status-latch.
    onPostFlush: safe(() => {
      if (!isActive()) return; // Stale listener guard
      if (getBridgeState().isAgentStreaming) return;
      inst.connection.send({ type: "session_heartbeat", sessionId: inst.sessionId, agentRunning: false });
    }),
  });
  // The lane's lifecycle hooks compare against this to ignore a moved-away origin.
  const primaryConnection = inst.connection;

  // Track connection so future bridge incarnations can disconnect it
  getBridgeState().connections!.push(inst.connection);

  // See change: fix-terminal-session-dashboard-reload.
  const terminalReload = createTerminalReload({ pi, getSessionId: () => inst.sessionId });

  const commandHandler = createCommandHandler(pi, () => inst.sessionId, {
    getModelRegistry: () => inst.cachedModelRegistry,
    // Selector-open re-sync of providers.json: heals a missed credentials_updated.
    // See change: refresh-models-on-provider-change (D1).
    reloadProviders: async () => { await reloadProviders(pi); },
    // Surface a session-id-mismatch drop server-side; the guard's own
    // `console.error` goes to /dev/null under the default
    // `keeperLog.capturePiOutput:false`.
    // See change: fix-spawn-correlation-ttl-coupling (D6).
    reportInboundDrop: (drop) => inst.connection.reportInboundDrop(drop),
    // AI-draft fork-subagent wiring (see change:
    // add-session-uncommitted-indicator-and-commit). Both degrade silently
    // to the draft ladder's lower rungs when unavailable.
    getSessionContextText: () => buildSessionContextText(inst.cachedCtx),
    runDraftAgent: (seed: string, cwd: string) =>
      runForkSubagentDraft(seed, cwd, () => inst.cachedCtx?.model),
    // Mirror server attach/detach pushes into BridgeContext.attachedChange so
    // the before_agent_start injector exposes it. See change:
    // inject-session-context-into-agent.
    // Dashboard system renames reach the namer BEFORE pi echoes them, so the
    // echo is not latched `user`. See change: investigate-auto-name-provenance-relabel (D3).
    onSystemRename: (name: string) => {
      const prevName = inst.lastSessionName;
      const rollbackNamer = getAutoNamer().noteSystemRename(name);
      inst.lastSessionName = name; // suppress the redundant plain name poll
      return () => {
        rollbackNamer();
        inst.lastSessionName = prevName;
      };
    },
    onUserRename: () => {
      // Only matters once a namer exists; never create one for a user rename.
      inst.autoNamer?.noteUserRename();
    },
    onAttachProposalChanged: (next: string | null) => {
      inst.attachedChange = next;
      const s = getBridgeState();
      s.attachedChange = next;
    },
    setThinkingLevel: (level: string) => (pi as any).setThinkingLevel?.(level),
    getThinkingLevel: () => (pi as any).getThinkingLevel?.(),
    setModel: async (provider: string, modelId: string) => {
      const registry = inst.cachedModelRegistry;
      if (!registry) return;
      const model = registry.find(provider, modelId);
      if (!model) return;
      try {
        await (pi as any).setModel(model);
      } catch {
        return;
      }
      // model_select event updates cachedCtx; small delay lets it propagate
      setTimeout(() => sendModelUpdateIfChanged(), 50);
    },
    shutdown: () => {
      // Pi does not expose clear*Queue to extensions (verified through 0.76.0).
      // Shadows are NOT reset here — pi's real queues persist until the process
      // exits via the safety-net timeout below, and the shadows must mirror
      // that. See change: honest-mid-turn-queue-surface (spec
      // mid-turn-prompt-queue: "Session shutdown invokes cachedCtx.shutdown
      // directly").
      if (inst.cachedCtx?.shutdown) {
        inst.cachedCtx.shutdown();
      }
      // Safety net: force exit after a short delay in case ctx.shutdown()
      // doesn't terminate (e.g. in RPC mode headless sessions)
      setTimeout(() => process.exit(0), 500);
    },
    abort: () => {
      // Pi.abort() cancels the turn; queues persist by design (pi ExtensionAPI
      // exposes no clear primitive). Shadows mirror pi's reality and stay
      // populated. See change: honest-mid-turn-queue-surface (spec
      // mid-turn-prompt-queue: "User abort invokes cachedCtx.abort directly").
      // Latch the abort BEFORE invoking cachedCtx.abort() so a long provider
      // backoff (5–60 s) that outlives the 2 s persistent-abort scheduler still
      // stops pi when it wakes to retry. Ordering matters: if abort() fires
      // agent_end synchronously, the agent_end handler's abortLatch.clear()
      // must win — requesting AFTER abort() would leak a set latch onto a later
      // turn. Cleared on the next user prompt (noteUserPrompt) or terminal
      // agent_end. See change: unify-error-retry-lifecycle.
      abortLatch.request(inst.sessionId);
      // Install retry cancellation BEFORE invoking pi: abort() can dispatch
      // terminal events synchronously, and those belong to the cancelled chain.
      retryTracker.noteAbort(inst.sessionId);
      if (inst.cachedCtx?.abort) {
        inst.cachedCtx.abort();
      }
    },
    /**
     * Raw cachedCtx.abort() only. Used by the persistent-abort scheduler
     * after the initial wrapper-abort has run, so repeated 200ms ticks
     * don't re-run the wrapper's queue clears / shadow resets and clobber
     * user prompts sent within the window.
     * See change: unify-status-banner-and-terminal-limit-stop.
     */
    rawAbort: () => {
      try {
        inst.cachedCtx?.abort?.();
      } catch (err) {
        console.warn("[dashboard] cachedCtx.abort threw in rawAbort:", err);
      }
    },
    isIdle: () => {
      try { return inst.cachedCtx?.isIdle?.() ?? false; } catch { return false; }
    },
    eventSink: (msg) => inst.connection.send(msg),
    compact: (opts) => {
      if (inst.cachedCtx?.compact) {
        inst.cachedCtx.compact(opts);
      }
    },
    // Terminal-hosted path only. Dashboard-spawned headless sessions are
    // reloaded by the SERVER via kill-and-respawn (`dispatchReload`).
    // Self-dispatches `/__dashboard_reload <token>` in-process (no pi version gate);
    // resolves `handedOff` on success, because the RELOADED instance reports
    // `completed` after re-registering. See `terminal-reload.ts`.
    // See change: fix-terminal-session-dashboard-reload (D1/D3/D4).
    reload: terminalReload.reload,
    spawnNew: () => {
      inst.connection.send({ type: "spawn_new_session", sessionId: inst.sessionId, cwd: process.cwd() });
    },
    sessionPrompt: async (text, delivery, promptId) => {
      // Route slash commands: management events, flow:run, extension dispatch, then fallback.
      // See change: fix-extension-slash-commands-in-dashboard.
      if (text.startsWith("/") && pi.events) {
        const cmdText = text.slice(1);
        const spaceIdx = cmdText.indexOf(" ");
        const cmdName = spaceIdx === -1 ? cmdText : cmdText.slice(0, spaceIdx);
        const cmdArgs = spaceIdx === -1 ? "" : cmdText.slice(spaceIdx + 1);

        // Flow fast-path: typed /<user-defined-flow-name> wins over extension dispatch.
        const flowsList = getFlowsList();
        if (flowsList.some(f => f.name === cmdName)) {
          // Non-turn slash route: settle any optimistic idle bubble so it does
          // not hang to the 30s timeout. See change: optimistic-prompt-progress.
          inst.connection.send({ type: "prompt_received", sessionId: inst.sessionId, fresh: false });
          pi.events.emit("flow:run", { flowName: cmdName, task: cmdArgs.trim() || undefined });
          return;
        }
      }

      // Extension-command dispatch (routing step 9). When matched, the helper
      // emits its own command_feedback events and we MUST NOT fall through.
      // One in-process `sendUserMessage({expandPromptTemplates:true})` works in
      // every session shape; the old headless-only RPC path is retired.
      // See change: retire-slash-dispatch-via-expand-prompt-templates.
      const handled = await tryDispatchExtensionCommand(
        pi,
        text,
        inst.sessionId,
        (msg) => inst.connection.send(msg),
        delivery,
      );
      if (handled) {
        // Non-turn dispatch route: settle optimistic idle bubble (no message_start
        // follows). See change: optimistic-prompt-progress.
        inst.connection.send({ type: "prompt_received", sessionId: inst.sessionId, fresh: false });
        return;
      }

      // Exec-mode slash template (executable: bash): run the body as bash and
      // skip the LLM entirely. Runs AFTER extension dispatch, BEFORE template
      // expansion + sendUserMessage. See change: add-dashboard-slash-commands.
      const ranExec = await tryExecSlashTemplate(
        pi,
        text,
        process.cwd(),
        inst.sessionId,
        (msg) => inst.connection.send(msg),
      );
      if (ranExec) {
        // Non-turn exec-template route: settle optimistic idle bubble.
        // See change: optimistic-prompt-progress.
        inst.connection.send({ type: "prompt_received", sessionId: inst.sessionId, fresh: false });
        return;
      }

      // Fallback: route the user prompt based on delivery + streaming state.
      //
      //   delivery="followUp" + streaming → buffer in bridgeFollowUp ONLY
      //                                      (pi never sees it until drain).
      //   delivery="steer"    + streaming → pi.sendUserMessage({deliverAs:"steer"})
      //                                      + shadow append via recordSteerSent.
      //   any delivery        + idle      → pi.sendUserMessage no deliverAs
      //                                      (fresh turn). No buffer push.
      //
      // Capture pre-send streaming state BEFORE any pi call — idle sends
      // synchronously fire agent_start which flips isAgentStreaming.
      //
      // See change: rework-mid-turn-prompt-queue (design.md D1).
      const deliverAs = delivery ?? ("followUp" as const);
      const wasStreaming = getBridgeState().isAgentStreaming;
      // Per-send ack carrying the capture-before-send streaming verdict (slash /
      // flow / template path). Mirrors the passthrough emit in command-handler.
      // fresh:true → optimistic bubble "sent"; fresh:false → drop (raced mid-turn).
      // See change: optimistic-prompt-progress.
      // `promptId` (when the server minted one) rides ONLY when this send
      // actually hands the prompt to pi: a follow-up racing a streaming turn is
      // buffered, and the non-turn routes above returned already.
      // See change: optimistic-prompt-progress,
      //             fix-spawn-correlation-ttl-coupling (D7).
      const buffered = wasStreaming && deliverAs === "followUp";
      inst.connection.send({
        type: "prompt_received",
        sessionId: inst.sessionId,
        fresh: !wasStreaming,
        ...(promptId && !buffered ? { promptId } : {}),
      });
      const expanded = expandPromptTemplateFromDisk(text, process.cwd(), pi);
      if (buffered) {
        // Bridge-owned buffer path — do NOT call pi.sendUserMessage. The
        // drain loop on agent_end will ship the entry as a fresh turn.
        bufferFollowupSend(expanded);
      } else {
        // Idle send or steer send — forward to pi directly.
        (pi.sendUserMessage as any)(expanded, { deliverAs });
        if (wasStreaming && deliverAs === "steer") recordSteerSent(expanded);
      }
    },
    onSteerSent: recordSteerSent,
    onFollowupSent: bufferFollowupSend,
    isStreaming: () => getBridgeState().isAgentStreaming === true,
    // Clear only the abort latch before prompt routing. A streaming follow-up
    // may be buffered rather than start a run, so retry cancellation is released
    // only by the observed user message_start below.
    noteUserPrompt: () => abortLatch.clear(inst.sessionId),
    // Disarm a still-armed provider-retry chain so a manual retry's native
    // agent_start is not converted into a synthetic auto_retry_start.
    // See change: replace-dashboard-retry-command-with-protocol-message.
    disarmRetryChain: () => retryTracker.noteExplicitRun(inst.sessionId),
  });
  inst.commandHandler = commandHandler;

  // Reload support: only a command handler's ctx has `reload()`. The bridge
  // self-dispatches this command (dashboard reload, token arg); a human may
  // also type it in the TUI (no args, no dashboard feedback). Nothing callable
  // is cached — every dispatch gets a fresh command ctx.
  // See change: fix-terminal-session-dashboard-reload (D1/D3).
  pi.registerCommand(RELOAD_COMMAND_NAME, {
    handler: (args: string, ctx: any) => terminalReload.handleReloadCommand(args, ctx),
  });

  /**
   * `/dashboard-connect <target>` — move this live session to another dashboard
   * (D11, task 9.4).
   *
   * The overlap is the point: the target proves it can serve BEFORE the origin
   * is released, so a failed move is a no-op rather than an outage. On success
   * the module-level `connection` binding is rebound, which is what carries
   * every existing send site over to the new dashboard.
   */
  pi.registerCommand("dashboard-connect", {
    handler: async (args: string) => {
      const { parseConnectTarget, describeConnectTarget, resolveConnectTarget } = await import(
        "./connect-target.js"
      );
      const { listLocalInstances } = await import(
        "@blackbelt-technology/pi-dashboard-shared/instance-directory.js"
      );
      const { createMoveCoordinator } = await import("./session-move.js");
      const { rendezvousEndpoint } = await import(
        "@blackbelt-technology/pi-dashboard-shared/rendezvous.js"
      );

      const parsed = parseConnectTarget(args ?? "");
      const resolved = resolveConnectTarget(parsed, {
        defaultEndpoint: () => rendezvousEndpoint()?.endpoint ?? null,
        instances: () => listLocalInstances(),
      });
      if (!resolved.ok) {
        console.error(`[dashboard] connect refused: ${resolved.reason}`);
        return;
      }
      if (resolved.endpoint === inst.dashboardUrl) {
        console.error(`[dashboard] already on ${describeConnectTarget(parsed)}`);
        return;
      }

      // The target's identity must be known BEFORE the move: the coordinator
      // refuses a target whose instance id is not the expected one, and
      // "whatever answers" is not an expectation (D14).
      const expectInstanceId =
        resolved.instanceId ??
        listLocalInstances().find((i) => i.endpoint === resolved.endpoint)?.instanceId;
      if (!expectInstanceId) {
        console.error(
          `[dashboard] connect refused: cannot determine the instance id of ${describeConnectTarget(parsed)} — refusing to move to an unverified dashboard`,
        );
        return;
      }

      let targetManager: ConnectionManager | undefined;
      const coordinator = createMoveCoordinator({
        origin: {
          connect: () => inst.connection.connect(),
          disconnect: () => inst.connection.disconnect(),
          send: (m) => inst.connection.send(m),
          get isConnected() {
            return inst.connection.isConnected;
          },
          // The coordinator never subscribes to the origin; only the target
          // answers the handshake.
          onMessage: () => {},
        },
        sessionId: inst.sessionId,
        sessionFile: inst.lastSessionFile,
        originEndpoint: inst.dashboardUrl,
        onServerMessage: (m) => void pathGate.onServerMessage(m),
        connect: (url) => {
          let handler: (msg: unknown) => void = () => {};
          targetManager = new ConnectionManager({
            url,
            planDial: (base) => localCredentialPlan(base),
            onIdentityFailure: (report) => appendIdentityLog(report),
            getSessionId: () => inst.sessionId,
            onMessage: (data) => {
              // Plugin lane replies resolve the caller's Promise only.
              if ((data as { type?: unknown } | null)?.type === "plugin_reply") {
                pluginRequests.handleReply(data as { requestId?: unknown });
                return;
              }
              handler(data);
            },
            onClose: () => {
              if (inst.connection === targetManager) pluginLaneDown();
            },
            // The move REBINDS `connection` to this manager, so without this
            // every post-move force-close would be silent again.
            onWatchdogFire: (w) => {
              const detail = formatWatchdogFire(w);
              console.log(`[dashboard] watchdog force-close (move target) ${detail}`);
              transportDiagnostics.record({ event: "watchdog_force_close", detail });
            },
            // On the FIRST open, not just reconnects: this is where the
            // provisional registration is announced, and a send before the
            // socket is live would be silently dropped.
            onOpen: () => {
              if (inst.connection === targetManager) pluginLaneUp();
              targetManager?.send({
                type: "session_register",
                extensionIdentity: bridgeExtensionIdentity(),
                sessionId: inst.sessionId,
                cwd: process.cwd(),
                source: "tui",
                pid: process.pid,
                provisional: true,
              });
            },
          });
          const mgr = targetManager;
          return {
            connect: () => mgr.connect(),
            disconnect: () => mgr.disconnect(),
            send: (m) => mgr.send(m),
            get isConnected() {
              return mgr.isConnected;
            },
            onMessage: (h) => {
              handler = h;
            },
          };
        },
      });

      const result = await coordinator.begin({
        targetUrl: resolved.endpoint,
        expectInstanceId,
        initiator: "/dashboard-connect",
      });

      if (!result.ok) {
        console.error(
          `[dashboard] move to ${describeConnectTarget(parsed)} failed: ${result.cause} — still on ${inst.dashboardUrl}`,
        );
        return;
      }

      // Rebind: from here every `connection.send(...)` in this module reaches
      // the new dashboard.
      if (targetManager) inst.connection = targetManager;
      // The origin's close already took the plugin lane down; bring it up on
      // the target now that it is the current connection.
      if (inst.connection.isConnected) pluginLaneUp();
      inst.dashboardUrl = resolved.endpoint;
      inst.registeredInstanceId = expectInstanceId;
      console.error(`[dashboard] moved to ${describeConnectTarget(parsed)} (${expectInstanceId})`);
    },
  });

  // `/dashboard-list` — every dashboard instance visible under this HOME
  // (task 9.6). This is the DISPLAY-only side of the D2 carve-out: it scans so
  // a human can choose, and never feeds automatic endpoint selection.
  pi.registerCommand("dashboard-list", {
    handler: async () => {
      const { listLocalInstances, formatInstanceLine } = await import(
        "@blackbelt-technology/pi-dashboard-shared/instance-directory.js"
      );
      const found = listLocalInstances();
      if (found.length === 0) {
        console.error("[dashboard] no dashboard instances found under this HOME");
        return;
      }
      console.error(
        `[dashboard] instances (* = default for this HOME):\n${found.map(formatInstanceLine).join("\n")}`,
      );
    },
  });

  // `/dashboard-where` — endpoint + identity + pinned, for the session that
  // cannot otherwise answer "which dashboard am I actually on?" (task 9.6).
  // Written with console.error because pi's stdout is discarded under the
  // default `capturePiOutput:false`.
  pi.registerCommand("dashboard-where", {
    handler: async () => {
      const lines = [
        `endpoint: ${inst.dashboardUrl}`,
        `instance: ${inst.registeredInstanceId ?? "unverified"}`,
        `pinned:   ${endpointPinned ? "yes (explicit configuration)" : "no (resolved from the $HOME rendezvous record)"}`,
        `pr-probe: ${prStatus.invocations()} gh invocation(s) this bridge`,
      ];
      console.error(`[dashboard] where:\n${lines.join("\n")}`);
    },
  });

  /** Sync local variables into BridgeContext for extracted module calls */
  function syncBc(): BridgeContext {
    return {
      pi, connection: inst.connection, sessionId: inst.sessionId, attachedChange: inst.attachedChange,
      cachedCtx: inst.cachedCtx, cachedModelRegistry: inst.cachedModelRegistry, cachedHasUI: inst.cachedHasUI,
      lastModel: inst.lastModel, lastThinkingLevel: inst.lastThinkingLevel,
      lastSessionFile: inst.lastSessionFile, lastSessionDir: inst.lastSessionDir, lastFirstMessage: inst.lastFirstMessage,
      lastGitBranch, lastGitPrJson, lastSessionName: inst.lastSessionName,
      lastGitWorktreeJson,
      lastGitStatusJson,
      lastCwdMissing,
      hasRegisteredOnce,
      dashboardSpawned,
      selfSpawnedPgids,
      prStatus,
      gitTracker: polling.gitTracker ?? undefined,
    };
  }
  inst.syncBc = syncBc;
  /** Sync BridgeContext mutations back to local variables */
  function applyBc(bc: BridgeContext): void {
    inst.sessionId = bc.sessionId;
    inst.attachedChange = bc.attachedChange;
    inst.cachedCtx = bc.cachedCtx;
    inst.cachedModelRegistry = bc.cachedModelRegistry;
    inst.cachedHasUI = bc.cachedHasUI;
    inst.lastModel = bc.lastModel;
    inst.lastThinkingLevel = bc.lastThinkingLevel;
    inst.lastSessionFile = bc.lastSessionFile;
    inst.lastSessionDir = bc.lastSessionDir;
    inst.lastFirstMessage = bc.lastFirstMessage;
    lastGitBranch = bc.lastGitBranch;
    lastGitPrJson = bc.lastGitPrJson;
    inst.lastSessionName = bc.lastSessionName;
    lastGitWorktreeJson = bc.lastGitWorktreeJson;
    lastGitStatusJson = bc.lastGitStatusJson;
    lastCwdMissing = bc.lastCwdMissing;
    hasRegisteredOnce = bc.hasRegisteredOnce;
  }
  inst.applyBc = applyBc;

  // Local wrappers that sync bc around extracted module calls
  function sendStateSync() { const bc = syncBc(); _sendStateSync(bc, getFlowsList); applyBc(bc); inst.connection.noteRegistered(); }
  function replaySessionEntries() { _replaySessionEntries(syncBc()); }
  inst.replaySessionEntries = replaySessionEntries;
  function sendModelUpdateIfChanged() { const bc = syncBc(); _sendModelUpdateIfChanged(bc); applyBc(bc); }
  inst.sendModelUpdateIfChanged = sendModelUpdateIfChanged;
  function sendSessionNameIfChanged() { const bc = syncBc(); _sendSessionNameIfChanged(bc); applyBc(bc); }
  inst.sendSessionNameIfChanged = sendSessionNameIfChanged;

  // ── add-auto-session-naming ──────────────────────────────────────────────
  // Stream through pi's OWN `ctx.modelRegistry`, not a bare-imported pi-ai
  // module (design D6). `ModelRuntime.streamSimple` already performs the full
  // normalize → prepare → `provider.streamSimple` sequence with credentials pi
  // has already resolved, so this is shorter than adapting a module AND it
  // removes a compat surface instead of adding one.
  //
  // pi >= 0.85 exports no global `streamSimple` at all, so the old bare import
  // silently yielded `undefined` and auto-naming never ran. The module import
  // is kept only as a fallback for a pi older than `piCompatibility.minimum`.
  // NOT cached across calls when it resolves from the registry: the registry
  // is captured lazily, so caching a miss would pin auto-naming off for the
  // whole session. See change: adopt-piai-factory-api-registry.
  async function loadStreamSimple(): Promise<StreamSimpleFn | undefined> {
    const registry: any = inst.cachedModelRegistry;
    if (typeof registry?.streamSimple === "function") {
      return registry.streamSimple.bind(registry) as StreamSimpleFn;
    }
    if (piAiStreamSimple !== undefined) return piAiStreamSimple ?? undefined;
    try {
      const mod: any = await import("@earendil-works/pi-ai");
      piAiStreamSimple = (mod.streamSimple as StreamSimpleFn) ?? null;
    } catch {
      piAiStreamSimple = null;
    }
    return piAiStreamSimple ?? undefined;
  }

  // One namer per bridge (a bridge is a single pi session). Built lazily so it
  // captures the live `cachedCtx` / `cachedModelRegistry` at call time.
  function getAutoNamer(): AutoNamer {
    if (inst.autoNamer) return inst.autoNamer;
    inst.autoNamer = createAutoNamer({
      getAutoNameSessions: () => inst.autoNameSessions,
      resolveNamingModel,
      getRegistry: () => inst.cachedModelRegistry,
      loadStreamSimple,
      getTranscript: () => extractLatestTurnWindow(inst.cachedCtx),
      applyName: (title: string) => {
        try { pi.setSessionName(title); } catch { /* ignore */ }
        inst.lastSessionName = title; // suppress the redundant plain name_update poll
        inst.connection.send({ type: "session_name_update", sessionId: inst.sessionId, name: title, nameSource: "auto" });
      },
      reportUserRename: (name: string) => {
        inst.connection.send({ type: "session_name_update", sessionId: inst.sessionId, name, nameSource: "user" });
      },
      emitError: (reason: string) => {
        inst.connection.send({ type: "auto_name_error", sessionId: inst.sessionId, reason });
      },
      reportOutcome: ({ outcome, reason, modelRef }) => {
        inst.connection.send({
          type: "auto_name_outcome", sessionId: inst.sessionId, outcome, reason, modelRef, at: Date.now(),
        });
      },
      // Carried across reload AND persisted server-side into the session's
      // `.meta.json`, so "permanent" survives a process restart rather than
      // re-spending a full budget on every cold start (design D7).
      persistState: (state: PersistedNamerState) => {
        inst.namerState = state;
        prev.namerState = state;
        inst.connection.send({ type: "auto_name_state", sessionId: inst.sessionId, state });
      },
    }, inst.namerState);
    return inst.autoNamer;
  }
  inst.getAutoNamer = getAutoNamer;

  // Run one naming attempt after a terminal turn. Observing the current name
  // first catches a pre-existing / in-pi rename (external → permanent "user"
  // lockout) before attempting to auto-name.
  //
  // The toggle gates the OBSERVATION but not the attempt: `maybeName` checks it
  // internally so the `disabled` outcome is reportable at all (design D9),
  // while `onObservedName` stays gated exactly as before this change. Letting
  // it run with the feature OFF would newly latch `nameSource: "user"` (plus a
  // persisted update) on sessions the user never asked to auto-name, inflating
  // the very population the follow-up investigation has to measure.
  // See change: fix-auto-naming-reasoning-model.
  function runAutoNameOnTurnEnd(): void {
    const namer = getAutoNamer();
    if (inst.autoNameSessions) namer.onObservedName(pi.getSessionName() ?? "");
    void namer.maybeName();
  }
  inst.runAutoNameOnTurnEnd = runAutoNameOnTurnEnd;

  function sendCwdMissingIfChanged(cwd: string) { const bc = syncBc(); _sendCwdMissingIfChanged(bc, cwd); applyBc(bc); }
  inst.sendCwdMissingIfChanged = sendCwdMissingIfChanged;
  function sendPiVersionIfChanged() { _sendPiVersionIfChanged(syncBc()); }
  inst.sendPiVersionIfChanged = sendPiVersionIfChanged;
  // Unified EventBus rename map for the emit intercept (flow + subagent events)
  const EVENT_BUS_MAP: Record<string, string> = { ...FLOW_EVENT_MAP, ...SUBAGENT_EVENT_MAP };

  registerEnrichedForwarders(inst);

  // Pass-through events: forward with no enrichment
  registerPassThroughForwarders(inst);

  // ── Subagent fan-out admission ────────────────────────────────────────────
  // Bounds concurrently in-flight `Agent` children so a wide fan-out on a loaded
  // host cannot stall the parent's event loop until the process is reaped.
  //
  // Registered AFTER the pass-through loop above ON PURPOSE: `runner.emitToolCall`
  // returns on the FIRST handler that answers a blocking result, so a gate
  // registered earlier would starve the bridge's own `tool_call` forwarder — the
  // dashboard would miss the refused call's `tool_call` while still seeing its
  // `tool_execution_end`, and live UI and transcript would disagree. See D8.
  //
  // The result carries `block` + `reason` and NEVER `terminate`: a refusal is
  // "not now" (re-issue after running children finish), not a task failure. The
  // `block` decision itself lives in `subagent-fanout-admission.ts`. See change:
  // bound-subagent-fanout-under-host-pressure (D2/D4/D5/D6/D7/D8).
  const admissionSampler = new SaturationSampler();
  const fanoutAdmission = new FanoutAdmissionGate({
    resolveConfig: () => resolveAdmissionConfig(config),
    saturation: admissionSampler,
    // Refusals are ALSO written durably: the failure this mitigates ends with the
    // process gone, so counters carried only by the live frame vanish in exactly
    // the case that matters. Admissions write nothing (hot path, no FS I/O).
    recordRefusal: (record) => {
      try {
        pi.appendEntry("subagent-admission-refused", record);
      } catch (err) {
        console.error("[dashboard] subagent-admission-refused entry failed:", err);
      }
    },
  });
  inst.fanoutAdmission = fanoutAdmission;
  pi.on("tool_call", safe((event: any) => {
    if (!isActive()) return;
    return fanoutAdmission.onToolCall(event);
  }));
  // Agent path gate — registered AFTER the fan-out admission handler (and after the
  // bridge's own forwarder) and deliberately NOT wrapped in the fail-open `safe()`:
  // its own try/catch maps any internal error to a block. Stale bridge instances
  // (after reload) pass through. See change: ask-agent-file-access-in-chat (D1).
  pi.on("tool_call", ((event: any, ctx: any) => {
    if (!isActive()) return undefined;
    return pathGate.handler(event, ctx);
  }) as any);
  pi.on("before_agent_start", safe((event: any) => {
    if (!isActive()) return;
    pathGate.onBeforeAgentStart(event);
  }));
  // Release permits on `tool_execution_end` — the ONE signal pi emits on the
  // normal, blocked AND aborted paths. NEVER `tool_result`: an aborted call
  // skips the path that produces it, so a permit released there would leak on
  // every Esc and eventually refuse all subagent work for the session. See D2.
  pi.on("tool_execution_end", safe((event: any) => {
    if (!isActive()) return;
    fanoutAdmission.onExecutionEnd(event);
  }));

  // Generic custom entries/messages (pi.appendEntry / pi.sendMessage) are NOT
  // subscribed here: pi does NOT dispatch `entry_appended` to extensions, and
  // the idle-path sendMessage emits message_start/end to internal listeners
  // only. The SINGLE chokepoint both surfaces share is the sessionManager
  // persistence methods — wrapped in `wrapCustomPersistenceForCtx` (same
  // pattern as wrapAppendMessageForCtx), installed at session_start below.
  // See change: render-inline-reasoning-and-custom-entries (D2).

  // Push external renames the moment they happen (pi 0.80.3+ session_info_changed)
  // instead of waiting for the turn-end name poll. The new name is routed
  // through the auto-namer's self-filter: the bridge's OWN auto-name echoing
  // back is classified self (no push, no lockout); a dashboard / in-pi rename
  // is classified external → one session_name_update{nameSource:"user"} +
  // permanent lockout. The turn-end poll (runAutoNameOnTurnEnd) stays as a
  // fallback for pi builds that do not emit this event. See change:
  // adopt-pi-074-080-features (A.2).
  registerSessionInfoChanged(inst);

  // Auto-decide project_trust for dashboard-spawned headless sessions (pi
  // 0.79.0+). The event fires during resource-loader reload, BEFORE
  // session_start reaches handlers, so the gate compares the event cwd to the
  // ACTIVATION cwd (captured at module scope above). Reads eventCwd from the
  // per-event ctx inside try/catch (ctx.cwd throws after session replacement).
  // Any non-match — or a throw — defers to pi's default. See change:
  // adopt-pi-074-080-features (A.3).
  registerProjectTrust(inst);

  // Per-turn system-prompt injector: splice dashboard session context
  // (sessionId, cwd, attached OpenSpec change) into the system prompt. Reads
  // live state via syncBc each turn; isActive guards against /reload stacking.
  // Coexists with the pass-through before_agent_start forwarder above (pi
  // chains { systemPrompt } results). See change: inject-session-context-into-agent.
  registerDashboardContextInjector(
    pi,
    () => ({ sessionId: inst.sessionId, attachedChange: inst.attachedChange }),
    isActive,
  );

  // Pi does NOT forward `queue_update` events to extensions (verified in
  // pi-coding-agent 0.71+ — see _emitExtensionEvent allowlist). Bridge
  // tracks the shadow queues itself; drain happens on observed boundaries:
  // turn_end drains steering (pi's mode:"all" delivers all queued steers),
  // agent_end drains follow-up (pi has no more tool calls).
  // See change: add-followup-edit-and-steer-cancel.
  // Bridge shadow steering queue: per-entry drain matcher in the
  // `message_start` handler removes each entry as pi delivers it. No bulk
  // clear here — it would wipe entries the user adds DURING the drain.
  // See change: add-followup-edit-and-steer-cancel (per-entry-drain).

  // Forward one EventBus frame as an `event_forward` message. Known channels
  // get renamed via EVENT_BUS_MAP; unknown channels use the channel name.
  function sendEventForward(channel: string, data: Record<string, unknown>): void {
    const eventType = EVENT_BUS_MAP[channel] ?? channel;
    inst.connection.send({
      type: "event_forward",
      sessionId: inst.sessionId,
      event: { eventType, timestamp: Date.now(), data },
    });
  }
  inst.sendEventForward = sendEventForward;

  // Flush subagent frames buffered while the bridge was not ready (D1). Called
  // right after `sessionReady` flips true on (re-)register, in emission order.
  // See change: fix-subagent-live-detail-reliability.
  function flushPendingSubagentFrames(): void {
    // Drained intermediate frames are stripped too: this path calls
    // `sendEventForward` directly, so a bus-path-only strip would leak every
    // buffered frame fat. See change: reduce-subagent-details-payload (X5).
    const flushed = flushBufferedSubagentFrames(subagentFrameBuffer, sendEventForward);
    // Plugin-declared latest/stream channels retained over the same gap flush
    // here too, in emission order. See change: add-plugin-bridge-contributions.
    pluginForwardRegistry.flush();
    if (flushed === 0) return;
    console.log(
      `[dashboard] flushed ${flushed} buffered subagent frame(s) on re-register` +
        ` (forwarded=${subagentFrameBuffer.stats.forwarded} buffered=${subagentFrameBuffer.stats.buffered}` +
        ` flushed=${subagentFrameBuffer.stats.flushed})`,
    );
  }
  inst.flushPendingSubagentFrames = flushPendingSubagentFrames;

  // EventBus forwarding: ONE `pi.events.on` subscription per declared channel
  // (every key of EVENT_BUS_MAP). NOT an `emit` intercept — pi hands each
  // extension its own `events` facade, so patching OUR `emit` never observed
  // pi-flows' or pi-subagents' emissions, and every live flow_*/subagent_*
  // event was silently dropped (automation runs then hung until the max-age
  // reaper). The gating + subagent-buffer semantics live in `forwardBusEvent`.
  // See change: fix-automation-run-lifecycle.
  const disposeEventBusForwarding = registerEventBusForwarding(
    pi.events,
    {
      sendEventForward,
      isSessionReady: () => inst.sessionReady,
      isActive,
      isConnected: () => inst.connection.isConnected,
      subagent: {
        isSubagentChannel: (channel) => SubagentFrameBuffer.isSubagentChannel(channel),
        markForwarded: (channel, data) => subagentFrameBuffer.markForwarded(channel, data),
        buffer: (channel, data) => subagentFrameBuffer.buffer(channel, data),
        stripForForward,
      },
    },
  );

  // Plugin-declared bus channels: plugin bridges emit
  // `dashboard:register-event-forward`; `attach()` subscribes the listener and
  // then emits `dashboard:bridge-ready` so plugins that activated first
  // re-declare. Core names no plugin channel. See change:
  // add-plugin-bridge-contributions (D1/D2/D4).
  const pluginForwardRegistry = new PluginForwardRegistry(pi.events, {
    send: (eventType, data) =>
      inst.connection.send({
        type: "event_forward",
        sessionId: inst.sessionId,
        event: { eventType, timestamp: Date.now(), data },
      }),
    isSessionReady: () => inst.sessionReady,
    isActive,
    isConnected: () => inst.connection.isConnected,
    isCoreChannel: (channel) => channel in EVENT_BUS_MAP,
  });
  inst.pluginForwardRegistry = pluginForwardRegistry;
  pluginForwardRegistry.attach();

  registerSessionStart(inst);

  // session_switch and session_fork events removed in pi 0.65.0.
  // Now handled via session_start with event.reason ("new"|"fork"|"resume").

  registerTurnEnd(inst);

  // Control event (never `event_forward`): an idle cache refresh's usage
  // entry lands before the NEXT decision, so each decision is a drain point.
  // Observe-only — returns no override and never throws (pi falls back to
  // its own decision on a handler failure, but we never give it one).
  // See change: count-non-message-usage.
  pi.on("cache_warming_decision", makeCacheWarmingDecisionHandler((ctx: any) => {
    if (!isActive()) return;
    drainUsage(ctx);
  }) as any);

  registerSessionShutdown(inst);

  // Re-send models list when custom providers finish async discovery
  onProviderChanged(() => {
    if (!isActive()) return;
    if (inst.cachedModelRegistry && inst.sessionReady) {
      try {
        const models = filterByEnabledModels(inst.cachedModelRegistry.getAvailable().map(toModelInfo));
        inst.connection.send({ type: "models_list", sessionId: inst.sessionId, models });
        // See change: replace-hardcoded-provider-lists.
        inst.connection.send({ type: "providers_list", sessionId: inst.sessionId, providers: buildProviderCatalogue() });
      } catch { /* ignore */ }

      // Retry pending default model — custom provider may now have its models
      if (inst.pendingDefaultModel) {
        inst.pendingDefaultModel = applyDefaultModel();
      }
    }
  });

  // Register cleanup for /reload — saves state to globalThis and tears down resources
  const state = getBridgeState();
  state.cleanup = () => {
    const s = getBridgeState();
    s.sessionId = inst.sessionId;
    s.attachedChange = inst.attachedChange;
    s.ctx = inst.cachedCtx;
    s.modelRegistry = inst.cachedModelRegistry;
    s.hasUI = inst.cachedHasUI;
    if (inst.heartbeatTimer) { clearInterval(inst.heartbeatTimer); inst.heartbeatTimer = null; }
    if (inst.gitPollTimer) { clearInterval(inst.gitPollTimer); inst.gitPollTimer = null; }
    drainDisposables(s);
    // Disable the admission sampler's private event-loop histogram. A bridge
    // re-init (/reload, session replacement) constructs a fresh sampler; without
    // this the superseded 20 ms-resolution monitor runs until process exit.
    admissionSampler.dispose();

    // Dev build & restart: rebuild client and stop server before reload
    if (config.devBuildOnReload) {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const packageRoot = path.resolve(__dirname, "..", "..");
      runDevBuild({ packageRoot, serverPort: config.port });
    }

    // Release our EventBus subscriptions. Nothing to "restore": the bridge no
    // longer replaces any host function. See change: fix-automation-run-lifecycle.
    disposeEventBusForwarding();
    pluginForwardRegistry.dispose();
    inst.connection.disconnect();
  };

  // Reload is handled by session_start which fires on /reload too
}
