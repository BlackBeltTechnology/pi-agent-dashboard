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

/** Register a handler for an extension WebSocket message type. */
export type RegisterPiHandlerFn = (type: string, handler: (msg: unknown) => void) => void;

/**
 * Subscribe to every forwarded pi event for any session. The handler
 * receives `(sessionId, event)` where `event` is the raw forwarded pi
 * event (`{ eventType, timestamp, data }`). Returns an unsubscribe fn.
 */
export type OnEventFn = (handler: (sessionId: string, event: unknown) => void) => () => void;

/**
 * Send a prompt/command into a running pi session. Text starting with `/`
 * is routed through the bridge's extension-command dispatch (Path C keeper
 * for headless sessions). Returns false when the session is not connected.
 * See change: add-goal-continuation-plugin.
 */
export type SendToSessionFn = (sessionId: string, text: string) => boolean;

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
  /** Send a prompt/command into a running session. See change: add-goal-continuation-plugin. */
  sendToSession: SendToSessionFn;
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
  getPluginConfig<T = Record<string, unknown>>(): T;
  updatePluginConfig<T = Record<string, unknown>>(partial: Partial<T>): Promise<void>;
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
  sendToSession: SendToSessionFn;
  spawnSession: SpawnSessionFn;
  abortSession: AbortSessionFn;
  getPluginConfig: (pluginId: string) => Record<string, unknown>;
  updatePluginConfig: (pluginId: string, partial: Record<string, unknown>) => Promise<void>;
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
    sendToSession: deps.sendToSession,
    spawnSession: deps.spawnSession,
    abortSession: deps.abortSession,

    getPluginConfig<T>(): T {
      return deps.getPluginConfig(pluginId) as T;
    },

    async updatePluginConfig<T>(partial: Partial<T>): Promise<void> {
      await deps.updatePluginConfig(pluginId, partial as Record<string, unknown>);
    },

    logger,
  };
}
