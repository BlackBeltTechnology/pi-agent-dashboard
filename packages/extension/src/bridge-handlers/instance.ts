/**
 * Per-incarnation bridge instance (change: test-trust-audit, design D2).
 *
 * `initBridge` builds one of these per call, right after the generation bump. It carries
 * every closure entity the extracted handler modules read or write (the field list is the
 * closure inventory of the code that moved), plus:
 *  - `shared`: the PROCESS-GLOBAL `BridgeState` that survives reload (cross-reload
 *    values: sessionId, attachedChange, shouldStopAfterTurn, namerState, connections, timers …);
 *  - `generation`: the generation this incarnation was created with;
 *  - `isActive()`: true while `shared.generation` still equals `generation`. A newer
 *    incarnation bumps the shared counter, which is how the old instance's handlers go inert.
 *
 * Fields other than `pi` / `generation` / `shared` / `isActive` are assigned by
 * `initBridge` as the matching declarations execute (they are typed as present; a test
 * supplies the ones its handler touches through `createInstance(..., overrides)`).
 * This file holds no module-level state and never imports the bridge entry point.
 */

import type { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { FlowInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AbortLatch } from "../abort-latch.js";
import type { AutoNamer, PersistedNamerState } from "../auto-session-namer.js";
import type { BridgeContext } from "../bridge-context.js";
import type { createPollingHolder } from "../bridge-polling.js";
import type { createCommandHandler } from "../command-handler.js";
import type { ConnectionManager } from "../connection.js";
import type { EmptyActionableGuard } from "../empty-actionable-guard.js";
import type { resolveEndpoint } from "../endpoint-resolution.js";
import type { createFollowupBuffer } from "../followup-buffer.js";
import type { GitTracker } from "../git-tracker.js";
import type { InboundLimits } from "../inbound-limits.js";
import type { ReadFileOutcome } from "../markdown-image-inliner.js";
import type { createMcpDashboardRegistrar } from "../mcp-token-delivery.js";
import type { MessageUpdateCoalescer } from "../message-update-coalescer.js";
import type { createPathGate } from "../path-gate/index.js";
import type { Suppression } from "../path-gate/suppression.js";
import type { PluginForwardRegistry } from "../plugin-event-forward-registry.js";
import type { createPluginRequestClient } from "../plugin-request-client.js";
import type { PrStatusScheduler } from "../pr-status.js";
import type { PromptBus } from "../prompt-bus.js";
import type { RetryTracker } from "../retry-tracker.js";
import type { FanoutAdmissionGate } from "../subagent-fanout-admission.js";
import type { SubagentFrameBuffer } from "../subagent-frame-buffer.js";
import type { SubagentTickThrottle } from "../subagent-tick-throttle.js";
import type { createTransportDiagnostics } from "../transport-diagnostics.js";
import type { UiModulesBridgeCtx } from "../ui-modules.js";
import type { UsageDrain } from "../usage-drain.js";
import type { VaultDelivery } from "../vault-delivery.js";

export interface BridgeState {
  cleanup?: () => void;
  sessionId?: string;
  ctx?: any;
  modelRegistry?: any;
  hasUI?: boolean;
  /** Monotonic generation counter — stale listeners bail out when mismatched */
  generation?: number;
  /** Path-gate denial map; process-global so a /reload keeps the 120 s suppression. */
  pathGateSuppression?: Suppression;
  /** The pi instance that owns the bridge (used to detect subagent re-entry) */
  pi?: ExtensionAPI;
  /** All connection instances from any bridge incarnation (for cleanup) */
  connections?: ConnectionManager[];
  /** Process-wide inbound limiter (see `BridgeInstance.inboundLimits`). */
  inboundLimits?: InboundLimits;
  /** All interval timers from any bridge incarnation (for cleanup) */
  timers?: ReturnType<typeof setInterval>[];
  /**
   * Teardown callbacks for schedulers/watchers owned by a bridge incarnation
   * (process-scan scheduler, git probe scheduler, git-dir watcher). Drained on
   * re-init, `state.cleanup` and `session_shutdown`.
   * See change: optimize-polling-hot-paths.
   */
  disposables?: Array<() => void>;
  /** True when the agent is currently in a turn (between agent_start and agent_end) */
  isAgentStreaming?: boolean;
  /**
   * The auto-namer's durable state set, carried across reload as VALUES. The
   * namer OBJECT is deliberately not carried: its closures would hold a stale
   * connection, session id and ctx. See change: fix-auto-naming-reasoning-model.
   */
  namerState?: PersistedNamerState;
  /**
   * Capture-once "was this pi dashboard-spawned?" boolean. Set on first bridge
   * activation from `!!process.env.PI_DASHBOARD_SPAWN_TOKEN` BEFORE the token is
   * scrubbed; persisted here so reload/reattach keeps the value after the env
   * var is gone. See change: fix-spawn-token-env-leak.
   */
  dashboardSpawned?: boolean;
  /**
   * Last Claude subscription compat value relayed by the server, mirrored
   * process-globally so a subagent child (whose `initBridge` returns early on
   * re-entry) can answer the compat probe on its own `pi.events`.
   * See change: seed-claude-compat-on-upgrade.
   */
  claudeSubscriptionCompat?: boolean;
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

export interface BridgeInstance {
  readonly pi: ExtensionAPI;
  /** Generation this incarnation was created with. */
  readonly generation: number;
  /** Process-global state shared across reloads (the object `getBridgeState()` returns). */
  readonly shared: BridgeState;
  /** True while no newer incarnation has bumped `shared.generation`. */
  isActive(): boolean;
  sessionId: string;
  attachedChange: string | null;
  sessionReady: boolean;
  usageDrain: UsageDrain;
  drainUsage: (ctx: any) => void;
  lastSessionFile: string | undefined;
  lastSessionDir: string | undefined;
  lastFirstMessage: string | undefined;
  cachedCwd: string | undefined;
  pendingDefaultModel: string | null;
  applyDefaultModel: () => string | null;
  getFlowsList: () => FlowInfo[];
  sendFlowsList: () => void;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  gitPollTimer: ReturnType<typeof setInterval> | null;
  polling: ReturnType<typeof createPollingHolder>;
  previousProcessPids: string;
  trackedPgids: Set<number>;
  selfSpawnedPgids: Set<number>;
  setRegisteredTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearRegisteredTimeout: (timer: ReturnType<typeof setTimeout>) => void;
  ensurePollingDisposable: () => void;
  renewGitTracker: () => GitTracker;
  prStatus: PrStatusScheduler;
  lastSessionName: string | undefined;
  autoNameSessions: boolean;
  /** Claude subscription compat switch relayed by the server; default false. See change: retire-anthropic-messages-bridge. */
  claudeSubscriptionCompat: boolean;
  autoNamer: AutoNamer | undefined;
  namerState: PersistedNamerState | undefined;
  cachedHasUI: boolean | undefined;
  cachedModelRegistry: any | undefined;
  cachedCtx: any | undefined;
  lastModel: string | undefined;
  lastThinkingLevel: string | undefined;
  dashboardSpawned: boolean;
  activationCwd: string;
  promptBus: PromptBus | undefined;
  retryTracker: RetryTracker;
  emptyActionableGuard: EmptyActionableGuard;
  abortLatch: AbortLatch;
  subagentFrameBuffer: SubagentFrameBuffer;
  mcpRegistrar: ReturnType<typeof createMcpDashboardRegistrar>;
  subagentTickThrottle: SubagentTickThrottle<unknown>;
  coalescer: MessageUpdateCoalescer<Record<string, unknown>>;
  assistantMessageGen: number;
  messageKeyOf: (gen: number, message: unknown) => string;
  bridgeSteering: string[];
  bridgeFollowUp: ReturnType<typeof createFollowupBuffer>;
  emitQueueUpdate: () => void;
  sendCommandFeedback: (command: string, message: string) => void;
  drainFollowupQueue: () => void;
  enqueueSystemFollowup: (text: string) => void;
  extractUserMessageText: (message: any) => string;
  sendSyntheticRetryEvent: (eventType: string, data: Record<string, unknown>) => void;
  idByMessage: WeakMap<object, string>;
  pendingNonces: WeakMap<object, string>;
  nextNonce: () => string;
  appendMessageWrapped: boolean;
  lastWrappedSm: any;
  getEmittedAssetHashes: (sid: string) => Set<string>;
  inlinerReadFile: (absolutePath: string) => ReadFileOutcome;
  maybeInlineAssistantImages: (event: any) => void;
  wrapAppendMessageForCtx: (ctx: any) => void;
  customPersistenceWrapped: boolean;
  customWrappedSm: any;
  wrapCustomPersistenceForCtx: (ctx: any) => void;
  safe: <T extends (...args: any[]) => any>(fn: T) => T;
  config: ReturnType<typeof loadConfig>;
  rendezvous: { endpoint: string; instanceId: string; httpPort: number; } | null;
  endpointChoice: ReturnType<typeof resolveEndpoint>;
  registeredInstanceId: string | undefined;
  dashboardUrl: string;
  endpointPinned: boolean;
  transportDiagnostics: ReturnType<typeof createTransportDiagnostics>;
  uiModulesBridgeCtx: UiModulesBridgeCtx;
  pluginRequests: ReturnType<typeof createPluginRequestClient>;
  pathGate: ReturnType<typeof createPathGate>;
  /** Credential-vault env delivery (bridge half). See change: add-credential-vault. */
  vaultDelivery: VaultDelivery;
  connection: ConnectionManager;
  commandHandler: ReturnType<typeof createCommandHandler>;
  /**
   * Process-wide inbound bounds (bash concurrency + per-connection prompt
   * bucket); the single instance lives in `shared.inboundLimits` so `/reload`
   * keeps the allowance. See change: harden-bridge-inbound-and-discovery (D17).
   */
  inboundLimits: InboundLimits;
  syncBc: () => BridgeContext;
  applyBc: (bc: BridgeContext) => void;
  /** `liveTailOpen`: keep in-flight tail calls open. See change: fix-replay-fabricates-orphan-end-for-live-calls. */
  replaySessionEntries: (opts?: { liveTailOpen?: boolean }) => void;
  sendModelUpdateIfChanged: () => void;
  sendSessionNameIfChanged: () => void;
  getAutoNamer: () => AutoNamer;
  runAutoNameOnTurnEnd: () => void;
  sendCwdMissingIfChanged: (cwd: string) => void;
  sendPiVersionIfChanged: () => void;
  fanoutAdmission: FanoutAdmissionGate;
  sendEventForward: (channel: string, data: Record<string, unknown>) => void;
  flushPendingSubagentFrames: () => void;
  pluginForwardRegistry: PluginForwardRegistry;
}

/**
 * Build an instance. `overrides` seeds closure fields (tests; `initBridge` assigns the
 * rest as declarations run). The cast is deliberate: closure fields are populated
 * incrementally by the entry point, exactly as the closure variables they replace were.
 */
export function createInstance(
  pi: ExtensionAPI,
  generation: number,
  shared: BridgeState,
  overrides: Partial<BridgeInstance> = {},
): BridgeInstance {
  return { pi, generation, shared, isActive: () => shared.generation === generation, ...overrides } as BridgeInstance;
}
