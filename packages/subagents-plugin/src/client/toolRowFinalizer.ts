/**
 * `Agent` tool-row finalizer of the subagents plugin.
 *
 * The shell's pure event reducer asks this finalizer FIRST at every site where a
 * subagent's outcome and an `Agent` chat row meet; it is the only writer of
 * `SessionState.subagents` besides the slice (`./sessionEventReducer.ts`). The
 * shell registers it on the plugin's behalf (the client entry exports it as
 * `toolRowFinalizers`). A hook returns the new state, or `undefined` to decline
 * (the shell's generic heal then runs: with the plugin disabled an orphan Agent
 * row still stops spinning, it just carries no subagent state).
 *
 * Hooks (all pure; they never mutate their input):
 * - `onSessionEvent`: `subagent_completed|failed` write `completed`/`failed` and stop
 *   the subagent's running Agent row; `agent_settled` stops rows whose subagent is
 *   already terminal.
 * - `onToolExecution`: `tool_execution_update` hydrates `running` from the durable
 *   `partialResult` (late-tick block included); `tool_execution_end` backfills the
 *   terminal state so `/resume` + refresh re-hydrate the inspector map.
 *
 * Contract (spec `session-end-orphan-heal`): finalize only `running` rows; never
 * clobber a real terminal row; a synthesized (`healedBy`) event never changes a
 * `completed`/`failed` subagent; heal provenance is recorded on the subagent and a
 * real write clears it. The dual index (`agentId` + `agentSessionId`) is kept by
 * `setSubagentState`, so both keys share ONE object.
 *
 * See change: decouple-plugins-from-core (D5 item 8); finalize-agent-card-on-subagent-stop;
 * fix-replay-fabricates-orphan-end-for-live-calls; fix-subagent-live-detail-durable-hydration.
 */
import type { ToolRowFinalizer, ToolRowFinalizerOpts } from "@blackbelt-technology/dashboard-plugin-runtime";
import {
  readSubagentDetails,
  type SubagentState,
  setSubagentState,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/subagent-types.js";
import type { DashboardEvent as SessionEventLike } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { SubagentSessionSlice } from "./sessionEventReducer.js";

/** Never-empty body when a completed subagent reported no result. */
export const SUBAGENT_DONE_NO_RESULT = "subagent finished";
/** Never-empty body when a failed subagent reported no error text. */
export const SUBAGENT_FAILED_NO_ERROR = "subagent failed";

/** Detail keys that exist only because a heal set them; a real end clears them. */
const HEAL_ONLY_DETAIL_KEYS = ["healedBy", "resultMissing"] as const;

/** The part of a chat row this finalizer reads and writes. */
interface AgentRow {
  role?: string;
  toolName?: string;
  toolStatus?: string;
  toolCallId?: string;
  toolDetails?: Record<string, unknown>;
  result?: string;
}

/** The part of the shell's session state this finalizer reads and writes. */
export interface AgentFinalizerState extends SubagentSessionSlice {
  messages: AgentRow[];
  toolCalls: Map<string, { status?: string }>;
}

type Data = Record<string, unknown>;
type Opts = ToolRowFinalizerOpts<AgentFinalizerState> | undefined;

const isTerminal = (sub: SubagentState | undefined): sub is SubagentState =>
  sub?.status === "completed" || sub?.status === "failed";

const stringOf = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/**
 * Newest-first indices of `Agent` rows a finalize may stop (design D2): top-level
 * `toolResult`, `toolName:"Agent"`, row running, `toolCalls` entry running. `agentId`
 * narrows to the row linked to that subagent.
 */
function eligibleAgentRows(state: AgentFinalizerState, agentId?: string): number[] {
  const out: number[] = [];
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m.role !== "toolResult" || m.toolName !== "Agent" || m.toolStatus !== "running" || !m.toolCallId) continue;
    if (state.toolCalls.get(m.toolCallId)?.status !== "running") continue;
    if (agentId !== undefined && m.toolDetails?.agentId !== agentId) continue;
    out.push(i);
    if (agentId !== undefined) break;
  }
  return out;
}

/**
 * Stop one running Agent row from its subagent's terminal state by reducing a
 * synthesized `tool_execution_end` through the shell's real end arm (design D1). The
 * timestamp is the TRIGGER's, so the same stream yields the same `duration`. A later
 * real end overwrites it. Without a `reduce` the row is left to the shell's neutral heal.
 */
function finalizeRowFromSubagent(
  state: AgentFinalizerState,
  toolCallId: string,
  sub: SubagentState,
  healedBy: string,
  timestamp: number,
  opts: Opts,
): AgentFinalizerState | undefined {
  if (!opts?.reduce) return undefined;
  const failedSub = sub.status === "failed";
  const result = failedSub ? sub.error || SUBAGENT_FAILED_NO_ERROR : sub.result || SUBAGENT_DONE_NO_RESULT;
  const details: Record<string, unknown> = {
    agentId: sub.id,
    status: failedSub ? "error" : "completed",
    ...(failedSub ? { error: result } : {}),
    ...(sub.durationMs !== undefined ? { durationMs: sub.durationMs } : {}),
    ...(sub.toolUses !== undefined ? { toolUses: sub.toolUses } : {}),
  };
  return opts.reduce(state, {
    eventType: "tool_execution_end",
    timestamp,
    data: { toolCallId, toolName: "Agent", result, isError: failedSub, healedBy, details },
  });
}

/** `subagent_completed|failed`: write the terminal state, then stop the subagent's Agent row. */
function onSubagentTerminal(state: AgentFinalizerState, event: SessionEventLike, opts: Opts): AgentFinalizerState {
  const data = event.data as Data;
  const id = data.id as string;
  const details = (data.details as Record<string, unknown> | undefined) ?? undefined;
  const existing = state.subagents.get(id);
  // A synthesized heal never regresses a subagent that already reported a real terminal state.
  // See change: heal-orphaned-tool-cards-on-session-end (design D4).
  if (data.healedBy !== undefined && isTerminal(existing)) return state;
  const healedBy = stringOf(data.healedBy) || undefined;
  const subagents = new Map(state.subagents);
  setSubagentState(subagents, {
    ...(existing ?? { id, type: (data.type as string) ?? "unknown", description: (data.description as string) ?? "" }),
    status: event.eventType === "subagent_completed" ? "completed" : "failed",
    // Heal provenance (D5): set by a synthesized terminal, cleared by a real one.
    healedBy,
    result: data.result as string | undefined,
    error: data.error as string | undefined,
    durationMs: data.durationMs as number | undefined,
    tokens: data.tokens as SubagentState["tokens"],
    toolUses: data.toolUses as number | undefined,
    ...readSubagentDetails(details),
    liveBlock: undefined,
  });
  const next: AgentFinalizerState = { ...state, subagents };
  // The subagent stopped: finalize its Agent card even if the tool's own end was lost.
  // Propagates the trigger's heal marker (e.g. `session_ended`).
  // See change: finalize-agent-card-on-subagent-stop (D3a).
  if (typeof id === "string") {
    const [idx] = eligibleAgentRows(next, id);
    const sub = next.subagents.get(id);
    if (idx !== undefined && sub) {
      return (
        finalizeRowFromSubagent(next, next.messages[idx].toolCallId!, sub, healedBy ?? "subagent_stopped", event.timestamp, opts) ??
        next
      );
    }
  }
  return next;
}

/**
 * `agent_settled`: a foreground Agent call cannot outlive its parent's settle. A row
 * whose subagent is already terminal finishes with that outcome; every other row is
 * declined to the shell's neutral heal. See change: finalize-agent-card-on-subagent-stop (D4).
 */
function onSettled(state: AgentFinalizerState, event: SessionEventLike, opts: Opts): AgentFinalizerState | undefined {
  let healed = state;
  for (const idx of eligibleAgentRows(state)) {
    const m = healed.messages[idx];
    const agentId = stringOf(m.toolDetails?.agentId);
    const sub = agentId ? healed.subagents.get(agentId) : undefined;
    if (!isTerminal(sub)) continue;
    healed = finalizeRowFromSubagent(healed, m.toolCallId!, sub, "turn_settled", event.timestamp, opts) ?? healed;
  }
  return healed === state ? undefined : healed;
}

/**
 * Merge `patch` over the existing subagent, keeping prior non-undefined fields (live +
 * replay commute) and falling back to the details' own type/description for a first sight.
 */
function mergeSubagent(
  id: string,
  existing: SubagentState | undefined,
  details: Data | undefined,
  patch: Partial<SubagentState>,
): SubagentState {
  return {
    id,
    type: existing?.type ?? stringOf(details?.subagentType) ?? "unknown",
    description: existing?.description ?? stringOf(details?.description) ?? "",
    ...existing,
    ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
  } as SubagentState;
}

/** Revive a subagent the `session_ended` heal failed: running again, heal marker and error dropped. */
function reopenHealedSubagent(subagents: Map<string, SubagentState>, agentId: string): Map<string, SubagentState> {
  const sub = subagents.get(agentId);
  if (sub?.healedBy !== "session_ended") return subagents;
  const { healedBy: _h, error: _e, ...rest } = sub;
  const out = new Map(subagents);
  setSubagentState(out, { ...rest, status: "running" });
  return out;
}

/**
 * Hydrate one subagent `running` from the tick's `details`. A terminal subagent keeps its
 * status (a late/reordered partial never regresses it); the heal marker records why the
 * CURRENT terminal status exists, so a running write drops it.
 * See change: fix-replay-fabricates-orphan-end-for-live-calls (D5).
 */
function hydrateFromTick(subagents: Map<string, SubagentState>, agentId: string, details: Data): Map<string, SubagentState> {
  const out = new Map(subagents);
  const existing = out.get(agentId);
  const terminal = isTerminal(existing);
  const tokensUsage = details.tokensUsage as SubagentState["tokens"] | undefined;
  const merged = mergeSubagent(agentId, existing, details, {
    ...(terminal ? {} : { status: "running" }),
    ...(tokensUsage !== undefined ? { tokens: tokensUsage } : {}),
    ...readSubagentDetails(details),
  });
  if (!terminal) delete merged.healedBy;
  setSubagentState(out, merged);
  return out;
}

/** A finished subagent's card is not reopened by a late tick: restore the prior terminal fields, merge the rest. */
function keepTerminalRow(state: AgentFinalizerState, idx: number, priorRow: AgentRow): AgentFinalizerState {
  const kept: Record<string, unknown> = { ...(state.messages[idx].toolDetails ?? {}) };
  for (const key of ["status", "error", ...HEAL_ONLY_DETAIL_KEYS]) {
    if (priorRow.toolDetails && key in priorRow.toolDetails) kept[key] = priorRow.toolDetails[key];
    else delete kept[key];
  }
  const messages = [...state.messages];
  messages[idx] = { ...state.messages[idx], result: priorRow.result, toolDetails: kept };
  return { ...state, messages };
}

/**
 * The late-tick block, after hydration. A finished subagent's card stays terminal (a late tick
 * only merges stats); a row that just learned an agent id whose subagent already stopped is
 * finalized. See change: finalize-agent-card-on-subagent-stop (D3b, D5).
 */
function settleLateTick(
  next: AgentFinalizerState,
  idx: number,
  priorRow: AgentRow,
  priorRunning: boolean,
  tickAgentId: string | undefined,
  event: SessionEventLike,
  opts: Opts,
): AgentFinalizerState {
  if (!priorRunning) {
    const priorAgentId = stringOf(priorRow.toolDetails?.agentId) ?? tickAgentId;
    return isTerminal(priorAgentId ? next.subagents.get(priorAgentId) : undefined) ? keepTerminalRow(next, idx, priorRow) : next;
  }
  const toolCallId = (event.data as Data).toolCallId as string;
  const sub = tickAgentId ? next.subagents.get(tickAgentId) : undefined;
  if (!isTerminal(sub) || next.messages[idx].role !== "toolResult" || next.toolCalls.get(toolCallId)?.status !== "running") {
    return next;
  }
  return finalizeRowFromSubagent(next, toolCallId, sub, "subagent_stopped", event.timestamp, opts) ?? next;
}

/**
 * `tool_execution_update`: durable live hydration of the inspector map from the Agent
 * tool's partial `details` (they carry the full running snapshot on every tick and ride
 * the DURABLE message channel that survives the loss of ephemeral `subagent_*` frames),
 * plus the late-tick block. `state` is post the shell's row write; `opts.prior` is the
 * pre-event state.
 * See change: fix-subagent-live-detail-durable-hydration, finalize-agent-card-on-subagent-stop (D3b, D5).
 */
function onUpdate(state: AgentFinalizerState, event: SessionEventLike, opts: Opts): AgentFinalizerState | undefined {
  const data = event.data as Data;
  const toolCallId = data.toolCallId as string;
  const partial = data.partialResult;
  if (!partial || typeof partial !== "object") return undefined;
  const idx = state.messages.findLastIndex((m) => m.toolCallId === toolCallId);
  if (idx === -1 || state.messages[idx].toolName !== "Agent") return undefined;
  const details = (partial as Data).details as Data | undefined;
  const tickAgentId = stringOf(details?.agentId);
  const priorRow = (opts?.prior ?? state).messages[idx] ?? state.messages[idx];
  // The shell reopened a row a `session_ended` heal had finalized (a live tick proves the
  // producer is alive); a row that was already running is not "reopened".
  const reopened = priorRow.toolStatus !== "running" && priorRow.toolDetails?.healedBy === "session_ended";
  const priorRunning = priorRow.toolStatus === "running" || reopened;

  // Reopen a subagent the SAME heal failed — only when its terminal state came from that heal.
  const rowAgentId = tickAgentId ?? stringOf(priorRow.toolDetails?.agentId);
  let subagents = reopened && rowAgentId ? reopenHealedSubagent(state.subagents, rowAgentId) : state.subagents;
  if (tickAgentId && details) subagents = hydrateFromTick(subagents, tickAgentId, details);
  let next: AgentFinalizerState = subagents === state.subagents ? state : { ...state, subagents };

  next = settleLateTick(next, idx, priorRow, priorRunning, tickAgentId, event, opts);
  return next === state ? undefined : next;
}

/** Build the terminal patch of a `tool_execution_end` for its subagent. */
function endPatch(data: Data, endDetails: Data | undefined): Partial<SubagentState> {
  const isError = data.isError as boolean;
  const resultStr = stringOf(data.result);
  const durationMs = typeof endDetails?.durationMs === "number" ? endDetails.durationMs : undefined;
  const tokensUsage = endDetails?.tokensUsage as SubagentState["tokens"] | undefined;
  const toolUses = typeof endDetails?.toolUses === "number" ? endDetails.toolUses : undefined;
  return {
    status: isError ? "failed" : "completed",
    ...(resultStr && !isError ? { result: resultStr } : {}),
    ...(isError ? { error: resultStr ?? stringOf(endDetails?.error) } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(tokensUsage !== undefined ? { tokens: tokensUsage } : {}),
    ...(toolUses !== undefined ? { toolUses } : {}),
    ...readSubagentDetails(endDetails),
  };
}

/**
 * `tool_execution_end`: backfill the subagent map from the Agent's end so `/resume` and
 * page-refresh re-hydrate the inspector map (state replay re-emits only the end). The merge
 * keeps prior non-undefined fields, so a live `subagent_completed` before or after commutes.
 * A synthesized heal never regresses a subagent that is already terminal. See change:
 * add-subagent-inspector §12 (D7); heal-orphaned-tool-cards-on-session-end (D4).
 */
function onEnd(state: AgentFinalizerState, event: SessionEventLike): AgentFinalizerState | undefined {
  const data = event.data as Data;
  if (data.toolName !== "Agent") return undefined;
  const endDetails = data.details as Data | undefined;
  const agentId = stringOf(endDetails?.agentId);
  if (!agentId) return undefined;
  const existing = state.subagents.get(agentId);
  if (data.healedBy !== undefined && isTerminal(existing)) return undefined;
  const merged = mergeSubagent(agentId, existing, endDetails, endPatch(data, endDetails));
  // Record which heal produced this terminal; a real end clears it.
  // See change: fix-replay-fabricates-orphan-end-for-live-calls (D5).
  const healedBy = stringOf(data.healedBy);
  if (healedBy) merged.healedBy = healedBy;
  else delete merged.healedBy;
  const subagents = new Map(state.subagents);
  setSubagentState(subagents, merged);
  return { ...state, subagents };
}

const agentFinalizer: ToolRowFinalizer<AgentFinalizerState> = {
  toolName: "Agent",
  onToolExecution(state, event, opts) {
    if (event.eventType === "tool_execution_update") return onUpdate(state, event, opts);
    if (event.eventType === "tool_execution_end") return onEnd(state, event);
    return undefined;
  },
  onSessionEvent(state, event, opts) {
    if (event.eventType === "subagent_completed" || event.eventType === "subagent_failed") {
      return onSubagentTerminal(state, event, opts);
    }
    if (event.eventType === "agent_settled") return onSettled(state, event, opts);
    return undefined;
  },
};

/** Tool-row finalizers the shell registers on this plugin's behalf. */
export const toolRowFinalizers: ToolRowFinalizer<AgentFinalizerState>[] = [agentFinalizer];
