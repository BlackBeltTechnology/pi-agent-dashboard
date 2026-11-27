/**
 * Coexistence of the group profile with ship-batch and with other teams (tasks 3.5, 3.15; tests 8.21 #E24,
 * 8.22 #R9): the ship-batch lock rules (heartbeat age, future heartbeat, dead pid on the same host, damaged
 * file) decide `batch_runner_active` through the real group preflight with a fake clock, and a change driven
 * by another ACTIVE team fails the later start `change_in_use` from the sidecars alone.
 * See change: add-agent-teams-openspec.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getStartProfile } from "../../start-profiles.js";
import { BATCH_LOCK_STALE_MS, batchLockLive, batchLockPath, checkBatchRunner } from "../batch-lock.js";
import { changesInUse, PENDING_CLAIM_TTL_MS, pendingClaimCount, runPreflight } from "../profiles.js";
import { APPLY, createOpenspecEnv, GROUP, type OpenspecEnv } from "./env.js";
import { blockedBy, initRepoAt, makeRepo, writeGroupFiles } from "./git-env.js";

const MIN = 60_000;
const DEAD_PID = 2_147_483_000; // beyond any real pid: `process.kill(pid, 0)` answers ESRCH

const withSkill = (e: OpenspecEnv): void => e.fake.setPiResources({ local: { skills: [{ name: "ship-it", filePath: "/s/ship-it/SKILL.md" }] }, global: { skills: [] }, packages: [] });

function lock(repo: string, content: string | Record<string, unknown> | undefined): void {
  const file = batchLockPath(repo);
  fs.rmSync(file, { force: true });
  if (content === undefined) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
}

describe("ship-batch lock rules through the group preflight (8.21 #E24)", () => {
  async function verdict(setup: (now: number) => string | Record<string, unknown> | undefined): Promise<string> {
    const e = await createOpenspecEnv();
    withSkill(e);
    const repo = makeRepo();
    writeGroupFiles(repo, { assignments: { a: "g" }, changes: { a: undefined } });
    const now = e.clock.now();
    lock(repo, setup(now));
    const res = await runPreflight(e.api, "group", "g", repo);
    return res.ok ? "proceeds" : res.error;
  }
  const rec = (now: number, over: Record<string, unknown>): Record<string, unknown> => ({ pid: process.pid, hostname: os.hostname(), groupId: "g", heartbeatAt: now, ...over });

  it.each([
    ["9m59.999s old", (n: number) => rec(n, { heartbeatAt: n - (10 * MIN - 1) }), "batch_runner_active"],
    ["exactly 10m old", (n: number) => rec(n, { heartbeatAt: n - 10 * MIN }), "proceeds"],
    ["10m00.001s old", (n: number) => rec(n, { heartbeatAt: n - (10 * MIN + 1) }), "proceeds"],
    ["2 minutes old (live)", (n: number) => rec(n, { heartbeatAt: n - 2 * MIN }), "batch_runner_active"],
    ["now", (n: number) => rec(n, {}), "batch_runner_active"],
    ["1 s in the future", (n: number) => rec(n, { heartbeatAt: n + 1000 }), "batch_runner_active"],
    ["exactly 60 s in the future", (n: number) => rec(n, { heartbeatAt: n + MIN }), "batch_runner_active"],
    ["60.001 s in the future (stale)", (n: number) => rec(n, { heartbeatAt: n + MIN + 1 }), "proceeds"],
    ["1 day in the future (stale)", (n: number) => rec(n, { heartbeatAt: n + 24 * 60 * MIN }), "proceeds"],
    ["dead pid, same host, fresh heartbeat (stale)", (n: number) => rec(n, { pid: DEAD_PID }), "proceeds"],
    ["another host, fresh heartbeat (live)", (n: number) => rec(n, { hostname: "some-other-host" }), "batch_runner_active"],
    ["another host, old heartbeat", (n: number) => rec(n, { hostname: "some-other-host", heartbeatAt: n - 11 * MIN }), "proceeds"],
    ["unparseable JSON", () => "{not json", "proceeds"],
    ["empty file", () => "", "proceeds"],
    ["a JSON value that is not a lock", () => "[1,2]", "proceeds"],
    ["a record without heartbeatAt", () => ({ pid: process.pid, hostname: os.hostname() }), "proceeds"],
    ["no lock file", () => undefined, "proceeds"],
  ])("%s → %s", async (_name, setup, expected) => {
    expect(await verdict(setup)).toBe(expected);
  });

  it("a symlinked or oversize lock is never read (the start proceeds)", async () => {
    const e = await createOpenspecEnv();
    withSkill(e);
    const repo = makeRepo();
    writeGroupFiles(repo, { assignments: { a: "g" }, changes: { a: undefined } });
    const target = path.join(repo, "elsewhere");
    fs.writeFileSync(target, JSON.stringify({ pid: process.pid, hostname: os.hostname(), groupId: "g", heartbeatAt: e.clock.now() }));
    fs.mkdirSync(path.dirname(batchLockPath(repo)), { recursive: true });
    fs.symlinkSync(target, batchLockPath(repo));
    expect(await runPreflight(e.api, "group", "g", repo)).toMatchObject({ ok: true });
  });

  it("the refusal names the holder (pid, group) and leaves nothing behind", async () => {
    const e = await createOpenspecEnv();
    withSkill(e);
    initRepoAt(e.cwd);
    writeGroupFiles(e.cwd, { assignments: { a: "g" }, changes: { a: undefined } });
    lock(e.cwd, rec(e.clock.now(), { groupId: "other" }));
    const res = await e.restStart({ template: GROUP, goal: "g", cwd: e.cwd });
    expect(res.body).toMatchObject({ ok: false, error: "batch_runner_active", details: { pid: process.pid, groupId: "other" } });
    expect(e.rt.store.list()).toEqual([]);
  });
});

describe("parity with the ship-batch lock reader (task 3.15)", () => {
  /** The package cannot import `.pi/skills/ship-batch/scripts/lock.ts` (outside `files`); this runs it side by side when present. */
  const skillLock = path.resolve(import.meta.dirname, "../../../../../../.pi/skills/ship-batch/scripts/lock.ts");

  it.skipIf(!fs.existsSync(skillLock))("same-host decisions equal ship-batch's lockDecision (refuse ⇔ live) wherever the heartbeat is not in the future", async () => {
    const sb = (await import(/* @vite-ignore */ skillLock)) as {
      LOCK_STALE_MS: number;
      lockDecision(lock: unknown, self: { hostname: string; pid: number }, now: number, isAlive?: (pid: number) => boolean): { action: string };
    };
    expect(sb.LOCK_STALE_MS).toBe(BATCH_LOCK_STALE_MS);
    const now = 1_700_000_000_000;
    const self = { hostname: "h", pid: 1 };
    for (const age of [0, 1, 5 * MIN, 10 * MIN - 1, 10 * MIN, 10 * MIN + 1, 60 * MIN]) {
      for (const alive of [true, false]) {
        const info = { pid: 42, hostname: "h", groupId: "g", heartbeatAt: now - age };
        const theirs = sb.lockDecision(info, self, now, () => alive).action === "refuse";
        expect(batchLockLive(info, now, self, () => alive), `age ${age} alive ${alive}`).toBe(theirs);
      }
    }
  });

  it("the rules of this change on top: a heartbeat more than 60 s ahead is stale (ship-batch has no such rule)", () => {
    const now = 1_700_000_000_000;
    const info = { pid: 42, hostname: "h", groupId: "g", heartbeatAt: now + MIN + 1 };
    expect(batchLockLive(info, now, { hostname: "h" }, () => true)).toBe(false);
  });

  it("checkBatchRunner reads the lock path <repo>/.worktrees/.ship-batch/lock", () => {
    const repo = makeRepo();
    expect(checkBatchRunner(repo, { now: 1 })).toEqual({ active: false });
    lock(repo, { pid: 7, hostname: "x", groupId: "gg", heartbeatAt: 1 });
    expect(checkBatchRunner(repo, { now: 2, hostname: "x", isAlive: () => true })).toEqual({ active: true, pid: 7, groupId: "gg", hostname: "x" });
    expect(batchLockPath(repo)).toBe(path.join(repo, ".worktrees", ".ship-batch", "lock"));
  });
});

describe("the same change in two teams (8.22 #R9)", () => {
  async function startGroup(e: OpenspecEnv): Promise<ReturnType<OpenspecEnv["restStart"]>> {
    return e.restStart({ template: GROUP, goal: "g", cwd: e.cwd });
  }

  async function seededEnv() {
    const e = await createOpenspecEnv();
    withSkill(e);
    initRepoAt(e.cwd);
    writeGroupFiles(e.cwd, { assignments: { a: "g", b: "g" }, changes: { a: undefined, b: blockedBy("a") } });
    return e;
  }

  it("a second group start naming the same changes is refused change_in_use from the sidecar of the active team; nothing is created", async () => {
    const e = await seededEnv();
    expect((await startGroup(e)).status).toBe(200);
    const first = e.rt.store.list()[0];
    if (!first) throw new Error("no team");
    await e.bindLead(first);
    await e.flush();
    expect(e.api.sidecar.get(first.id)).toMatchObject({ seeded: true });
    const teamsBefore = e.rt.store.list().length;
    const second = await startGroup(e);
    expect(second.body).toMatchObject({ ok: false, error: "change_in_use", details: { changes: ["a", "b"] } });
    expect(e.rt.store.list()).toHaveLength(teamsBefore);
    expect(e.api.sidecar.ids()).toEqual([first.id]);
  });

  it("a started team that has not seeded yet claims its changes (pending-plan registry); seeding hands the claim to the sidecar; a closed team releases its changes", async () => {
    const e = await seededEnv();
    expect((await startGroup(e)).status).toBe(200);
    const first = e.rt.store.list()[0];
    if (!first) throw new Error("no team");
    // not bound/seeded yet: no sidecar, but the preflight snapshot is pending, so the second start is refused (the preflight→bind window is closed)
    expect(await runPreflight(e.api, "group", "g", e.cwd)).toMatchObject({ ok: false, error: "change_in_use", details: { changes: ["a", "b"] } });
    await e.bindLead(first);
    await e.flush();
    expect(await runPreflight(e.api, "group", "g", e.cwd)).toMatchObject({ ok: false, error: "change_in_use" });
    expect(e.rt.ops.teamDelete(first, { actor: "user", force: true }).ok).toBe(true);
    await e.flush();
    expect(first.status).toBe("closed");
    expect(await runPreflight(e.api, "group", "g", e.cwd)).toMatchObject({ ok: true });
  });

  it("regression: two group starts racing between preflight and bind — the later one is refused change_in_use, nothing of it is created", async () => {
    const e = await seededEnv();
    const [r1, r2] = await Promise.all([startGroup(e), startGroup(e)]);
    const bodies = [r1, r2].map((r) => r.body as { ok?: boolean; error?: string });
    expect(bodies.filter((b) => b.error === "change_in_use")).toHaveLength(1);
    expect([r1.status, r2.status].filter((s) => s === 200)).toHaveLength(1);
    expect(e.rt.store.list()).toHaveLength(1);
  });

  it("an unseeded claim expires (a start that never bound must not block the changes for good); another repository is unaffected", async () => {
    const e = await seededEnv();
    expect((await startGroup(e)).status).toBe(200);
    expect(await runPreflight(e.api, "group", "g", e.cwd)).toMatchObject({ ok: false, error: "change_in_use" });
    const other = makeRepo();
    writeGroupFiles(other, { assignments: { a: "g" }, changes: { a: undefined } });
    expect(await runPreflight(e.api, "group", "g", other)).toMatchObject({ ok: true });
    e.clock.advance(PENDING_CLAIM_TTL_MS - 1);
    expect(await runPreflight(e.api, "group", "g", e.cwd)).toMatchObject({ ok: false, error: "change_in_use" });
    e.clock.advance(1);
    expect(await runPreflight(e.api, "group", "g", e.cwd)).toMatchObject({ ok: true });
  });

  it("an apply preflight claims its goal change for the other profile too, and releases it when the seed takes the snapshot", async () => {
    const e = await createOpenspecEnv();
    e.kind("apply", { plan: () => ({ tasks: [{ key: "1.1", title: "t" }] }) });
    expect(await getStartProfile(APPLY)?.preflight("x", e.cwd)).toEqual({ ok: true });
    expect([...changesInUse(e.api, e.cwd)]).toEqual(["x"]);
    const team = e.team("apply", "x");
    await getStartProfile(APPLY)?.seed(team); // takes the snapshot: the sidecar owns the change from here
    expect(e.api.sidecar.has(team.id)).toBe(true);
    expect(pendingClaimCount(e.api)).toBe(0);
  });

  it("an openspec-apply team on the same change also blocks a group start (and the apply goal is the change)", async () => {
    const e = await seededEnv();
    const apply = e.team("apply", "a");
    e.api.sidecar.create({ teamId: apply.id, kind: "apply", goal: "a", repo: e.cwd });
    expect(await runPreflight(e.api, "group", "g", e.cwd)).toMatchObject({ ok: false, error: "change_in_use", details: { changes: ["a"] } });
  });

  it("another repository with the same change names is unaffected", async () => {
    const e = await seededEnv();
    const apply = e.team("apply", "a");
    e.api.sidecar.create({ teamId: apply.id, kind: "apply", goal: "a", repo: e.cwd });
    const other = makeRepo();
    writeGroupFiles(other, { assignments: { a: "g" }, changes: { a: undefined } });
    expect(await runPreflight(e.api, "group", "g", other)).toMatchObject({ ok: true });
  });

  it("the check needs no host session lookup: it holds with the seam absent (the resident-session skip is the launcher's)", async () => {
    const e = await seededEnv();
    const apply = e.team("apply", "b");
    e.api.sidecar.create({ teamId: apply.id, kind: "apply", goal: "b", repo: e.cwd });
    expect(await runPreflight(e.api, "group", "g", e.cwd)).toMatchObject({ ok: false, error: "change_in_use", details: { changes: ["b"] } });
  });
});
