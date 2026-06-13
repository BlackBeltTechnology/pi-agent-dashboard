/**
 * PI Dashboard Bridge Extension
 *
 * Global extension that connects to the dashboard server,
 * forwards all pi events, and relays commands back.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Loader } from "@earendil-works/pi-tui";
import { ConnectionManager } from "./connection.js";
import { detectSessionSource } from "./source-detector.js";
import { buildVisibilityRegisterFields } from "./visibility-intent.js";
import { mapEventToProtocol } from "./event-forwarder.js";
import { createCommandHandler } from "./command-handler.js";
import { shouldApplyDefaultModel } from "./bridge-default-model-gate.js";
import { RetryTracker } from "./retry-tracker.js";
import { UsageLimitOrderer } from "./usage-limit-orderer.js";
import { USAGE_LIMIT_PATTERN } from "@blackbelt-technology/pi-dashboard-shared/error-patterns.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, ensureConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { runDevBuild } from "./dev-build.js";
import { isDashboardRunning } from "@blackbelt-technology/pi-dashboard-shared/server-identity.js";
import { discoverDashboard } from "@blackbelt-technology/pi-dashboard-shared/mdns-discovery.js";
import { launchServer } from "./server-launcher.js";
import { autoStartServer } from "./server-auto-start.js";
import type { ServerToExtensionMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { expandPromptTemplateFromDisk } from "./prompt-expander.js";

import { PromptBus } from "./prompt-bus.js";
import { DashboardDefaultAdapter } from "./dashboard-default-adapter.js";
import { registerAskUserTool } from "./ask-user-tool.js";
import { decodeMultiselectAnswer } from "./multiselect-decode.js";
import { activate as activateProviderRegister, onProviderChanged, reloadProviders, buildProviderCatalogue, toModelInfo } from "./provider-register.js";
import { activate as activateRoleManager } from "./role-manager.js";
import type { FlowInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { startMetricsMonitor, stopMetricsMonitor, collectMetrics } from "./process-metrics.js";
import { scanChildProcesses, getOwnPgid } from "./process-scanner.js";
import type { BridgeContext } from "./bridge-context.js";
import { filterHiddenCommands, extractFirstMessage, getCurrentModelString } from "./bridge-context.js";
import { tryDispatchExtensionCommand } from "./slash-dispatch.js";
import { flipHasUI } from "./hasui-flip.js";
import { sendStateSync as _sendStateSync, replaySessionEntries as _replaySessionEntries, handleSessionChange as _handleSessionChange } from "./session-sync.js";
import { sendModelUpdateIfChanged as _sendModelUpdateIfChanged, sendSessionNameIfChanged as _sendSessionNameIfChanged, sendGitInfoIfChanged as _sendGitInfoIfChanged, sendJjStateIfChanged as _sendJjStateIfChanged, sendCwdMissingIfChanged as _sendCwdMissingIfChanged, resetReconnectCaches as _resetReconnectCaches } from "./model-tracker.js";
import { registerFlowEventListeners, FLOW_EVENT_MAP, SUBAGENT_EVENT_MAP } from "./flow-event-wiring.js";
import { refreshUiModules, subscribeUiInvalidate, handleUiManagement, type UiModulesBridgeCtx } from "./ui-modules.js";
import { inlineMessageText, type ReadFileOutcome } from "./markdown-image-inliner.js";
import type { ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  persistAttachment,
  cleanupAttachmentsForSession,
  MAX_PER_MESSAGE_BYTES as ATTACH_MAX_PER_MESSAGE_BYTES,
} from "./ask-user-attachments.js";

const HEARTBEAT_INTERVAL = 15_000;
const GIT_POLL_INTERVAL = 30_000;
// Platform-aware process scan cadence. Windows keeps the original 10 s /
// 30 s floor because `wmic` / PowerShell are expensive and flash consoles;
// Unix uses 5 s / 5 s so legitimate bash subprocesses surface while still
// running. See change: tighten-process-list-ux.
const PROCESS_SCAN_INTERVAL = process.platform === "win32" ? 10_000 : 5_000; // platform-branch-ok: top-level cadence tuning; Windows uses costly wmic/PowerShell
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

    // Activate role manager: registers `flow:role-*` handlers that back
    // Settings → Roles. Relocated from pi-flows per OpenSpec change
    // `adopt-model-resolve-handler-and-roles-ownership`.
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
  let sessionReady = false; // true after session_start has run
  let lastSessionFile: string | undefined;
  let lastSessionDir: string | undefined;
  let lastFirstMessage: string | undefined;
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
  let lastJjStateJson: string | undefined; // see change: add-jj-workspace-plugin
  let lastGitWorktreeJson: string | undefined; // see change: add-worktree-spawn-dialog
  let lastCwdMissing: boolean | undefined; // see change: add-worktree-lifecycle-actions
  let lastSessionName: string | undefined;
  let cachedHasUI: boolean | undefined = prev.hasUI;
  let cachedModelRegistry: any | undefined = prev.modelRegistry;
  let cachedCtx: any | undefined = prev.ctx;
  let lastModel: string | undefined;
  let lastThinkingLevel: string | undefined;
  let hasRegisteredOnce = false; // see change: reattach-move-to-front
  let promptBus: PromptBus | undefined;

  // Provider-retry synthesis trackers. pi's ExtensionAPI does not expose
  // `auto_retry_*` events, so the bridge synthesizes them from observed
  // `message_end` / `agent_end` events. See change: fix-provider-retry-infinite-loop.
  const retryTracker = new RetryTracker();
  const usageLimitOrderer = new UsageLimitOrderer();

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
      // Route flow management actions from dashboard buttons
      if (msg.type === "flow_management" && pi.events) {
        if (msg.action === "run") {
          pi.events.emit("flow:run", { flowName: msg.flowName, task: msg.task || undefined });
        } else if (msg.action === "new") {
          pi.events.emit("flows:new-request", { description: msg.description || "" });
        } else if (msg.action === "edit") {
          const editFlows = getFlowsList() as Array<{ name: string; source?: string }>;
          const editMatch = editFlows.find(f => f.name === msg.flowName);
          const resolvedPath = editMatch?.source || "";
          if (!resolvedPath) {
            console.error(`[dashboard] flow_management edit: could not resolve path for "${msg.flowName}" (${editFlows.length} flows)`);
          }
          pi.events.emit("flows:edit-request", { flowName: msg.flowName || "", flowPath: resolvedPath, modificationRequest: msg.description || "" });
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
        pi.events.emit("flow:role-set", data);
        if (data.success) {
          const rolesData: any = {};
          pi.events.emit("flow:role-get-all", rolesData);
          connection.send({
            type: "roles_list",
            sessionId,
            roles: rolesData.roles ?? {},
            presets: rolesData.presets ?? [],
            activePreset: rolesData.activePreset ?? null,
          });
        }
        return;
      }
      if (msg.type === "role_preset_load" && pi.events) {
        const data: any = { name: (msg as any).presetName };
        pi.events.emit("flow:role-preset-load", data);
        if (data.success) {
          const rolesData: any = {};
          pi.events.emit("flow:role-get-all", rolesData);
          connection.send({
            type: "roles_list",
            sessionId,
            roles: rolesData.roles ?? {},
            presets: rolesData.presets ?? [],
            activePreset: rolesData.activePreset ?? null,
          });
        }
        return;
      }
      if (msg.type === "role_preset_save" && pi.events) {
        const data: any = { name: (msg as any).presetName };
        pi.events.emit("flow:role-preset-save", data);
        if (data.success) {
          const rolesData: any = {};
          pi.events.emit("flow:role-get-all", rolesData);
          connection.send({
            type: "roles_list",
            sessionId,
            roles: rolesData.roles ?? {},
            presets: rolesData.presets ?? [],
            activePreset: rolesData.activePreset ?? null,
          });
        }
        return;
      }
      if (msg.type === "role_preset_delete" && pi.events) {
        const data: any = { name: (msg as any).presetName };
        pi.events.emit("flow:role-preset-delete", data);
        if (data.success) {
          const rolesData: any = {};
          pi.events.emit("flow:role-get-all", rolesData);
          connection.send({
            type: "roles_list",
            sessionId,
            roles: rolesData.roles ?? {},
            presets: rolesData.presets ?? [],
            activePreset: rolesData.activePreset ?? null,
          });
        }
        return;
      }
      if (msg.type === "request_roles" && pi.events) {
        const rolesData: any = {};
        pi.events.emit("flow:role-get-all", rolesData);
        connection.send({
          type: "roles_list",
          sessionId,
          roles: rolesData.roles ?? {},
          presets: rolesData.presets ?? [],
          activePreset: rolesData.activePreset ?? null,
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
      // See change: add-jj-workspace-plugin.
      const _bc = syncBc();
      _resetReconnectCaches(_bc);
      applyBc(_bc);
      sendStateSync();
      // Force-emit jj/git state for the active session’s cwd. The bridge
      // doesn't have direct ctx here, so we walk the active session.
      try {
        const activeId = (pi as any).getCurrentSessionId?.();
        const activeCtx = activeId ? (pi as any).getCtx?.(activeId) : (cachedCtx as any);
        if (activeCtx?.cwd) {
          sendGitInfoIfChanged(activeCtx.cwd);
          sendJjStateIfChanged(activeCtx.cwd);
          sendCwdMissingIfChanged(activeCtx.cwd);
        }
      } catch { /* probe failure non-fatal */ }
      replaySessionEntries();
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
      if (cachedCtx?.abort) {
        cachedCtx.abort();
      }
      // Clear retry attempt counter so a subsequent agent_end does not
      // double-emit auto_retry_end{success:true}. See change:
      // fix-provider-retry-infinite-loop.
      retryTracker.noteAbort(sessionId);
      // Intentionally NOT clearing usageLimitOrderer.noteRetryEnd here.
      // The orderer's `pending` flag MUST survive user-initiated abort
      // so pi's eventual terminal agent_end can still surface the real
      // provider errorMessage via the orderer's maybeSynthesize path.
      // Without this, the user would see no provider context after
      // pressing Stop on a rate-limit retry — the placeholder
      // "Aborted by user" used to overwrite the truth, both swallowing
      // the real error. See change:
      // unify-status-banner-and-terminal-limit-stop.
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
      if (handled) return;

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
      pi, connection, sessionId,
      cachedCtx, cachedModelRegistry, cachedHasUI,
      lastModel, lastThinkingLevel,
      lastSessionFile, lastSessionDir, lastFirstMessage,
      lastGitBranch, lastGitPrNumber, lastSessionName,
      lastJjStateJson,
      lastGitWorktreeJson,
      lastCwdMissing,
      hasRegisteredOnce,
      selfSpawnedPgids,
    };
  }
  /** Sync BridgeContext mutations back to local variables */
  function applyBc(bc: BridgeContext): void {
    sessionId = bc.sessionId;
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
    lastJjStateJson = bc.lastJjStateJson;
    lastGitWorktreeJson = bc.lastGitWorktreeJson;
    lastCwdMissing = bc.lastCwdMissing;
    hasRegisteredOnce = bc.hasRegisteredOnce;
  }

  // Local wrappers that sync bc around extracted module calls
  function sendStateSync() { const bc = syncBc(); _sendStateSync(bc, getFlowsList); applyBc(bc); }
  function replaySessionEntries() { _replaySessionEntries(syncBc()); }
  function sendModelUpdateIfChanged() { const bc = syncBc(); _sendModelUpdateIfChanged(bc); applyBc(bc); }
  function sendSessionNameIfChanged() { const bc = syncBc(); _sendSessionNameIfChanged(bc); applyBc(bc); }
  function sendGitInfoIfChanged(cwd: string) { const bc = syncBc(); _sendGitInfoIfChanged(bc, cwd); applyBc(bc); }
  function sendJjStateIfChanged(cwd: string) { const bc = syncBc(); _sendJjStateIfChanged(bc, cwd); applyBc(bc); }
  function sendCwdMissingIfChanged(cwd: string) { const bc = syncBc(); _sendCwdMissingIfChanged(bc, cwd); applyBc(bc); }

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
      if (eventType === "agent_start") getBridgeState().isAgentStreaming = true;
      if (eventType === "agent_end") {
        getBridgeState().isAgentStreaming = false;
        // Provider-retry synthesis: forward auto_retry_end BEFORE agent_end
        // when retries were in flight, so the dashboard's retry banner
        // clears before the error banner appears. The usage-limit orderer
        // takes precedence (it carries the actual error string); the retry
        // tracker handles the non-usage-limit case. See change:
        // fix-provider-retry-infinite-loop.
        const orderedSynth = usageLimitOrderer.maybeSynthesize(sessionId, (event as any));
        if (orderedSynth) {
          sendSyntheticRetryEvent(orderedSynth.eventType, orderedSynth.data);
          retryTracker.noteAbort(sessionId); // clear tracker; orderer's event is authoritative
        } else {
          // First-attempt terminal USAGE_LIMIT branch: when no retry chain
          // was in flight (RETRYABLE_PATTERN didn't match) but the terminal
          // agent_end carries a USAGE_LIMIT_PATTERN error, synthesize the
          // same auto_retry_end{finalError} the orderer would have produced.
          // Without this, first-attempt terminal billing errors surface as
          // the generic `error` banner variant instead of `limit-exceeded`.
          // Mutually exclusive with the orderer's synth above.
          // See change: unify-status-banner-and-terminal-limit-stop.
          const agentMessages = (event as any)?.messages;
          const lastMsg = Array.isArray(agentMessages) && agentMessages.length > 0
            ? agentMessages[agentMessages.length - 1] as Record<string, unknown>
            : undefined;
          const lastErr = typeof lastMsg?.errorMessage === "string" ? lastMsg.errorMessage : "";
          const isFirstAttemptTerminalLimit =
            lastMsg?.stopReason === "error" &&
            lastErr.length > 0 &&
            USAGE_LIMIT_PATTERN.test(lastErr);

          if (isFirstAttemptTerminalLimit) {
            sendSyntheticRetryEvent("auto_retry_end", {
              success: false,
              attempt: -1,
              finalError: lastErr,
            });
          } else {
            const trackerSynth = retryTracker.observeAgentEnd(sessionId, event as any);
            if (trackerSynth) {
              sendSyntheticRetryEvent(trackerSynth.eventType, trackerSynth.data);
            }
          }
        }
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

      }
      // For model_select, enrich the event data with thinkingLevel
      if (eventType === "model_select") {
        const enriched = { ...event, thinkingLevel: (pi as any).getThinkingLevel?.() };
        const msg = mapEventToProtocol(sessionId, enriched);
        connection.send(msg);
        return;
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
        // Run retry-tracker / usage-limit-orderer SYNCHRONOUSLY here, BEFORE
        // the handler returns. Both the state update AND the synth event
        // send must be sync so they land on the wire BEFORE the next
        // `agent_end` (which pi fires synchronously back-to-back, see
        // pi-coding-agent agent-session.js:298–331).
        //
        // Previously these ran inside the setTimeout(0) macrotask intended
        // for entryId capture, so `agent_end` was processed (and shipped)
        // BEFORE the synthesizers had marked the retry as in-flight —
        // leaving the dashboard's `retryState` stuck (yellow + red banners
        // both visible). The message_end body itself stays deferred for
        // the entryId workaround (`fix-per-message-fork`); it doesn't
        // affect retry-state ordering since the reducer's message_end arm
        // does not touch retryState/lastError.
        // See change: fix-retry-banner-stuck-on-limit-exceeded.
        // Terminal billing/quota auto-abort: if this message_end carries a
        // USAGE_LIMIT_PATTERN match, pi's retry sleep is pointless — the
        // error won't resolve regardless of how many times we retry. Call
        // cachedCtx.abort() to short-circuit pi's retry loop, then
        // synthesize an auto_retry_end{finalError:errorMessage} so the
        // dashboard routes straight to the limit-exceeded banner variant
        // carrying the real provider error. Skips the retry-tracker / orderer
        // pending-set path entirely — there is no retry chain to track.
        // See change: unify-status-banner-and-terminal-limit-stop.
        const msgRole = (messageRef as any)?.role;
        const msgStopReason = (messageRef as any)?.stopReason;
        const msgErrorMessage = typeof (messageRef as any)?.errorMessage === "string"
          ? (messageRef as any).errorMessage as string
          : "";
        const isTerminalLimit =
          msgRole === "assistant" &&
          msgStopReason === "error" &&
          msgErrorMessage.length > 0 &&
          USAGE_LIMIT_PATTERN.test(msgErrorMessage);

        if (isTerminalLimit) {
          try {
            cachedCtx?.abort?.();
          } catch (err) {
            console.warn("[dashboard] cachedCtx.abort threw during terminal-limit auto-abort:", err);
          }
          sendSyntheticRetryEvent("auto_retry_end", {
            success: false,
            attempt: -1,
            finalError: msgErrorMessage,
          });
          // Intentionally fall through to the deferred message_end body send
          // below; the message_end itself still goes on the wire (the
          // reducer's message_end arm doesn't touch retryState/lastError).
        } else {
          // Normal path: retry-tracker / orderer state updates SYNCHRONOUSLY,
          // before the handler returns. See change:
          // fix-retry-banner-stuck-on-limit-exceeded.
          const synthetic = retryTracker.observeMessageEnd(sessionId, messageRef as any);
          if (synthetic) {
            if (synthetic.eventType === "auto_retry_start") {
              usageLimitOrderer.noteRetryStart(sessionId);
            } else {
              usageLimitOrderer.noteRetryEnd(sessionId);
            }
            sendSyntheticRetryEvent(synthetic.eventType, synthetic.data);
          }
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

  // EventBus catch-all: intercept pi.events.emit to forward all EventBus
  // traffic (flow events, subagent events, custom extension events).
  // Known channels get renamed via EVENT_BUS_MAP; unknown channels use the
  // channel name directly as the eventType.
  let origEventsEmit: ((channel: string, data: unknown) => void) | undefined;
  if (pi.events) {
    origEventsEmit = pi.events.emit.bind(pi.events);
    pi.events.emit = (channel: string, data: unknown) => {
      if (sessionReady && isActive()) {
        try {
          const eventType = EVENT_BUS_MAP[channel] ?? channel;
          const eventData = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
          connection.send({
            type: "event_forward",
            sessionId,
            event: { eventType, timestamp: Date.now(), data: eventData },
          });
        } catch { /* forwarding failure must never break the original emit */ }
      }
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
    // register so server can re-stamp source after restart.
    const dashboardSpawned = !!process.env.PI_DASHBOARD_SPAWN_TOKEN;
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
      // Fact-forwarding: server decides auto-hide. See change:
      // auto-hide-headless-worker-sessions.
      ...buildVisibilityRegisterFields(cachedHasUI, process.env),
    });

    // Allow event forwarding now that session_register is buffered
    sessionReady = true;

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
      pi.events.emit("flow:role-get-all", rolesData);
      if (rolesData.roles) {
        connection.send({
          type: "roles_list",
          sessionId,
          roles: rolesData.roles ?? {},
          presets: rolesData.presets ?? [],
          activePreset: rolesData.activePreset ?? null,
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

    // Send initial git + jj info
    sendGitInfoIfChanged(ctx.cwd);
    sendJjStateIfChanged(ctx.cwd);
    sendCwdMissingIfChanged(ctx.cwd);

    // Start metrics monitor and heartbeat
    startMetricsMonitor();
    heartbeatTimer = setInterval(() => {
      if (!isActive()) return;
      connection.send({
        type: "session_heartbeat",
        sessionId,
        metrics: collectMetrics(),
      });
    }, HEARTBEAT_INTERVAL);
    getBridgeState().timers!.push(heartbeatTimer);

    // Start git + jj + name/model polling
    gitPollTimer = setInterval(() => {
      if (!isActive()) return;
      sendGitInfoIfChanged(ctx.cwd);
      sendJjStateIfChanged(ctx.cwd);
      sendCwdMissingIfChanged(ctx.cwd);
      sendSessionNameIfChanged();
      sendModelUpdateIfChanged();
    }, GIT_POLL_INTERVAL);
    getBridgeState().timers!.push(gitPollTimer);

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
    if (gitPollTimer) clearInterval(gitPollTimer);
    gitPollTimer = setInterval(() => {
      sendGitInfoIfChanged(ctx.cwd);
      sendJjStateIfChanged(ctx.cwd);
      sendCwdMissingIfChanged(ctx.cwd);
    }, GIT_POLL_INTERVAL);
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
