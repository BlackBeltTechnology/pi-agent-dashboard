/**
 * Server-side plugin context factory.
 *
 * Creates a ServerPluginContext scoped to a specific plugin id,
 * with a namespaced logger and typed config accessors.
 */
import type { FastifyInstance } from "fastify";
import type { PluginLogger } from "../plugin-context.js";

// ── Logger ───────────────────────────────────────────────────────────────────

function createServerLogger(pluginId: string): PluginLogger {
  const prefix = `[plugin:${pluginId}]`;
  return {
    info: (msg, ...args) => console.info(prefix, msg, ...args),
    warn: (msg, ...args) => console.warn(prefix, msg, ...args),
    error: (msg, ...args) => console.error(prefix, msg, ...args),
  };
}

// ── Context types ─────────────────────────────────────────────────────────────

/** Minimal session manager surface exposed to plugins. */
export interface PluginSessionManager {
  listActive(): unknown[];
  listAll(): unknown[];
  getSession(id: string): unknown;
}

/** Minimal event store surface exposed to plugins. */
export interface PluginEventStore {
  getEvents(sessionId: string): unknown[];
  getLatestEvent(sessionId: string): unknown;
}

/** Minimal broadcast function exposed to plugins. */
export type BroadcastFn = (msg: unknown) => void;

/**
 * Register a handler for an extension WebSocket message type.
 *
 * The handler receives `(msg, sessionId)`. `sessionId` is supplied by the pi
 * gateway from the key the sending socket is stored under — it is NOT read out
 * of `msg`, so it cannot be spoofed by a bridge. That distinction is what lets
 * a plugin attribute a message to a session as a trust decision rather than as
 * a hint. See change: add-dashboard-mcp-server.
 *
 * The parameter is additive: handlers declared as `(msg) => …` remain valid.
 */
export type RegisterPiHandlerFn = (
  type: string,
  handler: (msg: unknown, sessionId: string) => void,
) => void;

/**
 * Subscribe to every forwarded pi event for any session. The handler
 * receives `(sessionId, event)` where `event` is the raw forwarded pi
 * event (`{ eventType, timestamp, data }`). Returns an unsubscribe fn.
 */
export type OnEventFn = (handler: (sessionId: string, event: unknown) => void) => () => void;

/**
 * Subscribe to session-end (unregister) for any session. The handler receives
 * the ended `sessionId` once the host marks the session `ended` — fired on
 * every death path (explicit unregister, heartbeat-timeout / reconnect-grace
 * expiry, dead-TCP cleanup). Returns an unsubscribe fn. Distinct from the
 * forwarded-event stream (`onEvent`): this fires from the transport/liveness
 * layer even when no terminal pi event was forwarded. See change:
 * finalize-automation-run-on-session-death.
 */
export type OnSessionEndedFn = (handler: (sessionId: string) => void) => () => void;

/**
 * Send a prompt/command into a running pi session. Text starting with `/`
 * is routed through the bridge's extension-command dispatch (Path C keeper
 * for headless sessions). Returns false when the session is not connected.
 * See change: add-goal-continuation-plugin.
 */
export type SendToSessionFn = (sessionId: string, text: string) => boolean;

/**
 * Emit a configured pi event INTO a running session's in-process event bus
 * (relayed over the bridge as a `plugin_emit_event` control message; the
 * in-session bridge does `pi.events.emit(eventType, data)`). Decoupled: the
 * host does not know which events exist — a plugin action emits whatever it
 * registered. Gated to first-party / trusted plugins (same gate as
 * `spawnSession`/`abortSession`): untrusted plugins get a hook returning
 * `false` without sending. Returns `true` when the control message was
 * dispatched to a connected session. See change: automation-emit-configured-event.
 */
export type EmitEventToSessionFn = (
  sessionId: string,
  eventType: string,
  data?: Record<string, unknown>,
) => boolean;

/** Register a handler for a browser WebSocket message type. */
export type RegisterBrowserHandlerFn = (type: string, handler: (msg: unknown, ws: unknown) => void) => void;

/**
 * Options for the plugin session-spawn hook.
 * See change: add-automation-plugin.
 */
export interface PluginSpawnOptions {
  /** Working directory the new pi session runs in. */
  cwd: string;
  /** Optional model id (resolved provider/model) passed as `--model`. */
  model?: string;
  /**
   * Run isolation mode requested by the caller. `worktree` asks the host to
   * run in an isolated git checkout; `local` runs in `cwd` directly. See
   * change: redesign-automation-editor-and-board (4.2 limitation: worktree
   * lifecycle not yet implemented in the host hook — falls back to `local`).
   */
  mode?: "worktree" | "local";
  /**
   * Sandbox level requested by the caller. See change:
   * redesign-automation-editor-and-board (4.2 limitation: pi exposes no
   * sandbox CLI flag, so this cannot be enforced at spawn yet).
   */
  sandbox?: "read-only" | "workspace-write" | "full-access";
  /**
   * When set, the spawned session is stamped `kind="automation"` +
   * `automationRun` once it registers (the server queues the stamp keyed
   * by cwd and applies it on `session_register`). `visibility` carries the
   * run's effective board visibility.
   */
  automationRun?: { name: string; runId: string; visibility?: "hidden" | "shown" };
}

/** Result of a plugin session-spawn request. */
export interface PluginSpawnResult {
  success: boolean;
  message?: string;
  /** Spawn correlation token (present on success). */
  spawnToken?: string;
}

/**
 * Spawn a new pi session from a plugin server entry. Gated to first-party /
 * trusted plugins by the host: untrusted plugins receive a hook that
 * rejects with `success: false`. See change: add-automation-plugin.
 */
export type SpawnSessionFn = (opts: PluginSpawnOptions) => Promise<PluginSpawnResult>;

/**
 * Abort a running pi session by id. Gated to first-party / trusted plugins by
 * the host (same trust gate as `spawnSession`): untrusted plugins receive a
 * hook that returns `false` without sending anything. Returns `true` when the
 * abort control message was dispatched to a connected session.
 * See change: automation-ui-mockup-parity.
 */
export type AbortSessionFn = (sessionId: string) => boolean;

/**
 * Terminate a plugin-spawned driver session (generic kill primitive shared by
 * automation runs AND goal-supervisor respawns). Renamed from
 * `abortAutomationRun` — the primitive is not automation-specific; goal is a
 * second caller. Gated to first-party / trusted plugins (same trust gate as
 * `spawnSession`/`abortSession`): untrusted plugins receive a hook that
 * resolves `false` without touching the process registry.
 *
 * `graceful: true` sends a clean-exit `{type:"shutdown"}` hint to a live
 * session AND escalates via the host kill ladder (the hint is dropped when
 * the bridge WS is not OPEN, so the kill is the guarantee). Otherwise it
 * hard-kills: by `sessionId` when linked, falling back to `spawnToken` for a
 * run spawned but not yet registered. Returns `true` when a live process was
 * targeted. See change: fix-automation-stop-zombie-runs (as `abortAutomationRun`),
 * add-goal-session-supervisor (rename to `abortSpawnedRun`).
 */
export type AbortSpawnedRunFn = (args: {
  sessionId?: string;
  spawnToken?: string;
  graceful?: boolean;
}) => Promise<boolean>;

/**
 * Publish a value under `name` into the host-owned cross-plugin service
 * registry (last write wins). In-process only — values never cross the
 * bridge. See change: register-plugin-automation-events.
 */
export type ProvideFn = (name: string, value: unknown) => void;

/**
 * Read a value previously published via `provide(name, ...)`. Returns
 * `undefined` when nothing was provided under `name` (never throws). The
 * loader's topological order (manifest.dependsOn) guarantees a provider's
 * registerPlugin runs before a dependent that declares it.
 * See change: register-plugin-automation-events.
 */
export type ConsumeFn = <T = unknown>(name: string) => T | undefined;

/**
 * Enumerate every value published via `provide(name, …)` whose `name` starts
 * with `prefix`, paired with its key. Enables publish/collect: producers
 * `provide` under a namespaced key, a consumer collects the namespace lazily,
 * independent of plugin load order. In-process only (never crosses the
 * bridge). Returns `[]` when nothing matches (never throws). Result order is
 * unspecified. See change: decouple-automation-action-registry.
 */
export type ConsumeAllFn = <T = unknown>(prefix: string) => Array<{ key: string; value: T }>;

/**
 * OAuth/api_key-aware model resolver a plugin server entry can use through
 * {@link PluginModelRuntime}. Structural mirror of the server's model-proxy
 * registry so the runtime package needs no dependency on the server package.
 */
export interface PluginModelRegistry {
  find(provider: string, modelId: string): Promise<unknown | null>;
  getApiKeyAndHeaders(model: unknown): Promise<{ apiKey: string; headers: Record<string, string> }>;
}

/**
 * A stored provider credential as the host holds it (api_key or OAuth).
 * Structural mirror of the server's `AuthCredential` so the runtime package
 * needs no dependency on the server package — same rationale as
 * {@link PluginModelRegistry}. See change: publish-quota-plugin.
 */
export type PluginAuthCredential = { type: string; [k: string]: unknown };

/**
 * Read-only access to the host's stored provider credentials — the seam that
 * replaces deep-importing `pi-dashboard-server/src/auth/provider-auth-storage`.
 *
 * SECURITY: `getCredential` returns the RAW record, including OAuth `refresh`
 * and `access` tokens. Gated by the host to first-party plugins (package name
 * scoped `@blackbelt-technology/`); untrusted plugins receive a hook that
 * always returns `undefined`. Note this gate is scope-based, NOT the
 * `priority <= 100` gate used by `spawnSession`/`abortSession` — `priority`
 * doubles as slot render-order, so it cannot express identity.
 * See change: publish-quota-plugin.
 */
export interface PluginProviderAuth {
  getCredential(provider: string): PluginAuthCredential | undefined;
}

/** Subset of pi-ai's streamSimple (as adapted by the server) a plugin consumes. */
export type PluginStreamSimpleFn = (opts: {
  model: unknown;
  messages: unknown[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
  apiKey?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}) => AsyncIterable<{ type?: string; message?: unknown; error?: { errorMessage?: string } }>;

/**
 * In-process model runtime seam. Lets a plugin `server` entry run completions
 * through the dashboard's own registry + streamSimple (credentials resolved
 * server-side via auth.json + providers.json) WITHOUT a loopback HTTP hop to
 * the model proxy — the same seam `server.ts` hands core routes. Absent when
 * the model proxy/registry is unavailable (plugin should degrade gracefully).
 * See change: make-grammar-fully-plugin-contained.
 */
export interface PluginModelRuntime {
  getModelRegistry(): Promise<PluginModelRegistry | null>;
  streamSimple: PluginStreamSimpleFn;
}

/** Full ServerPluginContext API exposed to plugin server entries. */
export interface ServerPluginContext {
  fastify: FastifyInstance;
  sessionManager: PluginSessionManager;
  eventStore: PluginEventStore;
  broadcastToSubscribers: BroadcastFn;
  registerPiHandler: RegisterPiHandlerFn;
  registerBrowserHandler: RegisterBrowserHandlerFn;
  /** Subscribe to all forwarded pi events. See change: add-goal-continuation-plugin. */
  onEvent: OnEventFn;
  /**
   * Subscribe to session-end (unregister). See change:
   * finalize-automation-run-on-session-death.
   */
  onSessionEnded: OnSessionEndedFn;
  /** Send a prompt/command into a running session. See change: add-goal-continuation-plugin. */
  sendToSession: SendToSessionFn;
  /**
   * Emit a configured pi event into a running session. See change:
   * automation-emit-configured-event.
   */
  emitEventToSession: EmitEventToSessionFn;
  /**
   * Spawn a new pi session. Gated to first-party/trusted plugins; untrusted
   * plugins get a hook that always resolves `{ success: false }`.
   * See change: add-automation-plugin.
   */
  spawnSession: SpawnSessionFn;
  /**
   * Abort a running session. Gated to first-party/trusted plugins; untrusted
   * plugins get a hook that returns `false`. See change:
   * automation-ui-mockup-parity.
   */
  abortSession: AbortSessionFn;
  /**
   * Terminate an automation run's spawned session (Stop + completion).
   * Gated to first-party/trusted plugins; untrusted plugins get a hook that
   * resolves `false`. See change: fix-automation-stop-zombie-runs.
   */
  abortSpawnedRun: AbortSpawnedRunFn;
  /**
   * Publish a value other plugins can consume. See change:
   * register-plugin-automation-events.
   */
  provide: ProvideFn;
  /**
   * Consume a value published by another plugin. Returns `undefined` when
   * absent. See change: register-plugin-automation-events.
   */
  consume: ConsumeFn;
  /**
   * Collect every value published under keys starting with `prefix`.
   * See change: decouple-automation-action-registry.
   */
  consumeAll: ConsumeAllFn;
  getPluginConfig<T = Record<string, unknown>>(): T;
  updatePluginConfig<T = Record<string, unknown>>(partial: Partial<T>): Promise<void>;
  /**
   * In-process model runtime (registry + streamSimple). Optional — absent when
   * the model proxy is unavailable. See change: make-grammar-fully-plugin-contained.
   */
  modelRuntime?: PluginModelRuntime;
  /**
   * Stored provider credentials. Optional — absent for untrusted plugins.
   * See change: publish-quota-plugin.
   */
  providerAuth?: PluginProviderAuth;
  logger: PluginLogger;
}

/** Dependencies injected by the server to construct a ServerPluginContext. */
export interface ServerContextDeps {
  fastify: FastifyInstance;
  sessionManager: PluginSessionManager;
  eventStore: PluginEventStore;
  broadcastToSubscribers: BroadcastFn;
  registerPiHandler: RegisterPiHandlerFn;
  registerBrowserHandler: RegisterBrowserHandlerFn;
  onEvent: OnEventFn;
  onSessionEnded: OnSessionEndedFn;
  sendToSession: SendToSessionFn;
  emitEventToSession: EmitEventToSessionFn;
  spawnSession: SpawnSessionFn;
  abortSession: AbortSessionFn;
  abortSpawnedRun: AbortSpawnedRunFn;
  provide: ProvideFn;
  consume: ConsumeFn;
  consumeAll: ConsumeAllFn;
  getPluginConfig: (pluginId: string) => Record<string, unknown>;
  updatePluginConfig: (pluginId: string, partial: Record<string, unknown>) => Promise<void>;
  /** In-process model runtime seam (optional). See change: make-grammar-fully-plugin-contained. */
  modelRuntime?: PluginModelRuntime;
  /** Provider-credential seam (optional, host-gated). See change: publish-quota-plugin. */
  providerAuth?: PluginProviderAuth;
}

/**
 * Create a ServerPluginContext scoped to a specific plugin.
 */
export function createServerPluginContext(
  deps: ServerContextDeps,
  pluginId: string,
): ServerPluginContext {
  const logger = createServerLogger(pluginId);

  return {
    fastify: deps.fastify,
    sessionManager: deps.sessionManager,
    eventStore: deps.eventStore,
    broadcastToSubscribers: deps.broadcastToSubscribers,
    registerPiHandler: deps.registerPiHandler,
    registerBrowserHandler: deps.registerBrowserHandler,
    onEvent: deps.onEvent,
    onSessionEnded: deps.onSessionEnded,
    sendToSession: deps.sendToSession,
    emitEventToSession: deps.emitEventToSession,
    spawnSession: deps.spawnSession,
    abortSession: deps.abortSession,
    abortSpawnedRun: deps.abortSpawnedRun,
    provide: deps.provide,
    consume: deps.consume,
    consumeAll: deps.consumeAll,

    getPluginConfig<T>(): T {
      return deps.getPluginConfig(pluginId) as T;
    },

    async updatePluginConfig<T>(partial: Partial<T>): Promise<void> {
      await deps.updatePluginConfig(pluginId, partial as Record<string, unknown>);
    },

    modelRuntime: deps.modelRuntime,
    providerAuth: deps.providerAuth,
    logger,
  };
}
