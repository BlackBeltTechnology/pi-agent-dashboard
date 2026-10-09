/**
 * Plugin event-forward declaration contract.
 *
 * A plugin bridge entry emits `dashboard:register-event-forward` with an
 * {@link EventForwardDeclaration}; the main bridge validates it with
 * {@link validateDeclaration} and subscribes each accepted channel once. The
 * main bridge emits `dashboard:bridge-ready` after attaching its listener so a
 * plugin that activated first can re-declare (load-order handshake).
 *
 * The payload is UNTRUSTED (any extension can emit on the bus): it is read
 * field-by-field, never spread or cloned, and every name is regex-checked.
 * See change: add-plugin-bridge-contributions (D1–D4).
 */

export const REGISTER_EVENT_FORWARD_CHANNEL = "dashboard:register-event-forward";
export const BRIDGE_READY_CHANNEL = "dashboard:bridge-ready";

export type EventForwardDelivery = "live" | "latest" | "stream";

export interface EventForwardChannelSpec {
  /** Forwarded `eventType`; defaults to the channel name. */
  as?: string;
  delivery: EventForwardDelivery;
  /** Top-level payload field grouping retained messages (latest/stream). */
  key?: string;
}

export interface EventForwardDeclaration {
  pluginId: string;
  channels: Record<string, EventForwardChannelSpec>;
}

/** Normalized accepted channel (as resolved, delivery, key). */
export interface AcceptedChannelSpec {
  channel: string;
  as: string;
  delivery: EventForwardDelivery;
  key?: string;
}

export const MAX_CHANNELS_PER_PLUGIN = 32;
export const MAX_PLUGIN_CHANNELS_TOTAL = 256;

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CHANNEL_RE = /^[a-z0-9][a-z0-9:_-]{0,63}$/;
const AS_RE = /^[a-z0-9_]{1,64}$/;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

/**
 * Event types a plugin channel may NOT forward as: pi core event types, the
 * core-mapped flow/subagent types, and bridge→server control message types.
 * A plugin hijacking one would inject frames the reducer trusts.
 */
export const RESERVED_EVENT_TYPES: ReadonlySet<string> = new Set([
  // pi core session events
  "agent_start", "agent_end", "turn_start", "turn_end",
  "message_start", "message_update", "message_end",
  "tool_execution_start", "tool_execution_update", "tool_execution_end",
  "tool_call", "tool_result", "input", "context", "before_agent_start",
  "session_start", "session_shutdown", "session_compact", "session_switch", "session_fork",
  "session_before_compact", "session_before_switch", "session_before_fork", "session_tree",
  "model_select", "user_bash", "auto_compaction_start", "auto_compaction_end",
  "auto_retry_start", "auto_retry_end", "compaction_start", "compaction_end",
  // core-mapped bus channels
  "flow_started", "flow_agent_started", "flow_agent_complete", "flow_agent_error",
  "flow_tool_call", "flow_tool_result", "flow_assistant_text", "flow_thinking_text",
  "flow_loop_iteration", "flow_auto_decision", "flow_complete", "flow_summary_started",
  "flow_summary_ready", "flow_summary_dismissed", "flow_autonomous_changed",
  "subagent_created", "subagent_started", "subagent_completed", "subagent_failed",
  // bridge control / protocol message types
  "event_forward", "entry_persisted", "session_register", "session_unregister",
  "session_heartbeat", "replay_complete", "commands_list", "flows_list",
  "extension_ui_request", "usage_recorded", "prompt_request", "prompt_dismiss",
  "prompt_cancel", "notify", "plugin_pi_message", "plugin_request", "queue_update",
  "bridge_diagnostic",
]);

export type RejectionReason =
  | "plugin-id"
  | "channel-name"
  | "as"
  | "reserved-as"
  | "delivery"
  | "key"
  | "per-plugin-cap"
  | "total-cap"
  | "spec-shape";

export interface ValidationResult {
  /** False when the whole declaration was rejected (bad pluginId / shape). */
  ok: boolean;
  pluginId?: string;
  accepted: AcceptedChannelSpec[];
  rejected: Array<{ channel: string; reason: RejectionReason }>;
}

function own(obj: object, k: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, k)
    ? (obj as Record<string, unknown>)[k]
    : undefined;
}

/**
 * Validate an untrusted declaration (D3). `existingForPlugin` / `existingTotal`
 * are the counts ALREADY accepted (so caps apply across repeated declarations);
 * `isKnown(channel)` reports a channel already accepted for this plugin so an
 * idempotent re-declaration does not consume cap budget.
 */
export function validateDeclaration(
  raw: unknown,
  opts: {
    existingForPlugin?: number;
    existingTotal?: number;
    isKnown?: (channel: string) => boolean;
  } = {},
): ValidationResult {
  const result: ValidationResult = { ok: false, accepted: [], rejected: [] };
  if (!raw || typeof raw !== "object") return result;
  const pluginId = own(raw, "pluginId");
  if (typeof pluginId !== "string" || !PLUGIN_ID_RE.test(pluginId)) return result;
  const channels = own(raw, "channels");
  if (!channels || typeof channels !== "object" || Array.isArray(channels)) return result;
  result.ok = true;
  result.pluginId = pluginId;

  let perPlugin = opts.existingForPlugin ?? 0;
  let total = opts.existingTotal ?? 0;
  for (const channel of Object.keys(channels)) {
    const reject = (reason: RejectionReason) => result.rejected.push({ channel, reason });
    if (!CHANNEL_RE.test(channel) || !channel.includes(":")) { reject("channel-name"); continue; }
    const spec = own(channels, channel);
    if (!spec || typeof spec !== "object") { reject("spec-shape"); continue; }
    const delivery = own(spec, "delivery");
    if (delivery !== "live" && delivery !== "latest" && delivery !== "stream") { reject("delivery"); continue; }
    const asRaw = own(spec, "as");
    let as = channel;
    if (asRaw !== undefined) {
      if (typeof asRaw !== "string" || !AS_RE.test(asRaw)) { reject("as"); continue; }
      as = asRaw;
    }
    if (RESERVED_EVENT_TYPES.has(as)) { reject("reserved-as"); continue; }
    const keyRaw = own(spec, "key");
    let key: string | undefined;
    if (keyRaw !== undefined) {
      if (typeof keyRaw !== "string" || !KEY_RE.test(keyRaw)) { reject("key"); continue; }
      key = keyRaw;
    }
    if (delivery !== "live" && key === undefined) { reject("key"); continue; }
    const known = opts.isKnown?.(channel) ?? false;
    if (!known) {
      if (perPlugin >= MAX_CHANNELS_PER_PLUGIN) { reject("per-plugin-cap"); continue; }
      if (total >= MAX_PLUGIN_CHANNELS_TOTAL) { reject("total-cap"); continue; }
      perPlugin++;
      total++;
    }
    result.accepted.push({ channel, as, delivery, ...(key !== undefined ? { key } : {}) });
  }
  return result;
}

/** Validate a key VALUE at forward time: string or finite number, ≤ 128 chars. */
export function isValidKeyValue(v: unknown): v is string | number {
  if (typeof v === "string") return v.length <= 128;
  if (typeof v === "number") return Number.isFinite(v) && String(v).length <= 128;
  return false;
}
