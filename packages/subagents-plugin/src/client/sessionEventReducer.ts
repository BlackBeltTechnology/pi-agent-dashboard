/**
 * Session event reducer slice of the subagents plugin.
 *
 * Folds the producer's `subagent_created|started|entry|delta` frames into
 * the plugin's `SessionState.pluginState` slot. The shell registers this slice on the plugin's
 * behalf (the client entry exports it as `sessionEventReducer`) and applies it
 * in the pure event reducer before the default branch; with the plugin
 * disabled the slice does not run and the events fold into the owned-event
 * group row instead.
 *
 * Pure: returns the SAME state when a frame changes nothing, otherwise a new
 * state with a fresh `subagents` Map (the previous Map is never mutated).
 *
 * `subagent_completed|failed` are OWNED here too (listed in `eventTypes`, so with
 * the plugin off they fold into the owned group row) but written by the Agent
 * tool-row finalizer (`./toolRowFinalizer.ts`, `onSessionEvent`), which also owns
 * the `partialResult` hydration and the `/resume` backfill. This slice leaves
 * them untouched.
 *
 * See change: decouple-plugins-from-core (D5 item 6); add-plugin-bridge-contributions (D7).
 */
import type { SessionEventReducerSlice } from "@blackbelt-technology/dashboard-plugin-runtime";
import {
  applyLiveBlockPiece,
  isTerminalSubagentStatus,
  readSubagentDetails,
  type SubagentState,
  type SubagentTimelineEntry,
  setSubagentState,
} from "../subagent-types.js";
import { type PluginStateSlice, subagentsOf, withSubagentMap } from "./pluginState.js";

/** The part of the shell's session state this slice reads and writes. */
export type SubagentSessionSlice = PluginStateSlice;

function withSubagents<S extends SubagentSessionSlice>(
  state: S,
  write: (map: Map<string, SubagentState>) => void,
): S {
  const subagents = new Map(subagentsOf(state));
  write(subagents);
  return withSubagentMap(state, subagents);
}

type Data = Record<string, unknown>;
type Reduce = (state: SubagentSessionSlice, data: Data, timestamp: number) => SubagentSessionSlice;

const detailsOf = (data: Data): Record<string, unknown> | undefined =>
  (data.details as Record<string, unknown> | undefined) ?? undefined;

/**
 * Plugin-local subagent state: the shared `SubagentState` plus the producer's
 * background mark (≥ 0.7.0). The shared `readSubagentDetails` whitelist drops
 * `details.background`, so this slice keeps it itself. Stored in the same map.
 * See change: show-background-subagents-in-dock (D1).
 */
export type PluginSubagentState = SubagentState & {
  background?: true;
  /**
   * Pi-host time (`event.timestamp`) of the newest live frame that proved this
   * subagent alive: `created` / `started` / `entry` / `delta` here, and the Agent
   * tool's `tool_execution_update` in the finalizer. A reconcile frame changes
   * the subagent only when this is absent or not later than the frame's
   * `takenAt` / `answeredAt`. See change: fix-background-subagent-ghost-rows (D5).
   */
  lastFrameAt?: number;
  /** A `__truncated` terminal frame ended this row: its final result was too large to keep. */
  resultTruncated?: true;
};

/** `{ lastFrameAt }` when the frame carries a numeric time, else nothing (never moves backwards, so a replayed older frame is harmless). */
const stamp = (timestamp: number, existing?: SubagentState): { lastFrameAt?: number } => {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return {};
  const prev = (existing as PluginSubagentState | undefined)?.lastFrameAt;
  return { lastFrameAt: prev !== undefined && prev > timestamp ? prev : timestamp };
};

/** True when the subagent was started with `run_in_background`. */
export const isBackgroundSubagent = (sub: SubagentState | undefined): boolean =>
  (sub as PluginSubagentState | undefined)?.background === true;

/**
 * Sticky background reader: `{ background: true }` only when the frame says so,
 * otherwise nothing — a frame without (or with a false) flag never clears it.
 */
const readBackground = (details: Record<string, unknown> | undefined): { background?: true } =>
  details?.background === true ? { background: true } : {};

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Short id shown when no frame carries a type or name. */
const shortId = (id: string): string => id.slice(0, 8);

/** A type no frame supplied: written by a stub (entry/delta before created/started). */
const isPlaceholderType = (id: string, type: string | undefined): boolean =>
  !type || type === "unknown" || type === shortId(id);

/**
 * Type and task of a row first seen from `data`: `details.*` before top-level
 * fields, type falling back to the display name, then the short id (never
 * `unknown`). First-wins: a type or task already read is kept; a stub's
 * placeholder type is replaced. See change: move-subagents-to-plugin (D8).
 */
function identityOf(id: string, data: Data, existing: SubagentState | undefined): { type: string; description: string } {
  const d = detailsOf(data);
  const read = str(d?.subagentType) ?? str(data.type) ?? str(d?.displayName) ?? shortId(id);
  return {
    type: existing && !isPlaceholderType(id, existing.type) ? existing.type : read,
    description: str(existing?.description) ?? str(d?.description) ?? str(data.description) ?? "",
  };
}

/** Heal markers a live `subagent_started` may revive. See change: move-subagents-to-plugin (D7). */
export const REVIVABLE_HEALS: ReadonlySet<string | undefined> = new Set(["session_ended", "untracked", "idle"]);

// First-wins merge: a created frame (live, replayed or carried) never regresses
// an existing row; it only fills what is missing. Applying it twice == once.
const created: Reduce = (state, data, timestamp) => {
  const id = data.id as string;
  if (typeof id !== "string" || !id) return state;
  return withSubagents(state, (subagents) => {
    const existing = subagents.get(id);
    const incoming = {
      ...readSubagentDetails(detailsOf(data)),
      ...readBackground(detailsOf(data)),
    };
    const defined = Object.fromEntries(Object.entries(existing ?? {}).filter(([, v]) => v !== undefined));
    setSubagentState(subagents, {
      ...incoming,
      status: "created",
      ...defined,
      id,
      ...identityOf(id, data, existing),
      ...stamp(timestamp, existing),
    } as PluginSubagentState);
  });
};

const started: Reduce = (state, data, timestamp) => {
  const id = data.id as string;
  if (typeof id !== "string" || !id) return state;
  const existing = subagentsOf(state).get(id);
  // Terminal never regresses, except a revivable heal (the producer is provably alive).
  if (isTerminalSubagentStatus(existing?.status) && !REVIVABLE_HEALS.has(existing?.healedBy)) return state;
  return withSubagents(state, (subagents) => {
    const { error: _e, ...rest } = (existing ?? {}) as SubagentState;
    setSubagentState(subagents, {
      ...rest,
      id,
      ...identityOf(id, data, existing),
      status: "running",
      healedBy: undefined,
      startedAt: existing?.startedAt ?? (typeof timestamp === "number" ? timestamp : Date.now()),
      ...readSubagentDetails(detailsOf(data)),
      ...readBackground(detailsOf(data)),
      ...stamp(timestamp, existing),
    } as PluginSubagentState);
  });
};

// One finished timeline step from the producer's entry stream (≥ 0.3.0),
// forwarded by this plugin's bridge declaration. Placed at its stable `index`
// (duplicate index ignored); a `blockId` closes that in-progress block.
// See change: add-plugin-bridge-contributions (D7).
const entryFrame: Reduce = (state, data, timestamp) => {
  const { agentId, index, entry } = data;
  if (typeof agentId !== "string" || typeof index !== "number" || !Number.isInteger(index) || index < 0) return state;
  if (!entry || typeof entry !== "object") return state;
  const existing = subagentsOf(state).get(agentId);
  const blockId = typeof data.blockId === "number" ? data.blockId : undefined;
  if (existing?.entries?.[index] && blockId === undefined) return state; // duplicate
  return withSubagents(state, (subagents) => {
    const entries = existing?.entries ? [...existing.entries] : [];
    if (!entries[index]) entries[index] = entry as SubagentTimelineEntry;
    let liveBlock = existing?.liveBlock;
    let closedBlockMax = existing?.closedBlockMax;
    if (blockId !== undefined) {
      closedBlockMax = Math.max(closedBlockMax ?? -1, blockId);
      if (liveBlock && liveBlock.blockId <= blockId) liveBlock = undefined;
    }
    setSubagentState(subagents, {
      ...(existing ?? { id: agentId, type: shortId(agentId), description: "", status: "running" }),
      entries,
      liveBlock,
      closedBlockMax,
      ...stamp(timestamp, existing),
    } as PluginSubagentState);
  });
};

const isIndex = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

// One append-only piece of the subagent's in-progress block (producer ≥ 0.4.0).
// See change: add-plugin-bridge-contributions (D7).
const deltaFrame: Reduce = (state, data, timestamp) => {
  const { agentId, blockId, offset, kind } = data;
  if (typeof agentId !== "string" || !isIndex(blockId) || !isIndex(offset)) return state;
  if (kind !== "thinking" && kind !== "text") return state;
  const text = typeof data.text === "string" ? data.text : "";
  const existing = subagentsOf(state).get(agentId);
  const liveBlock = applyLiveBlockPiece(existing, { blockId, kind, offset, text });
  if (!liveBlock || liveBlock === existing?.liveBlock) return state;
  return withSubagents(state, (subagents) => {
    setSubagentState(subagents, {
      ...(existing ?? { id: agentId, type: shortId(agentId), description: "", status: "running" }),
      liveBlock,
      ...stamp(timestamp, existing),
    } as PluginSubagentState);
  });
};

const ARMS: Record<string, Reduce> = {
  subagent_created: created,
  subagent_started: started,
  subagent_entry: entryFrame,
  subagent_delta: deltaFrame,
};

export const sessionEventReducer: SessionEventReducerSlice<SubagentSessionSlice> = {
  // `subagent_completed|failed`: owned for the plugin-off group row; the finalizer writes them.
  // `subagent_stop_result|registry_snapshot`: listed so the shell asks the finalizer, which
  // claims them (liveness reconcile). See change: fix-background-subagent-ghost-rows (D5).
  eventTypes: [
    ...Object.keys(ARMS),
    "subagent_completed",
    "subagent_failed",
    "subagent_stop_result",
    "subagent_registry_snapshot",
  ],
  reduce: (state, event) =>
    Object.hasOwn(ARMS, event.eventType) ? ARMS[event.eventType](state, event.data, event.timestamp) : state,
};
