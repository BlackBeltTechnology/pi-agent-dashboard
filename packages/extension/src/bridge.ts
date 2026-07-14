/**
 * PI Dashboard Bridge Extension
 *
 * Global extension that connects to the dashboard server,
 * forwards all pi events, and relays commands back.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureConfig, loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { discoverDashboard } from "@blackbelt-technology/pi-dashboard-shared/mdns-discovery.js";
import type { ServerToExtensionMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { isDashboardRunning } from "@blackbelt-technology/pi-dashboard-shared/server-identity.js";
import type { FlowInfo, ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Loader } from "@earendil-works/pi-tui";
import { AbortLatch } from "./abort-latch.js";
import { isUnderArtifactRoot, resolveArtifactRoots } from "./artifact-roots.js";
import {
  MAX_PER_MESSAGE_BYTES as ATTACH_MAX_PER_MESSAGE_BYTES,
  cleanupAttachmentsForSession,
  persistAttachment,
} from "./ask-user-attachments.js";
import { registerAskUserTool } from "./ask-user-tool.js";
import type { BridgeContext } from "./bridge-context.js";
import { extractFirstAssistantReply, extractFirstMessage, filterHiddenCommands, getCurrentModelString } from "./bridge-context.js";
import { shouldApplyDefaultModel } from "./bridge-default-model-gate.js";
import { createCommandHandler, tryExecSlashTemplate } from "./command-handler.js";
import { type AutoNamer, createAutoNamer, type StreamSimpleFn } from "./auto-session-namer.js";
import { buildSessionContextText, runForkSubagentDraft } from "./commit-draft-agent.js";
import { ConnectionManager } from "./connection.js";
import { registerDashboardContextInjector } from "./dashboard-context-injector.js";
import { DashboardDefaultAdapter } from "./dashboard-default-adapter.js";
import { runDevBuild } from "./dev-build.js";
import { EmptyActionableGuard, SURFACE_MESSAGE } from "./empty-actionable-guard.js";
import { resolveGuardConfig } from "./empty-actionable-guard-config.js";
import { mapEventToProtocol } from "./event-forwarder.js";
import { FLOW_EVENT_MAP, registerFlowEventListeners, SUBAGENT_EVENT_MAP } from "./flow-event-wiring.js";
import { runGitPollTick } from "./git-poll.js";
import { flipHasUI } from "./hasui-flip.js";
import { inlineMessageText, type ReadFileOutcome } from "./markdown-image-inliner.js";
import { resetReconnectCaches as _resetReconnectCaches, sendCwdMissingIfChanged as _sendCwdMissingIfChanged, sendGitInfoIfChanged as _sendGitInfoIfChanged, sendModelUpdateIfChanged as _sendModelUpdateIfChanged, sendPiVersionIfChanged as _sendPiVersionIfChanged, sendSessionNameIfChanged as _sendSessionNameIfChanged } from "./model-tracker.js";
import { decodeMultiselectAnswer } from "./multiselect-decode.js";
import { collectMetrics, startMetricsMonitor, stopMetricsMonitor } from "./process-metrics.js";
import { getOwnPgid, scanChildProcesses } from "./process-scanner.js";
import { PromptBus } from "./prompt-bus.js";
import { expandPromptTemplateFromDisk } from "./prompt-expander.js";
import { activate as activateProviderRegister, buildProviderCatalogue, onProviderChanged, reloadProviders, toModelInfo } from "./provider-register.js";
import { RetryTracker } from "./retry-tracker.js";
import { activate as activateRoleManager, lookupRole } from "./role-manager.js";
import { registerRoleModelTools } from "./role-model-tools.js";
import { autoStartServer } from "./server-auto-start.js";
import { launchServer } from "./server-launcher.js";
import { handleSessionChange as _handleSessionChange, replaySessionEntries as _replaySessionEntries, sendStateSync as _sendStateSync } from "./session-sync.js";
import { tryDispatchExtensionCommand } from "./slash-dispatch.js";
import { detectSessionSource } from "./source-detector.js";
import { SubagentFrameBuffer } from "./subagent-frame-buffer.js";
import { inlineToolResultImages } from "./tool-result-image-inliner.js";
import { classifyTurnActionability } from "./turn-actionability.js";
import { handleUiManagement, refreshUiModules, subscribeUiInvalidate, type UiModulesBridgeCtx } from "./ui-modules.js";
import { detectIsGitRepo } from "./vcs-info.js";
import { buildVisibilityRegisterFields } from "./visibility-intent.js";

const HEARTBEAT_INTERVAL = 15_000;
const GIT_POLL_INTERVAL = 30_000;
// Platform-aware process scan cadence. Windows keeps the original 10 s /
// 30 s floor because PowerShell Get-CimInstance is expensive and can flash consoles;
// Unix uses 5 s / 5 s so legitimate bash subprocesses surface while still
// running. See change: tighten-process-list-ux.
const PROCESS_SCAN_INTERVAL = process.platform === "win32" ? 10_000 : 5_000; // platform-branch-ok: top-level cadence tuning; Windows uses costly PowerShell Get-CimInstance
const PROCESS_MIN_ELAPSED_MS = process.platform === "win32" ? 30_000 : 5_000; // platform-branch-ok: matches PROCESS_SCAN_INTERVAL's Windows-safe defaults



// Use `process` (not `globalThis`) to survive jiti module cache invalidation
// AND to share state across isolated extension contexts (vm sandboxes).
const BRIDGE_KEY = "__pi_dashboard_bridge__";
interface BridgeState {
  cleanup?: () => void;
  sessionId?: string;
  ctx?: any;
  modelRegistry?: any;
  hasUI?: boolean;
  /** Monotonic generation counter — stale listeners bail out when mismatched */
  generation?: number;
  /** The pi instance that owns the bridge (used to detect subagent re-entry) */
  pi?: ExtensionAPI;
  /** All connection instances from any bridge incarnation (for cleanup) */
  connections?: ConnectionManager[];
  /** All interval timers from any bridge incarnation (for cleanup) */
  timers?: ReturnType<typeof setInterval>[];
  /** True when the agent is currently in a turn (between agent_start and agent_end) */
  isAgentStreaming?: boolean;
  /**
   * Capture-once "was this pi dashboard-spawned?" boolean. Set on first bridge
   * activation from `!!process.env.PI_DASHBOARD_SPAWN_TOKEN` BEFORE the token is
   * scrubbed; persisted here so reload/reattach keeps the value after the env
   * var is gone. See change: fix-spawn-token-env-leak.
   */
  dashboardSpawned?: boolean;
  /**
   * Dashboard-attached OpenSpec change name persisted across reload so the
   * `before_agent_start` injector keeps the fragment after `npm run reload`
   * even before the server re-replays on `session_register`. `null`/absent
   * when no change attached. See change: inject-session-context-into-agent.
   */
  attachedChange?: string | null;
  /**
   * Graceful stop-after-turn latch (pi 0.72+). Set true on a `stop_after_turn`
   * message; the next `turn_end` calls cachedCtx.shutdown() (fallback abort)
   * and clears the flag. Idempotent: repeated sets while pending are no-ops.
   * See change: adopt-pi-071-072-073-features.
   */
  shouldStopAfterTurn?: boolean;
}
function getBridgeState(): BridgeState {
  if (!(process as any)[BRIDGE_KEY]) {
    (process as any)[BRIDGE_KEY] = {};
  }
  return (process as any)[BRIDGE_KEY];
}

export default function (pi: ExtensionAPI) {
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
  if (prev.generation && prev.generation > 0 && prev.pi && prev.pi !== pi) {
    return;
  }

  prev.cleanup?.();
  prev.cleanup = undefined;

  // Disconnect ALL orphaned connections from previous bridge incarnations
  if (prev.connections) {
    for (const conn of prev.connections) {
      conn.disconnect();
    }
  }
  prev.connections = [];
  // Clear ALL orphaned timers
  if (prev.timers) {
    for (const t of prev.timers) {
      clearInterval(t);
    }
  }
  prev.timers = [];

  // Bump generation so stale listeners from previous initBridge calls bail out
  const generation = (prev.generation ?? 0) + 1;
  prev.generation = generation;
  prev.pi = pi;
  /** Return true if this bridge instance is still the active one */
  function isActive(): boolean {
    return getBridgeState().generation === generation;
  }

  let sessionId: string = prev.sessionId ?? crypto.randomUUID();
  let attachedChange: string | null = prev.attachedChange ?? null;
  let sessionReady = false; // true after session_start has run
  let lastSessionFile: string | undefined;
  let lastSessionDir: string | undefined;
  let lastFirstMessage: string | undefined;
  // ctx.cwd is a guarded getter on ExtensionRunner that throws once the session
  // is replaced (new/fork/resume/reload). Poll timers must read this cached copy
  // instead of the captured ctx, or they crash the host after a session change.
  // See change: fix-stale-ctx-cwd-crash.
  let cachedCwd: string | undefined;
  let pendingDefaultModel: string | null = null; // non-null if default model not yet applied (custom provider not ready)

  /** Try to apply the default model from config. Returns the model string if not found (pending), null if applied or no default. */
  function applyDefaultModel(): string | null {
    const freshConfig = loadConfig();
    if (!freshConfig.defaultModel || !cachedModelRegistry) return null;
    const slashIdx = freshConfig.defaultModel.indexOf("/");
    if (slashIdx <= 0) return null;
    const provider = freshConfig.defaultModel.slice(0, slashIdx);
    const modelId = freshConfig.defaultModel.slice(slashIdx + 1);
    try {
      const found = cachedModelRegistry.find(provider, modelId);
      if (found) {
        (pi as any).setModel(found).then(() => {
          setTimeout(() => sendModelUpdateIfChanged(), 50);
        }).catch(() => {});
        return null; // applied
      }
    } catch { /* ignore */ }
    return freshConfig.defaultModel; // not found yet — pending
  }

  /** Query pi-flows for available flows via synchronous event RPC */
  function getFlowsList(): FlowInfo[] {
    const probe: any = {};
    try {
      pi.events?.emit("flow:list-flows", probe);
    } catch { /* ignore */ }
    return (probe.flows as FlowInfo[] | undefined) ?? [];
  }

  /** Send flows_list message to the dashboard server */
  function sendFlowsList() {
    const flows = getFlowsList();
    console.error(`[dashboard] sendFlowsList: ${flows.length} flows, sessionId=${sessionId.slice(0,8)}`);
    connection.send({ type: "flows_list", sessionId, flows });
  }


  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let gitPollTimer: ReturnType<typeof setInterval> | null = null;
  let processScanTimer: ReturnType<typeof setInterval> | null = null;
  let previousProcessPids: string = ""; // JSON-stringified PID set for diff
  const trackedPgids = new Set<number>(); // PGIDs captured during bash tool calls
  // PIDs of subprocesses the bridge has spawned itself (dashboard server,
  // RPC keeper). Threaded into `scanChildProcesses` as `excludedPgids` so
  // bridge infrastructure never surfaces in the process list.
  // See change: tighten-process-list-ux.
  const selfSpawnedPgids = new Set<number>();
  // Seed pi's OWN process-group id so pi-self + same-group plugin/MCP
  // sidecars (context-mode bun, etc.) never enter `trackedPgids` or the
  // process list. Cached one-shot `ps` lookup; no-op on Windows.
  // See change: classify-process-list-entries.
  {
    const ownPgid = getOwnPgid();
    if (ownPgid !== undefined) selfSpawnedPgids.add(ownPgid);
  }
  let lastGitBranch: string | undefined;
  let lastGitPrNumber: number | undefined;
  let lastGitWorktreeJson: string | undefined; // see change: add-worktree-spawn-dialog
  let lastGitStatusJson: string | undefined; // see change: add-session-uncommitted-indicator-and-commit
  let lastCwdMissing: boolean | undefined; // see change: add-worktree-lifecycle-actions
  let lastSessionName: string | undefined;
  // ── add-auto-session-naming ────────────────────────────────────────────
  // Global auto-naming toggle, relayed by the server via `preferences_update`.
  // Default true so a bridge that registers before the first push still names.
  let autoNameSessions = true;
  let autoNamer: AutoNamer | undefined;
  // Lazily-loaded pi-ai streamSimple (null = load attempted and failed).
  let piAiStreamSimple: StreamSimpleFn | null | undefined;
  let cachedHasUI: boolean | undefined = prev.hasUI;
  let cachedModelRegistry: any | undefined = prev.modelRegistry;
  let cachedCtx: any | undefined = prev.ctx;
  let lastModel: string | undefined;
  let lastThinkingLevel: string | undefined;
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
  let promptBus: PromptBus | undefined;

  // Provider-retry synthesis tracker. pi's ExtensionAPI does not expose
  // `auto_retry_*` events, so the bridge synthesizes them by OBSERVING pi's
  // own retry behavior (error message_end → fresh assistant message_start →
  // auto_retry_start). See change: simplify-error-retry-single-card.
  const retryTracker = new RetryTracker();
  // Empty-actionable-turn guard: when a terminal turn is a clean-but-empty
  // `stop` (thinking-only, no text, no tool call), continue-or-surface instead
  // of idling silently. Provider-agnostic. See change:
  // fix-gemini-subagent-silent-tool-schema-failure.
  const guardConfig = resolveGuardConfig();
  const emptyActionableGuard = new EmptyActionableGuard(guardConfig.mode, guardConfig.retryCap);
  // Abort latch: keeps a user abort latched so a provider backoff that
  // outlives the 2 s persistent-abort scheduler still stops pi's retry.
  // Set on abort; cleared on a new user prompt or terminal agent_end; honored
  // on every observed resumption of the aborted turn. See change:
  // unify-error-retry-lifecycle (design D3b).
  const abortLatch = new AbortLatch();

  // Subagent live-detail reliability: retain subagent frames emitted while the
  // bridge is not ready (buffer-and-flush on re-register, D1) and keep the
  // latest snapshot of each running subagent for the resync responder (D2).
  // See change: fix-subagent-live-detail-reliability.
  const subagentFrameBuffer = new SubagentFrameBuffer();

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
  //   `drainFollowupQueue`, and the five mutation handlers (edit / remove /
  //   promote / clear / pull-to-editor).
  //
  // Both feed the same `queue_update` ExtensionToServerMessage.
  //
  // Steer is permanently pi-owned + display-only (steer drains too fast at
  // turn_end for mutation UI to matter; user direction).
  //
  // See change: rework-mid-turn-prompt-queue (spec mid-turn-prompt-queue).
  let bridgeSteering: string[] = [];
  let bridgeFollowUp: string[] = [];
  function emitQueueUpdate(): void {
    if (!isActive() || !sessionReady) return;
    connection.send({
      type: "queue_update",
      sessionId,
      steering: [...bridgeSteering],
      followUp: [...bridgeFollowUp],
    });
  }
  function recordSteerSent(text: string): void {
    // Only record when the agent was actually streaming at send time. Idle
    // sends start a new turn directly — pi doesn't queue them, so the
    // shadow queue must not show a chip. See change: add-followup-edit-and-steer-cancel.
    if (!getBridgeState().isAgentStreaming) return;
    bridgeSteering.push(text);
    emitQueueUpdate();
  }
  /** Soft cap on follow-up buffer depth. See design.md Decision 8. */
  const FOLLOWUP_QUEUE_CAP = 20;
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
   * Image attachments are NOT carried in the bridge buffer in v1 (text-only).
   * Image-bearing follow-ups buffered during streaming will lose their images
   * on drain. Phase 1 archived contract preserved images; restoring this is
   * deferred. See change: rework-mid-turn-prompt-queue (Known Limitation).
   */
  function bufferFollowupSend(text: string): void {
    if (!getBridgeState().isAgentStreaming) return;
    if (bridgeFollowUp.length >= FOLLOWUP_QUEUE_CAP) {
      console.warn("[dashboard] follow-up buffer at soft cap (" + FOLLOWUP_QUEUE_CAP + "); dropping new entry");
      return;
    }
    bridgeFollowUp.push(text);
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
   * (Verified at pi-coding-agent pi-agent-core/agent.js:307-330.)
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
    if (typeof cachedCtx?.hasPendingMessages === "function") {
      try {
        if (cachedCtx.hasPendingMessages()) return;
      } catch { /* probe failure non-fatal */ }
    }

    // Idle gate: pi flips isStreaming=false in finishRun() AFTER the
    // executor returns from runAgentLoop. queueMicrotask runs inside the
    // executor (too early), so we use setTimeout to escape the loop AND
    // poll for isIdle with bounded retries.
    const idle = (() => {
      try { return cachedCtx?.isIdle?.() === true; } catch { return false; }
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
      try {
        (pi.sendUserMessage as any)(entry);
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
   * Respects `FOLLOWUP_QUEUE_CAP` (drops with warning, same policy as
   * `bufferFollowupSend`). Schedules `drainFollowupQueue(0)` via
   * `setTimeout(…, 0)` so the drain re-runs AFTER the async judge verdict
   * resolves (the bridge's own `agent_end` drain already ran against an
   * empty buffer by then).
   *
   * Generic infrastructure — not goal-specific. See change:
   * add-goal-continuation-plugin (design.md Decision 2).
   */
  function enqueueSystemFollowup(text: string): void {
    if (typeof text !== "string" || text.length === 0) return;
    if (bridgeFollowUp.length >= FOLLOWUP_QUEUE_CAP) {
      console.warn("[dashboard] follow-up buffer at soft cap (" + FOLLOWUP_QUEUE_CAP + "); dropping system entry");
      return;
    }
    bridgeFollowUp.push(text);
    emitQueueUpdate();
    setTimeout(() => drainFollowupQueue(0), 0);
  }
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

  // rewriteFollowupQueue removed. The clear-then-replay strategy was broken
  // by construction (pi.clearFollowUpQueue is not on the ExtensionAPI, so the
  // "clear" step was a no-op and the replay just appended ghosts to pi's real
  // queue). See change: honest-mid-turn-queue-surface.

  /** Forward a synthesized auto_retry_* event using the standard event_forward shape. */
  const sendSyntheticRetryEvent = (eventType: string, data: Record<string, unknown>): void => {
    if (!isActive() || !sessionReady) return;
    connection.send({
      type: "event_forward",
      sessionId,
      event: { eventType, timestamp: Date.now(), data },
    });
  };

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
  const pendingNonces = new WeakMap<object, string>();
  let nonceCounter = 0;
  const nextNonce = (): string => `n-${++nonceCounter}-${Date.now()}`;
  let appendMessageWrapped = false;
  let lastWrappedSm: any = null;

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
    const cwd = (cachedCtx?.cwd as string | undefined) ?? process.cwd();
    const alreadyEmitted = getEmittedAssetHashes(sessionId);
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
      connection.send({
        type: "asset_register",
        sessionId,
        hash: a.hash,
        mimeType: a.mimeType,
        data: a.data,
      });
    }
  }

  /**
   * Wrap ctx.sessionManager.appendMessage once per session so that when pi
   * generates an entry id we capture it in the WeakMap and emit
   * entry_persisted to the server.
   */
  function wrapAppendMessageForCtx(ctx: any): void {
    const sm = ctx?.sessionManager;
    if (!sm || typeof sm.appendMessage !== "function") return;
    // Re-wrap when sessionManager identity changes (session replacement).
    if (sm === lastWrappedSm && appendMessageWrapped) return;
    const original = sm.appendMessage.bind(sm);
    sm.appendMessage = (msg: any, ...rest: any[]) => {
      const result = original(msg, ...rest);
      try {
        if (msg && typeof msg === "object" && typeof msg.id === "string") {
          idByMessage.set(msg as object, msg.id);
          const nonce = pendingNonces.get(msg as object);
          if (nonce && sessionReady && isActive()) {
            const ev = {
              type: "entry_persisted",
              entryId: msg.id,
              nonce,
            };
            connection.send(mapEventToProtocol(sessionId, ev));
            pendingNonces.delete(msg as object);
          }
        }
      } catch (err) {
        console.error("[dashboard] entry_persisted emit failed:", err);
      }
      return result;
    };
    lastWrappedSm = sm;
    appendMessageWrapped = true;
  }

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

  // Load config to determine WebSocket URL
  ensureConfig();
  const config = loadConfig();
  const dashboardUrl = process.env.PI_DASHBOARD_URL ?? `ws://localhost:${config.piPort}`;

  // Long-lived ctx wrapper for the Extension UI System (Phase 1) — see
  // change: add-extension-ui-modal. `getSessionId` reads the closed-over
  // `sessionId` so the helper always uses the current value (which is
  // mutated when `event.reason ∈ {"new","fork","resume"}` fires).
  const uiModulesBridgeCtx: UiModulesBridgeCtx = {
    pi: pi as any,
    connection: { send: (msg: unknown) => connection.send(msg) },
    getSessionId: () => sessionId,
  };

  const connection = new ConnectionManager({
    url: dashboardUrl,
    onMessage: safe(async (data: unknown) => {
      if (!isActive()) return; // Stale listener guard
      const msg = data as ServerToExtensionMessage;
      // Extension UI System (Phase 1): browser-originated action / data
      // request. Re-emit on pi.events; the listener either populates
      // data.items synchronously or calls _reply asynchronously.
      // See change: add-extension-ui-modal.
      if ((msg as any).type === "ui_management") {
        handleUiManagement(uiModulesBridgeCtx, msg as any);
        return;
      }
      // Server announced a deliberate restart/shutdown. Pause the auto-start
      // spawn step in `server-auto-start.ts` for `quiesceMs` so we don't
      // race the orchestrator that's about to bring up the replacement.
      // Discovery + reconnection still run via the normal backoff path.
      // See change: fix-restart-bridge-auto-start-race.
      if ((msg as any).type === "server_restarting") {
        const reason = (msg as any).reason;
        const quiesceMs = (msg as any).quiesceMs;
        if (typeof quiesceMs === "number" && quiesceMs > 0) {
          connection.pauseAutoStart(quiesceMs);
          console.log(`[dashboard] server announced restart (reason=${reason} quiesceMs=${quiesceMs})`);
        }
        return;
      }
      // Legacy extension_ui_response removed — now handled by prompt_response → promptBus.respond()
      // Reload auth credentials when dashboard notifies of changes
      if (msg.type === "credentials_updated") {
        try {
          // Hot-reload providers.json diff BEFORE refreshing the registry,
          // so any newly added providers are registered before getAvailable() runs.
          const diff = await reloadProviders(pi).catch((err) => {
            console.error("[dashboard] reloadProviders failed:", err);
            return { added: [], removed: [], changed: [] };
          });
          if (diff.added.length || diff.removed.length || diff.changed.length) {
            console.log(
              `[dashboard] hot-reloaded providers: added=${JSON.stringify(diff.added)} removed=${JSON.stringify(diff.removed)} changed=${JSON.stringify(diff.changed)}`,
            );
          }
          cachedModelRegistry?.authStorage?.reload?.();
          cachedModelRegistry?.refresh?.();
        } catch (err) { console.error("[dashboard] credentials reload failed:", err); }
        // Push updated models list to dashboard client
        if (cachedModelRegistry && sessionReady) {
          try {
            const models = cachedModelRegistry.getAvailable().map(toModelInfo);
            connection.send({ type: "models_list", sessionId, models });
            // See change: replace-hardcoded-provider-lists.
            connection.send({ type: "providers_list", sessionId, providers: buildProviderCatalogue() });
          } catch (err) { console.error("[dashboard] models_list push failed:", err); }
        }
        return;
      }
      // Auto-naming toggle relay: store the pushed value so the namer gates on
      // the current preference. See change: add-auto-session-naming.
      if (msg.type === "preferences_update") {
        if (typeof (msg as any).autoNameSessions === "boolean") {
          autoNameSessions = (msg as any).autoNameSessions;
        }
        return;
      }
      // Graceful stop-after-turn: latch a per-session flag; the next turn_end
      // shuts the session down cleanly. Idempotent. See change:
      // adopt-pi-071-072-073-features.
      if (msg.type === "stop_after_turn") {
        getBridgeState().shouldStopAfterTurn = true;
        return;
      }
      // Route flow management actions from dashboard buttons
      if (msg.type === "flow_management" && pi.events) {
        if (msg.action === "run") {
          pi.events.emit("flow:run", { flowName: msg.flowName, task: msg.task || undefined });
        } else if (msg.action === "set-edit-mode") {
          // Edit-mode toggle (rework-flows-plugin-for-new-pi-flows). pi-flows
          // persists flows.editFlow, syncs skill visibility, reloads.
          // /flows:new + /flows:edit removed upstream — authoring is now the
          // edit-flow skill via send_prompt from the dashboard.
          if (typeof (msg as { enabled?: unknown }).enabled === "boolean") {
            pi.events.emit("flow:set-edit-mode", { enabled: (msg as { enabled: boolean }).enabled });
          }
        } else if (msg.action === "delete") {
          // Dashboard already confirmed upfront — delete directly
          pi.events.emit("flow:delete-request", { flowName: msg.flowName });
          pi.events.emit("flow:notify", { message: `Flow "${msg.flowName}" deleted.`, level: "info" });
        }
        return;
      }
      // Route role management from dashboard
      if (msg.type === "role_set" && pi.events) {
        const data: any = { role: (msg as any).role, modelId: (msg as any).modelId };
        pi.events.emit("roles:set", data);
        if (data.success) {
          const rolesData: any = {};
          pi.events.emit("roles:get-all", rolesData);
          connection.send({
            type: "roles_list",
            sessionId,
            roles: rolesData.roles ?? {},
            presets: rolesData.presets ?? [],
            activePreset: rolesData.activePreset ?? null,
            builtinRoleNames: rolesData.builtinRoleNames ?? [],
          });
        }
        return;
      }
      if (msg.type === "role_preset_load" && pi.events) {
        const data: any = { name: (msg as any).presetName };
        pi.events.emit("roles:preset-load", data);
        if (data.success) {
          const rolesData: any = {};
          pi.events.emit("roles:get-all", rolesData);
          connection.send({
            type: "roles_list",
            sessionId,
            roles: rolesData.roles ?? {},
            presets: rolesData.presets ?? [],
            activePreset: rolesData.activePreset ?? null,
            builtinRoleNames: rolesData.builtinRoleNames ?? [],
          });
        }
        return;
      }
      if (msg.type === "role_preset_save" && pi.events) {
        const data: any = { name: (msg as any).presetName };
        pi.events.emit("roles:preset-save", data);
        if (data.success) {
          const rolesData: any = {};
          pi.events.emit("roles:get-all", rolesData);
          connection.send({
            type: "roles_list",
            sessionId,
            roles: rolesData.roles ?? {},
            presets: rolesData.presets ?? [],
            activePreset: rolesData.activePreset ?? null,
            builtinRoleNames: rolesData.builtinRoleNames ?? [],
          });
        }
        return;
      }
      if (msg.type === "role_preset_delete" && pi.events) {
        const data: any = { name: (msg as any).presetName };
        pi.events.emit("roles:preset-delete", data);
        if (data.success) {
          const rolesData: any = {};
          pi.events.emit("roles:get-all", rolesData);
          connection.send({
            type: "roles_list",
            sessionId,
            roles: rolesData.roles ?? {},
            presets: rolesData.presets ?? [],
            activePreset: rolesData.activePreset ?? null,
            builtinRoleNames: rolesData.builtinRoleNames ?? [],
          });
        }
        return;
      }
      // Remove a CUSTOM role: purge from schema + active map + every preset.
      // Built-ins are rejected server-side in the roles:remove handler.
      // Mirrors the role_set routing block. See change: add-custom-roles-ui.
      if (msg.type === "role_remove" && pi.events) {
        const data: any = { role: (msg as any).role };
        pi.events.emit("roles:remove", data);
        if (data.success) {
          const rolesData: any = {};
          pi.events.emit("roles:get-all", rolesData);
          connection.send({
            type: "roles_list",
            sessionId,
            roles: rolesData.roles ?? {},
            presets: rolesData.presets ?? [],
            activePreset: rolesData.activePreset ?? null,
            builtinRoleNames: rolesData.builtinRoleNames ?? [],
          });
        }
        return;
      }
      if (msg.type === "request_roles" && pi.events) {
        const rolesData: any = {};
        pi.events.emit("roles:get-all", rolesData);
        connection.send({
          type: "roles_list",
          sessionId,
          roles: rolesData.roles ?? {},
          presets: rolesData.presets ?? [],
          activePreset: rolesData.activePreset ?? null,
          builtinRoleNames: rolesData.builtinRoleNames ?? [],
        });
        return;
      }
      // Route PromptBus responses from dashboard client
      if (msg.type === "prompt_response" && promptBus) {
        promptBus.respond({
          id: (msg as any).promptId,
          answer: (msg as any).answer,
          cancelled: (msg as any).cancelled,
          source: (msg as any).source ?? "dashboard-default",
          // Optional pasted images for method:"input".
          // See change: add-ask-user-input-multiline-paste.
          images: (msg as any).images,
        });
        return;
      }
      // Legacy architect_prompt_response routing REMOVED.
      // Previously routed to flow:prompt-response + cancelAllPending().
      // Now handled by PromptBus: dashboard sends prompt_response,
      // bus calls respond(), adapters get onResponse() for cross-cancellation.
      // Route flow control messages to pi-flows via pi.events
      // Generic plugin-registered event emission. A dashboard plugin action
      // (e.g. automation) emits a configured event INTO this session; the
      // bridge relays it onto pi.events. Decoupled: the bridge does not know
      // which events exist. See change: automation-emit-configured-event.
      if (msg.type === "plugin_emit_event" && pi.events) {
        const eventType = (msg as { eventType?: unknown }).eventType;
        if (typeof eventType === "string" && eventType.length > 0) {
          const data = (msg as { data?: unknown }).data;
          pi.events.emit(eventType, data && typeof data === "object" ? (data as Record<string, unknown>) : {});
        }
        return;
      }
      // Subagent resync (D2): reply with the latest retained snapshot of a
      // running subagent as a synthetic subagent_started event_forward. No-op
      // for an unknown/finished agent (durable completed-case backfill covers
      // those). See change: fix-subagent-live-detail-reliability.
      if (msg.type === "subagent_resync_request") {
        const agentId = (msg as { agentId?: unknown }).agentId;
        if (typeof agentId === "string" && agentId.length > 0 && sessionReady && isActive()) {
          const snap = subagentFrameBuffer.resync(agentId);
          if (snap) {
            sendEventForward("subagents:started", snap.data);
            console.log(`[dashboard] served subagent resync for agentId=${agentId}`);
          } else {
            console.log(`[dashboard] subagent resync no-op (unknown/finished) agentId=${agentId}`);
          }
        }
        return;
      }
      if (msg.type === "flow_control" && pi.events) {
        if (msg.action === "abort") {
          pi.events.emit("flow:abort", {});
          // Also abort architect if running (mutually exclusive with flow execution;
          // the irrelevant emit is a no-op due to guard checks on both listeners)
          pi.events.emit("flow:architect-abort", {});
        } else if (msg.action === "toggle_autonomous") {
          pi.events.emit("flow:toggle-autonomous", {});
        } else if (msg.action === "dismiss_summary") {
          pi.events.emit("flow:summary-dismissed", {});
        }
        return;
      }
      // ── Follow-up queue mutation (bridge-owned buffer) ─────────────────
      //
      // These five handlers mutate `bridgeFollowUp` only. NONE of them
      // call pi.sendUserMessage, pi.clear*Queue, or any other pi method.
      // The bridge owns the buffer; pi never sees these entries until the
      // drain loop ships them on agent_end as fresh-turn sendUserMessage.
      //
      // The OLD pi-mutation handler set from Phase 3 (clear_steering_queue,
      // clear_followup_slot, edit_followup_slot) is GONE forever — pi's
      // ExtensionAPI exposes no clear*Queue primitives (verified through
      // pi 0.76.0). Steer mutation will never be exposed (steer drains too
      // fast for it to matter; user direction).
      //
      // See change: rework-mid-turn-prompt-queue (design.md D3).
      if (msg.type === "edit_followup_entry") {
        const { index, text } = msg as { type: string; index: number; text: string };
        if (typeof index !== "number" || index < 0 || index >= bridgeFollowUp.length) {
          connection.send({
            type: "event_forward",
            sessionId,
            event: { eventType: "command_feedback", timestamp: Date.now(), data: {
              command: "edit_followup_entry", status: "error", message: "Index out of range",
            } },
          });
          return;
        }
        bridgeFollowUp[index] = text;
        emitQueueUpdate();
        return;
      }
      if (msg.type === "remove_followup_entry") {
        const { index } = msg as { type: string; index: number };
        if (typeof index !== "number" || index < 0 || index >= bridgeFollowUp.length) {
          connection.send({
            type: "event_forward",
            sessionId,
            event: { eventType: "command_feedback", timestamp: Date.now(), data: {
              command: "remove_followup_entry", status: "error", message: "Index out of range",
            } },
          });
          return;
        }
        bridgeFollowUp.splice(index, 1);
        emitQueueUpdate();
        return;
      }
      if (msg.type === "promote_followup_entry") {
        const { index } = msg as { type: string; index: number };
        // Silent no-op for index 0 or invalid — no emit (D3).
        if (typeof index !== "number" || index <= 0 || index >= bridgeFollowUp.length) {
          return;
        }
        const [entry] = bridgeFollowUp.splice(index, 1);
        bridgeFollowUp.unshift(entry);
        emitQueueUpdate();
        return;
      }
      if (msg.type === "clear_followup_entries") {
        const { indices } = msg as { type: string; indices: number[] | "all" };
        if (indices === "all") {
          if (bridgeFollowUp.length > 0) {
            bridgeFollowUp = [];
            emitQueueUpdate();
          }
          return;
        }
        if (!Array.isArray(indices)) return;
        // Sort descending to avoid index drift across multiple splices.
        const sorted = [...indices].sort((a, b) => b - a);
        let mutated = false;
        for (const i of sorted) {
          if (typeof i === "number" && i >= 0 && i < bridgeFollowUp.length) {
            bridgeFollowUp.splice(i, 1);
            mutated = true;
          }
        }
        if (mutated) emitQueueUpdate();
        return;
      }
      const response = await commandHandler.handle(msg);
      if (response) connection.send(response);
      // Immediately send model/thinking update after handling set_thinking_level
      if (msg.type === "set_thinking_level") {
        // Small delay to let pi process the level change
        setTimeout(() => sendModelUpdateIfChanged(), 50);
      }
    }),
    onReconnect: safe(() => {
      if (!isActive()) return; // Stale listener guard
      // Reset caches that aren't persisted server-side so the upcoming
      // 30s tick (and the inline calls below) re-emit the live state.
      const _bc = syncBc();
      _resetReconnectCaches(_bc);
      applyBc(_bc);
      sendStateSync();
      // Force-emit git state for the active session’s cwd. The bridge
      // doesn't have direct ctx here, so we walk the active session.
      try {
        const activeId = (pi as any).getCurrentSessionId?.();
        const activeCtx = activeId ? (pi as any).getCtx?.(activeId) : (cachedCtx as any);
        if (activeCtx?.cwd) {
          sendGitInfoIfChanged(activeCtx.cwd);
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
      // Client-side dedup by requestId prevents double-rendering.
      if (promptBus) {
        for (const { request, component, placement } of promptBus.getPendingRequests()) {
          connection.send({
            type: "prompt_request" as any,
            sessionId,
            promptId: request.id,
            prompt: {
              type: request.type,
              question: request.question,
              options: request.options,
              defaultValue: request.defaultValue,
              pipeline: request.pipeline,
              metadata: request.metadata,
            },
            component,
            placement,
          });
        }
      }
      connection.send({ type: "replay_complete", sessionId });
      // If agent is mid-turn, send synthetic agent_start so server sets status to "streaming"
      if (getBridgeState().isAgentStreaming) {
        connection.send(mapEventToProtocol(sessionId, { type: "agent_start" }));
      }
      // Extension UI System (Phase 1): re-probe modules after every
      // reconnect so the server-side cache stays accurate. The probe is
      // synchronous and re-runs the listener stack each call.
      // See change: add-extension-ui-modal.
      refreshUiModules(uiModulesBridgeCtx);
    }),
  });

  // Track connection so future bridge incarnations can disconnect it
  getBridgeState().connections!.push(connection);

  const commandHandler = createCommandHandler(pi, () => sessionId, {
    getModelRegistry: () => cachedModelRegistry,
    // AI-draft fork-subagent wiring (see change:
    // add-session-uncommitted-indicator-and-commit). Both degrade silently
    // to the draft ladder's lower rungs when unavailable.
    getSessionContextText: () => buildSessionContextText(cachedCtx),
    runDraftAgent: (seed: string, cwd: string) =>
      runForkSubagentDraft(seed, cwd, () => cachedCtx?.model),
    // Mirror server attach/detach pushes into BridgeContext.attachedChange so
    // the before_agent_start injector exposes it. See change:
    // inject-session-context-into-agent.
    onAttachProposalChanged: (next: string | null) => {
      attachedChange = next;
      const s = getBridgeState();
      s.attachedChange = next;
    },
    setThinkingLevel: (level: string) => (pi as any).setThinkingLevel?.(level),
    getThinkingLevel: () => (pi as any).getThinkingLevel?.(),
    setModel: async (provider: string, modelId: string) => {
      const registry = cachedModelRegistry;
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
      if (cachedCtx?.shutdown) {
        cachedCtx.shutdown();
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
      abortLatch.request(sessionId);
      if (cachedCtx?.abort) {
        cachedCtx.abort();
      }
      // Clear retry attempt counter so a subsequent agent_end does not
      // double-emit auto_retry_end{success:true}. See change:
      // fix-provider-retry-infinite-loop.
      retryTracker.noteAbort(sessionId);
      // pi's eventual terminal agent_end still surfaces the real provider
      // errorMessage through the reducer's own agent_end error path; the
      // observe-based tracker only synthesizes retry lifecycle events, never
      // the settled error. See change: simplify-error-retry-single-card.
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
        cachedCtx?.abort?.();
      } catch (err) {
        console.warn("[dashboard] cachedCtx.abort threw in rawAbort:", err);
      }
    },
    isIdle: () => {
      try { return cachedCtx?.isIdle?.() ?? false; } catch { return false; }
    },
    eventSink: (msg) => connection.send(msg),
    compact: (opts) => {
      if (cachedCtx?.compact) {
        cachedCtx.compact(opts);
      }
    },
    reload: () => {
      const reloadFn = (globalThis as any)[RELOAD_KEY] as (() => Promise<void>) | undefined;
      if (reloadFn) {
        reloadFn().catch((err: any) => {
          console.error("[dashboard] reload failed:", err);
        });
      } else {
        console.error("[dashboard] reload not available — type /__dashboard_reload in pi TUI once to bootstrap");
      }
    },
    spawnNew: () => {
      connection.send({ type: "spawn_new_session", sessionId, cwd: process.cwd() });
    },
    sessionPrompt: async (text, delivery) => {
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
          connection.send({ type: "prompt_received", sessionId, fresh: false });
          pi.events.emit("flow:run", { flowName: cmdName, task: cmdArgs.trim() || undefined });
          return;
        }
      }

      // Extension-command dispatch (routing step 9). When matched, the helper
      // emits its own command_feedback events and we MUST NOT fall through.
      // The `connection` arg enables Path C (headless RPC → server-routed
      // dispatch via the keeper UDS); see change:
      // add-rpc-stdin-dispatch-with-keeper-sidecar.
      const handled = await tryDispatchExtensionCommand(
        pi,
        text,
        sessionId,
        (msg) => connection.send(msg),
        connection,
      );
      if (handled) {
        // Non-turn dispatch route: settle optimistic idle bubble (no message_start
        // follows). See change: optimistic-prompt-progress.
        connection.send({ type: "prompt_received", sessionId, fresh: false });
        return;
      }

      // Exec-mode slash template (executable: bash): run the body as bash and
      // skip the LLM entirely. Runs AFTER extension dispatch, BEFORE template
      // expansion + sendUserMessage. See change: add-dashboard-slash-commands.
      const ranExec = await tryExecSlashTemplate(
        pi,
        text,
        process.cwd(),
        sessionId,
        (msg) => connection.send(msg),
      );
      if (ranExec) {
        // Non-turn exec-template route: settle optimistic idle bubble.
        // See change: optimistic-prompt-progress.
        connection.send({ type: "prompt_received", sessionId, fresh: false });
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
      connection.send({ type: "prompt_received", sessionId, fresh: !wasStreaming });
      const expanded = expandPromptTemplateFromDisk(text, process.cwd(), pi);
      if (wasStreaming && deliverAs === "followUp") {
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
    // Clear the abort latch when a new user prompt is dispatched, before pi
    // can fire agent_start for it. See change: unify-error-retry-lifecycle.
    noteUserPrompt: () => abortLatch.clear(sessionId),
  });

  // Reload support: extension events only provide ExtensionContext (no reload).
  // ExtensionCommandContext (with reload()) is only available in command handlers.
  // We register __dashboard_reload command; invoking /__dashboard_reload from pi TUI
  // captures ctx.reload(). After first capture, dashboard-triggered reloads work.
  // The captured fn is stored in globalThis to survive module reloads.
  const RELOAD_KEY = "__pi_dashboard_reload_fn__";

  pi.registerCommand("__dashboard_reload", {
    handler: async (_args: string, ctx: any) => {
      if (ctx?.reload) {
        (globalThis as any)[RELOAD_KEY] = () => ctx.reload();
        await ctx.reload();
      }
    },
  });

  /** Sync local variables into BridgeContext for extracted module calls */
  function syncBc(): BridgeContext {
    return {
      pi, connection, sessionId, attachedChange,
      cachedCtx, cachedModelRegistry, cachedHasUI,
      lastModel, lastThinkingLevel,
      lastSessionFile, lastSessionDir, lastFirstMessage,
      lastGitBranch, lastGitPrNumber, lastSessionName,
      lastGitWorktreeJson,
      lastGitStatusJson,
      lastCwdMissing,
      hasRegisteredOnce,
      dashboardSpawned,
      selfSpawnedPgids,
    };
  }
  /** Sync BridgeContext mutations back to local variables */
  function applyBc(bc: BridgeContext): void {
    sessionId = bc.sessionId;
    attachedChange = bc.attachedChange;
    cachedCtx = bc.cachedCtx;
    cachedModelRegistry = bc.cachedModelRegistry;
    cachedHasUI = bc.cachedHasUI;
    lastModel = bc.lastModel;
    lastThinkingLevel = bc.lastThinkingLevel;
    lastSessionFile = bc.lastSessionFile;
    lastSessionDir = bc.lastSessionDir;
    lastFirstMessage = bc.lastFirstMessage;
    lastGitBranch = bc.lastGitBranch;
    lastGitPrNumber = bc.lastGitPrNumber;
    lastSessionName = bc.lastSessionName;
    lastGitWorktreeJson = bc.lastGitWorktreeJson;
    lastGitStatusJson = bc.lastGitStatusJson;
    lastCwdMissing = bc.lastCwdMissing;
    hasRegisteredOnce = bc.hasRegisteredOnce;
  }

  // Local wrappers that sync bc around extracted module calls
  function sendStateSync() { const bc = syncBc(); _sendStateSync(bc, getFlowsList); applyBc(bc); }
  function replaySessionEntries() { _replaySessionEntries(syncBc()); }
  function sendModelUpdateIfChanged() { const bc = syncBc(); _sendModelUpdateIfChanged(bc); applyBc(bc); }
  function sendSessionNameIfChanged() { const bc = syncBc(); _sendSessionNameIfChanged(bc); applyBc(bc); }

  // ── add-auto-session-naming ──────────────────────────────────────────────
  // Lazily acquire pi-ai's streamSimple the way the server's model-proxy does.
  async function loadStreamSimple(): Promise<StreamSimpleFn | undefined> {
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
    if (autoNamer) return autoNamer;
    autoNamer = createAutoNamer({
      getAutoNameSessions: () => autoNameSessions,
      resolveFastModel: () => lookupRole("@fast"),
      getRegistry: () => cachedModelRegistry,
      loadStreamSimple,
      getTranscript: () => ({
        firstUserMsg: extractFirstMessage(cachedCtx),
        firstAssistantReply: extractFirstAssistantReply(cachedCtx),
      }),
      applyName: (title: string) => {
        try { pi.setSessionName(title); } catch { /* ignore */ }
        lastSessionName = title; // suppress the redundant plain name_update poll
        connection.send({ type: "session_name_update", sessionId, name: title, nameSource: "auto" });
      },
      reportUserRename: (name: string) => {
        connection.send({ type: "session_name_update", sessionId, name, nameSource: "user" });
      },
      emitError: (reason: string) => {
        connection.send({ type: "auto_name_error", sessionId, reason });
      },
    });
    return autoNamer;
  }

  // Run one naming attempt after a terminal turn. Observing the current name
  // first catches a pre-existing / in-pi rename (external → permanent "user"
  // lockout) before attempting to auto-name.
  function runAutoNameOnTurnEnd(): void {
    if (!autoNameSessions) return;
    const namer = getAutoNamer();
    namer.onObservedName(pi.getSessionName() ?? "");
    void namer.maybeName();
  }
  function sendGitInfoIfChanged(cwd: string) { const bc = syncBc(); _sendGitInfoIfChanged(bc, cwd); applyBc(bc); }
  function sendCwdMissingIfChanged(cwd: string) { const bc = syncBc(); _sendCwdMissingIfChanged(bc, cwd); applyBc(bc); }
  function sendPiVersionIfChanged() { _sendPiVersionIfChanged(syncBc()); }

  // Forward all pi core events to the dashboard.
  // Events with special enrichment logic:
  const enrichedEventTypes = [
    "agent_start",
    "agent_end",
    "turn_start",
    "turn_end",
    "message_start",
    "message_update",
    "message_end",
    "tool_execution_start",
    "tool_execution_update",
    "tool_execution_end",
    "session_compact",
    "model_select",
    "thinking_level_select",
  ] as const;
  // Pass-through events: forwarded as-is with no special handling.
  // Unrecognized types render as expandable JSON cards in the dashboard.
  const passThroughEventTypes = [
    "tool_call",
    "tool_result",
    "user_bash",
    "input",
    "before_agent_start",
    "resources_discover",
    "session_before_switch",
    "session_before_fork",
    "session_before_compact",
    "session_before_tree",
    "session_tree",
  ] as const;
  // Excluded from subscription (not forwarded):
  // - `context`: carries full message arrays (very large)
  // - `before_provider_request`: carries raw API payloads (very large)
  // - `session_start`: dedicated handler → session_register protocol message
  // - session change (new/fork/resume): handled inside session_start via event.reason
  // - `session_shutdown`: dedicated handler → disconnect/cleanup

  // Unified EventBus rename map for the emit intercept (flow + subagent events)
  const EVENT_BUS_MAP: Record<string, string> = { ...FLOW_EVENT_MAP, ...SUBAGENT_EVENT_MAP };

  for (const eventType of enrichedEventTypes) {
    pi.on(eventType as any, safe(async (event: any, ctx: any) => {
      // Bail out if a newer bridge instance has taken over
      if (!isActive()) return;
      // Always keep latest context for abort/shutdown
      cachedCtx = ctx;
      // Don't send events before session_start has established the correct session ID
      if (!sessionReady) return;
      // Track agent streaming state (survives reconnect/reload)
      if (eventType === "agent_start") {
        getBridgeState().isAgentStreaming = true;
        // Abort latch (resumption hook): if a user abort is still latched when
        // pi fires a fresh agent_start for the aborted turn (no intervening
        // user prompt cleared it), abort again. See change:
        // unify-error-retry-lifecycle.
        if (abortLatch.shouldAbort(sessionId)) {
          try { cachedCtx?.abort?.(); } catch { /* idempotent */ }
        }
      }
      if (eventType === "agent_end") {
        getBridgeState().isAgentStreaming = false;
        // Abort latch settle: the turn terminally ended — clear the latch so a
        // later, unrelated turn is not aborted. See change:
        // unify-error-retry-lifecycle.
        abortLatch.clear(sessionId);
        // Provider-retry synthesis: forward auto_retry_end BEFORE agent_end
        // when a retry chain was in flight, so the dashboard's retry sub-line
        // clears before the settled error renders. A terminal error pi never
        // re-attempted (no chain) yields nothing here — the reducer's own
        // agent_end arm surfaces lastError.
        // See change: simplify-error-retry-single-card.
        const trackerSynth = retryTracker.observeAgentEnd(sessionId, event as any);
        if (trackerSynth) {
          sendSyntheticRetryEvent(trackerSynth.eventType, trackerSynth.data);
        }
        // Automatic session topic-naming: attempt on each terminal turn until
        // the first success (or a permanent lockout). Non-blocking; all errors
        // are handled inside the namer. See change: add-auto-session-naming.
        runAutoNameOnTurnEnd();
        // Bridge shadow follow-up queue: the per-entry drain matcher in
        // the `message_start` handler removes each entry as pi delivers it
        // (mirrors pi's internal `_processAgentEvent`). No bulk clear here
        // — it would wipe entries the user adds DURING the drain window.
        // See change: add-followup-edit-and-steer-cancel (per-entry-drain).

        // Bridge-owned follow-up drain: pop one entry from bridgeFollowUp
        // and hand it to pi as a fresh turn (sendUserMessage no deliverAs).
        // Scheduled via setTimeout (not queueMicrotask) so pi's
        // finishRun() can flip isStreaming=false BEFORE we call back.
        // The drain function itself polls ctx.isIdle() and retries up to
        // ~2s if pi hasn't transitioned yet.
        // See change: rework-mid-turn-prompt-queue (post-smoke fix #3).
        setTimeout(() => drainFollowupQueue(0), 0);

        // Empty-actionable-turn guard: classify this turn's terminal shape.
        // A thinking-only / empty `stop` (no visible text, no tool call, no
        // error) would otherwise idle the session silently. Continue-or-
        // surface instead. Normal / tool-call / truncated / error turns yield
        // `none` and only reset the guard's per-session counter.
        // See change: fix-gemini-subagent-silent-tool-schema-failure.
        {
          const agentMsgs = (event as any)?.messages;
          const terminalMsg =
            Array.isArray(agentMsgs) && agentMsgs.length > 0
              ? (agentMsgs[agentMsgs.length - 1] as Record<string, unknown>)
              : undefined;
          if (terminalMsg?.role === "assistant") {
            const actionability = classifyTurnActionability(terminalMsg as any);
            const decision = emptyActionableGuard.observe(sessionId, actionability);
            if (decision.action === "continue" && decision.nudge) {
              // Only nudge when nothing else will already re-run the session
              // (no user/system follow-up pending). A pending entry means the
              // session is not idling, so the guard can safely no-op.
              if (bridgeFollowUp.length === 0) {
                enqueueSystemFollowup(decision.nudge);
              }
            } else if (decision.action === "surface") {
              // Non-error status: the model returned only reasoning. Forward a
              // structured, non-error notice so the server logs it to
              // server.log and the dashboard card renders it (distinct from an
              // error banner).
              const model =
                typeof terminalMsg.model === "string"
                  ? (terminalMsg.model as string)
                  : undefined;
              const provider =
                typeof terminalMsg.provider === "string"
                  ? (terminalMsg.provider as string)
                  : undefined;
              connection.send({
                type: "event_forward",
                sessionId,
                event: {
                  eventType: "empty_actionable_surface",
                  timestamp: Date.now(),
                  data: {
                    message: decision.reason ?? SURFACE_MESSAGE,
                    model: provider && model ? `${provider}/${model}` : model,
                  },
                },
              });
            }
          }
        }

      }
      // For model_select, enrich the event data with thinkingLevel
      if (eventType === "model_select") {
        const enriched = { ...event, thinkingLevel: (pi as any).getThinkingLevel?.() };
        const msg = mapEventToProtocol(sessionId, enriched);
        connection.send(msg);
        return;
      }

      // Pi 0.71+ fires a dedicated thinking_level_select event when the
      // thinking level changes alone (no model change). Push a model_update
      // through the existing dedup gate so the dashboard reflects it
      // immediately rather than waiting for the next model change.
      // See change: adopt-pi-071-072-073-features.
      if (eventType === "thinking_level_select") {
        sendModelUpdateIfChanged();
        return;
      }

      // Graceful stop-after-turn: when latched, shut the session down cleanly
      // at this turn boundary. Fall back to abort if shutdown is unavailable.
      // Clear the flag BEFORE calling shutdown so a double-fired turn_end
      // can't re-trigger. See change: adopt-pi-071-072-073-features.
      if (eventType === "turn_end" && getBridgeState().shouldStopAfterTurn) {
        getBridgeState().shouldStopAfterTurn = false;
        try {
          if (typeof (ctx as any)?.shutdown === "function") (ctx as any).shutdown();
          else (ctx as any)?.abort?.();
        } catch (err) {
          console.error("[dashboard] stop-after-turn shutdown failed:", err);
        }
      }

      // For turn_end, enrich with contextUsage (pi-only API) so server can extract stats
      if (eventType === "turn_end") {
        const contextUsage = ctx.getContextUsage?.();
        if (contextUsage) {
          const enriched = { ...event, contextUsage };
          const msg = mapEventToProtocol(sessionId, enriched);
          connection.send(msg);
          return;
        }
      }

      // For message_start: stamp a nonce on the event so the client reducer
      // can correlate a later entry_persisted back-fill with this bubble.
      // We do NOT attach entryId here — the message has no id yet on pi
      // 0.69+ (persistence is deferred to message_end). See change:
      // fix-per-message-fork.
      //
      // USER message_start sends are deferred via setTimeout(0) so they
      // land on the wire AFTER any pending message_end deferrals (which
      // also use setTimeout(0) — timer FIFO preserves order). Without this,
      // a follow-up user message_start emitted synchronously by pi during
      // an agent_end drain would arrive BEFORE the preceding assistant
      // message_end, and the client reducer would append the user bubble
      // above the assistant's final response. ASSISTANT message_start stays
      // sync because message_update events fire sync and the reducer's
      // streamingTextFlushed reset depends on message_start being processed
      // first. See change: add-followup-edit-and-steer-cancel (chat-order).
      if (eventType === "message_start") {
        wrapAppendMessageForCtx(ctx);
        const messageRef = (event as any).message;
        if (messageRef && typeof messageRef === "object") {
          const nonce = nextNonce();
          pendingNonces.set(messageRef as object, nonce);
          const enriched = { ...event, nonce };
          const msg = mapEventToProtocol(sessionId, enriched);
          const role = (messageRef as any).role;
          // Abort latch (resumption + clear hooks). A USER message_start is a
          // deliberate new turn — clear the latch so it is never aborted. An
          // ASSISTANT message_start while the latch is set is the aborted
          // turn resuming a retry (no intervening user prompt) — abort again.
          // See change: unify-error-retry-lifecycle.
          if (role === "user") {
            abortLatch.clear(sessionId);
            // A deliberate new user turn resets the empty-actionable guard's
            // consecutive-continuation counter, so a stale count from a prior
            // (possibly aborted) empty-actionable chain never shortens the next
            // unrelated prompt's retry budget.
            // See change: fix-gemini-subagent-silent-tool-schema-failure.
            emptyActionableGuard.reset(sessionId);
          } else if (abortLatch.shouldAbort(sessionId)) {
            try { cachedCtx?.abort?.(); } catch { /* idempotent */ }
          }
          // Observe-based retry: an assistant message_start that follows an
          // error message_end in the same turn (no user prompt between) is pi
          // re-attempting — emit auto_retry_start so the dashboard shows the
          // live retry sub-line. See change: simplify-error-retry-single-card.
          if (role !== "user") {
            const retrySynth = retryTracker.observeMessageStart(sessionId, messageRef as any);
            if (retrySynth) sendSyntheticRetryEvent(retrySynth.eventType, retrySynth.data);
          }
          if (role === "user") {
            // Per-entry shadow-queue drain matcher: mirror pi's internal
            // logic (`_processAgentEvent` in pi-coding-agent
            // agent-session.js). When pi delivers a queued user message,
            // find its text in `bridgeSteering` first then `bridgeFollowUp`,
            // remove the first occurrence, and emit a fresh `queue_update`.
            //
            // POST-rework-mid-turn-prompt-queue: the steer side is
            // unchanged — pi still owns steering. The follow-up side is
            // now reduced in scope: dashboard-buffered follow-ups never
            // reach pi via {deliverAs:"followUp"} (the drain loop ships
            // them as no-deliverAs fresh-turn sends, popped from the
            // buffer BEFORE the pi call). So this matcher will splice
            // bridgeFollowUp ONLY for:
            //   (a) TUI-queued follow-ups draining through pi's natural
            //       queue (text not in bridgeFollowUp → indexOf=-1 → no-op)
            //   (b) Any future code path that calls
            //       pi.sendUserMessage(_, {deliverAs:"followUp"}) directly
            //       (none exist in this codebase post-rework).
            // The follow-up matcher is therefore defense-in-depth; cost is
            // one indexOf per user message_start.
            //
            // See change: rework-mid-turn-prompt-queue (design.md D9, R7).
            const text = extractUserMessageText(messageRef);
            if (text) {
              const sIdx = bridgeSteering.indexOf(text);
              if (sIdx !== -1) {
                bridgeSteering.splice(sIdx, 1);
                emitQueueUpdate();
              } else {
                const fIdx = bridgeFollowUp.indexOf(text);
                if (fIdx !== -1) {
                  bridgeFollowUp.splice(fIdx, 1);
                  emitQueueUpdate();
                }
              }
            }
            setTimeout(() => {
              if (!isActive() || !sessionReady) return;
              connection.send(msg);
            }, 0);
          } else {
            connection.send(msg);
          }
          return;
        }
      }

      // For message_end: defer the SEND via setTimeout(0). Pi 0.69+ runs
      // sessionManager.appendMessage AFTER the awaited extension dispatcher
      // returns, so a queueMicrotask deferral is no longer enough. By the
      // time the macrotask fires, appendMessage has run, pi has mutated
      // event.message.id in place, and the wrapped appendMessage above has
      // populated idByMessage. We also stamp a nonce so a downstream
      // entry_persisted can correlate (covers user message_end where the
      // earlier message_start nonce is what the reducer is waiting on).
      // See change: fix-per-message-fork.
      if (eventType === "message_end") {
        wrapAppendMessageForCtx(ctx);
        const messageRef = (event as any).message;
        const nonce = messageRef && typeof messageRef === "object"
          ? (pendingNonces.get(messageRef as object) ?? nextNonce())
          : nextNonce();
        if (messageRef && typeof messageRef === "object" && !pendingNonces.has(messageRef as object)) {
          pendingNonces.set(messageRef as object, nonce);
        }
        // Apply markdown image inliner to assistant content. Mutates
        // event.message.content in place AND ships any new asset_register
        // messages immediately so they precede the deferred message_end
        // send below. See change: chat-markdown-local-images-and-math.
        maybeInlineAssistantImages(event);
        // Run the retry-tracker SYNCHRONOUSLY here, BEFORE the handler
        // returns, so any synthesized retry event lands on the wire BEFORE
        // the next `agent_end` (which pi fires synchronously back-to-back,
        // see pi-coding-agent agent-session.js:298–331). The message_end
        // body itself stays deferred for the entryId workaround
        // (`fix-per-message-fork`); that does not affect retry-state ordering
        // since the reducer's message_end arm does not touch
        // retryState/lastError.
        //
        // Observe-based: an error message_end records a pending failure and
        // emits NOTHING (the retry is confirmed only when pi starts a fresh
        // assistant message_start). A non-error message_end that closes an
        // in-flight chain emits auto_retry_end{success:true}. Billing/quota
        // failures flow through this same path — pi treats them as terminal,
        // so they settle via agent_end with no special-casing.
        // See change: simplify-error-retry-single-card.
        const synthetic = retryTracker.observeMessageEnd(sessionId, messageRef as any);
        if (synthetic) {
          sendSyntheticRetryEvent(synthetic.eventType, synthetic.data);
        }
        setTimeout(() => {
          if (!isActive() || !sessionReady) return;
          const entryId =
            (messageRef && typeof messageRef === "object" && typeof messageRef.id === "string" ? messageRef.id : undefined)
            ?? (messageRef ? idByMessage.get(messageRef as object) : undefined)
            ?? ctx.sessionManager?.getLeafId?.();
          const enriched = { ...event, entryId, nonce };
          const protoMsg = mapEventToProtocol(sessionId, enriched);
          connection.send(protoMsg);
        }, 0);
        return;
      }

      // Apply markdown image inliner to assistant message_update events.
      // For other event types this is a no-op (role check inside the helper).
      // See change: chat-markdown-local-images-and-math.
      if (eventType === "message_update") {
        maybeInlineAssistantImages(event);
      }

      // Inline path-referenced image tool results (e.g. browser `screenshot`)
      // as type:"image" content blocks at capture time. Gated to the artifact-
      // root allowlist (default agent-browser screenshot dir +
      // AGENT_BROWSER_SCREENSHOT_DIR) so arbitrary tool-echoed paths are not
      // read/disclosed. Over-cap / out-of-root / missing / non-image paths are
      // left as text and fall back to the artifact route.
      // See change: inline-agent-screenshot-artifacts.
      if (eventType === "tool_execution_end") {
        try {
          const artifactRoots = resolveArtifactRoots({
            homedir: os.homedir(),
            env: process.env,
            realpathSync: fs.realpathSync,
          });
          const inlined = inlineToolResultImages((event as any).result, {
            readFile: inlinerReadFile,
            isAllowedPath: (p) => isUnderArtifactRoot(p, artifactRoots, fs.realpathSync),
          });
          // Apply when a new image was inlined OR when the inliner rewrote the
          // result (e.g. stripped a redundant path whose image the result
          // already carried natively). The inliner returns the SAME reference
          // when nothing changed, so an identity diff is a safe change signal.
          if (inlined.result !== (event as any).result) {
            (event as any).result = inlined.result;
          }
        } catch (err) {
          console.error("[dashboard] tool-result image inline failed:", err);
        }
        // Forward the tool result's structured `details` to the client. pi's
        // live tool_execution_end extension event exposes the full ToolResult
        // ({ content, details }) on `event.result`, but only `result` is
        // otherwise surfaced — the reducer reads a top-level `data.details`
        // (the same field the replay path synthesizes from the persisted
        // entry). Lift `result.details` to the event so renderers (e.g. the
        // flow_agents list card) get a non-truncated structured payload LIVE,
        // not only after a replay/refresh. No-op when result carries no
        // details or already has a top-level details.
        // See change: flow-agents-readable-list.
        try {
          const r = (event as any).result;
          if (
            !(event as any).details &&
            r && typeof r === "object" && !Array.isArray(r) &&
            (r as any).details && typeof (r as any).details === "object"
          ) {
            (event as any).details = (r as any).details;
          }
        } catch { /* non-fatal */ }
      }

      const msg = mapEventToProtocol(sessionId, event);
      connection.send(msg);
    }));
  }

  // Pass-through events: forward with no enrichment
  for (const eventType of passThroughEventTypes) {
    pi.on(eventType as any, safe(async (event: any, ctx: any) => {
      if (!isActive()) return;
      cachedCtx = ctx;
      if (!sessionReady) return;
      const msg = mapEventToProtocol(sessionId, event);
      connection.send(msg);
    }));
  }

  // Per-turn system-prompt injector: splice dashboard session context
  // (sessionId, cwd, attached OpenSpec change) into the system prompt. Reads
  // live state via syncBc each turn; isActive guards against /reload stacking.
  // Coexists with the pass-through before_agent_start forwarder above (pi
  // chains { systemPrompt } results). See change: inject-session-context-into-agent.
  registerDashboardContextInjector(
    pi,
    () => ({ sessionId, attachedChange }),
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
    connection.send({
      type: "event_forward",
      sessionId,
      event: { eventType, timestamp: Date.now(), data },
    });
  }

  // Flush subagent frames buffered while the bridge was not ready (D1). Called
  // right after `sessionReady` flips true on (re-)register, in emission order.
  // See change: fix-subagent-live-detail-reliability.
  function flushPendingSubagentFrames(): void {
    const drained = subagentFrameBuffer.drain();
    if (drained.length === 0) return;
    for (const { channel, data } of drained) {
      try { sendEventForward(channel, data); } catch { /* keep flushing */ }
    }
    console.log(
      `[dashboard] flushed ${drained.length} buffered subagent frame(s) on re-register` +
        ` (forwarded=${subagentFrameBuffer.stats.forwarded} buffered=${subagentFrameBuffer.stats.buffered}` +
        ` flushed=${subagentFrameBuffer.stats.flushed})`,
    );
  }

  // EventBus catch-all: intercept pi.events.emit to forward all EventBus
  // traffic (flow events, subagent events, custom extension events).
  // Known channels get renamed via EVENT_BUS_MAP; unknown channels use the
  // channel name directly as the eventType.
  let origEventsEmit: ((channel: string, data: unknown) => void) | undefined;
  if (pi.events) {
    origEventsEmit = pi.events.emit.bind(pi.events);
    pi.events.emit = (channel: string, data: unknown) => {
      try {
        const eventData = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
        if (SubagentFrameBuffer.isSubagentChannel(channel)) {
          // Subagent frames are reconcilable state, not fire-and-forget. Forward
          // live only when the session is ready AND the transport is actually
          // open; otherwise buffer the latest frame per agent (latest-wins,
          // bounded) instead of letting it fall into the shared FIFO ring.
          // `sessionReady` stays true across a transient WS drop, so gating on
          // `connection.isConnected` routes reconnect-window frames into the
          // per-agent buffer (flushed on session_start AND onReconnect) rather
          // than risking eviction from the shared ring.
          // See change: fix-subagent-live-detail-reliability (D1/D2).
          if (sessionReady && isActive() && connection.isConnected) {
            sendEventForward(channel, eventData);
            subagentFrameBuffer.markForwarded(channel, eventData);
          } else if (!subagentFrameBuffer.buffer(channel, eventData)) {
            console.warn(
              `[dashboard] subagent frame dropped (no agentId) channel=${channel} while not ready`,
            );
          }
        } else if (sessionReady && isActive()) {
          sendEventForward(channel, eventData);
        }
      } catch { /* forwarding failure must never break the original emit */ }
      origEventsEmit!(channel, data);
    };
  }

  pi.on("session_start", safe(async (_event: any, ctx: any) => {

    // Bail out if a newer bridge instance has taken over
    if (!isActive()) return;
    const newSessionId = ctx.sessionManager.getSessionId();

    // On session switch/fork (0.65.0+: event.reason replaces session_switch/session_fork events),
    // unregister the old session before re-registering the new one.
    const reason = _event?.reason;
    if ((reason === "new" || reason === "fork" || reason === "resume") && sessionId && sessionId !== newSessionId) {
      // Clear any latched abort for the OUTGOING session id. Otherwise a
      // latched old session that is resumed later would have its first
      // legitimate turn aborted by the agent_start/message_start latch hooks.
      // See change: unify-error-retry-lifecycle.
      abortLatch.clear(sessionId);
      handleSessionChange(ctx);
    }

    cachedHasUI = ctx.hasUI;
    cachedCtx = ctx;
    sessionId = newSessionId;

    // Wrap sessionManager.appendMessage so that future message_end events can
    // recover the just-generated entry id, even when their setTimeout(0)
    // fires before pi has finished mutating event.message in place. The
    // helper is idempotent and re-wraps on session replacement.
    // See change: fix-per-message-fork.
    appendMessageWrapped = false;
    lastWrappedSm = null;
    wrapAppendMessageForCtx(ctx);

    // Register ask_user at runtime (not at load time) to avoid static
    // tool-name conflicts with other extensions like pi-flows.
    registerAskUserTool(pi);

    // Register the agent-facing role/model tools (list_models, list_roles,
    // update_roles). list_models reads the in-process session registry via a
    // live getter so its refs match the human Model Selector exactly.
    // See change: add-agent-role-model-tools.
    registerRoleModelTools(pi, { getRegistry: () => cachedModelRegistry });

    // Extract session file/dir early — needed for source detection and UI proxy
    const sessionFile = ctx.sessionManager.getSessionFile?.() ?? undefined;
    const sessionDir = ctx.sessionManager.getSessionDir?.() ?? undefined;
    lastSessionFile = sessionFile;
    lastSessionDir = sessionDir;

    // ── PromptBus setup ──
    // Create bus with dashboard connection wiring.
    // Replaces the old ui-proxy race pattern.
    // Convert seconds → milliseconds for PromptBus.
    // Values <= 0 (e.g. -1) are passed through as-is to signal infinite wait.
    const askUserTimeoutMs = config.askUserPromptTimeoutSeconds > 0
      ? config.askUserPromptTimeoutSeconds * 1000
      : -1;
    promptBus = new PromptBus({
      timeoutMs: askUserTimeoutMs,
      onDashboardRequest: (prompt, component, placement) => {
        connection.send({
          type: "prompt_request" as any,
          sessionId,
          promptId: prompt.id,
          prompt: {
            question: prompt.question,
            type: prompt.type,
            options: prompt.options,
            defaultValue: prompt.defaultValue,
            pipeline: prompt.pipeline,
            metadata: prompt.metadata,
          },
          component,
          placement,
        });
      },
      onDashboardDismiss: (id) => {
        connection.send({ type: "prompt_dismiss" as any, sessionId, promptId: id });
      },
      onDashboardCancel: (id) => {
        connection.send({ type: "prompt_cancel" as any, sessionId, promptId: id });
      },
    });

    // Register built-in default adapter (always present, works without pi-flows)
    promptBus.registerAdapter(new DashboardDefaultAdapter());

    // Capture original ctx.ui method references BEFORE patching
    const originalNotify = ctx.ui.notify?.bind(ctx.ui);
    const originals = {
      select: ctx.ui.select?.bind(ctx.ui) as ((q: string, opts: string[], extra?: any) => Promise<string | undefined>) | undefined,
      input: ctx.ui.input?.bind(ctx.ui) as ((q: string, placeholder?: string, extra?: any) => Promise<string | undefined>) | undefined,
      confirm: ctx.ui.confirm?.bind(ctx.ui) as ((q: string, msg: string, extra?: any) => Promise<boolean>) | undefined,
      editor: ctx.ui.editor?.bind(ctx.ui) as ((q: string, prefill?: string, extra?: any) => Promise<string | undefined>) | undefined,
      // NOTE: the `custom` field is intentionally NOT captured here. A
      // previous change (fix-multiselect-auto-cancel-on-dashboard) added a
      // TUI multiselect arm that awaited the original ctx.ui.custom binding,
      // but pi 0.70's RPC mode defines that primitive as a no-op (returns
      // undefined synchronously), causing the TUI adapter to auto-cancel the
      // dashboard-rendered dialog within one event-loop tick. The arm has
      // been removed; see change fix-multiselect-tui-arm-self-cancel for full
      // rationale. A repo lint (no-tui-multiselect-arm-regression.test.ts)
      // prevents reintroduction by banning the co-occurrence of two
      // substrings (the captured original binding and the TUI arm match).
    };

    // Register TUI adapter — presents prompts in the terminal using original
    // (unpatched) ctx.ui methods. Must be registered BEFORE patching ctx.ui.
    if (ctx.hasUI) {
      const activeControllers = new Map<string, AbortController>();
      const bus = promptBus;

      bus.registerAdapter({
        name: "tui",

        onRequest(prompt: any) {
          const ac = new AbortController();
          activeControllers.set(prompt.id, ac);

          const present = async () => {
            try {
              let answer: string | boolean | undefined;

              if (prompt.type === "select" && prompt.options && originals.select) {
                answer = await originals.select(prompt.question, prompt.options, { signal: ac.signal });
              } else if (prompt.type === "input" && originals.input) {
                answer = await originals.input(prompt.question, prompt.defaultValue || "", { signal: ac.signal });
              } else if (prompt.type === "confirm" && originals.confirm) {
                answer = await originals.confirm(prompt.question, "", { signal: ac.signal });
              } else if (prompt.type === "editor" && originals.editor) {
                answer = await originals.editor(prompt.question, prompt.defaultValue || "", { signal: ac.signal });
              } else {
                // NOTE: there is intentionally no `else if` arm for the
                // multiselect prompt type here. See change
                // fix-multiselect-tui-arm-self-cancel — pi 0.70 RPC mode's
                // ctx.ui.custom primitive is a no-op, so any TUI arm that
                // awaits it auto-cancels the dashboard-rendered dialog. The
                // bus-routed ctx.ui.multiselect patch below + the
                // DashboardDefaultAdapter handle multiselect end-to-end.
                return;
              }

              if (!ac.signal.aborted) {
                const answerStr = typeof answer === "boolean" ? (answer ? "true" : "false") : answer;
                bus.respond({
                  id: prompt.id,
                  answer: answerStr ?? undefined,
                  cancelled: answerStr == null,
                  source: "tui",
                });
              }
            } catch {
              if (!ac.signal.aborted) {
                bus.respond({ id: prompt.id, cancelled: true, source: "tui" });
              }
            } finally {
              activeControllers.delete(prompt.id);
            }
          };

          present();
          return {}; // Claim without component (TUI-only)
        },

        onResponse(response: any) {
          if (response.source !== "tui") {
            const ac = activeControllers.get(response.id);
            if (ac) {
              ac.abort();
              activeControllers.delete(response.id);
            }
          }
        },

        onCancel(id: string) {
          const ac = activeControllers.get(id);
          if (ac) {
            ac.abort();
            activeControllers.delete(id);
          }
        },
      });
    }

    // Replace ctx.ui dialog methods with PromptBus wrappers.
    // All extension commands that call ctx.ui.select/input/confirm/editor
    // now route through the bus, which distributes to all registered adapters.
    {
      const bus = promptBus;
      // Build a `metadata` envelope for bus.request that includes both
      // `message` (existing) and `toolCallId` (new — added by change
      // `fix-interactive-ui-reorder` so the client reducer can pair the
      // resulting interactiveUi row with its parent toolResult row).
      // Free-floating callers (slash commands, architect prompts) omit
      // `opts.toolCallId` and the metadata field stays undefined.
      const buildMeta = (
        opts: any,
        explicitMessage?: string,
      ): Record<string, unknown> | undefined => {
        const message = explicitMessage ?? opts?.message;
        const toolCallId = opts?.toolCallId;
        if (!message && !toolCallId) return undefined;
        const meta: Record<string, unknown> = {};
        if (message) meta.message = message;
        if (toolCallId) meta.toolCallId = toolCallId;
        return meta;
      };

      (ctx.ui as any).select = (title: string, options: string[], opts?: any) =>
        bus.request({ pipeline: "command", type: "select", question: title, options, metadata: buildMeta(opts) })
          .then(r => r.cancelled ? undefined : r.answer);

      (ctx.ui as any).input = (title: string, placeholder?: string, opts?: any) =>
        bus.request({ pipeline: "command", type: "input", question: title, defaultValue: placeholder, metadata: buildMeta(opts) })
          .then(r => r.cancelled ? undefined : r.answer);

      // Persist pasted images for an ask_user input answer to disk + emit one
      // asset_register per new hash (dashboard thumbnail). Returns absolute
      // paths the LLM can Read. Drops over per-image / cumulative caps.
      // Closes over sessionId, connection, getEmittedAssetHashes (all in
      // scope here). See change: add-ask-user-input-multiline-paste.
      const persistAnswerImages = (
        images: ImageContent[],
      ): Array<{ path: string; mimeType: string; bytes: number }> => {
        const out: Array<{ path: string; mimeType: string; bytes: number }> = [];
        const emitted = getEmittedAssetHashes(sessionId);
        let cumulative = 0;
        for (const image of images) {
          const persisted = persistAttachment({ sessionId, image });
          if (!persisted) continue;
          if (cumulative + persisted.bytes > ATTACH_MAX_PER_MESSAGE_BYTES) {
            console.warn(`[bridge] ask_user image over cumulative cap dropped (${persisted.hash})`);
            continue;
          }
          cumulative += persisted.bytes;
          if (!emitted.has(persisted.hash)) {
            emitted.add(persisted.hash);
            connection.send({
              type: "asset_register",
              sessionId,
              hash: persisted.hash,
              mimeType: persisted.mimeType,
              data: image.data,
            });
          }
          out.push({ path: persisted.path, mimeType: persisted.mimeType, bytes: persisted.bytes });
        }
        return out;
      };

      // ctx.ui.inputWithImages is NOT a built-in pi method. The ask_user tool
      // calls it for method:"input" so pasted images survive (ctx.ui.input
      // decodes to a bare string, dropping PromptResponse.images). Resolves
      // to: undefined (cancel) | string (no images) | {value, attachments}
      // (images). See change: add-ask-user-input-multiline-paste, design.md
      // Decision 1.
      (ctx.ui as any).inputWithImages = (title: string, placeholder?: string, opts?: any) =>
        bus.request({ pipeline: "command", type: "input", question: title, defaultValue: placeholder, metadata: buildMeta(opts) })
          .then(r => {
            if (r.cancelled) return undefined;
            const atts = r.images?.length ? persistAnswerImages(r.images) : [];
            return atts.length ? { value: r.answer ?? "", attachments: atts } : (r.answer ?? "");
          });

      (ctx.ui as any).confirm = (title: string, message?: string, opts?: any) =>
        bus.request({ pipeline: "command", type: "confirm", question: title, metadata: buildMeta(opts, message) })
          .then(r => !r.cancelled && r.answer === "true");

      (ctx.ui as any).editor = (title: string, prefill?: string, opts?: any) =>
        bus.request({ pipeline: "command", type: "editor", question: title, defaultValue: prefill, metadata: buildMeta(opts) })
          .then(r => r.cancelled ? undefined : r.answer);

      // ── Multiselect ──────────────────────────────────────────────
      // ctx.ui.multiselect is NOT a built-in pi method — we attach it here
      // so that polyfillMultiselect (and any other consumer) routes through
      // PromptBus. The dashboard adapter renders a real browser dialog via
      // MultiselectRenderer; there is intentionally no TUI adapter arm for
      // multiselect (pi 0.70 RPC mode's ctx.ui.custom is a no-op, so any TUI
      // arm would auto-cancel the dashboard render in <1s). See changes
      // fix-multiselect-auto-cancel-on-dashboard (initial bus routing) and
      // fix-multiselect-tui-arm-self-cancel (TUI arm removal).
      if (typeof (ctx.ui as any).multiselect === "function") {
        // Defensive: future upstream pi may add a built-in multiselect.
        // Override is intentional — the bus-routed version is what
        // participates in PromptBus first-response-wins semantics.
        // eslint-disable-next-line no-console
        console.warn("[bridge] ctx.ui.multiselect already exists — overriding for PromptBus routing");
      }
      (ctx.ui as any).multiselect = (title: string, options: string[], opts?: any) =>
        bus.request({
          pipeline: "command",
          type: "multiselect",
          question: title,
          options,
          metadata: opts?.message ? { message: opts.message } : undefined,
        }).then(decodeMultiselectAnswer);

      // ── Batch ────────────────────────────────────────────────────
      // ctx.ui.batch is NOT a built-in pi method. The ask_user tool calls it
      // to dispatch a multi-question batch as ONE bus request carrying
      // `questions[]` in metadata; the dashboard renders a BatchRenderer
      // wizard and returns one `{answers}` response (JSON-encoded in the bus
      // `answer` string). Resolves to BatchAnswer[] on submit, or undefined on
      // cancel. See change: redesign-ask-user-question-cards.
      (ctx.ui as any).batch = (title: string, questions: unknown[], opts?: any) =>
        bus.request({
          pipeline: "command",
          type: "batch",
          question: title,
          metadata: { ...(buildMeta(opts) ?? {}), questions },
        }).then((r) => {
          if (r.cancelled || r.answer == null) return undefined;
          try {
            const parsed = JSON.parse(r.answer);
            if (!Array.isArray(parsed)) return undefined;
            // Persist any input-step images and rewrite that answer to
            // {value, attachments}, dropping the raw base64 `images`.
            // See change: add-ask-user-input-multiline-paste.
            return parsed.map((a: any) => {
              if (a && typeof a === "object" && Array.isArray(a.images) && a.images.length) {
                const atts = persistAnswerImages(a.images);
                const { images: _drop, ...rest } = a;
                return atts.length ? { ...rest, attachments: atts } : rest;
              }
              return a;
            });
          } catch {
            return undefined;
          }
        });

      // Notify is fire-and-forget: call original + forward to dashboard
      (ctx.ui as any).notify = (message: string, level?: string) => {
        originalNotify?.(message, level);
        connection.send({
          type: "prompt_request" as any,
          sessionId,
          promptId: crypto.randomUUID(),
          prompt: { question: message, type: "notify" },
          component: { type: "notify", props: { message, level } },
          placement: "inline",
        });
      };
    }

    // Flip ctx.hasUI=true now that ctx.ui.* has been patched to route
    // through PromptBus → dashboard. `cachedHasUI` (captured earlier at
    // line ~1287) retains the pi-supplied original value, so
    // `detectSessionSource` continues to classify dashboard-spawned RPC
    // vs tmux correctly. Extensions that branch on `ctx.hasUI`
    // (context-mode `/ctx-stats` / `/ctx-doctor`, pi-agent-browser auto-install)
    // now take their UI-present branch and render output via the proxied
    // `ctx.ui.notify`. See change: fix-bridge-hasui-for-headless-rpc.
    flipHasUI(ctx);

    // Listen for adapter registrations from other extensions (e.g. pi-flows)
    if (pi.events) {
      pi.events.on("prompt:register-adapter", (adapter: any) => {
        if (promptBus && adapter && typeof adapter.name === "string") {
          promptBus.registerAdapter(adapter);
          // Inject respond/cancel functions so cross-package adapters can talk back
          if (typeof adapter.setRespond === "function") {
            adapter.setRespond((response: any) => promptBus!.respond(response));
          }
          if (typeof adapter.setCancel === "function") {
            adapter.setCancel((id: string) => promptBus!.cancel(id));
          }
        }
      });

      // Expose bus request function for pi-flows to use via emitPromptAndAwait
      pi.events.emit("prompt:set-bus-request", {
        request: (options: any) => promptBus!.request(options),
      });

      // Generic system-follow-up channel: any plugin bridge entry can request
      // a system-originated continuation through the single drain path by
      // emitting `dashboard:enqueue-followup`. Inert when no plugin emits it.
      // See change: add-goal-continuation-plugin (Decision 2).
      pi.events.on("dashboard:enqueue-followup", (payload: any) => {
        if (payload && typeof payload.text === "string") {
          enqueueSystemFollowup(payload.text);
        }
      });

      // Generic plugin bridge→server channel: a plugin bridge entry emits
      // `dashboard:plugin-message` and the main bridge wraps it in a
      // `plugin_pi_message` envelope over the extension WS. The server
      // dispatches to handlers registered via
      // `ServerPluginContext.registerPiHandler(messageType, handler)`.
      // See change: add-goal-continuation-plugin.
      pi.events.on("dashboard:plugin-message", (payload: any) => {
        if (
          payload &&
          typeof payload.pluginId === "string" &&
          typeof payload.messageType === "string"
        ) {
          connection.send({
            type: "plugin_pi_message",
            sessionId,
            pluginId: payload.pluginId,
            messageType: payload.messageType,
            payload: payload.payload ?? null,
          });
        }
      });
    }

    // Connect first, then auto-start if needed.
    // session_register must be buffered before any event_forward messages.
    connection.connect();

    // Extract first message (sessionFile/sessionDir already extracted above)
    const firstMessage = extractFirstMessage(ctx);
    lastFirstMessage = firstMessage;

    // Register session with initial model/thinkingLevel
    lastSessionName = pi.getSessionName() ?? "";
    const initialModel = getCurrentModelString(syncBc());
    const initialThinkingLevel = (pi as any).getThinkingLevel?.() ?? undefined;
    lastModel = initialModel;
    lastThinkingLevel = initialThinkingLevel;

    // Include eventCount so server can skip event wipe on reconnect
    let eventCount: number | undefined;
    try {
      const entries = ctx.sessionManager?.getBranch?.();
      if (entries) eventCount = entries.length;
    } catch { /* ignore */ }

    // See change: fix-dashboard-source-mislabelling — sent on every
    // register so server can re-stamp source after restart. Derived from the
    // capture-once boolean (token may already be scrubbed). See change:
    // fix-spawn-token-env-leak.
    connection.send({
      type: "session_register",
      sessionId,
      cwd: ctx.cwd,
      name: lastSessionName || undefined,
      source: detectSessionSource(cachedHasUI, sessionFile),
      model: initialModel,
      thinkingLevel: initialThinkingLevel,
      sessionFile,
      sessionDir,
      firstMessage,
      eventCount,
      ...(dashboardSpawned ? { dashboardSpawned: true } : {}),
      // Tri-state git-repo signal, computed at register time (authority).
      // See change: gate-session-worktree-button-on-git.
      isGitRepo: detectIsGitRepo(ctx.cwd),
      // Fact-forwarding: server decides auto-hide. See change:
      // auto-hide-headless-worker-sessions.
      ...buildVisibilityRegisterFields(cachedHasUI, process.env),
    });

    // Allow event forwarding now that session_register is buffered
    sessionReady = true;

    // Flush any subagent frames buffered during the not-ready window (D1) so a
    // reconnect/discovery/reload gap self-heals instead of leaving a running
    // subagent's detail empty. See change: fix-subagent-live-detail-reliability.
    flushPendingSubagentFrames();

    // Replay full session history so the dashboard has all messages
    replaySessionEntries();
    connection.send({ type: "replay_complete", sessionId });
    // If agent is mid-turn (e.g. reload during streaming), send synthetic agent_start
    if (getBridgeState().isAgentStreaming) {
      connection.send(mapEventToProtocol(sessionId, { type: "agent_start" }));
    }

    // Send initial commands list
    const commands = filterHiddenCommands(pi.getCommands());
    connection.send({
      type: "commands_list",
      sessionId,
      commands,
    });

    // Send initial flows list
    sendFlowsList();

    // Send available models
    cachedModelRegistry = (ctx as any).modelRegistry;
    if (cachedModelRegistry) {
      try {
        const models = cachedModelRegistry.getAvailable().map(toModelInfo);
        connection.send({ type: "models_list", sessionId, models });
        // See change: replace-hardcoded-provider-lists.
        connection.send({ type: "providers_list", sessionId, providers: buildProviderCatalogue() });
      } catch { /* modelRegistry not available */ }
    }

    // Apply default model only on brand-new sessions (no prior message history).
    // Resume (--session) and fork (--fork) both load parent messages, so messageCount > 0
    // and we keep their existing model. Mirrors pi's own !hasExistingSession gate
    // (sdk.js:106 — `existingSession.messages.length > 0`). NOT the raw getEntries()
    // count: pi's sdk.js auto-appends model_change + thinking_level_change setup
    // entries to a brand-new session BEFORE emitting session_start, so getEntries()
    // is ≥ 2 even for a session with no user history. Only message entries count.
    // See changes: fix-resume-keeps-session-model, fix-default-model-new-session-entry-count.
    const entryCount = ctx.sessionManager.buildSessionContext?.()?.messages?.length ?? 0;
    const freshConfig = loadConfig();
    if (shouldApplyDefaultModel({
      reason: _event?.reason,
      entryCount,
      hasModelRegistry: Boolean(cachedModelRegistry),
      hasDefaultModel: Boolean(freshConfig.defaultModel),
    })) {
      pendingDefaultModel = applyDefaultModel();
    }

    // Send initial roles
    if (pi.events) {
      const rolesData: any = {};
      pi.events.emit("roles:get-all", rolesData);
      if (rolesData.roles) {
        connection.send({
          type: "roles_list",
          sessionId,
          roles: rolesData.roles ?? {},
          presets: rolesData.presets ?? [],
          activePreset: rolesData.activePreset ?? null,
          builtinRoleNames: rolesData.builtinRoleNames ?? [],
        });
      }
    }

    // Discover or auto-start server (non-blocking — connection will reconnect)
    //
    // When a real launchServer() is about to run (not on mDNS/health-check
    // paths), mount an animated TUI widget above the editor using pi-tui's
    // Loader (a real Component, self-animating at 80ms, like pi-flows'
    // architect-widget). The previous implementation used
    // ctx.ui.setStatus(...) which only writes a footer string and relies on
    // the TUI render loop being ticked elsewhere — on the cold-start path
    // nothing else requests renders, so the spinner never animated and often
    // never appeared. setWidget(key, factory, {placement:"aboveEditor"}) gives
    // us a managed component that owns its own render loop and is always
    // visible while the launch is in flight.
    let spinnerTimer: NodeJS.Timeout | null = null;
    let spinnerStart = 0;
    let activeLoader: Loader | null = null;
    const stopSpinner = () => {
      if (spinnerTimer) {
        clearInterval(spinnerTimer);
        spinnerTimer = null;
      }
      activeLoader = null;
      ctx.ui.setWidget("pi-dashboard-launch", undefined);
    };
    autoStartServer(config, {
      discoverDashboard,
      isDashboardRunning,
      launchServer,
      notify: (msg, level) => ctx.ui.notify(msg, level),
      onLaunchStart: () => {
        spinnerStart = Date.now();
        const buildMessage = () => {
          const elapsed = Math.floor((Date.now() - spinnerStart) / 1000);
          return `starting dashboard server … (${elapsed}s)`;
        };
        ctx.ui.setWidget(
          "pi-dashboard-launch",
          (tui: unknown, theme: { fg: (role: string, s: string) => string }) => {
            const loader = new Loader(
              tui as ConstructorParameters<typeof Loader>[0],
              (s: string) => theme.fg("accent", s),
              (s: string) => theme.fg("muted", s),
              buildMessage(),
            );
            activeLoader = loader;
            // Loader has stop() but no dispose(); wire dispose so that
            // setExtensionWidget's teardown stops the 80ms animation interval.
            (loader as Loader & { dispose?: () => void }).dispose = () => loader.stop();
            return loader;
          },
          { placement: "aboveEditor" },
        );
        // Refresh the elapsed-seconds label every second. Frame animation is
        // driven by the Loader's own 80ms interval.
        spinnerTimer = setInterval(() => {
          activeLoader?.setMessage(buildMessage());
        }, 1000);
      },
      onLaunchEnd: () => {
        stopSpinner();
      },
      // Register the spawned dashboard-server PID into `selfSpawnedPgids`
      // synchronously, before the next 5 s process-scan tick. Keeps the
      // dashboard's own `node` infrastructure out of the session-card
      // process list. See change: tighten-process-list-ux.
      onServerSpawned: (childPid: number) => {
        selfSpawnedPgids.add(childPid);
      },
      // Honor the server's `server_restarting` quiesce window. While a
      // deliberate restart/shutdown is in flight, skip the spawn step so we
      // don't race the orchestrator. Discovery + reconnection still run.
      // See change: fix-restart-bridge-auto-start-race.
      shouldSuppressAutoStart: () => connection.shouldSuppressAutoStart(),
    }).then((result) => {
      stopSpinner(); // safety net — covers onLaunchEnd not firing
      if (result.server && result.server.piPort !== config.piPort) {
        // Server found on a different piPort than configured — update connection URL
        connection.updateUrl(`ws://${result.server.host === 'localhost' ? 'localhost' : result.server.host}:${result.server.piPort}`);
      }
    }).catch(() => { stopSpinner(); });

    // Send initial git info + the session's pi version
    sendGitInfoIfChanged(ctx.cwd);
    sendCwdMissingIfChanged(ctx.cwd);
    sendPiVersionIfChanged();

    // Start metrics monitor and heartbeat
    startMetricsMonitor();
    heartbeatTimer = setInterval(() => {
      if (!isActive()) return;
      connection.send({
        type: "session_heartbeat",
        sessionId,
        // Fold the bridge→server ring-buffer eviction count into the heartbeat
        // so it reaches `/api/health`. See change:
        // fix-stuck-tool-card-on-dropped-event.
        metrics: { ...collectMetrics(), droppedBufferedFrames: connection.getDroppedBufferedCount() },
      });
    }, HEARTBEAT_INTERVAL);
    getBridgeState().timers!.push(heartbeatTimer);

    // Start git + name/model polling
    startGitPollTimer(ctx);

    // Start process scanner (detect stalled child processes)
    // Captures new child PGIDs during active bash calls, then checks tracked PGIDs
    processScanTimer = setInterval(() => {
      if (!isActive()) return;
      const processes = scanChildProcesses(
        process.pid,
        trackedPgids,
        PROCESS_MIN_ELAPSED_MS,
        { excludedPgids: selfSpawnedPgids },
      );
      const currentPids = JSON.stringify(processes.map((p) => p.pid).sort());
      if (currentPids !== previousProcessPids) {
        previousProcessPids = currentPids;
        connection.send({
          type: "process_list",
          sessionId,
          processes: processes.map((p) => ({ pid: p.pid, pgid: p.pgid, command: p.command, elapsedMs: p.elapsedMs })),
        });
      }
    }, PROCESS_SCAN_INTERVAL);
    getBridgeState().timers!.push(processScanTimer);

    // Register flow event listeners (pi-flows emits these via pi.events)
    registerFlowEventListeners(syncBc(), () => sessionReady, getFlowsList);

    // Extension UI System (Phase 1): subscribe to invalidate once per
    // session, then run the discovery probe. The probe is synchronous
    // and re-runs on every reconnect (see `onReconnect` callback above).
    // See change: add-extension-ui-modal.
    subscribeUiInvalidate(uiModulesBridgeCtx);
    refreshUiModules(uiModulesBridgeCtx);
  }));

  // Shared handler for session changes (new/fork/resume)
  function handleSessionChange(ctx: any) {
    // Clear attachedChange on a real session switch (new/fork/resume): it is
    // persisted globally + restored at activate, so without this the previous
    // session's attached change would leak into the new session's prompt until
    // the server replays. The server re-pushes the correct value for the new
    // sessionId on its session_register. See change: inject-session-context-into-agent.
    attachedChange = null;
    getBridgeState().attachedChange = null;
    // Drop retained subagent frames/snapshots on a real session switch — the
    // new/fork/resumed session's subagents are unrelated to the outgoing one.
    // See change: fix-subagent-live-detail-reliability.
    subagentFrameBuffer.reset();
    // Clear the stop-after-turn latch so a new/fork/resumed session does not
    // inherit the previous session's pending graceful-stop and shut down on
    // its first turn_end. See change: adopt-pi-071-072-073-features.
    getBridgeState().shouldStopAfterTurn = false;
    // Bridge shadow queues reset on session change so the new session
    // starts with empty chips. See change: add-followup-edit-and-steer-cancel.
    if (bridgeSteering.length > 0 || bridgeFollowUp.length > 0) {
      bridgeSteering = [];
      bridgeFollowUp = [];
      emitQueueUpdate();
    }
    const bc = syncBc();
    _handleSessionChange(bc, ctx, getFlowsList);
    applyBc(bc);

    // Restart polling timers
    startGitPollTimer(ctx);
  }

  // Single source of truth for the git + name/model poll loop. Both session
  // start and session change call this so the two timers can never drift.
  // Caches ctx.cwd (the throwing getter) and clears any prior timer first.
  function startGitPollTimer(ctx: any) {
    if (gitPollTimer) clearInterval(gitPollTimer);
    cachedCwd = ctx.cwd;
    gitPollTimer = setInterval(() => runGitPollTick({
      isActive,
      cachedCwd: () => cachedCwd,
      sendGitInfoIfChanged,
      sendCwdMissingIfChanged,
      sendSessionNameIfChanged,
      sendModelUpdateIfChanged,
      sendPiVersionIfChanged,
    }), GIT_POLL_INTERVAL);
    getBridgeState().timers!.push(gitPollTimer);
  }

  // session_switch and session_fork events removed in pi 0.65.0.
  // Now handled via session_start with event.reason ("new"|"fork"|"resume").

  pi.on("turn_end", safe(async (event: any, ctx: any) => {
    if (!isActive()) return;
    cachedCtx = ctx;
    if (!sessionReady) return;

    // Send firstMessage update after first turn if not previously sent
    if (!lastFirstMessage) {
      const firstMsg = extractFirstMessage(ctx);
      if (firstMsg) {
        lastFirstMessage = firstMsg;
        connection.send({
          type: "first_message_update",
          sessionId,
          firstMessage: firstMsg,
        });
      }
    }

  }));

  pi.on("session_shutdown", safe(async () => {
    if (!isActive()) return;
    getBridgeState().isAgentStreaming = false;
    stopMetricsMonitor();
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (gitPollTimer) {
      clearInterval(gitPollTimer);
      gitPollTimer = null;
    }
    connection.send({
      type: "session_unregister",
      sessionId,
    });

    // Drop retained subagent frames/snapshots on shutdown.
    // See change: fix-subagent-live-detail-reliability.
    subagentFrameBuffer.reset();

    // Best-effort: remove this session's pasted ask_user attachments.
    // See change: add-ask-user-input-multiline-paste.
    cleanupAttachmentsForSession(sessionId);

    // Give time for the unregister to send
    await new Promise((resolve) => setTimeout(resolve, 100));
    connection.disconnect();
  }));

  // Re-send models list when custom providers finish async discovery
  onProviderChanged(() => {
    if (!isActive()) return;
    if (cachedModelRegistry && sessionReady) {
      try {
        const models = cachedModelRegistry.getAvailable().map(toModelInfo);
        connection.send({ type: "models_list", sessionId, models });
        // See change: replace-hardcoded-provider-lists.
        connection.send({ type: "providers_list", sessionId, providers: buildProviderCatalogue() });
      } catch { /* ignore */ }

      // Retry pending default model — custom provider may now have its models
      if (pendingDefaultModel) {
        pendingDefaultModel = applyDefaultModel();
      }
    }
  });

  // Register cleanup for /reload — saves state to globalThis and tears down resources
  const state = getBridgeState();
  state.cleanup = () => {
    const s = getBridgeState();
    s.sessionId = sessionId;
    s.attachedChange = attachedChange;
    s.ctx = cachedCtx;
    s.modelRegistry = cachedModelRegistry;
    s.hasUI = cachedHasUI;
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (gitPollTimer) { clearInterval(gitPollTimer); gitPollTimer = null; }

    // Dev build & restart: rebuild client and stop server before reload
    if (config.devBuildOnReload) {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const packageRoot = path.resolve(__dirname, "..", "..");
      runDevBuild({ packageRoot, serverPort: config.port });
    }

    // Restore original pi.events.emit (EventBus catch-all cleanup)
    if (origEventsEmit && pi.events) {
      pi.events.emit = origEventsEmit;
    }
    connection.disconnect();
  };

  // Reload is handled by session_start which fires on /reload too
}
