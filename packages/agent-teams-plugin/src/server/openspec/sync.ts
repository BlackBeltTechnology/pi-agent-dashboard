/**
 * The runtime is the sole writer of `tasks.md` checkboxes (design D8, spec "The runtime is the sole writer of
 * checkboxes", "Checkboxes are matched by id and text", "Checkbox sync is serial and recoverable", "Sync timing
 * and a deleted tasks.md", "Team close drains pending sync").
 *
 *  - Trigger: core's `task_completed` store event (after gates and commit; the isolated listener cannot undo
 *    the commit). Work is queued per change (one promise chain per repo+change): toggles never interleave.
 *  - A job reads the checkbox list (`GET`), finds each ref by id AND text hash, else by a unique text-hash
 *    match, and ticks it through the toggle route with the CURRENT line. `409` ⇒ refetch and retry; at most 3
 *    attempts with 250 ms / 1 s backoff, 10 s per call (`tasks-source.ts`).
 *  - No match ⇒ `ref_missing` (logged, counts as synced); several ⇒ unsynced + one lead notice, never retried;
 *    `401`/`403` ⇒ no retry, `sync_forbidden` notice; `404` (tasks.md gone) ⇒ every ref `ref_missing`, synced,
 *    lead notice; three failed attempts ⇒ one waking notice naming ids, `synced:false`.
 *  - New work only starts while the team is `active`; a started job may finish while the team closes, for at
 *    most 5 s after the close began, then pending tasks are persisted `synced:false` and the lead is told.
 *  - After a restart (`RECONCILE_DELAY_MS`, so the host routes are mounted) unsynced completed tasks of active
 *    apply teams are retried; the toggle is idempotent (a human-ticked box is found `done` and left alone).
 * Notices carry task ids and codes only, never task text. See change: add-agent-teams-openspec.
 */
import type { Team } from "../../shared/types.js";
import { OPENSPEC_COUNTERS } from "./log.js";
import type { OpenspecApi } from "./profiles.js";
import { boxRefsOf } from "./seed-apply.js";
import { type BoxRef, createTasksSource, type SourceTask, textHash } from "./tasks-source.js";

const SYNC_ATTEMPTS = 3;
export const SYNC_BACKOFF_MS = [250, 1000] as const;
const DRAIN_MAX_MS = 5000;
export const RECONCILE_DELAY_MS = 5000;

export interface ApplySync {
  /** Queue the checkbox sync of one completed task (no-op unless it is an unsynced unit of an active apply team). */
  schedule(team: Team, taskId: string): void;
  /** Retry every unsynced completed task of every active apply team. */
  reconcile(): void;
  /** Resolves when every queued job has finished. */
  whenIdle(): Promise<void>;
  dispose(): void;
}

type Match = { kind: "found"; task: SourceTask } | { kind: "missing" } | { kind: "ambiguous" };

/** Find one ref in a fresh checkbox list: id AND hash, else a unique hash match. */
function matchRef(hashed: ReadonlyArray<{ task: SourceTask; hash: string }>, ref: BoxRef): Match {
  const exact = hashed.filter((x) => x.task.id === ref.id && x.hash === ref.textHash);
  if (exact.length === 1) return { kind: "found", task: (exact[0] as { task: SourceTask }).task };
  const byHash = hashed.filter((x) => x.hash === ref.textHash);
  if (exact.length === 0 && byHash.length === 1) return { kind: "found", task: (byHash[0] as { task: SourceTask }).task };
  return byHash.length === 0 ? { kind: "missing" } : { kind: "ambiguous" };
}

interface Job {
  teamId: string;
  taskId: string;
  repo: string;
  change: string;
}

/** What a job knows between attempts. */
interface JobState {
  remaining: BoxRef[];
  ambiguous: string[];
  failure?: "retry" | "forbidden" | undefined;
}

/** Result of one pass: boxes still to tick, ambiguous ids, and how the pass failed (if it did). */
interface Pass {
  remaining: BoxRef[];
  ambiguous: string[];
  failure?: "retry" | "forbidden" | undefined;
  /** tasks.md vanished during the pass. */
  gone?: boolean;
}

/** Nothing more to attempt: forbidden is never retried, and an empty remainder without a failure is done. */
const isSettled = (state: JobState): boolean => state.failure === "forbidden" || (state.remaining.length === 0 && state.failure === undefined);

const idList = (ids: readonly string[]): string => ids.slice(0, 12).join(", ") + (ids.length > 12 ? ", …" : "");

export function createApplySync(api: OpenspecApi): ApplySync {
  const { deps, sidecar, log } = api;
  const { clock, store, ops } = deps;
  const source = createTasksSource(api.inject, clock);

  const chains = new Map<string, Promise<void>>();
  const pending = new Map<string, Set<string>>();
  const closing = new Map<string, { timer: unknown; cancelled: boolean }>();
  const sleepers = new Set<{ teamId: string; timer: unknown; resolve: (elapsed: boolean) => void }>();
  let reconcileTimer: unknown;
  let disposed = false;

  const cancelled = (teamId: string): boolean => disposed || closing.get(teamId)?.cancelled === true;

  /** Sleep `ms`; `false` when woken early (dispose, or the drain deadline of the team passed). */
  function sleep(teamId: string, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const rec = {
        teamId,
        timer: undefined as unknown,
        resolve: (elapsed: boolean) => {
          clock.clearTimeout(rec.timer);
          sleepers.delete(rec);
          resolve(elapsed);
        },
      };
      rec.timer = clock.setTimeout(() => rec.resolve(true), ms);
      sleepers.add(rec);
    });
  }

  /** One lead notice per key (persisted flag); never throws. */
  function notify(teamId: string, key: string, text: string, wake: boolean): void {
    const team = store.get(teamId);
    if (!team || !sidecar.noticeOnce(teamId, key)) return;
    try {
      ops.enqueueLeadNotice(team, { text, wake });
    } catch (err) {
      log.event("warn", "notice_failed", teamId, { key, error: (err as Error).name });
    }
  }

  function markSynced(teamId: string, taskId: string, value: boolean): boolean {
    const res = sidecar.update(teamId, (d) => {
      d.synced[taskId] = value;
    });
    if (!res.ok) log.record("error", "sync_state_write_failed", OPENSPEC_COUNTERS.sidecarWriteFailed, teamId, { task: taskId });
    return res.ok;
  }

  /** `tasks.md` is gone: every remaining ref is `ref_missing`, the task counts as synced, the lead is told. */
  function tasksFileGone(teamId: string, taskId: string, remaining: readonly BoxRef[]): void {
    for (const b of remaining) log.event("warn", "ref_missing", teamId, { task: taskId, box: b.id, cause: "tasks_md_gone" });
    markSynced(teamId, taskId, true);
    notify(teamId, `tasks_md_gone:${taskId}`, `OpenSpec checkbox sync: tasks.md is gone, so the checkboxes of task #${taskId} (${idList(remaining.map((b) => b.id))}) cannot be ticked (ref_missing).`, true);
  }

  /** The unticked checkbox a ref points at; `undefined` when there is nothing to tick (missing, ambiguous or already ticked). */
  function pendingBox(job: Job, hashed: ReadonlyArray<{ task: SourceTask; hash: string }>, box: BoxRef, out: Pass): SourceTask | undefined {
    const m = matchRef(hashed, box);
    if (m.kind === "missing") log.event("warn", "ref_missing", job.teamId, { task: job.taskId, box: box.id, cause: "no_match" });
    if (m.kind === "ambiguous") out.ambiguous.push(box.id);
    return m.kind === "found" && !m.task.done ? m.task : undefined; // a box a human ticked already needs nothing
  }

  /** Tick one box: `ok`, or why not (`gone`: tasks.md vanished; `forbidden`: never retried; `retry`: conflict, network, 5xx, timeout). */
  async function tickBox(job: Job, task: SourceTask): Promise<"ok" | "gone" | "forbidden" | "retry"> {
    const res = await source.toggle(job.repo, job.change, { id: task.id, line: task.line });
    if (res.ok) return "ok";
    return res.code === "not_found" ? "gone" : res.code === "forbidden" ? "forbidden" : "retry";
  }

  /** One pass over `remaining` against a fresh checkbox list: tick what is unticked, report what is left. */
  async function pass(job: Job, remaining: readonly BoxRef[], tasks: readonly SourceTask[]): Promise<Pass> {
    const hashed = tasks.map((task) => ({ task, hash: textHash(task.text) }));
    const out: Pass = { remaining: [], ambiguous: [] };
    for (let i = 0; i < remaining.length; i++) {
      const task = pendingBox(job, hashed, remaining[i] as BoxRef, out);
      const res = task ? await tickBox(job, task) : "ok";
      if (res === "gone") return { ...out, remaining: remaining.slice(i), gone: true };
      if (res === "forbidden") return { ...out, remaining: [...out.remaining, ...remaining.slice(i)], failure: "forbidden" };
      if (res === "retry") {
        out.failure = "retry";
        out.remaining.push(remaining[i] as BoxRef);
      }
    }
    return out;
  }

  /** The lead notice / counter / synced flag of a finished job. */
  function conclude(job: Job, total: number, state: JobState): void {
    const { teamId, taskId } = job;
    const ids = idList(state.remaining.map((b) => b.id));
    if (state.failure === "forbidden") {
      log.record("warn", "sync_forbidden", OPENSPEC_COUNTERS.syncFailed, teamId, { task: taskId });
      notify(teamId, `sync_forbidden:${taskId}`, `OpenSpec checkbox sync was refused (sync_forbidden) for task #${taskId}: the dashboard did not accept the in-process toggle. Tick ${ids} by hand.`, true);
    } else if (state.remaining.length > 0) {
      log.record("warn", "sync_failed", OPENSPEC_COUNTERS.syncFailed, teamId, { task: taskId, attempts: SYNC_ATTEMPTS });
      notify(teamId, `sync_failed:${taskId}`, `OpenSpec checkbox sync failed (sync_failed) for task #${taskId} after ${SYNC_ATTEMPTS} attempts: ${ids} stay unticked; the next server start retries.`, true);
    } else if (state.ambiguous.length > 0) {
      log.record("warn", "sync_ambiguous", OPENSPEC_COUNTERS.syncFailed, teamId, { task: taskId });
      notify(teamId, `sync_ambiguous:${taskId}`, `OpenSpec checkbox sync (sync_ambiguous): ${idList(state.ambiguous)} of task #${taskId} match several checkboxes in tasks.md and were NOT ticked; tick them by hand.`, false);
    } else if (markSynced(teamId, taskId, true)) log.record("info", "sync_ok", OPENSPEC_COUNTERS.syncOk, teamId, { task: taskId, boxes: total });
  }

  /** One read + pass, folded into `state`. `gone`: tasks.md vanished; `cancelled`: the team's drain deadline passed. */
  async function attempt(job: Job, state: JobState): Promise<"ok" | "gone" | "cancelled"> {
    if (cancelled(job.teamId)) return "cancelled";
    const read = await source.read(job.repo, job.change);
    if (cancelled(job.teamId)) return "cancelled";
    if (!read.ok) {
      state.failure = read.code === "forbidden" ? "forbidden" : "retry";
      return read.code === "not_found" ? "gone" : "ok";
    }
    const p = await pass(job, state.remaining, read.tasks);
    state.remaining = p.remaining;
    state.ambiguous.push(...p.ambiguous);
    state.failure = p.failure;
    return p.gone ? "gone" : "ok";
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a flat bounded retry loop; the score comes from being nested in the sync closure that owns the queue state
  async function runJob(teamId: string, taskId: string): Promise<void> {
    const d0 = sidecar.get(teamId);
    const boxes = boxRefsOf(d0?.refs[taskId]);
    if (!d0 || !boxes || d0.synced[taskId]) return;
    const job: Job = { teamId, taskId, repo: d0.repo, change: d0.goal };
    const state: JobState = { remaining: [...boxes], ambiguous: [] };

    for (let n = 1; n <= SYNC_ATTEMPTS; n++) {
      const res = await attempt(job, state);
      if (res !== "ok") return res === "gone" ? tasksFileGone(teamId, taskId, state.remaining) : undefined;
      if (isSettled(state)) break;
      if (n < SYNC_ATTEMPTS && !(await sleep(teamId, SYNC_BACKOFF_MS[n - 1] as number))) return;
    }
    if (!cancelled(teamId)) conclude(job, boxes.length, state);
  }

  function finished(teamId: string, taskId: string): void {
    const set = pending.get(teamId);
    set?.delete(taskId);
    if (set && set.size === 0) {
      pending.delete(teamId);
      const c = closing.get(teamId);
      if (c) {
        clock.clearTimeout(c.timer);
        closing.delete(teamId);
      }
    }
  }

  function schedule(team: Team, taskId: string): void {
    if (disposed || team.status !== "active" || api.profileOf(team) !== "apply" || api.teamState(team) !== "active") return;
    const d = sidecar.get(team.id);
    if (!d || d.synced[taskId] || !boxRefsOf(d.refs[taskId]) || pending.get(team.id)?.has(taskId)) return;
    pending.set(team.id, (pending.get(team.id) ?? new Set()).add(taskId));
    const key = `${d.repo}\u0000${d.goal}`;
    const job = (chains.get(key) ?? Promise.resolve()).then(() => runJob(team.id, taskId)).catch((err: unknown) => log.event("error", "sync_job_failed", team.id, { task: taskId, error: (err as Error)?.name ?? "error" })).finally(() => finished(team.id, taskId));
    chains.set(key, job);
    void job.finally(() => {
      if (chains.get(key) === job) chains.delete(key);
    });
  }

  /** The team started closing: give the queue `DRAIN_MAX_MS`, then persist `synced:false` and tell the lead. */
  function beginDrain(team: Team): void {
    const waiting = pending.get(team.id);
    if (!waiting || waiting.size === 0 || closing.has(team.id)) return;
    const rec = {
      cancelled: false,
      timer: clock.setTimeout(() => {
        rec.cancelled = true;
        const ids = [...(pending.get(team.id) ?? [])];
        for (const s of sleepers) if (s.teamId === team.id) s.resolve(false);
        for (const id of ids) markSynced(team.id, id, false);
        log.record("warn", "sync_drain_expired", OPENSPEC_COUNTERS.syncFailed, team.id, { tasks: ids.length });
        notify(team.id, "sync_drain", `OpenSpec checkbox sync did not finish before the team closed: the checkboxes of task(s) ${ids.map((i) => `#${i}`).join(", ")} may stay unticked (synced:false).`, true);
      }, DRAIN_MAX_MS),
    };
    closing.set(team.id, rec);
  }

  /** Completed tasks of active apply teams whose checkboxes are not synced yet. */
  function unsyncedTasks(): Array<[Team, string]> {
    const out: Array<[Team, string]> = [];
    for (const team of store.list()) {
      if (team.status !== "active" || api.profileOf(team) !== "apply") continue;
      const d = sidecar.get(team.id);
      for (const task of team.tasks) if (task.status === "completed" && !d?.synced[task.id] && boxRefsOf(d?.refs[task.id])) out.push([team, task.id]);
    }
    return out;
  }
  const hasUnsynced = (): boolean => unsyncedTasks().length > 0;

  function reconcile(): void {
    if (disposed) return;
    for (const [team, taskId] of unsyncedTasks()) schedule(team, taskId);
  }

  api.onStoreEvent("task_completed", ({ team, task }) => schedule(team, task.id));
  api.onStoreEvent("team_closed", ({ team }) => beginDrain(team));
  api.onStoreEvent("change", ({ team }) => {
    if (team.status === "closing") beginDrain(team);
  });
  // Armed only when there is something to retry, so an idle runtime holds no timer.
  if (hasUnsynced()) reconcileTimer = clock.setTimeout(reconcile, RECONCILE_DELAY_MS);

  const handle: ApplySync = {
    schedule,
    reconcile,
    async whenIdle() {
      while (chains.size > 0) await Promise.allSettled([...chains.values()]);
    },
    dispose() {
      disposed = true;
      clock.clearTimeout(reconcileTimer);
      for (const c of closing.values()) clock.clearTimeout(c.timer);
      closing.clear();
      for (const s of [...sleepers]) s.resolve(false);
    },
  };
  api.onDispose(() => handle.dispose());
  return handle;
}
