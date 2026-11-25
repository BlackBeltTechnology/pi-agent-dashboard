/**
 * `toolDetails` shape validation for the team tool renderers (design D5; task 8.3).
 * `details` is an untrusted object: the same tool name may come from another
 * extension, the result may be elided, or a key may have the wrong type. Each op
 * has a strict validator; anything else yields `undefined` and the renderer falls
 * back to the input summary + result text (never blank). `{op, ok:false, error}`
 * yields the error code. Pure, no React.
 * See change: add-agent-teams-ui.
 */
import type { TeamOp } from "../shared/protocol.js";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const optStr = (v: unknown): v is string | undefined => v === undefined || typeof v === "string";
const strList = (v: unknown): v is string[] => Array.isArray(v) && v.every(str);
const countMap = (v: unknown): v is Record<string, number> => isObj(v) && Object.values(v).every((n) => typeof n === "number" && Number.isFinite(n));

interface TaskBrief {
  id: string;
  title: string;
  status: string;
  owner?: string;
  claimable: boolean;
}

export type ToolView =
  | { op: "TeamCreate"; team: { name: string; maxTeammates: number; mode: string } }
  | { op: "TeammateSpawn"; member: { name: string; role?: string; status: string; model?: string } }
  | { op: "TeamStatus"; members: Record<string, number>; tasks: Record<string, number> }
  | { op: "TeamDelete"; force: boolean }
  | { op: "SendMessage"; to?: string; delivery: string }
  | { op: "TaskCreate"; task: { id: string; title: string; blockedBy: string[]; owner?: string } }
  | { op: "TaskList"; tasks: TaskBrief[] }
  | { op: "TaskGet"; task: { id: string; title: string; status: string; description: string; owner?: string; blockedBy: string[] } }
  | { op: "TaskUpdate"; task: { id: string; title: string; from: string; to: string; owner?: string } }
  | { op: "ShutdownRequest" }
  | { op: "ShutdownResponse"; approve: boolean };

export type ParsedDetails = { kind: "ok"; view: ToolView } | { kind: "error"; code: string };

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one flat switch over the closed set of 11 ops, each arm a plain shape check — splitting it only adds indirection
function viewOf(op: TeamOp, d: Obj): ToolView | undefined {
  switch (op) {
    case "TeamCreate": {
      const t = d.team;
      return isObj(t) && str(t.name) && typeof t.maxTeammates === "number" && str(t.mode) ? { op, team: { name: t.name, maxTeammates: t.maxTeammates, mode: t.mode } } : undefined;
    }
    case "TeammateSpawn": {
      const m = d.member;
      return isObj(m) && str(m.name) && str(m.status) && optStr(m.role) && optStr(m.model) ? { op, member: { name: m.name, status: m.status, ...(m.role !== undefined ? { role: m.role } : {}), ...(m.model !== undefined ? { model: m.model } : {}) } } : undefined;
    }
    case "TeamStatus": {
      const c = d.counts;
      return isObj(c) && countMap(c.members) && countMap(c.tasks) ? { op, members: c.members, tasks: c.tasks } : undefined;
    }
    case "TeamDelete":
      return d.force === undefined || typeof d.force === "boolean" ? { op, force: d.force === true } : undefined;
    case "SendMessage":
      return str(d.delivery) && optStr(d.to) ? { op, delivery: d.delivery, ...(d.to !== undefined ? { to: d.to } : {}) } : undefined;
    case "TaskCreate": {
      const t = d.task;
      return isObj(t) && str(t.id) && str(t.title) && strList(t.blockedBy) && optStr(t.owner) ? { op, task: { id: t.id, title: t.title, blockedBy: t.blockedBy, ...(t.owner !== undefined ? { owner: t.owner } : {}) } } : undefined;
    }
    case "TaskList": {
      const list = d.tasks;
      if (!Array.isArray(list)) return undefined;
      const tasks: TaskBrief[] = [];
      for (const t of list) {
        if (!isObj(t) || !str(t.id) || !str(t.title) || !str(t.status) || typeof t.claimable !== "boolean" || !optStr(t.owner)) return undefined;
        tasks.push({ id: t.id, title: t.title, status: t.status, claimable: t.claimable, ...(t.owner !== undefined ? { owner: t.owner } : {}) });
      }
      return { op, tasks };
    }
    case "TaskGet": {
      const t = d.task;
      return isObj(t) && str(t.id) && str(t.title) && str(t.status) && str(t.description) && strList(t.blockedBy) && optStr(t.owner)
        ? { op, task: { id: t.id, title: t.title, status: t.status, description: t.description, blockedBy: t.blockedBy, ...(t.owner !== undefined ? { owner: t.owner } : {}) } }
        : undefined;
    }
    case "TaskUpdate": {
      const t = d.task;
      return isObj(t) && str(t.id) && str(t.title) && str(t.from) && str(t.to) && optStr(t.owner) ? { op, task: { id: t.id, title: t.title, from: t.from, to: t.to, ...(t.owner !== undefined ? { owner: t.owner } : {}) } } : undefined;
    }
    case "ShutdownRequest":
      return { op };
    case "ShutdownResponse":
      return typeof d.approve === "boolean" ? { op, approve: d.approve } : undefined;
    default:
      return undefined;
  }
}

/** Validate `details` for `toolName`; `undefined` = missing, foreign (another op) or malformed. */
export function parseToolDetails(toolName: TeamOp, details: unknown): ParsedDetails | undefined {
  if (!isObj(details) || details.op !== toolName || typeof details.ok !== "boolean") return undefined;
  if (!details.ok) return str(details.error) && details.error !== "" ? { kind: "error", code: details.error } : undefined;
  const view = viewOf(toolName, details);
  return view ? { kind: "ok", view } : undefined;
}
