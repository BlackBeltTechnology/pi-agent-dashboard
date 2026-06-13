/**
 * Plugin intent protocol — wire-format types.
 *
 * Plugins describe per-session UI contributions as `IntentNode` JSON trees
 * and broadcast them via `ServerPluginContext.broadcastToSubscribers`. The
 * shell on every connected client receives the broadcast, looks up the
 * referenced primitive name in its local UI primitive registry, and renders
 * the resulting React component with the JSON-serializable props.
 *
 * Function references SHALL NOT cross the wire. Action handlers (onClick,
 * onSubmit, etc.) are declared as `ActionDescriptor` objects; the client's
 * IntentRenderer wires them to send `PluginActionMessage` back over the
 * WebSocket when triggered.
 *
 * See change: adopt-server-driven-intent-rendering.
 */
import type { SlotId } from "./slot-types.js";

/**
 * A node in an intent tree.
 *
 * The plugin describes WHAT to render by primitive name. The client's
 * IntentRenderer resolves the name to a `ComponentType` from its local
 * primitive registry.
 */
export interface IntentNode {
  /** Stable primitive name. Resolved by useUiPrimitive on the client. */
  primitive: string;
  /**
   * Props passed to the resolved component. Values may be primitives,
   * serializable structures, OR nested IntentNodes (rendered recursively
   * as React elements by IntentRenderer).
   */
  props?: Record<string, unknown>;
  /** Optional stable React key for reconciliation. Required for items in lists. */
  key?: string;
  /**
   * Optional action descriptors. The IntentRenderer wires these to send
   * `PluginActionMessage` to the server when the user triggers them.
   */
  actions?: Record<string, ActionDescriptor>;
}

/**
 * What to send back to the server when the user triggers an action.
 *
 * Function references SHALL NOT cross the wire. This is what does instead.
 */
export interface ActionDescriptor {
  /** The plugin to dispatch the action to (matches manifest id). */
  pluginId: string;
  /** Plugin-defined action name. */
  action: string;
  /** Optional payload. Must be JSON-serializable. */
  payload?: Record<string, unknown>;
}

/**
 * Server → Browser envelope. One message per (slot, session) change from
 * a plugin. The shell on every connected client receives it via the bridge
 * fanout.
 */
/**
 * Server → Browser: a generic plugin-emitted dashboard event for a session.
 * The plugin server broadcasts these; the shell routes `event` into the
 * plugin per-session event store so `useSessionEvents(sessionId)` consumers
 * re-render. Distinct from `plugin_intents` (declarative slot trees) — this
 * carries a raw `{ eventType, timestamp, data }` event for plugin reducers.
 * See change: add-goal-continuation-plugin.
 */
export interface PluginEventBroadcast {
  type: "plugin_event";
  /** The plugin emitting this event. */
  pluginId: string;
  /** The session this event applies to. */
  sessionId: string;
  /** Raw dashboard event folded by the plugin's own reducer. */
  event: { eventType: string; timestamp: number; data: Record<string, unknown> };
}

export interface PluginIntentsMessage {
  type: "plugin_intents";
  /** The plugin emitting this intent. */
  pluginId: string;
  /**
   * The session this intent applies to. `null` for global slots like
   * `settings-section` that aren't bound to a single session.
   */
  sessionId: string | null;
  /** The slot this intent occupies. */
  slot: SlotId;
  /** The intent tree. `null` means "clear my contribution to this slot". */
  intent: IntentNode | null;
}

/**
 * Browser → Server envelope. Emitted by the IntentRenderer when the user
 * triggers an `ActionDescriptor` (e.g. a button click) inside a rendered
 * intent tree.
 */
export interface PluginActionMessage {
  type: "plugin_action";
  /** Matches `ActionDescriptor.pluginId` on the originating intent. */
  pluginId: string;
  /** The session context this action originated in (may be `null`). */
  sessionId: string | null;
  /** Plugin-defined action name. */
  action: string;
  /** Optional payload. */
  payload?: Record<string, unknown>;
}
