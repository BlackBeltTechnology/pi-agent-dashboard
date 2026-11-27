/**
 * The checkbox source of the apply profile (design D7/D8): `GET /api/openspec/tasks` and
 * `POST /api/openspec/tasks/toggle` through the loopback inject. The dashboard parser stays the ONE source of
 * checkbox ids / lines / state (the OpenSpec CLI numbers tasks `1,2,3…` and exposes no `1.1`). Every call is
 * bounded by a timeout on the injected clock. Results are a closed union of codes; nothing here throws.
 * Also owns the text normalisation + hash a ref records so a box can be found again after a human edit.
 * See change: add-agent-teams-openspec.
 */
import { createHash } from "node:crypto";
import type { Clock } from "../../shared/clock.js";
import { stripTrailingHint } from "./hints.js";
import type { InjectFn, InjectResult } from "./inject.js";

const TASKS_CALL_TIMEOUT_MS = 10_000;

/** One checkbox as the dashboard parser reports it. */
export interface SourceTask {
  id: string;
  text: string;
  done: boolean;
  /** 1-based line: the optimistic-concurrency token of the toggle. */
  line: number;
  group: string;
}

type TasksReadResult =
  | { ok: true; tasks: SourceTask[] }
  | { ok: false; code: "not_found" | "forbidden" | "unavailable" | "invalid" | "error"; status?: number };

type ToggleResult = { ok: true } | { ok: false; code: "conflict" | "not_found" | "forbidden" | "unavailable" | "error"; status?: number };

/** Normalised box text: no trailing hint, collapsed whitespace. The checkbox state is not part of the text. */
export function normalizeBoxText(text: string): string {
  return stripTrailingHint(text).replace(/\s+/g, " ").trim();
}

/** Stable short hash of a box's normalised text (ids and ticked state are not part of it). */
export function textHash(text: string): string {
  return createHash("sha256").update(normalizeBoxText(text)).digest("hex").slice(0, 16);
}

/** A reference a seeded task keeps to one checkbox. */
export interface BoxRef {
  id: string;
  textHash: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseTasks(body: unknown): SourceTask[] | undefined {
  if (!isRecord(body) || body.success !== true || !isRecord(body.data) || !Array.isArray(body.data.tasks)) return undefined;
  const out: SourceTask[] = [];
  for (const t of body.data.tasks) {
    if (!isRecord(t) || typeof t.id !== "string" || typeof t.text !== "string" || typeof t.done !== "boolean" || typeof t.line !== "number" || !Number.isInteger(t.line)) return undefined;
    out.push({ id: t.id, text: t.text, done: t.done, line: t.line, group: typeof t.group === "string" ? t.group : "" });
  }
  return out;
}

/** Run `call` with a timeout on `clock`; a timeout or a rejection is `undefined`. */
async function bounded(clock: Pick<Clock, "setTimeout" | "clearTimeout">, call: () => Promise<InjectResult>): Promise<InjectResult | undefined> {
  let timer: unknown;
  const timeout = new Promise<undefined>((resolve) => {
    timer = clock.setTimeout(() => resolve(undefined), TASKS_CALL_TIMEOUT_MS);
  });
  try {
    return await Promise.race([call(), timeout]);
  } catch {
    return undefined;
  } finally {
    clock.clearTimeout(timer);
  }
}

const authCode = (status: number): "forbidden" | undefined => (status === 401 || status === 403 ? "forbidden" : undefined);

export interface TasksSource {
  read(cwd: string, change: string): Promise<TasksReadResult>;
  toggle(cwd: string, change: string, box: { id: string; line: number }): Promise<ToggleResult>;
}

/** Bind the two calls to an inject and a clock. */
export function createTasksSource(inject: InjectFn | undefined, clock: Pick<Clock, "setTimeout" | "clearTimeout">): TasksSource {
  return {
    async read(cwd, change) {
      if (!inject) return { ok: false, code: "unavailable" };
      const url = `/api/openspec/tasks?cwd=${encodeURIComponent(cwd)}&change=${encodeURIComponent(change)}`;
      const res = await bounded(clock, () => inject({ method: "GET", url }));
      if (!res) return { ok: false, code: "error" };
      const auth = authCode(res.statusCode);
      if (auth) return { ok: false, code: auth, status: res.statusCode };
      if (res.statusCode === 404) return { ok: false, code: "not_found", status: 404 };
      if (res.statusCode !== 200) return { ok: false, code: "error", status: res.statusCode };
      const tasks = parseTasks(res.body);
      return tasks ? { ok: true, tasks } : { ok: false, code: "invalid", status: 200 };
    },
    async toggle(cwd, change, box) {
      if (!inject) return { ok: false, code: "unavailable" };
      const res = await bounded(clock, () => inject({ method: "POST", url: "/api/openspec/tasks/toggle", payload: { cwd, change, id: box.id, done: true, line: box.line } }));
      if (!res) return { ok: false, code: "error" };
      if (res.statusCode === 200) return { ok: true };
      const auth = authCode(res.statusCode);
      if (auth) return { ok: false, code: auth, status: res.statusCode };
      if (res.statusCode === 409) return { ok: false, code: "conflict", status: 409 };
      if (res.statusCode === 404) return { ok: false, code: "not_found", status: 404 };
      return { ok: false, code: "error", status: res.statusCode };
    },
  };
}
