/**
 * Bridge → server lane client (task 8.3, design D3): one wrapper over
 * `requestPluginServer("agent-teams", …)` for `agent-teams/call` and the four
 * lifecycle types, plus the error-code → readable-text mapping the tools use.
 * The caller identity is the lane socket's session id: nothing here sends one.
 * See change: add-agent-teams-core.
 */
import { type PluginLaneReply, requestPluginServer } from "@blackbelt-technology/dashboard-plugin-runtime/bridge";
import { AGENT_TEAMS_PLUGIN_ID } from "../shared/plugin-id.js";
import {
  type AckPayload,
  type BusyPayload,
  type HelloPayload,
  type HelloReply,
  type IdlePayload,
  LANE_ACK,
  LANE_BUSY,
  LANE_CALL,
  LANE_HELLO,
  LANE_IDLE,
  type TeamOp,
} from "../shared/protocol.js";

export type LaneRequest = (pluginId: string, type: string, payload?: unknown) => Promise<PluginLaneReply>;

/** A reply the bridge can act on: the server's op result, or a lane/transport failure (`transport:true`). */
export type LaneResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message?: string; details?: Record<string, unknown>; transport: boolean };

/** Lane failures where the request never reached an agent-teams handler (retry-able). */
const TRANSPORT_ERRORS = new Set(["unavailable", "timeout", "disconnected", "no_handler"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function interpret<T>(reply: PluginLaneReply): LaneResult<T> {
  if (!reply.ok) return { ok: false, error: reply.error, transport: TRANSPORT_ERRORS.has(reply.error) };
  const r = reply.result;
  if (!isRecord(r) || typeof r.ok !== "boolean") return { ok: false, error: "bad_reply", transport: false };
  if (r.ok) return { ok: true, data: r.data as T };
  return {
    ok: false,
    error: typeof r.error === "string" ? r.error : "bad_reply",
    ...(typeof r.message === "string" ? { message: r.message } : {}),
    ...(isRecord(r.details) ? { details: r.details } : {}),
    transport: false,
  };
}

export interface LaneClient {
  call(op: TeamOp, args: unknown): Promise<LaneResult<unknown>>;
  hello(payload: HelloPayload): Promise<LaneResult<HelloReply>>;
  busy(): Promise<LaneResult<unknown>>;
  idle(payload: IdlePayload): Promise<LaneResult<unknown>>;
  ack(ids: readonly number[]): Promise<LaneResult<unknown>>;
}

export function createLaneClient(request: LaneRequest = requestPluginServer): LaneClient {
  const send = async <T>(type: string, payload: unknown): Promise<LaneResult<T>> => {
    try {
      return interpret<T>(await request(AGENT_TEAMS_PLUGIN_ID, type, payload));
    } catch (err) {
      return { ok: false, error: "unavailable", message: (err as Error).message, transport: true };
    }
  };
  return {
    call: (op, args) => send(LANE_CALL, { op, args }),
    hello: (payload) => send<HelloReply>(LANE_HELLO, payload),
    busy: () => send<unknown>(LANE_BUSY, {} satisfies BusyPayload),
    idle: (payload) => send<unknown>(LANE_IDLE, payload),
    ack: (ids) => send<unknown>(LANE_ACK, { ids: [...ids] } satisfies AckPayload),
  };
}

const TEXT: Record<string, string> = {
  unavailable: "the dashboard is not connected, so team tools are unavailable right now",
  timeout: "the dashboard did not answer in time; retry once",
  disconnected: "the dashboard connection dropped; retry once",
  no_handler: "this dashboard does not support agent teams",
  request_too_large: "the request is too large",
  origin_denied: "team tools work only in a local dashboard session",
  already_in_team: "this session is already in a team",
  already_claimed: "the task is already claimed by another member",
  blocked: "the task is blocked by unfinished dependencies",
  broadcast_lead_only: "only the lead may broadcast",
  cwd_outside_lead: "cwd must be inside the lead's working directory or a configured extra root",
  dependency_cycle: "that dependency would create a cycle",
  invalid_args: "invalid arguments",
  invalid_transition: "that status change is not allowed",
  kind_reserved: "that message kind is reserved for the server",
  lead_confined: "this session is confined by another plugin and cannot lead a team",
  member_degraded: "your team tools are refused until your guard is healthy again",
  member_gone: "that teammate is gone",
  members_active: "teammates are still active (use force to close the team anyway)",
  message_too_long: "the message is too long",
  mode_unavailable: "that teammate mode is not available",
  name_reserved: "that name is reserved",
  name_taken: "a teammate with that name already exists",
  nested_team_forbidden: "teammates cannot create teams",
  not_in_team: "this session is not in a team",
  not_lead: "only the lead may do that",
  not_owner: "only the task's owner or the lead may do that",
  nothing_to_resume: "that teammate has no recorded session to resume",
  op_blocked: "the operation was blocked",
  owner_locked: "the task owner cannot be changed",
  rate_limited: "you are sending messages too fast; wait a little",
  self_message: "you cannot message yourself",
  skill_not_found: "a requested skill was not found",
  skill_resolution_unavailable: "skills cannot be resolved on this host, so a skill allowlist cannot be applied",
  task_cap_reached: "the task limit is reached",
  team_cap_reached: "the active-team limit is reached",
  team_closed: "the team is closed",
  team_full: "the team is at its teammate limit",
  unknown_op: "unknown operation",
  unknown_owner: "no such member",
  unknown_recipient: "no such recipient",
  unknown_task: "no such task",
  urgent_lead_only: "only the lead may send urgent messages",
};

/** Lowercase, one-line description of a failed call for the model (`code: text (detail)`). */
export function describeError(res: { error: string; message?: string; details?: Record<string, unknown> }): string {
  const base = TEXT[res.error] ?? res.error.replace(/_/g, " ");
  const detail = res.message ? ` (${res.message})` : "";
  return `${res.error}: ${base}${detail}`;
}
