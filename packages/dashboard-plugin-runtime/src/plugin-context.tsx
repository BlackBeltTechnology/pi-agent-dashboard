/**
 * Plugin context provider and hooks for dashboard plugins.
 *
 * The PluginContextProvider wraps the entire React app. Each slot consumer
 * pushes a nested CurrentPluginContext layer when rendering a contribution,
 * scoping hooks like usePluginConfig<T>() and logger to the contributing plugin.
 */

import type { PluginConfigUpdateMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { SlotId } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-types.js";
import type { DashboardEvent, DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import React, {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { getSessionData, subscribeSessionData } from "./session-data-store.js";
import { getSessionEvents, subscribeSessionEvents } from "./session-events-store.js";
import { type ClaimEntry, createSlotRegistry, type SlotRegistry } from "./slot-registry.js";

/**
 * Snapshot shape of an interactive UI request as exposed to plugins. Mirrors
 * the shell's `InteractiveUiRequest` shape but typed independently so the
 * runtime doesn't reach into shell internals.
 *
 * See change: route-flow-asks-to-upper-slot.
 */
export interface InteractiveUiRequestSnapshot {
  requestId: string;
  method: string;
  params: Record<string, unknown>;
  status: "pending" | "resolved" | "cancelled" | "dismissed";
  result?: unknown;
}

/**
 * Snapshot shape of subagent state as exposed to plugins. Structurally
 * typed to avoid pulling in the subagents-plugin's full state type from
 * here — the runtime stays plugin-agnostic.
 *
 * Transitional: subagent state currently lives in the shell's central
 * reducer. A follow-up change will move it into the subagents-plugin
 * reducer (mirror of `pluginize-flows-via-registry`). When that lands,
 * `useSessionSubagents` keeps the same contract but reads from the plugin's
 * own reducer instead of shell state.
 *
 * See change: add-flow-agent-popout.
 */
// Structural minimum: any subagent record exposing an `id` is assignable.
// Plugins downcast (via `as unknown as ReadonlyMap<string, FullType>`) to
// the full producer-defined shape. Dropping the `Record<string, unknown>`
// intersection lets the shell's actual `SubagentState` (which has typed
// fields, not an index signature) flow through `useSessionSubagents`
// without coercion. See change: add-flow-agent-popout.
export type SubagentStateSnapshot = { id: string };

const EMPTY_INTERACTIVE_REQUESTS: readonly InteractiveUiRequestSnapshot[] = Object.freeze([]);
const EMPTY_SUBAGENTS: ReadonlyMap<string, SubagentStateSnapshot> = Object.freeze(new Map());

// ── Logger ───────────────────────────────────────────────────────────────────

export interface PluginLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

function createPluginLogger(pluginId: string): PluginLogger {
  const prefix = `[plugin:${pluginId}]`;
  return {
    info: (msg, ...args) => console.info(prefix, msg, ...args),
    warn: (msg, ...args) => console.warn(prefix, msg, ...args),
    error: (msg, ...args) => console.error(prefix, msg, ...args),
  };
}

// ── Router ───────────────────────────────────────────────────────────────────

export interface PluginRouter {
  open(viewId: string, params?: Record<string, unknown>): void;
  close(): void;
}

// ── Plugin context (outer) ───────────────────────────────────────────────────

export interface PluginContextValue {
  registry: SlotRegistry;
  /** Access session state by id. */
  useSessionState(sessionId: string): DashboardSession | undefined;
  /** Access all sessions. */
  useAllSessions(): DashboardSession[];
  /**
   * The session the user is currently viewing (URL `/session/:id`), or
   * `undefined` when no session is selected. Plugins rendering in global
   * surfaces (e.g. `settings-section`) use this to scope per-session UI.
   *
   * See change: fix-pi-flows-end-to-end (Group 5).
   */
  useSelectedSessionId(): string | undefined;
  /**
   * Access the per-session event stream as a stable, reactive
   * snapshot. Plugins use this to derive their own state via internal
   * reducers + `useMemo`. The returned array reference is stable
   * across renders that don't add a new event for this session.
   *
   * See change: pluginize-flows-via-registry.
   */
  useSessionEvents(sessionId: string): readonly DashboardEvent[];
  /**
   * Access the shell's WebSocket connection status. Plugins use this to
   * gate effects that send messages (e.g. cold-open `subscribe` on mount):
   * sending before `connected` is silently dropped by the shell's send
   * primitive (only fires when `readyState === OPEN`).
   *
   * See change: fix-flows-plugin-polish (popout cold-open subscribe).
   */
  useShellConnectionStatus(): "connecting" | "connected" | "disconnected" | "offline" | "auth_required";
  /**
   * Access the per-session active interactive UI requests (PromptBus
   * pending prompts). Wired by the shell to the same array it stores
   * on its event-reducer state; plugins read it to derive their own
   * pending-prompt views (e.g. flow-plugin's per-flow question queue
   * filtered by component type).
   *
   * Returns the empty array reference for unknown sessions.
   *
   * See change: route-flow-asks-to-upper-slot.
   */
  useSessionInteractiveRequests(sessionId: string): readonly InteractiveUiRequestSnapshot[];
  /**
   * Access the per-session subagent state map. Transitional read bridge
   * while subagent state lives in the shell reducer; will be re-pointed
   * at the subagents-plugin's own reducer in a follow-up.
   *
   * See change: add-flow-agent-popout.
   */
  useSessionSubagents(sessionId: string): ReadonlyMap<string, SubagentStateSnapshot>;
  /** Get plugin config for a specific plugin id. */
  getPluginConfig(pluginId: string): Record<string, unknown>;
  /** Subscribe to plugin config updates. Returns an unsubscribe fn. */
  subscribePluginConfig(
    pluginId: string,
    cb: (config: Record<string, unknown>) => void,
  ): () => void;
  /** Dispatch a message. Returns a Promise for messages the shell handles
   *  asynchronously (e.g. `plugin_config_write` → POST). See change:
   *  fix-plugin-config-write-persistence. */
  send(message: unknown): void | Promise<void>;
  /** Router to open/close content views. */
  pluginRouter: PluginRouter;
  /** WebSocket connection (used internally for subscriptions). */
  ws?: WebSocket | null;
  /**
   * Translate a fully-qualified catalog key in the active language. Wired by
   * the shell from the client i18n runtime. Plugins should prefer the scoped
   * {@link useT} hook, which auto-prefixes `plugin.<id>.`. Falls back to the
   * call-site English when no translation exists (never throws).
   * See change: make-all-ui-text-i18n.
   */
  t?: (key: string, vars?: Record<string, string | number>, fallback?: string) => string;
  /** The active UI language code (e.g. "en", "zh-CN", "hu"). */
  language?: string;
}

const PluginReactContext = createContext<PluginContextValue | null>(null);

// ── Per-plugin context (nested, pushed by slot consumers) ────────────────────

interface CurrentPluginContextValue {
  pluginId: string;
}
const CurrentPluginContext = createContext<CurrentPluginContextValue | null>(null);

// ── Public hooks (called from plugin component code) ─────────────────────────

/**
 * @public — scoped translator for plugin slot contributions. Auto-prefixes the
 * calling plugin's `plugin.<id>.` namespace so plugin code writes
 * `t("launch.title", vars, "Launch")` and it resolves `plugin.<id>.launch.title`
 * in the active language. Degrades to the call-site English fallback when the
 * shell has not wired a translator or the key is missing. Never throws.
 */
export function useT(): (
  key: string,
  vars?: Record<string, string | number>,
  fallback?: string,
) => string {
  const outer = useContext(PluginReactContext);
  const current = useContext(CurrentPluginContext);
  const pluginId = current?.pluginId;
  return (key, vars, fallback) => {
    const scoped = pluginId ? `plugin.${pluginId}.${key}` : key;
    if (outer?.t) return outer.t(scoped, vars, fallback);
    // No shell translator wired: interpolate the fallback locally.
    const template = fallback ?? key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
  };
}

/** @public — the active UI language code, or "en" when unwired. */
export function useLanguage(): string {
  const outer = useContext(PluginReactContext);
  return outer?.language ?? "en";
}

/** @public — called only from plugin slot contributions */
export function usePluginConfig<T = Record<string, unknown>>(): T {
  const outer = useContext(PluginReactContext);
  const current = useContext(CurrentPluginContext);
  if (!current) {
    throw new Error(
      "usePluginConfig must be called from a plugin slot contribution; " +
        "if you need a plugin's config from outside, use server-side getPluginConfig",
    );
  }
  if (!outer) throw new Error("Slot consumer must be rendered inside <PluginContextProvider>");

  const { pluginId } = current;
  const [config, setConfig] = useState<Record<string, unknown>>(
    () => outer.getPluginConfig(pluginId),
  );

  useEffect(() => {
    return outer.subscribePluginConfig(pluginId, setConfig);
  }, [outer, pluginId]);

  return config as T;
}

/** @public */
export function useAllSessions(): DashboardSession[] {
  const ctx = useContext(PluginReactContext);
  if (!ctx) throw new Error("Slot consumer must be rendered inside <PluginContextProvider>");
  return ctx.useAllSessions();
}

/** @public */
export function useSessionState(sessionId: string): DashboardSession | undefined {
  const ctx = useContext(PluginReactContext);
  if (!ctx) throw new Error("Slot consumer must be rendered inside <PluginContextProvider>");
  return ctx.useSessionState(sessionId);
}

/**
 * @public — reactive: returns the shell's WebSocket connection status.
 * Use this to gate effects that call `usePluginSend` so messages aren't
 * dropped while the connection is still being established.
 *
 * Returns `"disconnected"` when called outside a `<PluginContextProvider>`
 * (soft contract, matches other status-style hooks).
 *
 * See change: fix-flows-plugin-polish (popout cold-open subscribe).
 */
export function useShellConnectionStatus(): "connecting" | "connected" | "disconnected" | "offline" | "auth_required" {
  const ctx = useContext(PluginReactContext);
  if (!ctx) return "disconnected";
  return ctx.useShellConnectionStatus();
}

/**
 * @public — reactive: read the active interactive UI requests for a session.
 * Plugins use this to derive their own pending-prompt views (e.g. the
 * flow-plugin's per-flow question queue filtered by component type).
 *
 * See change: route-flow-asks-to-upper-slot.
 */
export function useSessionInteractiveRequests(
  sessionId: string,
): readonly InteractiveUiRequestSnapshot[] {
  // Soft contract: returns the empty array when called outside a
  // `<PluginContextProvider>` (e.g. in shell unit tests). Plugin slot
  // contributions are always descendants of the provider in production.
  const ctx = useContext(PluginReactContext);
  if (!ctx) return EMPTY_INTERACTIVE_REQUESTS;
  return ctx.useSessionInteractiveRequests(sessionId);
}

/**
 * @public — reactive: read the per-session subagent state map.
 *
 * Transitional bridge while subagent state lives in the shell reducer.
 * Returns the same value reference until a new event for that session
 * changes the map. Returns the shared `EMPTY_SUBAGENTS` frozen-Map for
 * unknown session ids.
 *
 * See change: add-flow-agent-popout.
 */
export function useSessionSubagents(
  sessionId: string,
): ReadonlyMap<string, SubagentStateSnapshot> {
  // Soft contract: returns the empty map when called outside a
  // `<PluginContextProvider>` (e.g. in shell unit tests).
  const ctx = useContext(PluginReactContext);
  if (!ctx) return EMPTY_SUBAGENTS;
  return ctx.useSessionSubagents(sessionId);
}

/**
 * @public — reactive: returns the currently-selected session id (URL
 * `/session/:id`) or `undefined` when no session is selected.
 * See change: fix-pi-flows-end-to-end (Group 5).
 */
export function useSelectedSessionId(): string | undefined {
  const ctx = useContext(PluginReactContext);
  if (!ctx) throw new Error("Slot consumer must be rendered inside <PluginContextProvider>");
  return ctx.useSelectedSessionId();
}

/**
 * Internal hook implementation — wired into `PluginContextValue.useSessionEvents`
 * by `PluginContextProvider`. The implementation lives here as a
 * top-level hook (not a closure inside the provider) so React's hook
 * detection sees a real hook call.
 */
function useSessionEventsHookImpl(sessionId: string): readonly DashboardEvent[] {
  return useSyncExternalStore(
    (cb) => subscribeSessionEvents(sessionId, cb),
    () => getSessionEvents(sessionId),
    () => getSessionEvents(sessionId),
  );
}

/**
 * Public hook — read a session-scoped key/value entry the shell has
 * published into `session-data-store`. Plugins MAY use this to read
 * data the shell already receives but doesn't expose via
 * `DashboardSession` (e.g. `flows_list`, `commands_list`).
 *
 * The value reference is stable until `publishSessionData` for the
 * same (sessionId, key) replaces it.
 *
 * @public
 */
export function useSessionData<T>(sessionId: string, key: string): T | undefined {
  return useSyncExternalStore(
    (cb) => subscribeSessionData(sessionId, key, cb),
    () => getSessionData<T>(sessionId, key),
    () => getSessionData<T>(sessionId, key),
  );
}

/**
 * Public hook — read the per-session event stream for plugin-owned
 * state derivation. Plugins SHALL call this from inside a slot
 * contribution (i.e. a descendant of `<PluginContextProvider>`).
 *
 * The returned array is a frozen snapshot; the reference is stable
 * until a new event arrives for the requested session, at which point
 * `useSyncExternalStore` triggers a re-render and returns the
 * extended snapshot.
 *
 * @public
 */
export function useSessionEvents(sessionId: string): readonly DashboardEvent[] {
  const ctx = useContext(PluginReactContext);
  if (!ctx) throw new Error("Slot consumer must be rendered inside <PluginContextProvider>");
  return ctx.useSessionEvents(sessionId);
}

/** @public — namespaced logger for the current plugin contribution */
export function usePluginLogger(): PluginLogger {
  const current = useContext(CurrentPluginContext);
  if (!current) {
    throw new Error("usePluginLogger must be called from a plugin slot contribution");
  }
  return React.useMemo(() => createPluginLogger(current.pluginId), [current.pluginId]);
}

/** @public */
export function usePluginSend(): (message: unknown) => void | Promise<void> {
  const ctx = useContext(PluginReactContext);
  if (!ctx) throw new Error("Slot consumer must be rendered inside <PluginContextProvider>");
  return ctx.send;
}

/** @public */
export function usePluginRouter(): PluginRouter {
  const ctx = useContext(PluginReactContext);
  if (!ctx) throw new Error("Slot consumer must be rendered inside <PluginContextProvider>");
  return ctx.pluginRouter;
}

// ── Registry accessor ─────────────────────────────────────────────────────────

/** Returns null when outside a PluginContextProvider (graceful degradation). */
export function useSlotRegistryOrNull(): SlotRegistry | null {
  const ctx = useContext(PluginReactContext);
  return ctx ? ctx.registry : null;
}

/** Throws when outside a PluginContextProvider (for test assertions). */
export function useSlotRegistry(): SlotRegistry {
  const ctx = useContext(PluginReactContext);
  if (!ctx) throw new Error("Slot consumer must be rendered inside <PluginContextProvider>");
  return ctx.registry;
}

// ── Provider ─────────────────────────────────────────────────────────────────

export interface PluginContextProviderProps {
  children: ReactNode;
  registry?: SlotRegistry;
  sessions?: DashboardSession[];
  sessionStates?: Map<string, DashboardSession>;
  /**
   * Resolver returning the active interactive UI requests for a session.
   * Wired by the shell from its event-reducer state. When omitted, the
   * provider returns the empty array for every session.
   *
   * See change: route-flow-asks-to-upper-slot.
   */
  useSessionInteractiveRequests?: (sessionId: string) => readonly InteractiveUiRequestSnapshot[];
  /**
   * WebSocket connection status accessor. Wired by the shell from its
   * `useWebSocket().status` value. When omitted, the provider returns
   * `"disconnected"`.
   *
   * See change: fix-flows-plugin-polish (popout cold-open subscribe).
   */
  connectionStatus?: "connecting" | "connected" | "disconnected" | "offline" | "auth_required";
  /**
   * Resolver returning the per-session subagent state map. Wired by the
   * shell from its event-reducer state. When omitted, the provider returns
   * the empty map for every session.
   *
   * See change: add-flow-agent-popout.
   */
  useSessionSubagents?: (sessionId: string) => ReadonlyMap<string, SubagentStateSnapshot>;
  /**
   * Currently-selected session id (from URL `/session/:id`). Plugins
   * read it via `useSelectedSessionId()`. See change:
   * fix-pi-flows-end-to-end (Group 5).
   */
  selectedSessionId?: string;
  send?: (message: unknown) => void | Promise<void>;
  pluginRouter?: PluginRouter;
  ws?: WebSocket | null;
  /**
   * Active-language translator wired by the shell from the client i18n
   * runtime. Exposed to plugins via {@link useT}. See change:
   * make-all-ui-text-i18n.
   */
  t?: (key: string, vars?: Record<string, string | number>, fallback?: string) => string;
  /** Active UI language code. Exposed via {@link useLanguage}. */
  language?: string;
}

// Per-plugin config store (in-memory, keyed by plugin id)
const pluginConfigs = new Map<string, Record<string, unknown>>();
const configSubscribers = new Map<string, Set<(c: Record<string, unknown>) => void>>();

function getConfig(pluginId: string): Record<string, unknown> {
  return pluginConfigs.get(pluginId) ?? {};
}

function setConfig(pluginId: string, config: Record<string, unknown>): void {
  pluginConfigs.set(pluginId, config);
  const subs = configSubscribers.get(pluginId);
  if (subs) for (const cb of subs) cb(config);
}

function subscribeConfig(
  pluginId: string,
  cb: (config: Record<string, unknown>) => void,
): () => void {
  if (!configSubscribers.has(pluginId)) configSubscribers.set(pluginId, new Set());
  configSubscribers.get(pluginId)!.add(cb);
  return () => configSubscribers.get(pluginId)?.delete(cb);
}

/**
 * Apply an incoming plugin_config_update broadcast.
 * Called by the WebSocket message handler.
 */
export function applyPluginConfigUpdate(update: PluginConfigUpdateMessage): void {
  setConfig(update.id, update.config as Record<string, unknown>);
}

/**
 * Read the current plugin config for a given plugin id, outside the React
 * tree. Used by the WS message handler to merge incremental updates (e.g.
 * `roles_list` + `models_list` both target the built-ins plugin and must
 * not overwrite each other). Plugins SHOULD read their own config via
 * `usePluginConfig<T>()` in components.
 */
export function getPluginConfig(pluginId: string): Record<string, unknown> {
  return getConfig(pluginId);
}

/**
 * Initialize plugin configs from a bulk fetch (e.g. from /api/config) so
 * settings persisted to config.json hydrate on client boot / reload.
 *
 * Uses `setConfig` (not a raw Map set) so subscribers that mounted before this
 * runs are notified — the `/api/config` fetch happens in a post-render effect,
 * by which point `usePluginConfig` consumers have already read the (empty)
 * initial value. See change: fix-plugin-config-write-persistence.
 */
export function initPluginConfigs(pluginsBlock: Record<string, Record<string, unknown>>): void {
  for (const [id, config] of Object.entries(pluginsBlock)) {
    setConfig(id, config);
  }
}

export function PluginContextProvider({
  children,
  registry,
  sessions = [],
  selectedSessionId,
  send: sendFn,
  pluginRouter: routerProp,
  useSessionInteractiveRequests: useSessionInteractiveRequestsProp,
  useSessionSubagents: useSessionSubagentsProp,
  connectionStatus,
  ws,
  t: tProp,
  language: languageProp,
}: PluginContextProviderProps) {
  const resolvedRegistry = registry ?? createSlotRegistry();

  const useAllSessionsFn = useCallback(() => sessions, [sessions]);
  const useSessionStateFn = useCallback(
    (sessionId: string) => sessions.find(s => s.id === sessionId),
    [sessions],
  );
  const useSelectedSessionIdFn = useCallback(() => selectedSessionId, [selectedSessionId]);
  const useSessionInteractiveRequestsFn = useCallback(
    (sessionId: string): readonly InteractiveUiRequestSnapshot[] => {
      if (useSessionInteractiveRequestsProp) return useSessionInteractiveRequestsProp(sessionId);
      return EMPTY_INTERACTIVE_REQUESTS;
    },
    [useSessionInteractiveRequestsProp],
  );
  const useSessionSubagentsFn = useCallback(
    (sessionId: string): ReadonlyMap<string, SubagentStateSnapshot> => {
      if (useSessionSubagentsProp) return useSessionSubagentsProp(sessionId);
      return EMPTY_SUBAGENTS;
    },
    [useSessionSubagentsProp],
  );
  const useShellConnectionStatusFn = useCallback(
    () => connectionStatus ?? "disconnected",
    [connectionStatus],
  );

  const send = useCallback(
    (message: unknown): void | Promise<void> => {
      return sendFn ? sendFn(message) : undefined;
    },
    [sendFn],
  );

  const pluginRouter = routerProp ?? {
    open: (viewId, _params) => console.warn(`[plugin-router] open(${viewId}) not wired`),
    close: () => console.warn("[plugin-router] close() not wired"),
  };

  // Subscribe to plugin_config_update WebSocket messages
  useEffect(() => {
    if (!ws) return;
    function onMessage(evt: MessageEvent) {
      try {
        const msg = JSON.parse(evt.data as string);
        if (msg?.type === "plugin_config_update") {
          applyPluginConfigUpdate(msg as PluginConfigUpdateMessage);
        }
      } catch {
        // ignore parse errors
      }
    }
    ws.addEventListener("message", onMessage);
    return () => ws.removeEventListener("message", onMessage);
  }, [ws]);

  const value: PluginContextValue = {
    registry: resolvedRegistry,
    useAllSessions: useAllSessionsFn,
    useSessionState: useSessionStateFn,
    useSelectedSessionId: useSelectedSessionIdFn,
    useSessionEvents: useSessionEventsHookImpl,
    useSessionInteractiveRequests: useSessionInteractiveRequestsFn,
    useSessionSubagents: useSessionSubagentsFn,
    useShellConnectionStatus: useShellConnectionStatusFn,
    getPluginConfig: getConfig,
    subscribePluginConfig: subscribeConfig,
    send,
    pluginRouter,
    ws,
    t: tProp,
    language: languageProp,
  };

  return <PluginReactContext.Provider value={value}>{children}</PluginReactContext.Provider>;
}

// ── Slot consumer wrapper ─────────────────────────────────────────────────────

/**
 * Wraps a single contribution's component in the nested CurrentPluginContext
 * layer so that usePluginConfig<T>() and usePluginLogger() resolve to the
 * correct plugin's namespace.
 */
export function CurrentPluginLayer({
  pluginId,
  children,
}: {
  pluginId: string;
  children: ReactNode;
}) {
  return (
    <CurrentPluginContext.Provider value={{ pluginId }}>
      {children}
    </CurrentPluginContext.Provider>
  );
}

// Re-export types consumers need
export type { ClaimEntry, SlotId, SlotRegistry };
