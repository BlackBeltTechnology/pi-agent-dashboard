/**
 * Test environment of the group launcher / completion gate / relaunch route: the OpenSpec env (full runtime
 * over the fake host) plus a SEEDED `openspec-group` team (real `seedCore`: core tasks, sidecar refs and
 * `ext.group`), launcher dependencies replaced by recording fakes (group-api seam of slice B1), a no-op
 * host spawn starter and helpers to complete tasks / add members the way the lane would.
 * See change: add-agent-teams-openspec.
 */
import path from "node:path";
import { vi } from "vitest";
import type { OpResult, TeammateSpawnResult } from "../../../shared/protocol.js";
import type { Team } from "../../../shared/types.js";
import { type EnsureWorktreeResult, type LauncherDeps, launcherOf } from "../launcher.js";
import { seedCore } from "../seed-core.js";
import { createOpenspecEnv, GROUP, type OpenspecEnv, type OpenspecEnvOptions } from "./env.js";

interface GroupChange {
  name: string;
  /** In-group blockers (change names). */
  blockedBy?: string[];
}

export interface GroupEnvOptions extends OpenspecEnvOptions {
  changes: Array<string | GroupChange>;
  /** Plugin config merged over `{openspecGroupParallel: 2, maxTeammates: 5}`. */
  pluginConfig?: Record<string, unknown>;
  /** Team record `overrides` (default `{autoDispatch: false}`, as the bundled template sets). */
  overrides?: { autoDispatch?: boolean; notifyCoalesceMs?: number };
  /** Leave the sidecar unseeded (the team is `pending`). */
  noSeed?: boolean;
  /** Principal recorded as `Team.owner` (route owner rule); with `enforced: true` only it (and the local operator) controls the team. */
  owner?: { iss: string; sub: string };
}

export type GroupEnv = OpenspecEnv & {
  gteam: Team;
  taskOf(change: string): string;
  worktreeOf(change: string): string;
  /** Recording fakes installed on the launcher (`ensure` resolves immediately by default). */
  fx: {
    ensureWorktree: ReturnType<typeof vi.fn<LauncherDeps["ensureWorktree"]>>;
    buildBriefing: ReturnType<typeof vi.fn<LauncherDeps["buildBriefing"]>>;
    spawnCalls: Array<{ name: string; cwd: string | undefined; committer: string | undefined; prompt: string }>;
  };
  /** Run the launcher for the team and wait until its drain loop is idle. */
  run(): Promise<void>;
  /** Claim then complete a task the way a member would (emits `task_completed`). */
  complete(change: string): void;
  /** Make a live member (with a session) of `name`. */
  member(name: string, status?: "idle" | "busy" | "disconnected" | "gone" | "failed" | "shutdown_pending"): void;
  /** Names of members of the team, in order. */
  members(): string[];
  launched(change: string): { state: string; member: string; code?: string; noticed?: boolean } | undefined;
  /** Lead notices (texts) in order. */
  notices(): Array<{ text: string; wake: boolean }>;
};

const noopStarter = async (): Promise<void> => undefined;

export async function createGroupEnv(over: GroupEnvOptions): Promise<GroupEnv> {
  const { changes, pluginConfig, overrides = { autoDispatch: false }, noSeed, owner, ...rest } = over;
  const e = await createOpenspecEnv({ ...rest, config: { maxTeammates: 5, openspecGroupParallel: 2, ...(rest.config ?? {}), ...(pluginConfig ?? {}) }, runtime: { ...(rest.runtime ?? {}), starter: noopStarter } });
  // Hold the launcher until the test starts it (`run()`): the seed's store events would otherwise launch at once.
  launcherOf(e.api)?.configure({ paused: true });
  const specs: GroupChange[] = changes.map((c) => (typeof c === "string" ? { name: c } : c));
  const lead = e.fake.addSession(`S-lead-grp`, { cwd: e.cwd });
  const created = e.rt.ops.createTeam({
    name: "openspec-group",
    leadCwd: e.cwd,
    leadSessionId: lead,
    overrides,
    ...(owner ? { owner: e.ownerKey(owner) } : {}),
    template: { name: GROUP, source: "bundled", hash: "h", goal: "grp", playbook: "p", members: [], spawn: "lead", seeded: true },
  });
  if (!created.ok) throw new Error(`createTeam failed: ${created.error}`);
  const team = created.data;
  if (!noSeed) {
    const outcome = seedCore(
      { ops: e.rt.ops, sidecar: e.api.sidecar, log: e.api.log, clock: e.clock },
      team,
      { teamId: team.id, kind: "group", goal: "grp", repo: e.cwd },
      {
        tasks: specs.map((c) => ({ key: c.name, title: c.name, blockedBy: c.blockedBy ?? [], ownerLocked: true, ref: { kind: "group", change: c.name } })),
        sidecar: { ext: { group: { changeOrder: specs.map((c) => c.name), base: "develop", merge: "develop", outOfGroup: {}, skipped: [] } } },
      },
    );
    if (outcome.status !== "seeded") throw new Error(`seed failed: ${outcome.status}`);
  }

  const spawnCalls: GroupEnv["fx"]["spawnCalls"] = [];
  const ensureWorktree = vi.fn<LauncherDeps["ensureWorktree"]>(async (_api, input): Promise<EnsureWorktreeResult> => ({ ok: true, path: path.join(e.cwd, ".worktrees", `os-${input.change}`), branch: `os/${input.change}` }));
  const buildBriefing = vi.fn<LauncherDeps["buildBriefing"]>((i) => `briefing ${i.taskId} ${i.change} ${i.worktreePath} ${i.shipSkill}`);
  const launcher = launcherOf(e.api);
  if (!launcher) throw new Error("launcher not registered");
  launcher.configure({
    ensureWorktree,
    buildBriefing,
    memberNameFor: (c) => `os-${c}`,
    spawn: async (t, args, trusted): Promise<OpResult<TeammateSpawnResult>> => {
      spawnCalls.push({ name: args.name, cwd: trusted.cwd, committer: trusted.committer, prompt: args.prompt });
      return e.rt.ops.spawnTeammate(t, args, { trusted });
    },
  });

  const taskOf = (change: string): string => {
    const refs = e.api.sidecar.get(team.id)?.refs ?? {};
    const id = Object.entries(refs).find(([, v]) => (v as { change?: string }).change === change)?.[0];
    if (!id) throw new Error(`no task for ${change}`);
    return id;
  };
  return Object.assign(e, {
    gteam: team,
    taskOf,
    worktreeOf: (change: string) => path.join(e.cwd, ".worktrees", `os-${change}`),
    fx: { ensureWorktree, buildBriefing, spawnCalls },
    run: () => {
      launcher.configure({ paused: false });
      return launcher.evaluate(e.rt.store.get(team.id) as Team);
    },
    complete(change: string) {
      const id = taskOf(change);
      const t = e.rt.store.task(e.rt.store.get(team.id) as Team, id);
      if (t?.status === "pending") e.rt.store.patchTask(team.id, id, { status: "in_progress" });
      e.rt.store.patchTask(team.id, id, { status: "completed" });
    },
    member(name: string, status: "idle" | "busy" | "disconnected" | "gone" | "failed" | "shutdown_pending" = "idle") {
      const t = e.rt.store.get(team.id) as Team;
      if (e.rt.store.member(t, name)) {
        e.rt.store.patchMember(team.id, name, { status });
        return;
      }
      e.rt.store.reserveMember(team.id, { name, spawnToken: `tok-${name}`, cwd: e.cwd, status, guardActive: false, noMcp: false, noContextFiles: false, lastSettleId: 0 });
    },
    members: () => (e.rt.store.get(team.id) as Team).members.map((m) => m.name),
    launched(change: string) {
      return e.api.sidecar.get(team.id)?.launched[taskOf(change)];
    },
    notices() {
      return e.rt.store
        .mailLog(team.id)
        .filter((m) => m.to === "lead" && m.kind === "notice")
        .map((m) => ({ text: m.text, wake: m.wake }));
    },
  }) as unknown as GroupEnv;
}
