/**
 * subagents-plugin · bridge entry (runs inside every pi session as a pi extension).
 *
 * Declares the producer's channels to the main dashboard bridge through the
 * plugin event-forward registry, so core never names them:
 *   - `subagents:created|started|completed|failed` → `subagent_created|started|
 *     completed|failed` (`latest`, key `id`, group `lifecycle`): one slot per agent
 *     across the four channels, so a terminal frame supersedes created/started
 *     while the bridge cannot forward. `maxKeys: 256` (≈128 agents: lifecycle +
 *     stream key each), above the 64-key default.
 *   - `subagents:entry` → `subagent_entry` (one finished timeline step)
 *   - `subagents:delta` → `subagent_delta` (append-only piece of the open block)
 * Both `stream` (every message kept in order while the bridge cannot forward),
 * keyed by `agentId` so one agent's deltas and entries keep their interleaving.
 *
 * Registry reconcile (change: move-subagents-to-plugin, D7):
 *   - `subagents:registry_snapshot` → `subagent_registry_snapshot` (`latest`,
 *     key `scope`): on every `dashboard:bridge-ready`, AFTER the declare, emit
 *     `subagents:list { out: undefined }`. A defined `out` (possibly `[]`) is
 *     forwarded as a snapshot (`background: true`, producer `idle` kept); `out`
 *     still unset = no answer, no snapshot. With no answer the query is retried
 *     once, on the first `subagents:*` lifecycle emission observed (a producer
 *     that loads late proves itself active that way). The producer fills `out`
 *     from its first activation only, so the list may be partial (accepted; the
 *     client's live-frame-after-`takenAt` guard covers it).
 *
 * Declares on activation AND on every `dashboard:bridge-ready` (load-order /
 * reload handshake). Every `on` / `emit` is wrapped: a stale runtime's `on`
 * throws, and a bridge entry must never break session start. Producer contract:
 * `pi-dashboard-subagents` ≥ 0.4.0 (`SubagentEntryEvent`, `SubagentDeltaEvent`);
 * ≥ 0.7.0 for the `subagents:list` query.
 * See change: add-plugin-bridge-contributions.
 */
import {
  BRIDGE_READY_CHANNEL,
  type EventForwardDeclaration,
  REGISTER_EVENT_FORWARD_CHANNEL,
  REGISTER_TOOL_UPDATE_FILTER_CHANNEL,
  type ToolUpdateFilterDeclaration,
} from "@blackbelt-technology/pi-dashboard-shared/event-forward-declaration.js";

export const LIST_CHANNEL = "subagents:list";
export const REGISTRY_SNAPSHOT_CHANNEL = "subagents:registry_snapshot";

/** Producer channel → forwarded lifecycle type (one `latest` slot per `id` across the group). */
const LIFECYCLE = { delivery: "latest", key: "id", group: "lifecycle" } as const;

export const SUBAGENTS_FORWARD_DECLARATION: EventForwardDeclaration = {
  pluginId: "subagents",
  maxKeys: 256,
  channels: {
    "subagents:created": { as: "subagent_created", ...LIFECYCLE },
    "subagents:started": { as: "subagent_started", ...LIFECYCLE },
    "subagents:completed": { as: "subagent_completed", ...LIFECYCLE },
    "subagents:failed": { as: "subagent_failed", ...LIFECYCLE },
    "subagents:entry": { as: "subagent_entry", delivery: "stream", key: "agentId" },
    "subagents:delta": { as: "subagent_delta", delivery: "stream", key: "agentId" },
    [REGISTRY_SNAPSHOT_CHANNEL]: { as: "subagent_registry_snapshot", delivery: "latest", key: "scope" },
  },
};

/**
 * `tool_execution_update` filter for the claimed `Agent` tool: drop the cumulative
 * `details.entries` timeline of a queued/running agent (bytes per tick stay flat);
 * terminal updates keep it. See change: move-subagents-to-plugin (D5).
 */
export const AGENT_TOOL_UPDATE_FILTER: ToolUpdateFilterDeclaration = {
  pluginId: "subagents",
  toolName: "Agent",
  dropPaths: ["partialResult.details.entries", "details.entries"],
  when: { path: "partialResult.details.status", in: ["queued", "running"] },
};

/** Dashboard-side subagent status vocabulary (`idle`: run ended, session alive). */
export type DashboardSubagentStatus = "created" | "running" | "idle" | "completed" | "failed" | "stopped";

/** The producer's `subagents:list` answer, forwarded as `subagent_registry_snapshot`. */
export interface RegistrySnapshotPayload {
  scope: "registry";
  entries: Array<{ agentId: string; status: DashboardSubagentStatus }>;
  takenAt: number;
  background: true;
}

/**
 * Producer → dashboard status (D2): `queued` → `created`; `error`/`aborted` →
 * `failed`; `running`/`completed`/`stopped` unchanged. Unknown → `undefined`.
 */
export function mapProducerStatus(status: unknown): DashboardSubagentStatus | undefined {
  switch (status) {
    case "queued":
    case "created":
      return "created";
    case "running":
      return "running";
    case "idle":
      return "idle";
    case "completed":
      return "completed";
    case "error":
    case "aborted":
    case "failed":
      return "failed";
    case "stopped":
      return "stopped";
    default:
      return undefined;
  }
}

interface EventsLike {
  emit: (channel: string, data: unknown) => void;
  on?: (channel: string, handler: (data: unknown) => void) => unknown;
}

export default function activate(ctx: unknown): void {
  const c = ctx as { pi?: { events?: EventsLike }; events?: EventsLike } | undefined;
  const events = c?.pi?.events ?? c?.events;
  if (!events || typeof events.emit !== "function") return;
  const safeEmit = (channel: string, data: unknown): boolean => {
    try {
      events.emit(channel, data);
      return true;
    } catch {
      /* never break session start */
      return false;
    }
  };
  const safeOn = (channel: string, handler: (data: unknown) => void): void => {
    try {
      events.on?.(channel, handler);
    } catch {
      /* a stale runtime's `on` throws — nothing to wire */
    }
  };
  const declare = () => {
    safeEmit(REGISTER_TOOL_UPDATE_FILTER_CHANNEL, AGENT_TOOL_UPDATE_FILTER);
    return safeEmit(REGISTER_EVENT_FORWARD_CHANNEL, SUBAGENTS_FORWARD_DECLARATION);
  };

  /** Ask the producer for its list; forward a snapshot only when it answered (D7). Returns whether it did. */
  const publishRegistry = (): boolean => {
    const query: { out?: unknown } = { out: undefined };
    if (!safeEmit(LIST_CHANNEL, query)) return false;
    if (!Array.isArray(query.out)) return false;
    const entries: RegistrySnapshotPayload["entries"] = [];
    const seen = new Set<string>();
    for (const e of query.out) {
      if (!e || typeof e !== "object") continue;
      const rec = e as { agentId?: unknown; id?: unknown; status?: unknown };
      const agentId = typeof rec.agentId === "string" ? rec.agentId : rec.id;
      const status = mapProducerStatus(rec.status);
      if (typeof agentId !== "string" || !agentId || !status || seen.has(agentId)) continue;
      seen.add(agentId);
      entries.push({ agentId, status });
    }
    const snapshot: RegistrySnapshotPayload = { scope: "registry", entries, takenAt: Date.now(), background: true };
    safeEmit(REGISTRY_SNAPSHOT_CHANNEL, snapshot);
    return true;
  };

  // One retry when bridge-ready got no answer: the first lifecycle emission proves a producer is active.
  let retryArmed = false;
  declare();
  safeOn(BRIDGE_READY_CHANNEL, () => {
    // Declare FIRST so the snapshot channel is subscribed when it is emitted.
    declare();
    retryArmed = !publishRegistry();
  });
  for (const channel of ["subagents:created", "subagents:started", "subagents:completed", "subagents:failed"]) {
    safeOn(channel, () => {
      if (!retryArmed) return;
      retryArmed = false;
      publishRegistry();
    });
  }
}
