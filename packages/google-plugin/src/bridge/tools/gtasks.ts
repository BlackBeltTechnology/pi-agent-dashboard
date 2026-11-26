/**
 * Google Tasks tools (`gtasks_*`, design D11; spec google-tasks-tools). `gtasks_lists` / `gtasks_list` (level read) return
 * compact JSON in 50-item pages (`nextPageToken`, scenario-gate C6); open tasks only unless `include_completed`.
 * `gtasks_create` / `gtasks_update` / `gtasks_complete` / `gtasks_delete` (level write) are confirmed first, showing
 * account, list, title and due date. A change that changes nothing succeeds with `unchanged: true` and is never
 * confirmed (C21). See change: add-google-connect.
 */
import { pageSize } from "../paging.js";
import { optBool, optStr, type Params, reqStr } from "../params.js";
import { clip } from "../preview.js";
import { type Call, type ProductTools, Skip, type ToolOutput } from "../runtime.js";
import { invalidParams } from "../tool-error.js";

const enc = encodeURIComponent;
const LIST_ID = /^[A-Za-z0-9_@-]{1,256}$/;
const TASK_ID = /^[A-Za-z0-9_-]{1,256}$/;
const MAX_TITLE = 1024;
const MAX_NOTES = 8192;

interface GTask {
  id?: string;
  title?: string;
  notes?: string;
  due?: string;
  status?: string;
  parent?: string;
  completed?: string;
}
interface GList {
  id?: string;
  title?: string;
}
interface Page<T> {
  items?: T[];
  nextPageToken?: string;
}
/** State handed from `prepare` to `summary` / `run`: the list (for its title) and the task as it is now. */
interface State {
  list: { id: string; title: string };
  task?: GTask;
}

// ───────────── argument parsing ─────────────

function listId(p: Params): string {
  const v = optStr(p, "listId", 256) ?? "@default";
  if (!LIST_ID.test(v)) throw invalidParams("`listId` must be a task list id (default: the account's default list)");
  return v;
}

function taskId(p: Params): string {
  const v = reqStr(p, "taskId", 256);
  if (!TASK_ID.test(v)) throw invalidParams("`taskId` must be a task id returned by gtasks_list");
  return v;
}

/** A real calendar date `YYYY-MM-DD` (Tasks keeps the date only), or undefined. */
function dueArg(p: Params): string | undefined {
  const v = optStr(p, "due", 32);
  if (v === undefined) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const [y, mo, d] = [Number(m?.[1]), Number(m?.[2]), Number(m?.[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (!m || date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    throw invalidParams("`due` must be a calendar date as YYYY-MM-DD");
  }
  return v;
}

/** `title` when given must have content (an update may leave it out). */
function titleArg(p: Params, required: boolean): string | undefined {
  if (required) return reqStr(p, "title", MAX_TITLE);
  return p.title === undefined || p.title === null ? undefined : reqStr(p, "title", MAX_TITLE);
}

const shape = (t: GTask) => ({
  id: t.id,
  title: t.title ?? "",
  notes: t.notes ?? "",
  due: t.due ?? null,
  status: t.status,
  parent: t.parent ?? null,
  ...(t.completed ? { completed: t.completed } : {}),
});

const getList = async (call: Call, id: string): Promise<State["list"]> => {
  const l = await call.api.request<GList>("GET", `/users/@me/lists/${enc(id)}`);
  return { id: l.id ?? id, title: l.title ?? "(untitled)" };
};
const getTask = (call: Call, list: string, id: string) => call.api.request<GTask>("GET", `/lists/${enc(list)}/tasks/${enc(id)}`);

const listLine = (s: State) => `List: ${clip(s.list.title, 200)} [${clip(s.list.id, 120)}]`;
const dayOf = (due?: string) => due?.slice(0, 10);
const dueLine = (due?: string) => `Due: ${due ?? "(none)"}`;
const taskLine = (t: GTask) => `Task: ${clip(t.title ?? "(untitled)", 200)}`;
/** Tasks stores a due date as midnight UTC of that day. */
const dueStamp = (day: string) => `${day}T00:00:00.000Z`;

/** The changes an update would make to `cur`, as `[label, old, new]`. */
function changes(a: { title?: string; notes?: string; due?: string }, cur: GTask): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  if (a.title !== undefined && a.title !== (cur.title ?? "")) out.push(["title", cur.title ?? "", a.title]);
  if (a.notes !== undefined && a.notes !== (cur.notes ?? "")) out.push(["notes", cur.notes ?? "", a.notes]);
  if (a.due !== undefined && a.due !== dayOf(cur.due)) out.push(["due", dayOf(cur.due) ?? "", a.due]);
  return out;
}

const LIST_PROP = { type: "string", description: "Task list id from gtasks_lists. Default: the account's default list." };
const TASK_PROP = { type: "string", minLength: 1, description: "Task id from gtasks_list." };
const DUE_PROP = { type: "string", description: "Due date as YYYY-MM-DD." };

export const gtasks: ProductTools = {
  product: "tasks",
  create(rt) {
    return [
      rt.define({
        name: "gtasks_lists",
        label: "list task lists",
        description: "List the account's Google Tasks task lists (id, title). Requires Tasks level read.",
        properties: { pageToken: { type: "string", description: "nextPageToken of the previous page." } },
        level: "read",
        parse: (p) => ({ pageToken: optStr(p, "pageToken", 2048) }),
        async run(a, call): Promise<ToolOutput> {
          const r = await call.api.request<Page<GList>>("GET", "/users/@me/lists", { query: { maxResults: pageSize(undefined), pageToken: a.pageToken } });
          const lists = (r.items ?? []).map((l) => ({ id: l.id, title: l.title ?? "" }));
          return { json: { lists, ...(r.nextPageToken ? { nextPageToken: r.nextPageToken } : {}) } };
        },
      }),

      rt.define({
        name: "gtasks_list",
        label: "list tasks",
        description:
          "List the tasks of one task list (id, title, notes, due, status, parent). Only open tasks unless include_completed is true. Long lists come in pages: pass the returned nextPageToken as pageToken. Requires Tasks level read.",
        properties: {
          listId: LIST_PROP,
          include_completed: { type: "boolean", description: "Also return completed (and hidden) tasks. Default false." },
          pageToken: { type: "string", description: "nextPageToken of the previous page." },
        },
        level: "read",
        parse: (p) => ({ list: listId(p), all: optBool(p, "include_completed") ?? false, pageToken: optStr(p, "pageToken", 2048) }),
        async run(a, call): Promise<ToolOutput> {
          const r = await call.api.request<Page<GTask>>("GET", `/lists/${enc(a.list)}/tasks`, {
            query: { showCompleted: a.all, showHidden: a.all, maxResults: pageSize(undefined), pageToken: a.pageToken },
          });
          const tasks = (r.items ?? []).filter((t) => a.all || t.status === "needsAction").map(shape);
          return { json: { listId: a.list, tasks, ...(r.nextPageToken ? { nextPageToken: r.nextPageToken } : {}) } };
        },
      }),

      rt.define<{ list: string; title: string; notes?: string; due?: string; parent?: string }, State>({
        name: "gtasks_create",
        label: "create task",
        description: "Create a Google Task (requires Tasks level write; the user confirms first).",
        properties: {
          listId: LIST_PROP,
          title: { type: "string", minLength: 1, maxLength: MAX_TITLE },
          notes: { type: "string", maxLength: MAX_NOTES },
          due: DUE_PROP,
          parent: { type: "string", description: "Parent task id, to create a subtask." },
        },
        required: ["title"],
        level: "write",
        write: true,
        parse: (p) => ({
          list: listId(p),
          title: titleArg(p, true) as string,
          notes: optStr(p, "notes", MAX_NOTES),
          due: dueArg(p),
          parent: p.parent === undefined || p.parent === null ? undefined : taskId({ taskId: p.parent }),
        }),
        prepare: async (a, call) => ({ list: await getList(call, a.list) }),
        summary: (a, s) => [listLine(s), `Title: ${clip(a.title, 200)}`, dueLine(a.due), ...(a.notes ? [`Notes: ${clip(a.notes)}`] : []), ...(a.parent ? [`Subtask of: ${clip(a.parent, 120)}`] : [])],
        async run(a, call, s): Promise<ToolOutput> {
          const t = await call.api.request<GTask>("POST", `/lists/${enc(s.list.id)}/tasks`, {
            query: { parent: a.parent },
            body: { title: a.title, ...(a.notes ? { notes: a.notes } : {}), ...(a.due ? { due: dueStamp(a.due) } : {}) },
          });
          return { json: { created: true, listId: s.list.id, ...shape(t) } };
        },
      }),

      rt.define<{ list: string; id: string; title?: string; notes?: string; due?: string }, State>({
        name: "gtasks_update",
        label: "update task",
        description: "Change the title, notes or due date of a Google Task (requires Tasks level write; the user confirms first). Only the fields you pass change.",
        properties: { listId: LIST_PROP, taskId: TASK_PROP, title: { type: "string", minLength: 1, maxLength: MAX_TITLE }, notes: { type: "string", maxLength: MAX_NOTES }, due: DUE_PROP },
        required: ["taskId"],
        level: "write",
        write: true,
        parse: (p) => ({ list: listId(p), id: taskId(p), title: titleArg(p, false), notes: optStr(p, "notes", MAX_NOTES), due: dueArg(p) }),
        async prepare(a, call) {
          const task = await getTask(call, a.list, a.id);
          if (changes(a, task).length === 0) return new Skip({ json: { unchanged: true, taskId: a.id } });
          return { list: await getList(call, a.list), task };
        },
        summary: (a, s) => [listLine(s), taskLine(s.task as GTask), ...changes(a, s.task as GTask).map(([k, o, n]) => `Change ${k}: ${clip(o || "(none)", 200)} \u2192 ${clip(n, 200)}`)],
        async run(a, call, s): Promise<ToolOutput> {
          const t = await call.api.request<GTask>("PATCH", `/lists/${enc(s.list.id)}/tasks/${enc(a.id)}`, {
            body: { ...(a.title !== undefined ? { title: a.title } : {}), ...(a.notes !== undefined ? { notes: a.notes } : {}), ...(a.due ? { due: dueStamp(a.due) } : {}) },
          });
          return { json: { updated: true, listId: s.list.id, ...shape(t) } };
        },
      }),

      rt.define<{ list: string; id: string }, State>({
        name: "gtasks_complete",
        label: "complete task",
        description: "Mark a Google Task as completed (requires Tasks level write; the user confirms first). An already completed task is returned unchanged.",
        properties: { listId: LIST_PROP, taskId: TASK_PROP },
        required: ["taskId"],
        level: "write",
        write: true,
        parse: (p) => ({ list: listId(p), id: taskId(p) }),
        async prepare(a, call) {
          const task = await getTask(call, a.list, a.id);
          if (task.status === "completed") return new Skip({ json: { unchanged: true, taskId: a.id, status: "completed" } });
          return { list: await getList(call, a.list), task };
        },
        summary: (_a, s) => [listLine(s), taskLine(s.task as GTask), dueLine(dayOf(s.task?.due)), "Mark as completed"],
        async run(a, call, s): Promise<ToolOutput> {
          const t = await call.api.request<GTask>("PATCH", `/lists/${enc(s.list.id)}/tasks/${enc(a.id)}`, {
            body: { status: "completed", completed: new Date().toISOString() },
          });
          return { json: { completed: true, listId: s.list.id, ...shape(t) } };
        },
      }),

      rt.define<{ list: string; id: string }, State>({
        name: "gtasks_delete",
        label: "delete task",
        description: "Delete a Google Task permanently (requires Tasks level write; the user confirms first).",
        properties: { listId: LIST_PROP, taskId: TASK_PROP },
        required: ["taskId"],
        level: "write",
        write: true,
        parse: (p) => ({ list: listId(p), id: taskId(p) }),
        async prepare(a, call) {
          return { list: await getList(call, a.list), task: await getTask(call, a.list, a.id) };
        },
        summary: (_a, s) => [listLine(s), taskLine(s.task as GTask), dueLine(dayOf(s.task?.due)), "DELETE this task"],
        async run(a, call, s): Promise<ToolOutput> {
          await call.api.request("DELETE", `/lists/${enc(s.list.id)}/tasks/${enc(a.id)}`);
          return { json: { deleted: true, listId: s.list.id, taskId: a.id } };
        },
      }),
    ];
  },
};
