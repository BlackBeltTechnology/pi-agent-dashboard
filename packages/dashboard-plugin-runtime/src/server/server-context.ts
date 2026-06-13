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

    getPluginConfig<T>(): T {
      return deps.getPluginConfig(pluginId) as T;
    },

    async updatePluginConfig<T>(partial: Partial<T>): Promise<void> {
      await deps.updatePluginConfig(pluginId, partial as Record<string, unknown>);
    },

    logger,
  };
}
