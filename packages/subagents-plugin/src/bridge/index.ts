/**
 * subagents-plugin · bridge entry (runs inside every pi session as a pi extension).
 *
 * Declares the producer's per-step and in-progress-block streams to the main
 * dashboard bridge through the plugin event-forward registry, so core never
 * names these channels:
 *   - `subagents:entry` → `subagent_entry` (one finished timeline step)
 *   - `subagents:delta` → `subagent_delta` (append-only piece of the open block)
 * Both `stream` (every message kept in order while the bridge cannot forward),
 * keyed by `agentId` so one agent's deltas and entries keep their interleaving.
 *
 * Liveness reconcile (change: fix-background-subagent-ghost-rows, D1–D4):
 *   - `subagents:stop_result` → `subagent_stop_result` (`latest`, key `agentId`):
 *     every `subagents:stop` is answered with the COMBINED verdict of every
 *     producer activation on this bus. Producers push synchronously onto
 *     `data.verdicts`; this entry reads them in a microtask, after `emit` has
 *     run every listener. Zero verdicts (producer < 0.8.0) → no answer.
 *   - `subagents:registry_snapshot` → `subagent_registry_snapshot` (`latest`,
 *     key `scope`): on every `dashboard:bridge-ready`, AFTER the declare, query
 *     `subagents:registry {answered, entries}` and forward the union when at
 *     least one activation answered.
 *
 * Declares on activation AND on every `dashboard:bridge-ready` (load-order /
 * reload handshake). Every `on` / `emit` is wrapped: a stale runtime's `on`
 * throws, and a bridge entry must never break session start. Producer contract:
 * `pi-dashboard-subagents` ≥ 0.4.0 (`SubagentEntryEvent`, `SubagentDeltaEvent`);
 * ≥ 0.8.0 for stop verdicts and the registry query.
 * See change: add-plugin-bridge-contributions.
 */
import {
  BRIDGE_READY_CHANNEL,
  type EventForwardDeclaration,
  REGISTER_EVENT_FORWARD_CHANNEL,
} from "@blackbelt-technology/pi-dashboard-shared/event-forward-declaration.js";

export const STOP_CHANNEL = "subagents:stop";
export const STOP_RESULT_CHANNEL = "subagents:stop_result";
export const REGISTRY_QUERY_CHANNEL = "subagents:registry";
export const REGISTRY_SNAPSHOT_CHANNEL = "subagents:registry_snapshot";

export const SUBAGENTS_FORWARD_DECLARATION: EventForwardDeclaration = {
  pluginId: "subagents",
  channels: {
    "subagents:entry": { as: "subagent_entry", delivery: "stream", key: "agentId" },
    "subagents:delta": { as: "subagent_delta", delivery: "stream", key: "agentId" },
    [STOP_RESULT_CHANNEL]: { as: "subagent_stop_result", delivery: "latest", key: "agentId" },
    [REGISTRY_SNAPSHOT_CHANNEL]: { as: "subagent_registry_snapshot", delivery: "latest", key: "scope" },
  },
};

/** Dashboard-side subagent status vocabulary. */
export type DashboardSubagentStatus = "created" | "running" | "completed" | "failed" | "stopped";
export type StopPhase = "queued" | "running" | "terminal" | "unknown";

/** Combined answer forwarded as `subagent_stop_result`. */
export interface StopResultPayload {
  agentId: string;
  outcome: "stopped" | "ignored";
  phase: StopPhase;
  status?: "completed" | "failed" | "stopped";
  answeredAt: number;
}

/** Union of every activation's registry, forwarded as `subagent_registry_snapshot`. */
export interface RegistrySnapshotPayload {
  scope: "registry";
  entries: Array<{ agentId: string; status: DashboardSubagentStatus }>;
  takenAt: number;
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

const PHASE_RANK: Record<StopPhase, number> = { unknown: 0, terminal: 1, queued: 3, running: 4 };

/**
 * Combine producer verdicts (D3): `running` > `queued` > `terminal` with
 * status > `terminal` without status > `unknown`. `outcome` is `stopped` when
 * any verdict was `queued` / `running`. `undefined` for zero valid verdicts.
 */
export function combineVerdicts(
  verdicts: unknown,
): Omit<StopResultPayload, "agentId" | "answeredAt"> | undefined {
  if (!Array.isArray(verdicts)) return undefined;
  let best: { phase: StopPhase; status?: StopResultPayload["status"]; rank: number } | undefined;
  for (const v of verdicts) {
    if (!v || typeof v !== "object") continue;
    const phase = (v as { phase?: unknown }).phase;
    if (phase !== "queued" && phase !== "running" && phase !== "terminal" && phase !== "unknown") continue;
    let status: StopResultPayload["status"];
    if (phase === "terminal") {
      const mapped = mapProducerStatus((v as { status?: unknown }).status);
      if (mapped === "completed" || mapped === "failed" || mapped === "stopped") status = mapped;
    }
    // terminal-with-status ranks above terminal-without (2 vs 1).
    const rank = phase === "terminal" && status ? 2 : PHASE_RANK[phase];
    if (!best || rank > best.rank) best = { phase, status, rank };
  }
  if (!best) return undefined;
  const outcome = best.phase === "queued" || best.phase === "running" ? "stopped" : "ignored";
  return { outcome, phase: best.phase, ...(best.status ? { status: best.status } : {}) };
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
  const declare = () => safeEmit(REGISTER_EVENT_FORWARD_CHANNEL, SUBAGENTS_FORWARD_DECLARATION);

  /** Query every producer activation and forward the union (D1, D4). */
  const publishRegistry = () => {
    const query: { answered: number; entries: unknown[] } = { answered: 0, entries: [] };
    if (!safeEmit(REGISTRY_QUERY_CHANNEL, query)) return;
    if (typeof query.answered !== "number" || query.answered <= 0) return;
    const entries: RegistrySnapshotPayload["entries"] = [];
    const seen = new Set<string>();
    for (const e of Array.isArray(query.entries) ? query.entries : []) {
      if (!e || typeof e !== "object") continue;
      const agentId = (e as { agentId?: unknown }).agentId;
      const status = mapProducerStatus((e as { status?: unknown }).status);
      if (typeof agentId !== "string" || !agentId || !status || seen.has(agentId)) continue;
      seen.add(agentId);
      entries.push({ agentId, status });
    }
    const snapshot: RegistrySnapshotPayload = { scope: "registry", entries, takenAt: Date.now() };
    safeEmit(REGISTRY_SNAPSHOT_CHANNEL, snapshot);
  };

  declare();
  safeOn(BRIDGE_READY_CHANNEL, () => {
    // Declare FIRST so the snapshot channel is subscribed when it is emitted.
    declare();
    publishRegistry();
  });
  safeOn(STOP_CHANNEL, (data) => {
    if (!data || typeof data !== "object") return;
    const request = data as { agentId?: unknown; verdicts?: unknown };
    const agentId = request.agentId;
    if (typeof agentId !== "string" || !agentId) return;
    // Read after `emit` returns: every synchronous producer listener has pushed
    // its verdict by then, whatever the listener order. A verdict pushed later
    // breaks the producer contract and is not counted.
    queueMicrotask(() => {
      const combined = combineVerdicts(request.verdicts);
      if (!combined) return; // no producer answered (< 0.8.0): keep today's feedback
      const answer: StopResultPayload = { agentId, ...combined, answeredAt: Date.now() };
      safeEmit(STOP_RESULT_CHANNEL, answer);
    });
  });
}
