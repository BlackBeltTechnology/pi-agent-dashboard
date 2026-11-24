/**
 * Task list operations (tasks 4.1–4.5, 4.8–4.10; design D8, spec agent-teams-task-list):
 * `TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate` plus the actor forms
 * (`createTask`, `updateTask`, actor `server`) and `releaseTasksOf`. Every handler
 * is ONE synchronous state transition: all validation happens before the first
 * store write, and a claim is a plain check-and-set (Node's single thread makes
 * it atomic, no lock). Nothing here talks to the dispatcher or the mail layer
 * directly: `onActivity` (a claim/complete/create/assign committed) and `notify`
 * (a lead lifecycle item) are injected.
 * See change: add-agent-teams-core.
 */
import { TASK_DESCRIPTION_MAX_CHARS, TASK_TITLE_MAX_CHARS, TRUNCATION_MARKER } from "../shared/constants.js";
import type {
  OpResult,
  TaskCreateResult,
  TaskDependency,
  TaskGetResult,
  TaskListResult,
  TaskUpdateResult,
  TaskView,
} from "../shared/protocol.js";
import { sanitizeText, truncateWithMarker } from "../shared/text.js";
import type { Task, TaskStatus, Team } from "../shared/types.js";
import { isRecord, own, textField } from "./args.js";
import type { ConfigReader } from "./config.js";
import { compareTaskIds, fail, isLive } from "./op-util.js";
import type { TeamStore } from "./store.js";
import type { Telemetry } from "./telemetry.js";
import type { Logger } from "./types.js";

/** Who performs a task operation: the lead, a teammate, or the trusted in-process server actor. */
export interface Principal {
  kind: "lead" | "member" | "server";
  /** `lead`, the member name, or `server`. */
  name: string;
}

/** A lifecycle item for the lead's coalesced notice. `body` is peer-authored text (continuation lines). */
export interface LeadItem {
  head: string;
  body?: string;
  wake: boolean;
}

export interface TaskOpsDeps {
  store: TeamStore;
  config: ConfigReader;
  logger: Logger;
  telemetry: Telemetry;
  /** A create/claim/complete/assign committed: reset pair counters and run the dispatcher. */
  onActivity(team: Team): void;
  notify(team: Team, item: LeadItem): void;
}

const MAX_DEPENDENCIES = 50;
const LIST_RESULT_PREVIEW = 200;
const LIST_COMPLETED_LIMIT = 50;

export interface CreateTaskInput {
  title: string;
  description?: string;
  blockedBy?: string[];
  owner?: string;
  /** Server actor only: the owner becomes immutable for lead/teammate callers. */
  ownerLocked?: boolean;
}

export interface UpdateTaskInput {
  id: string;
  status?: TaskStatus;
  owner?: string | null;
  title?: string;
  description?: string;
  addBlockedBy?: string[];
  result?: string;
}

/** Dependency ids of `task`, as agents see them (full result, truncated by the caller). */
function dependenciesOf(store: TeamStore, team: Team, task: Task, resultMax: number): TaskDependency[] {
  const out: TaskDependency[] = [];
  for (const id of task.blockedBy) {
    const dep = store.task(team, id);
    if (!dep) continue;
    out.push({
      id: dep.id,
      title: dep.title,
      status: dep.status,
      ...(dep.result !== undefined ? { result: truncateWithMarker(dep.result, resultMax, TRUNCATION_MARKER) } : {}),
    });
  }
  return out;
}

/** The text of a `task_assigned` mail (and a claim reply): the FULL task, never only its title. */
export function assignmentText(store: TeamStore, team: Team, task: Task, resultMax: number): string {
  const lines = [`Task #${task.id} is yours: ${task.title}`, "", task.description === "" ? "(no description)" : task.description];
  const deps = dependenciesOf(store, team, task, resultMax);
  if (deps.length > 0) {
    lines.push("", "Dependencies:");
    for (const d of deps) lines.push(`- #${d.id} ${d.title} [${d.status}]${d.result !== undefined ? `: ${d.result}` : ""}`);
  }
  lines.push("", `When finished call TaskUpdate {id:"${task.id}", status:"completed", result}.`);
  return lines.join("\n");
}

/** DFS over the persisted graph: would `taskId` depending on `deps` close a cycle (or depend on itself)? */
function wouldCycle(store: TeamStore, team: Team, taskId: string, deps: readonly string[]): boolean {
  const seen = new Set<string>();
  const stack = [...deps];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = store.task(team, id);
    if (t) stack.push(...t.blockedBy);
  }
  return false;
}

function idList(v: unknown): string[] | undefined | "invalid" {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length > MAX_DEPENDENCIES) return "invalid";
  const out: string[] = [];
  for (const item of v) {
    const id = typeof item === "number" && Number.isInteger(item) ? String(item) : item;
    if (typeof id !== "string" || id === "" || id.length > 20) return "invalid";
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function createTaskOps(deps: TaskOpsDeps) {
  const { store, config, logger } = deps;

  function view(team: Team, task: Task, who: string | undefined, preview = false): TaskView {
    const blocked = store.isBlocked(team, task);
    const out: TaskView = {
      ...task,
      blocked,
      claimable: task.status === "pending" && !blocked && (task.owner === undefined || task.owner === who),
    };
    if (preview && task.result !== undefined) out.result = truncateWithMarker(task.result, LIST_RESULT_PREVIEW, TRUNCATION_MARKER);
    return out;
  }

  function principalOf(caller: { role: string; name: string }): Principal {
    return caller.role === "lead" ? { kind: "lead", name: "lead" } : { kind: "member", name: caller.name };
  }

  /** A valid assignee: any non-released member (a `spawning` one included); a shutting-down member is refused. */
  function checkOwner(team: Team, name: unknown): OpResult<string> {
    if (typeof name !== "string") return fail("invalid_args", "owner must be a member name or null");
    const member = store.member(team, name);
    if (!member || !isLive(member)) return fail("unknown_owner", name);
    if (member.status === "shutdown_pending") return fail("invalid_transition", `${name} is shutting down`);
    return { ok: true, data: name };
  }

  function textOrFail(v: unknown, max: number, opts: { required?: boolean; multiline?: boolean } = {}): OpResult<string | undefined> {
    const r = textField(v, max, opts);
    return r.ok ? { ok: true, data: r.value } : fail("invalid_args");
  }

  // ── TaskCreate ────────────────────────────────────────────────────────────

  function createCore(team: Team, who: Principal, input: CreateTaskInput): OpResult<TaskCreateResult> {
    const cfg = config();
    if (team.tasks.filter((t) => t.status !== "completed").length >= cfg.maxTasks) return fail("task_cap_reached", `at most ${cfg.maxTasks} open tasks`);
    const blockedBy = input.blockedBy ?? [];
    for (const id of blockedBy) if (!store.task(team, id)) return fail("unknown_dependency", id);
    if (input.owner !== undefined) {
      if (who.kind === "member") return fail("owner_not_lead");
      const owner = checkOwner(team, input.owner);
      if (!owner.ok) return owner;
    }
    const task = store.addTask(team.id, {
      title: input.title,
      description: input.description ?? "",
      blockedBy,
      createdBy: who.name,
      ...(input.owner !== undefined ? { owner: input.owner } : {}),
      ...(input.ownerLocked && who.kind === "server" ? { ownerLocked: true } : {}),
    });
    if (!task) return fail("team_closed");
    deps.onActivity(team);
    return { ok: true, data: { task: view(team, task, undefined) } };
  }

  function parseCreate(raw: unknown): OpResult<CreateTaskInput> {
    if (!isRecord(raw)) return fail("invalid_args", "args must be an object");
    const title = textOrFail(own(raw, "title"), TASK_TITLE_MAX_CHARS, { required: true });
    const description = textOrFail(own(raw, "description"), TASK_DESCRIPTION_MAX_CHARS, { multiline: true });
    const blockedBy = idList(own(raw, "blockedBy"));
    const owner = own(raw, "owner");
    if (!title.ok || !description.ok || blockedBy === "invalid") return fail("invalid_args");
    if (owner !== undefined && owner !== null && typeof owner !== "string") return fail("invalid_args", "owner must be a string");
    return {
      ok: true,
      data: {
        title: title.data as string,
        ...(description.data !== undefined ? { description: description.data } : {}),
        ...(blockedBy ? { blockedBy } : {}),
        ...(typeof owner === "string" ? { owner } : {}),
      },
    };
  }

  function taskCreate(raw: unknown, caller: { role: string; name: string; team?: Team }): OpResult<TaskCreateResult> {
    if (!caller.team) return fail("not_in_team");
    const input = parseCreate(raw);
    if (!input.ok) return input;
    return createCore(caller.team, principalOf(caller), input.data);
  }

  /** Actor form (server): may set `ownerLocked`; same caps and checks as the lane op. */
  function createTask(team: Team, input: CreateTaskInput, opts: { actor: "server" | "lead" }): OpResult<TaskCreateResult> {
    return createCore(team, opts.actor === "server" ? { kind: "server", name: "server" } : { kind: "lead", name: "lead" }, input);
  }

  // ── TaskList / TaskGet ────────────────────────────────────────────────────

  function taskList(raw: unknown, caller: { role: string; name: string; team?: Team }): OpResult<TaskListResult> {
    const team = caller.team;
    if (!team) return fail("not_in_team");
    const args = isRecord(raw) ? raw : {};
    const status = own(args, "status");
    const owner = own(args, "owner");
    const includeCompleted = own(args, "includeCompleted");
    if (status !== undefined && status !== "pending" && status !== "in_progress" && status !== "completed") return fail("invalid_args", "bad status");
    if ((owner !== undefined && typeof owner !== "string") || (includeCompleted !== undefined && typeof includeCompleted !== "boolean")) return fail("invalid_args");
    const wantCompleted = includeCompleted === true || status === "completed";
    let tasks = team.tasks.filter((t) => (t.status !== "completed" || wantCompleted) && (status === undefined || t.status === status) && (owner === undefined || t.owner === owner));
    const completed = tasks.filter((t) => t.status === "completed");
    if (completed.length > LIST_COMPLETED_LIMIT) {
      const keep = new Set(completed.slice(-LIST_COMPLETED_LIMIT).map((t) => t.id));
      tasks = tasks.filter((t) => t.status !== "completed" || keep.has(t.id));
    }
    return { ok: true, data: { tasks: tasks.map((t) => view(team, t, caller.name, true)) } };
  }

  function taskGet(raw: unknown, caller: { role: string; name: string; team?: Team }): OpResult<TaskGetResult> {
    const team = caller.team;
    if (!team) return fail("not_in_team");
    const id = isRecord(raw) ? own(raw, "id") : undefined;
    if (typeof id !== "string" && typeof id !== "number") return fail("invalid_args", "id required");
    const task = store.task(team, String(id));
    if (!task) return fail("unknown_task", String(id));
    return { ok: true, data: { task: view(team, task, caller.name), dependencies: dependenciesOf(store, team, task, config().maxResultChars) } };
  }

  // ── TaskUpdate ────────────────────────────────────────────────────────────

  interface ParsedUpdate {
    status?: TaskStatus;
    owner?: string | null;
    title?: string;
    description?: string;
    addBlockedBy?: string[];
    result?: string;
  }

  function parseUpdate(raw: unknown): OpResult<{ id: string; fields: ParsedUpdate }> {
    if (!isRecord(raw)) return fail("invalid_args", "args must be an object");
    const id = own(raw, "id");
    if (typeof id !== "string" && typeof id !== "number") return fail("invalid_args", "id required");
    const status = own(raw, "status");
    const owner = own(raw, "owner");
    if (status !== undefined && status !== "pending" && status !== "in_progress" && status !== "completed") return fail("invalid_args", "bad status");
    if (owner !== undefined && owner !== null && typeof owner !== "string") return fail("invalid_args", "owner must be a string or null");
    const title = textOrFail(own(raw, "title"), TASK_TITLE_MAX_CHARS);
    const description = textOrFail(own(raw, "description"), TASK_DESCRIPTION_MAX_CHARS, { multiline: true });
    const add = idList(own(raw, "addBlockedBy"));
    const rawResult = own(raw, "result");
    if (!title.ok || !description.ok || add === "invalid" || (rawResult !== undefined && typeof rawResult !== "string")) return fail("invalid_args");
    if (own(raw, "title") !== undefined && title.data === "") return fail("invalid_args", "title must not be empty");
    const fields: ParsedUpdate = {};
    if (status !== undefined) fields.status = status;
    if (owner !== undefined) fields.owner = owner;
    if (title.data !== undefined) fields.title = title.data;
    if (description.data !== undefined) fields.description = description.data;
    if (add) fields.addBlockedBy = add;
    if (typeof rawResult === "string") {
      // `result` is truncated, never rejected (spec: oversized result is stored truncated with a marker).
      // Bound the scan first: nothing past 4× the cap can survive the code-point cut (a hostile 10 MB string stays cheap).
      const max = config().maxResultChars;
      fields.result = truncateWithMarker(sanitizeText(rawResult.slice(0, max * 4 + 8), { keepNewlines: true }), max, TRUNCATION_MARKER);
    }
    return { ok: true, data: { id: String(id), fields } };
  }

  function updateCore(team: Team, who: Principal, raw: unknown): OpResult<TaskUpdateResult> {
    const parsed = parseUpdate(raw);
    if (!parsed.ok) return parsed;
    const { id, fields } = parsed.data;
    const task = store.task(team, id);
    if (!task) return fail("unknown_task", id);
    const isLead = who.kind === "lead";
    const isServer = who.kind === "server";
    const privileged = isLead || isServer;

    // owner: only the lead/server may set or clear it; a teammate's only owner write is the claim itself.
    const ownerGiven = fields.owner !== undefined;
    let assignTo: string | null | undefined;
    if (ownerGiven) {
      if (!privileged) {
        if (fields.owner !== who.name) return fail("owner_not_lead");
        if (task.ownerLocked && fields.owner !== task.owner) return fail("owner_locked", `task ${id} is launcher-owned`);
      } else {
        assignTo = fields.owner;
      }
    }
    // The lead's `status:"in_progress"` + owner is an assignment (the owner claims); without owner it is refused.
    let status = fields.status;
    if (isLead && status === "in_progress") {
      if (!ownerGiven || fields.owner === null) return fail("invalid_transition", "assign an owner; the owner claims the task");
      status = undefined;
    }
    if (status === "in_progress" && isServer) return fail("invalid_transition", "the server does not claim tasks");

    if (assignTo !== undefined) {
      if (task.ownerLocked && !isServer) return fail("owner_locked", `task ${id} is launcher-owned`);
      if (task.status !== "pending") return fail("invalid_transition", `task ${id} is ${task.status}`);
      if (assignTo !== null) {
        const ok = checkOwner(team, assignTo);
        if (!ok.ok) return ok;
      }
    }

    const patch: Partial<Omit<Task, "id" | "createdAt">> & { clearOwner?: boolean } = {};
    let claim = false;
    let complete = false;
    if (status !== undefined) {
      if (task.status === "completed") return fail("invalid_transition", `task ${id} is completed`);
      if (status === "in_progress") {
        if (task.status === "in_progress" || (task.owner !== undefined && task.owner !== who.name)) {
          deps.telemetry.count(team.id, "claimConflicts");
          deps.telemetry.log("claim", team.id, { task: id, by: who.name, conflict: true });
          return fail("already_claimed", task.status === "in_progress" ? `task ${id} is already in progress` : `task ${id} is owned by ${task.owner}`);
        }
        if (store.isBlocked(team, task)) return fail("blocked", `task ${id} has unfinished dependencies`);
        claim = true;
        patch.status = "in_progress";
        patch.owner = who.name;
      } else if (status === "completed") {
        if (who.kind === "member" && task.owner !== who.name) return fail("not_owner", `task ${id} is not yours`);
        if (task.status !== "in_progress") return fail("invalid_transition", `task ${id} is ${task.status}`);
        complete = true;
        patch.status = "completed";
        if (fields.result !== undefined) patch.result = fields.result;
      } else if (task.status === "in_progress") {
        return fail("invalid_transition", "an in_progress task cannot go back to pending");
      }
    }
    if (fields.result !== undefined && !complete) {
      if (task.status !== "in_progress" && !claim) return fail("invalid_transition", "a result belongs to a task being completed");
      if (who.kind === "member" && task.owner !== who.name) return fail("not_owner");
      patch.result = fields.result;
    }
    if (assignTo !== undefined) {
      if (assignTo === null) patch.clearOwner = true;
      else patch.owner = assignTo;
    }
    if (fields.title !== undefined || fields.description !== undefined) {
      if (task.status === "completed") return fail("invalid_transition", `task ${id} is completed`);
      if (fields.title !== undefined) patch.title = fields.title;
      if (fields.description !== undefined) patch.description = fields.description;
    }
    if (fields.addBlockedBy) {
      if (task.status === "completed") return fail("invalid_transition", `task ${id} is completed`);
      for (const dep of fields.addBlockedBy) if (!store.task(team, dep)) return fail("unknown_dependency", dep);
      if (wouldCycle(store, team, id, fields.addBlockedBy)) return fail("dependency_cycle", `task ${id} would depend on itself`);
      const merged = [...new Set([...task.blockedBy, ...fields.addBlockedBy])];
      if (merged.length > MAX_DEPENDENCIES) return fail("invalid_args", `at most ${MAX_DEPENDENCIES} dependencies`);
      patch.blockedBy = merged;
    }

    // ── commit (single store write) ────────────────────────────────────────
    const wasBlockedBy = new Set(team.tasks.filter((t) => t.status === "pending" && t.blockedBy.includes(id) && store.isBlocked(team, t)).map((t) => t.id));
    if (Object.keys(patch).length > 0) store.patchTask(team.id, id, patch);
    const after = store.task(team, id) as Task;
    const unblocked: string[] = [];
    if (complete) {
      for (const depId of [...wasBlockedBy].sort(compareTaskIds)) {
        const t = store.task(team, depId);
        if (t && !store.isBlocked(team, t)) unblocked.push(depId);
      }
      if (who.kind === "member") {
        deps.notify(team, {
          head: `${who.name} completed task #${id}: ${after.title}`,
          ...(after.result ? { body: truncateWithMarker(after.result, LIST_RESULT_PREVIEW, TRUNCATION_MARKER) } : {}),
          wake: false,
        });
      }
    }
    if (claim) {
      deps.telemetry.count(team.id, "claims");
      deps.telemetry.log("claim", team.id, { task: id, by: who.name });
    }
    if (complete) deps.telemetry.log("complete", team.id, { task: id, by: who.name, resultChars: after.result?.length ?? 0 });
    if (claim || complete || assignTo !== undefined || fields.addBlockedBy) deps.onActivity(team);
    const final = store.task(team, id) as Task;
    return {
      ok: true,
      data: {
        task: view(team, final, who.name),
        unblocked,
        ...(claim ? { dependencies: dependenciesOf(store, team, final, config().maxResultChars) } : {}),
      },
    };
  }

  function taskUpdate(raw: unknown, caller: { role: string; name: string; team?: Team }): OpResult<TaskUpdateResult> {
    if (!caller.team) return fail("not_in_team");
    return updateCore(caller.team, principalOf(caller), raw);
  }

  /** Actor form (server): may change a launcher-owned task's owner. */
  function updateTask(team: Team, input: UpdateTaskInput, opts: { actor: "server" | "lead" }): OpResult<TaskUpdateResult> {
    return updateCore(team, opts.actor === "server" ? { kind: "server", name: "server" } : { kind: "lead", name: "lead" }, input);
  }

  // ── release on member exit (4.8) ──────────────────────────────────────────

  /**
   * `in_progress` tasks of `name` return to `pending` unowned with a note; every
   * other non-completed task it owns merely loses its owner (a respawn of the same
   * name inherits nothing). Returns the ids for the lead notice.
   */
  function releaseTasksOf(team: Team, name: string, reason: string): { released: string[]; unowned: string[] } {
    const out = { released: [] as string[], unowned: [] as string[] };
    for (const task of [...team.tasks]) {
      if (task.owner !== name || task.status === "completed") continue;
      if (task.status === "in_progress") {
        store.patchTask(team.id, task.id, { status: "pending", clearOwner: true, note: `released: ${name} ${reason}` });
        out.released.push(task.id);
      } else {
        store.patchTask(team.id, task.id, { clearOwner: true });
        out.unowned.push(task.id);
      }
    }
    if (out.released.length > 0 || out.unowned.length > 0) logger.info(`agent-teams: released ${out.released.length} and unowned ${out.unowned.length} task(s) of ${name}`);
    return out;
  }

  return { taskCreate, taskList, taskGet, taskUpdate, createTask, updateTask, releaseTasksOf, view, dependenciesOf: (team: Team, task: Task) => dependenciesOf(store, team, task, config().maxResultChars) };
}
