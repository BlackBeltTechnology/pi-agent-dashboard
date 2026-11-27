/**
 * `openspec-group` launcher (design D3): one teammate per change, spawned lazily in `changeOrder`.
 *
 *  - Slot occupancy is DERIVED from state (a `launching` record, or a `launched` one whose task is open and
 *    whose member is not `gone`/`failed`; `disconnected` holds the slot), so a restart cannot over-launch.
 *  - A launch needs `Team.status === "active"`, an unblocked pending task with no launch record, a free slot and
 *    live members below the team cap. Launches are serial per team (one drain loop); store events only mark the
 *    loop dirty, so an event storm costs one O(tasks + members) scan and no I/O when nothing is launchable.
 *  - `launched[task]` is written to the sidecar synchronously BEFORE any worktree or spawn work; a `launching`
 *    record found at start becomes `launch_failed launch_interrupted`. Nothing is relaunched automatically: the
 *    lead gets ONE waking notice per record (persisted `noticed`) naming the relaunch route and `TeamDelete`.
 *  - Spawn goes through core `spawnTeammate` with `TrustedSpawnOptions {cwd: worktree, committer: "member"}`;
 *    core has no `owner` argument, so the fallback of D3 applies: the owner is set by the server actor in the
 *    SAME continuation right after the reservation (the task is `ownerLocked`, a claim by any other member
 *    needs a prompt it never got).
 *  - Every launch is bounded by `LAUNCH_TIMEOUT_MS`; a late success is ignored (worktree left), a core refusal
 *    (`name_taken`, `cwd_outside_lead`, …) fails the launch with that code and never adopts a foreign member.
 *  - `task_completed` frees the slot (state-derived) and asks core to shut the member down (server actor).
 * See change: add-agent-teams-openspec.
 */
import fs from "node:fs";
import path from "node:path";
import type { OpResult, TeammateSpawnArgs, TeammateSpawnResult } from "../../shared/protocol.js";
import type { Task, Team } from "../../shared/types.js";
import type { TrustedSpawnOptions } from "../extension-points.js";
import { isLive } from "../op-util.js";
import { registerShippedGate } from "./gate.js";
import { OPENSPEC_COUNTERS } from "./log.js";
import type { OpenspecApi } from "./profiles.js";
import { registerRelaunchRoute } from "./relaunch-route.js";
import type { LaunchRecord, SidecarData } from "./sidecar.js";

/** A launch that has not finished after this long is `launch_failed launch_timeout` (a late success is ignored). */
export const LAUNCH_TIMEOUT_MS = 120_000;
const RELAUNCH_ROUTE = "/api/plugins/agent-teams/openspec-relaunch";

export type EnsureWorktreeResult = { ok: true; path: string; branch: string } | { ok: false; code: string; message?: string };

/** What the launcher needs of the group module (`group-api.ts`, slice B1); every member is replaceable in tests. */
export interface LauncherDeps {
  ensureWorktree(api: OpenspecApi, input: { repo: string; change: string; base: string; signal?: AbortSignal }): Promise<EnsureWorktreeResult>;
  memberNameFor(change: string): string;
  buildBriefing(input: { taskId: string; change: string; worktreePath: string; shipSkill: string; member: string }): string;
  /** Default: core `ops.spawnTeammate`. */
  spawn(team: Team, args: TeammateSpawnArgs, trusted: TrustedSpawnOptions): Promise<OpResult<TeammateSpawnResult>>;
  /** `true` when a resident session runs in `worktreePath`; `undefined` when the host has no session lookup seam. */
  residentSession(worktreePath: string): boolean | undefined;
  launchTimeoutMs: number;
  /** Test seam: while `true` no pass runs (events are ignored); a later `evaluate` after clearing it proceeds. */
  paused: boolean;
}

type GroupFns = Pick<LauncherDeps, "ensureWorktree" | "memberNameFor" | "buildBriefing">;

type RelaunchResult = { ok: true; change: string } | { ok: false; error: "not_relaunchable" | "sidecar_write_failed"; message: string };

export interface Launcher {
  /** Re-evaluate one team; resolves when its drain loop is idle again. */
  evaluate(team: Team): Promise<void>;
  /** Clear a `launch_failed` / lost `launched` record and re-evaluate (the route's body). */
  relaunch(team: Team, change: string): RelaunchResult;
  /** `task_completed` of a launcher task: ask core to shut the member down (the slot is free by derivation). */
  completed(team: Team, task: Task): void;
  /** Replace single dependencies (tests); unspecified members keep their default. */
  configure(over: Partial<LauncherDeps>): void;
}

const launchers = new WeakMap<OpenspecApi, Launcher>();
const wiredRegistries = new WeakMap<object, { api: OpenspecApi }>();

/** The launcher registered on `api` (undefined before `register`). */
export const launcherOf = (api: OpenspecApi): Launcher | undefined => launchers.get(api);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The ordered change names the group seed persisted (`ext.group.changeOrder`). */
function changeOrderOf(d: Readonly<SidecarData>): readonly string[] | undefined {
  const g = d.ext.group;
  if (!isRecord(g) || !Array.isArray(g.changeOrder)) return undefined;
  return g.changeOrder.filter((c): c is string => typeof c === "string");
}

/** `change → core task id` from the seed refs (`{kind:"group", change}`). */
function tasksByChange(d: Readonly<SidecarData>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [taskId, ref] of Object.entries(d.refs)) if (isRecord(ref) && ref.kind === "group" && typeof ref.change === "string") out.set(ref.change, taskId);
  return out;
}

/** Failure codes are short tokens; anything else is flattened so a notice never carries foreign text. */
const safeCode = (code: string): string => code.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 40) || "unknown";

const stuckAdvice = (team: Team, change: string): string =>
  `Relaunch (team owner): POST ${RELAUNCH_ROUTE} {"teamId":"${team.id}","change":"${change}"}. v1 has no abandon route: fix the cause and relaunch, or TeamDelete the team.`;

function createLauncher(api: OpenspecApi): Launcher {
  const { store, ops, clock } = api.deps;
  let over: Partial<LauncherDeps> = {};
  let realGroup: Promise<GroupFns | undefined> | undefined;
  const warned = new Set<string>();
  const once = (key: string, fn: () => void): void => {
    if (warned.has(key)) return;
    warned.add(key);
    fn();
  };

  const loadGroup = (): Promise<GroupFns | undefined> => (realGroup ??= import("./group-api.js").then((m) => m as unknown as GroupFns, () => undefined));

  async function groupFns(): Promise<GroupFns | undefined> {
    if (over.ensureWorktree && over.memberNameFor && over.buildBriefing) return { ensureWorktree: over.ensureWorktree, memberNameFor: over.memberNameFor, buildBriefing: over.buildBriefing };
    const real = await loadGroup();
    if (!real) return undefined;
    return { ensureWorktree: over.ensureWorktree ?? real.ensureWorktree, memberNameFor: over.memberNameFor ?? real.memberNameFor, buildBriefing: over.buildBriefing ?? real.buildBriefing };
  }

  const spawn: LauncherDeps["spawn"] = (team, args, trusted) => (over.spawn ?? ((t, a, tr) => ops.spawnTeammate(t, a, { trusted: tr })))(team, args, trusted);

  function residentSession(worktreePath: string): boolean | undefined {
    if (over.residentSession) return over.residentSession(worktreePath);
    const list = api.deps.host.listActiveSessions;
    if (typeof list !== "function") return undefined;
    const want = realOrSame(worktreePath);
    return list().some((s) => isRecord(s) && typeof s.cwd === "string" && realOrSame(s.cwd) === want);
  }

  const maxTeammatesOf = (team: Team): number => Math.min(team.maxTeammates, api.deps.config().maxTeammates);

  // ── state helpers ───────────────────────────────────────────────────────────

  const memberLost = (team: Team, name: string): boolean => {
    const m = store.member(team, name);
    return !m || !isLive(m);
  };

  /** Occupied slots: `launching`, or `launched` with an open task and a member that is not `gone`/`failed`. */
  function slotsHeld(team: Team, d: Readonly<SidecarData>): number {
    let n = 0;
    for (const [taskId, rec] of Object.entries(d.launched)) {
      if (rec.state === "launching") n++;
      else if (rec.state === "launched" && store.task(team, taskId)?.status !== "completed" && !memberLost(team, rec.member)) n++;
    }
    return n;
  }

  /** Persist `mutate` on the record of `taskId` only while it still is the same attempt; `true` when written. */
  function updateRecord(teamId: string, taskId: string, expect: (r: LaunchRecord) => boolean, mutate: (r: LaunchRecord) => void): boolean {
    const cur = api.sidecar.get(teamId)?.launched[taskId];
    if (!cur || !expect(cur)) return false;
    const res = api.sidecar.update(teamId, (d) => {
      const rec = d.launched[taskId];
      if (rec) mutate(rec);
    });
    if (!res.ok) api.log.record("error", "launcher_sidecar_failed", OPENSPEC_COUNTERS.sidecarWriteFailed, teamId, { code: res.error });
    return res.ok;
  }

  function notify(team: Team, text: string, wake: boolean): void {
    if (team.status === "closed") return;
    try {
      ops.enqueueLeadNotice(team, { text, wake });
    } catch (err) {
      api.log.event("warn", "launcher_notice_failed", team.id, { error: (err as Error).name });
    }
  }

  /** Record `launch_failed` (with `noticed`) and tell the lead once; `false` when the record was not ours any more. */
  function failLaunch(team: Team, taskId: string, change: string, code: string, only?: (r: LaunchRecord) => boolean): boolean {
    const wrote = updateRecord(
      team.id,
      taskId,
      only ?? ((r) => r.state === "launching"),
      (r) => {
        r.state = "launch_failed";
        r.code = code;
        r.noticed = true;
      },
    );
    if (!wrote) return false;
    api.log.record("warn", "launch_failed", OPENSPEC_COUNTERS.launchFailed, team.id, { code, change });
    notify(team, `OpenSpec launch of change "${change}" failed: ${safeCode(code)}. Task #${taskId} stays pending and its slot is free; nothing is retried automatically. ${stuckAdvice(team, change)}`, true);
    return true;
  }

  /** A `launched` member that is gone while its task is pending: one non-waking notice (core already woke the lead for the exit). */
  function scanStuck(team: Team, d: Readonly<SidecarData>): void {
    for (const [taskId, rec] of Object.entries(d.launched)) {
      if (rec.state !== "launched" || rec.noticed) continue;
      const task = store.task(team, taskId);
      if (!task || task.status !== "pending" || !memberLost(team, rec.member)) continue;
      if (!updateRecord(team.id, taskId, (r) => r.state === "launched" && !r.noticed, (r) => void (r.noticed = true))) continue;
      notify(team, `OpenSpec: teammate ${rec.member} for change "${rec.change}" is gone and task #${taskId} is pending again; it is NOT relaunched automatically. ${stuckAdvice(team, rec.change)}`, false);
    }
  }

  // ── one launch ──────────────────────────────────────────────────────────────

  interface Job {
    teamId: string;
    taskId: string;
    change: string;
    member: string;
    repo: string;
    base: string;
    shipSkill: string;
    worktree: string;
  }

  /** The synchronous decision: scan, maybe write the `launching` record, return the job to run. */
  function prepare(teamId: string, fns: GroupFns): Job | undefined {
    const team = store.get(teamId);
    if (!team || team.status !== "active" || api.profileOf(team) !== "group" || api.teamState(team) !== "active") return undefined;
    let d = api.sidecar.get(teamId) as Readonly<SidecarData>;
    const order = changeOrderOf(d);
    if (!order) return undefined;
    scanStuck(team, d);
    d = api.sidecar.get(teamId) as Readonly<SidecarData>;
    const byChange = tasksByChange(d);
    let cand: { change: string; taskId: string } | undefined;
    for (const change of order) {
      const taskId = byChange.get(change);
      if (taskId === undefined || d.launched[taskId]) continue;
      const task = store.task(team, taskId);
      if (!task || task.status !== "pending" || task.owner !== undefined || store.isBlocked(team, task)) continue;
      cand = { change, taskId };
      break;
    }
    if (!cand) return undefined;
    const cfg = api.config({ effectiveMaxTeammates: api.deps.config().maxTeammates });
    if (!cfg.ok) {
      once(`cfg:${cfg.key}`, () => api.log.event("error", "launcher_config_invalid", teamId, { key: cfg.key }));
      return undefined;
    }
    if (slotsHeld(team, d) >= cfg.config.groupParallel) return undefined;
    if (team.members.filter(isLive).length >= maxTeammatesOf(team)) return undefined;

    const worktree = path.join(d.repo, ".worktrees", `os-${cand.change}`);
    const resident = residentSession(worktree);
    if (resident === undefined) once(`resident:${teamId}`, () => api.log.event("info", "resident_check_skipped", teamId, { reason: "no_session_lookup" }));
    const member = fns.memberNameFor(cand.change);
    const group = isRecord(d.ext.group) ? d.ext.group : {};
    const base = typeof group.base === "string" && group.base !== "" ? group.base : cfg.config.worktreeBase;
    const wrote = api.sidecar.update(teamId, (x) => {
      x.launched[(cand as { taskId: string }).taskId] = { state: "launching", member, change: (cand as { change: string }).change, at: clock.now() };
    });
    if (!wrote.ok) {
      api.log.record("error", "launcher_sidecar_failed", OPENSPEC_COUNTERS.sidecarWriteFailed, teamId, { code: wrote.error });
      return undefined; // fail closed: nothing advanced, nothing started
    }
    const job: Job = { teamId, taskId: cand.taskId, change: cand.change, member, repo: d.repo, base, shipSkill: cfg.config.shipSkill, worktree };
    if (resident === true) {
      failLaunch(team, job.taskId, job.change, "resident_session");
      return undefined;
    }
    return job;
  }

  /** `stop` = leave the drain loop until the next team change (a `team_full` race). */
  async function execute(job: Job, fns: GroupFns): Promise<"continue" | "stop"> {
    const ctl = new AbortController();
    const teamOf = (): Team | undefined => store.get(job.teamId);
    let result: "continue" | "stop" = "continue";

    const work = async (): Promise<void> => {
      const wt = await fns.ensureWorktree(api, { repo: job.repo, change: job.change, base: job.base, signal: ctl.signal }).catch(() => ({ ok: false, code: "worktree_failed" }) as const);
      if (ctl.signal.aborted) return; // late: ignored, the worktree is left
      const team = teamOf();
      if (!team) return;
      if (!wt.ok) {
        failLaunch(team, job.taskId, job.change, wt.code);
        return;
      }
      const prompt = fns.buildBriefing({ taskId: job.taskId, change: job.change, worktreePath: wt.path, shipSkill: job.shipSkill, member: job.member });
      const res = await spawn(team, { name: job.member, prompt }, { cwd: wt.path, committer: "member" }).catch((): OpResult<TeammateSpawnResult> => ({ ok: false, error: "invalid_args", message: "spawn_failed" }));
      if (ctl.signal.aborted) {
        if (res.ok) strayMember(team, job); // reserved after the deadline: never adopted
        return;
      }
      if (!res.ok) {
        if (res.error === "team_full") {
          // the cap raced the check: forget the record, retry on the next team change
          if (api.sidecar.get(team.id)?.launched[job.taskId]?.state === "launching") api.sidecar.update(team.id, (d) => void delete d.launched[job.taskId]);
          result = "stop";
          return;
        }
        failLaunch(team, job.taskId, job.change, res.error === "invalid_args" && res.message === "spawn_failed" ? "spawn_failed" : res.error);
        return;
      }
      // Fallback of D3: core has no owner argument; set it in this very continuation (no await after the reservation).
      const owned = ops.updateTask(team, { id: job.taskId, owner: job.member }, { actor: "server" });
      const marked = updateRecord(team.id, job.taskId, (r) => r.state === "launching", (r) => void (r.state = "launched"));
      api.log.record("info", "launched", OPENSPEC_COUNTERS.launched, team.id, { change: job.change, member: job.member, written: marked });
      if (!owned.ok) {
        api.log.event("error", "owner_not_set", team.id, { code: owned.error });
        notify(team, `OpenSpec: teammate ${job.member} was spawned but could not be made owner of task #${job.taskId} (${safeCode(owned.error)}). ${stuckAdvice(team, job.change)}`, true);
      }
    };

    let timer: unknown;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = clock.setTimeout(() => resolve("timeout"), over.launchTimeoutMs ?? LAUNCH_TIMEOUT_MS);
    });
    const finished = work().then(
      () => "done" as const,
      (err: unknown) => {
        api.log.event("error", "launch_threw", job.teamId, { error: (err as Error)?.name ?? "error" });
        return "threw" as const;
      },
    );
    try {
      const outcome = await Promise.race([finished, timeout]);
      if (outcome === "timeout") {
        ctl.abort();
        const team = teamOf();
        if (team) failLaunch(team, job.taskId, job.change, "launch_timeout");
      } else if (outcome === "threw") {
        ctl.abort();
        const team = teamOf();
        if (team) failLaunch(team, job.taskId, job.change, "launch_failed");
      }
    } finally {
      clock.clearTimeout(timer);
    }
    return result;
  }

  /** A member reserved after its launch timed out: ask it to shut down (best effort); the record is already `launch_failed`. */
  function strayMember(team: Team, job: Job): void {
    try {
      ops.requestShutdown(team, job.member, { actor: "server", reason: "launch timed out" });
    } catch (err) {
      api.log.event("warn", "stray_shutdown_failed", team.id, { error: (err as Error).name });
    }
    api.log.event("warn", "late_launch_ignored", team.id, { change: job.change });
  }

  // ── drain loop ──────────────────────────────────────────────────────────────

  interface Run {
    dirty: boolean;
    done: Promise<void>;
  }
  const runs = new Map<string, Run>();

  function evaluate(team: Team): Promise<void> {
    const live = runs.get(team.id);
    if (live) {
      live.dirty = true;
      return live.done;
    }
    const run: Run = { dirty: false, done: Promise.resolve() };
    runs.set(team.id, run);
    run.done = (async () => {
      try {
        await Promise.resolve();
        for (;;) {
          run.dirty = false;
          if (over.paused) return;
          const fns = await groupFns();
          if (!fns) {
            once("group_api", () => api.log.event("error", "group_api_unavailable", team.id));
            return;
          }
          const job = prepare(team.id, fns);
          if (job) {
            if ((await execute(job, fns)) === "stop") return;
            continue;
          }
          if (!run.dirty) return;
        }
      } catch (err) {
        api.log.event("error", "launcher_pass_failed", team.id, { error: (err as Error)?.name ?? "error" });
      } finally {
        runs.delete(team.id);
      }
    })();
    return run.done;
  }

  // ── relaunch ────────────────────────────────────────────────────────────────

  function relaunch(team: Team, change: string): RelaunchResult {
    const refuse = (message: string): RelaunchResult => ({ ok: false, error: "not_relaunchable", message });
    if (team.status === "closed" || api.profileOf(team) !== "group" || api.teamState(team) !== "active") return refuse("this team has no relaunchable change");
    const d = api.sidecar.get(team.id) as Readonly<SidecarData>;
    const taskId = tasksByChange(d).get(change);
    const rec = taskId === undefined ? undefined : d.launched[taskId];
    const task = taskId === undefined ? undefined : store.task(team, taskId);
    const clearable = rec !== undefined && task?.status === "pending" && (rec.state === "launch_failed" || (rec.state === "launched" && memberLost(team, rec.member)));
    if (!clearable || taskId === undefined) return refuse(`change ${change} has nothing to relaunch`);
    const res = api.sidecar.update(team.id, (x) => void delete x.launched[taskId]);
    if (!res.ok) return { ok: false, error: "sidecar_write_failed", message: res.message };
    api.log.event("info", "relaunch_requested", team.id, { change });
    void evaluate(team);
    return { ok: true, change };
  }

  // ── completion ──────────────────────────────────────────────────────────────

  function onCompleted(team: Team, task: Task): void {
    const rec = api.sidecar.get(team.id)?.launched[task.id];
    if (!rec || rec.state !== "launched") return;
    try {
      const res = ops.requestShutdown(team, rec.member, { actor: "server", reason: "change shipped" });
      if (!res.ok) api.log.event("warn", "shutdown_request_refused", team.id, { code: res.error, member: rec.member });
    } catch (err) {
      api.log.event("warn", "shutdown_request_failed", team.id, { error: (err as Error).name });
    }
  }

  return {
    evaluate,
    relaunch,
    completed: onCompleted,
    configure(next) {
      over = { ...over, ...next };
    },
  };
}

/** `realpath` or the input when the path does not exist. */
function realOrSame(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * At start: a `launching` record is a crash mid-launch (`launch_interrupted`), a `launch_failed` one the
 * lead has not been told about gets its single notice. Both persist `noticed` first, so N restarts tell once.
 */
function reconcileRecords(api: OpenspecApi, launcher: Launcher): void {
  const { store, ops } = api.deps;
  for (const team of store.list()) {
    if (team.status === "closed" || api.profileOf(team) !== "group" || api.teamState(team) !== "active") continue;
    const d = api.sidecar.get(team.id);
    if (!d) continue;
    for (const [taskId, rec] of Object.entries(d.launched)) {
      const interrupted = rec.state === "launching";
      if (!interrupted && !(rec.state === "launch_failed" && !rec.noticed)) continue;
      const res = api.sidecar.update(team.id, (x) => {
        const r = x.launched[taskId];
        if (!r) return;
        if (interrupted) {
          r.state = "launch_failed";
          r.code = "launch_interrupted";
        }
        r.noticed = true;
      });
      if (!res.ok) continue;
      const code = interrupted ? "launch_interrupted" : (rec.code ?? "unknown");
      api.log.record("warn", "launch_failed", OPENSPEC_COUNTERS.launchFailed, team.id, { code, change: rec.change });
      ops.enqueueLeadNotice(team, {
        text: `OpenSpec launch of change "${rec.change}" failed: ${safeCode(code)}. Task #${taskId} stays pending and its slot is free; nothing is retried automatically. ${stuckAdvice(team, rec.change)}`,
        wake: true,
      });
    }
    void launcher.evaluate(team);
  }
}

/** Slice entry (`slices.ts`): launcher, completion gate, relaunch route. */
export function register(api: OpenspecApi): void {
  const launcher = createLauncher(api);
  launchers.set(api, launcher);
  api.onDispose(() => launchers.delete(api));

  api.onStoreEvent("change", ({ team }) => {
    if (api.profileOf(team) === "group") void launcher.evaluate(team);
  });
  api.onStoreEvent("task_completed", ({ team, task }) => {
    if (api.profileOf(team) !== "group") return;
    launcher.completed(team, task);
    void launcher.evaluate(team);
  });

  // Gate and route are registered ONCE per extension registry and always resolve the newest handle.
  const holder = wiredRegistries.get(api.deps.ext);
  if (holder) holder.api = api;
  else {
    const h = { api };
    wiredRegistries.set(api.deps.ext, h);
    registerShippedGate(() => h.api);
    registerRelaunchRoute(() => ({ api: h.api, launcher: launchers.get(h.api) }));
  }
  reconcileRecords(api, launcher);
}
