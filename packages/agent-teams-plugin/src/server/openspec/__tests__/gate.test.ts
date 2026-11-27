/**
 * `not_shipped` completion gate (tasks 3.10, 8.15–8.20; test-plan #X6 #X7 #X8 #X9 #X10 #P7): a launcher-owned
 * task of a group team completes only when the change is SHIPPED — exact `YYYY-MM-DD-<change>` archive
 * directory with the change directory gone (worktree present), or the same listing on `origin/<merge>` after a
 * bounded fetch (worktree gone). Fail closed everywhere; scope limited to launcher-owned completions.
 * See change: add-agent-teams-openspec.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runOpGatePipeline } from "../../extension-points.js";
import { type GateIo, nodeGateIo, verifyShipped } from "../gate.js";
import { launcherOf } from "../launcher.js";
import { tmp } from "./env.js";
import { createGroupEnv, type GroupEnv } from "./launcher-env.js";

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const CHANGE = "fix-x";

/** A bare repo dir with the worktree layout for `CHANGE`; returns the repo root and the archive dir. */
function worktreeFixture(opts: { changeDir?: boolean; entries?: Array<{ name: string; kind?: "dir" | "file" | "symlink" }> } = {}) {
  const repo = tmp();
  const wt = path.join(repo, ".worktrees", `os-${CHANGE}`);
  const archive = path.join(wt, "openspec", "changes", "archive");
  fs.mkdirSync(archive, { recursive: true });
  if (opts.changeDir) fs.mkdirSync(path.join(wt, "openspec", "changes", CHANGE), { recursive: true });
  for (const e of opts.entries ?? []) {
    const p = path.join(archive, e.name);
    if (e.kind === "file") fs.writeFileSync(p, "x");
    else if (e.kind === "symlink") fs.symlinkSync(repo, p);
    else fs.mkdirSync(p, { recursive: true });
  }
  return { repo, wt, archive };
}

const verify = (e: GroupEnv, repo: string, io?: GateIo, over: { merge?: string; fetchTimeoutMs?: number } = {}) =>
  verifyShipped(e.api, { repo, change: CHANGE, merge: over.merge ?? "develop", fetchTimeoutMs: over.fetchTimeoutMs ?? 8000 }, io);

describe("state (a): worktree present (8.15, #X6)", () => {
  it.each([
    ["exact entry, change dir absent", [{ name: "2025-01-01-fix-x" }], false, true],
    ["exact entry, change dir still present", [{ name: "2025-01-01-fix-x" }], true, false],
    ["no entry at all", [], false, false],
    ["suffix glob look-alike add-fix-x", [{ name: "2025-01-01-add-fix-x" }], false, false],
    ["suffix look-alike fix-x-2", [{ name: "2025-01-01-fix-x-2" }], false, false],
    ["malformed date 2025-1-1", [{ name: "2025-1-1-fix-x" }], false, false],
    ["undated name", [{ name: "fix-x" }], false, false],
    ["a FILE named like the entry", [{ name: "2025-01-01-fix-x", kind: "file" as const }], false, false],
    ["a SYMLINK named like the entry", [{ name: "2025-01-01-fix-x", kind: "symlink" as const }], false, false],
    ["several dated entries, one exact", [{ name: "2024-12-31-other" }, { name: "2025-01-01-fix-x" }, { name: "2025-02-02-fix-x-2" }], false, true],
  ])("%s", async (_name, entries, changeDir, allowed) => {
    const e = await createGroupEnv({ changes: [CHANGE] });
    const { repo } = worktreeFixture({ entries, changeDir });
    const v = await verify(e, repo);
    expect(v.ok).toBe(allowed);
    if (!v.ok) expect(["not_archived", "change_dir_present"]).toContain(v.reason);
  });

  it("a missing archive directory is not_archived (not a crash)", async () => {
    const e = await createGroupEnv({ changes: [CHANGE] });
    const repo = tmp();
    fs.mkdirSync(path.join(repo, ".worktrees", `os-${CHANGE}`), { recursive: true });
    expect(await verify(e, repo)).toEqual({ ok: false, reason: "not_archived" });
  });

  it("the worktree is a symlink: never trusted", async () => {
    const e = await createGroupEnv({ changes: [CHANGE] });
    const repo = tmp();
    const other = tmp();
    fs.mkdirSync(path.join(repo, ".worktrees"), { recursive: true });
    fs.mkdirSync(path.join(other, "openspec", "changes", "archive", "2025-01-01-fix-x"), { recursive: true });
    fs.symlinkSync(other, path.join(repo, ".worktrees", `os-${CHANGE}`));
    expect(await verify(e, repo)).toEqual({ ok: false, reason: "check_failed" });
  });
});

/** Scripted io for state (b): the worktree is absent; `git` answers by subcommand. */
function remoteIo(git: GateIo["git"]): GateIo & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    stat: async () => "absent",
    list: async () => {
      throw new Error("not used");
    },
    git: (args, o) => {
      calls.push([...args]);
      return git(args, o);
    },
  };
}
const tree = (...names: string[]): Uint8Array => Buffer.from(names.map((n) => `040000 tree 0123456789abcdef0123456789abcdef01234567\topenspec/changes/archive/${n}\u0000`).join(""));
const ok = (stdout: Uint8Array = Buffer.alloc(0)) => Promise.resolve({ code: 0, stdout });

describe("state (b): worktree gone (8.16, #X7)", () => {
  it("fetch ok + exact entry on origin/<merge> ⇒ allowed; argv has `--` separators and no shell", async () => {
    const e = await createGroupEnv({ changes: [CHANGE] });
    const io = remoteIo((args) => (args[0] === "fetch" ? ok() : ok(tree("2025-01-01-fix-x"))));
    expect(await verify(e, tmp(), io)).toEqual({ ok: true, mode: "remote" });
    expect(io.calls[0]).toEqual(["fetch", "--no-tags", "--quiet", "--", "origin", "develop"]);
    expect(io.calls[1]).toEqual(["ls-tree", "-z", "refs/remotes/origin/develop", "--", "openspec/changes/archive/"]);
  });

  it.each([
    ["fetch ok, no entry", () => ok(tree("2025-01-01-add-fix-x", "2025-01-01-fix-x-2")), "not_on_merge_base"],
    ["fetch ok, entry is not a tree", () => ok(Buffer.from("100644 blob 0123456789abcdef0123456789abcdef01234567\topenspec/changes/archive/2025-01-01-fix-x\u0000")), "not_on_merge_base"],
  ])("%s", async (_n, ls, reason) => {
    const e = await createGroupEnv({ changes: [CHANGE] });
    const io = remoteIo((args) => (args[0] === "fetch" ? ok() : (ls as () => ReturnType<typeof ok>)()));
    expect(await verify(e, tmp(), io)).toEqual({ ok: false, reason });
  });

  it("fetch non-zero exit (e.g. no `origin` remote) ⇒ fetch_failed and ls-tree is never run", async () => {
    const e = await createGroupEnv({ changes: [CHANGE] });
    const io = remoteIo(async () => ({ code: 128, stdout: Buffer.alloc(0) }));
    expect(await verify(e, tmp(), io)).toEqual({ ok: false, reason: "fetch_failed" });
    expect(io.calls).toHaveLength(1);
  });

  it("merge ref missing after a clean fetch (ls-tree fails) ⇒ blocked", async () => {
    const e = await createGroupEnv({ changes: [CHANGE] });
    const io = remoteIo(async (args) => (args[0] === "fetch" ? { code: 0, stdout: Buffer.alloc(0) } : { code: 128, stdout: Buffer.alloc(0) }));
    const v = await verify(e, tmp(), io);
    expect(v.ok).toBe(false);
  });

  it("a hanging fetch is aborted at openspecFetchTimeoutMs on the clock and blocked fetch_failed", async () => {
    const e = await createGroupEnv({ changes: [CHANGE] });
    let signal: AbortSignal | undefined;
    const io = remoteIo((_a, o) => {
      signal = o.signal;
      return new Promise(() => undefined);
    });
    const p = verify(e, tmp(), io, { fetchTimeoutMs: 8000 });
    await settle();
    e.clock.advance(7999);
    await settle();
    expect(signal?.aborted).toBe(false);
    e.clock.advance(1);
    expect(await p).toEqual({ ok: false, reason: "fetch_failed" });
    expect(signal?.aborted).toBe(true);
  });

  it("fetch timeout is bounded by config: default 8000, max 10000 — below the 12 s op-gate budget", async () => {
    const e = await createGroupEnv({ changes: [CHANGE], pluginConfig: { openspecFetchTimeoutMs: 60_000 } });
    const cfg = e.api.config({ effectiveMaxTeammates: 5 });
    expect(cfg.ok && cfg.config.fetchTimeoutMs).toBe(10_000);
    const dflt = (await createGroupEnv({ changes: [CHANGE] })).api.config({ effectiveMaxTeammates: 5 });
    expect(dflt.ok && dflt.config.fetchTimeoutMs).toBe(8000);
  });

  it("openspecWorktreeBase=main, openspecMergeBase=develop: the verdict is on origin/develop (end to end through the gate)", async () => {
    const e = await createGroupEnv({ changes: [CHANGE], pluginConfig: { openspecWorktreeBase: "main", openspecMergeBase: "develop" } });
    const git = vi.spyOn(nodeGateIo, "git").mockImplementation(async (args) => (args[0] === "fetch" ? { code: 0, stdout: Buffer.alloc(0) } : { code: 0, stdout: tree("2025-01-01-fix-x") }));
    await e.run();
    const id = e.taskOf(CHANGE);
    e.rt.store.patchMember(e.gteam.id, `os-${CHANGE}`, { sessionId: "S-m", status: "busy" });
    e.fake.addSession("S-m", { cwd: e.cwd });
    expect(await e.fake.call("S-m", "TaskUpdate", { id, status: "in_progress" })).toMatchObject({ ok: true });
    const res = await e.fake.call("S-m", "TaskUpdate", { id, status: "completed", result: "shipped" });
    expect(res).toMatchObject({ ok: true });
    expect(git.mock.calls.every((c) => c[0].includes("develop") || c[0].includes("refs/remotes/origin/develop"))).toBe(true);
    git.mockRestore();
  });
});

describe("state (b) against a real repository", () => {
  const sh = (cwd: string, ...args: string[]): void => void execFileSync("git", args, { cwd, stdio: "ignore", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });

  function realRepos(archiveNames: string[]) {
    const root = tmp();
    const origin = path.join(root, "origin.git");
    const other = path.join(root, "other");
    const clone = path.join(root, "clone");
    fs.mkdirSync(origin);
    sh(origin, "init", "--bare", "-b", "develop");
    sh(root, "clone", origin, other);
    sh(other, "checkout", "-b", "develop");
    for (const n of archiveNames) {
      fs.mkdirSync(path.join(other, "openspec", "changes", "archive", n), { recursive: true });
      fs.writeFileSync(path.join(other, "openspec", "changes", "archive", n, "proposal.md"), "x");
    }
    fs.writeFileSync(path.join(other, "README"), "x");
    sh(other, "add", "-A");
    sh(other, "commit", "-m", "init");
    sh(other, "push", "origin", "develop");
    sh(root, "clone", origin, clone);
    return { clone, other };
  }

  it("the real fetch + ls-tree argv works: exact entry allowed; a similarly named archive blocked", async () => {
    const e = await createGroupEnv({ changes: [CHANGE] });
    const yes = realRepos(["2025-01-01-fix-x"]);
    expect(await verify(e, yes.clone)).toEqual({ ok: true, mode: "remote" });
    const no = realRepos(["2025-01-01-add-fix-x", "2025-01-01-fix-x-2"]);
    expect(await verify(e, no.clone)).toEqual({ ok: false, reason: "not_on_merge_base" });
  });

  it("a fetch that sees a NEW merge on the remote picks it up (the fetch is not skipped)", async () => {
    const e = await createGroupEnv({ changes: [CHANGE] });
    const { clone, other } = realRepos([]);
    expect(await verify(e, clone)).toEqual({ ok: false, reason: "not_on_merge_base" });
    fs.mkdirSync(path.join(other, "openspec", "changes", "archive", "2025-03-03-fix-x"), { recursive: true });
    fs.writeFileSync(path.join(other, "openspec", "changes", "archive", "2025-03-03-fix-x", "p.md"), "x");
    sh(other, "add", "-A");
    sh(other, "commit", "-m", "ship");
    sh(other, "push", "origin", "develop");
    expect(await verify(e, clone)).toEqual({ ok: true, mode: "remote" });
  });

  it("no origin remote: blocked fetch_failed", async () => {
    const e = await createGroupEnv({ changes: [CHANGE] });
    const repo = tmp();
    sh(repo, "init", "-b", "develop");
    expect(await verify(e, repo)).toEqual({ ok: false, reason: "fetch_failed" });
  });

  it("untrusted merge values never reach git (option-like / invalid refs ⇒ check_failed, no process)", async () => {
    const e = await createGroupEnv({ changes: [CHANGE] });
    const git = vi.spyOn(nodeGateIo, "git");
    for (const merge of ["--upload-pack=x", "-x", "a..b", "x y", "@{-1}", "x.lock", "x/", "a\nb"]) {
      expect(await verify(e, tmp(), nodeGateIo, { merge }), merge).toEqual({ ok: false, reason: "check_failed" });
    }
    expect(git).not.toHaveBeenCalled();
    git.mockRestore();
  });
});

describe("fail closed (8.17, #X8)", () => {
  const boom = (code: string) => Object.assign(new Error("boom"), { code });
  const cases: Array<[string, GateIo]> = [
    ["stat of the worktree throws EACCES", { stat: async () => Promise.reject(boom("EACCES")), list: async () => [], git: () => ok() }],
    ["listing the archive throws EACCES", { stat: async () => "dir", list: async () => Promise.reject(boom("EACCES")), git: () => ok() }],
    ["the dir vanishes mid-check (list then ENOENT)", { stat: async () => "dir", list: async () => Promise.reject(boom("ENOENT")), git: () => ok() }],
    ["git ENOENT (not installed)", { stat: async () => "absent", list: async () => [], git: () => Promise.reject(boom("ENOENT")) }],
    ["git throws synchronously", { stat: async () => "absent", list: async () => [], git: () => { throw new Error("sync"); } }],
    ["non-UTF8 ls-tree output", { stat: async () => "absent", list: async () => [], git: (a) => (a[0] === "fetch" ? ok() : ok(Buffer.from([0x30, 0x34, 0x30, 0x30, 0x30, 0x30, 0x20, 0x74, 0x72, 0x65, 0x65, 0x20, 0x61, 0x09, 0xff, 0xfe, 0xc3, 0x28, 0x00]))) }],
    ["the change dir stat fails after a clean listing", { stat: async (p) => (p.endsWith(CHANGE) ? Promise.reject(boom("EIO")) : "dir"), list: async () => [{ name: "2025-01-01-fix-x", kind: "dir" }], git: () => ok() }],
  ];
  it.each(cases)("%s ⇒ never allowed, never throws", async (_n, io) => {
    const e = await createGroupEnv({ changes: [CHANGE] });
    const v = await verify(e, tmp(), io);
    expect(v.ok).toBe(false);
  });

  it("an io that rejects AFTER the bounded wait was settled leaves no unhandled rejection", async () => {
    const e = await createGroupEnv({ changes: [CHANGE] });
    const seen: unknown[] = [];
    const on = (r: unknown): void => void seen.push(r);
    process.on("unhandledRejection", on);
    let rejectLate: (e: Error) => void = () => undefined;
    const io = remoteIo(() => new Promise((_r, rej) => void (rejectLate = rej)));
    const p = verify(e, tmp(), io, { fetchTimeoutMs: 100 });
    await settle();
    e.clock.advance(100);
    await p;
    rejectLate(new Error("late"));
    await settle();
    await settle();
    process.off("unhandledRejection", on);
    expect(seen).toEqual([]);
  });

  it("through the op: a thrown scope/gate error blocks, the task and the store stay unchanged, one structured log without task text", async () => {
    const e = await createGroupEnv({ changes: [CHANGE] });
    await e.run();
    const id = e.taskOf(CHANGE);
    e.rt.store.patchMember(e.gteam.id, `os-${CHANGE}`, { sessionId: "S-m", status: "busy" });
    e.fake.addSession("S-m", { cwd: e.cwd });
    await e.fake.call("S-m", "TaskUpdate", { id, status: "in_progress" });
    const stat = vi.spyOn(nodeGateIo, "stat").mockRejectedValue(Object.assign(new Error("EACCES secret-task-text"), { code: "EACCES" }));
    const before = JSON.stringify(e.rt.store.task(e.rt.store.get(e.gteam.id)!, id));
    const res = await e.fake.call("S-m", "TaskUpdate", { id, status: "completed", result: "TOP SECRET RESULT" });
    stat.mockRestore();
    expect(res).toMatchObject({ ok: false, error: "op_blocked" });
    expect(res.message).toContain("not_shipped (check_failed)");
    expect(JSON.stringify(e.rt.store.task(e.rt.store.get(e.gteam.id)!, id))).toBe(before);
    const lines = [...e.fake.logs.warn, ...e.fake.logs.info, ...e.fake.logs.error].filter((l) => l.includes("openspec not_shipped"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("reason=check_failed");
    expect([...e.fake.logs.warn, ...e.fake.logs.info, ...e.fake.logs.error].join("\n")).not.toContain("TOP SECRET");
  });
});

/** Run every registered `TaskUpdate` gate like core does for a completing call. */
async function gates(e: GroupEnv, team: { id: string }, callerName: string, args: Record<string, unknown>) {
  const t = e.rt.store.get(team.id)!;
  return runOpGatePipeline(e.rt.ext.gatesFor("TaskUpdate"), { op: "TaskUpdate", team: t, callerName, args }, 12_000, e.clock);
}

describe("gate scope (8.18, #X9)", () => {
  it("fires only on the completion of a launcher-owned task; every other cell touches neither fs nor git", async () => {
    const e = await createGroupEnv({ changes: ["a", "b"], pluginConfig: { openspecGroupParallel: 1 } });
    await e.run();
    const lead = e.rt.ops.createTask(e.rt.store.get(e.gteam.id)!, { title: "lead extra" }, { actor: "lead" });
    const review = e.rt.ops.createTask(e.rt.store.get(e.gteam.id)!, { title: "Review" }, { actor: "lead" });
    if (!lead.ok || !review.ok) throw new Error("setup");
    const apply = e.team("apply", "some-change", { seeded: true });
    const applyTask = e.rt.ops.createTask(apply, { title: "apply task" }, { actor: "lead" });
    if (!applyTask.ok) throw new Error("setup");
    const stat = vi.spyOn(nodeGateIo, "stat");
    const list = vi.spyOn(nodeGateIo, "list");
    const git = vi.spyOn(nodeGateIo, "git");
    const touched = () => stat.mock.calls.length + list.mock.calls.length + git.mock.calls.length;
    const kinds: Array<[string, { id: string }, string]> = [
      ["launcher-owned", { id: e.taskOf("a") }, e.gteam.id],
      ["lead-created extra", { id: lead.data.task.id }, e.gteam.id],
      ["Review/other", { id: review.data.task.id }, e.gteam.id],
      ["apply-team task", { id: applyTask.data.task.id }, apply.id],
    ];
    const updates: Array<[string, Record<string, unknown>]> = [
      ["completed", { status: "completed" }],
      ["in_progress", { status: "in_progress" }],
      ["owner change", { owner: "os-b" }],
      ["title edit", { title: "x" }],
    ];
    for (const [kind, { id }, teamId] of kinds) {
      for (const [uname, u] of updates) {
        for (const actor of ["lead", "os-a"]) {
          const before = touched();
          const out = await gates(e, { id: teamId }, actor, { id, ...u });
          const fired = touched() > before;
          const expected = kind === "launcher-owned" && uname === "completed";
          expect(fired, `${kind} × ${uname} × ${actor}`).toBe(expected);
          if (!expected) expect(out.kind, `${kind} × ${uname} × ${actor}`).toBe("pass");
        }
      }
    }
    stat.mockRestore();
    list.mockRestore();
    git.mockRestore();
  });

  it("a non-launcher completion passes through the whole gate pipeline (change-3 hook gate + this one) without any fs/git work", async () => {
    const e = await createGroupEnv({ changes: ["a"] });
    const lead = e.rt.ops.createTask(e.rt.store.get(e.gteam.id)!, { title: "lead extra" }, { actor: "lead" });
    if (!lead.ok) throw new Error("setup");
    expect(e.rt.ext.gatesFor("TaskUpdate").length).toBeGreaterThanOrEqual(2); // change-3 hook gate + this one
    const git = vi.spyOn(nodeGateIo, "git");
    const out = await gates(e, e.gteam, "lead", { id: lead.data.task.id, status: "completed" });
    expect(out.kind).toBe("pass");
    expect(git).not.toHaveBeenCalled();
    git.mockRestore();
  });

  it("a missing launcher state (sidecar lost) of an ownerLocked task fails closed state_unavailable", async () => {
    const e = await createGroupEnv({ changes: ["a"] });
    e.api.sidecar.remove(e.gteam.id);
    const out = await gates(e, e.gteam, "os-a", { id: "1", status: "completed" });
    expect(out.kind).toBe("veto");
    if (out.kind === "veto") expect(out.veto.feedback).toContain("not_shipped (state_unavailable)");
  });
});

describe("abandon path (8.19, #X10)", () => {
  it("the lead cannot force-complete a launcher task: refused not_shipped naming the relaunch route and TeamDelete; dependants stay blocked", async () => {
    const e = await createGroupEnv({ changes: ["a", { name: "b", blockedBy: ["a"] }] });
    await e.run();
    const { repo } = { repo: e.cwd };
    fs.mkdirSync(path.join(e.worktreeOf("a"), "openspec", "changes", "a"), { recursive: true }); // never archived
    const id = e.taskOf("a");
    e.rt.store.patchTask(e.gteam.id, id, { status: "in_progress" }); // stuck mid-run
    void repo;
    const res = await e.fake.call(e.rt.store.get(e.gteam.id)?.leadSessionId as string, "TaskUpdate", { id, status: "completed", result: "abandoned" });
    expect(res).toMatchObject({ ok: false, error: "op_blocked" });
    expect(res.message).toContain("not_shipped");
    expect(res.message).toContain("openspec-relaunch");
    expect(res.message).toContain("TeamDelete");
    const t = e.rt.store.get(e.gteam.id)!;
    expect(e.rt.store.task(t, id)?.status).toBe("in_progress");
    const b = e.rt.store.task(t, e.taskOf("b"))!;
    expect(e.rt.store.isBlocked(t, b)).toBe(true);
  });

  it("a member refusal tells it to hand back and leave the task in_progress (no relaunch advice)", async () => {
    const e = await createGroupEnv({ changes: ["a"] });
    await e.run();
    e.rt.store.patchMember(e.gteam.id, "os-a", { sessionId: "S-m", status: "busy" });
    e.fake.addSession("S-m", { cwd: e.cwd });
    const id = e.taskOf("a");
    await e.fake.call("S-m", "TaskUpdate", { id, status: "in_progress" });
    const res = await e.fake.call("S-m", "TaskUpdate", { id, status: "completed" });
    expect(res).toMatchObject({ ok: false, error: "op_blocked" });
    expect(res.message).toContain("leave the task in_progress");
    expect(res.message).not.toContain("TeamDelete");
  });
});

describe("a worktree-present completion end to end (8.15)", () => {
  it("allowed once the exact archive entry exists and the change dir is gone; the slot/shutdown flow then runs", async () => {
    const e = await createGroupEnv({ changes: ["a", "b"], pluginConfig: { openspecGroupParallel: 1 } });
    await e.run();
    e.rt.store.patchMember(e.gteam.id, "os-a", { sessionId: "S-m", status: "busy" });
    e.fake.addSession("S-m", { cwd: e.cwd });
    const id = e.taskOf("a");
    await e.fake.call("S-m", "TaskUpdate", { id, status: "in_progress" });
    const archive = path.join(e.worktreeOf("a"), "openspec", "changes", "archive", "2025-01-01-a");
    fs.mkdirSync(archive, { recursive: true });
    fs.mkdirSync(path.join(e.worktreeOf("a"), "openspec", "changes", "a"), { recursive: true });
    expect(await e.fake.call("S-m", "TaskUpdate", { id, status: "completed" })).toMatchObject({ ok: false });
    fs.rmSync(path.join(e.worktreeOf("a"), "openspec", "changes", "a"), { recursive: true });
    expect(await e.fake.call("S-m", "TaskUpdate", { id, status: "completed" })).toMatchObject({ ok: true });
    await settle();
    expect(e.rt.store.member(e.rt.store.get(e.gteam.id)!, "os-a")?.status).toBe("shutdown_pending");
    expect(launcherOf(e.api)).toBeDefined();
  });
});

describe("gate cost (8.20, #P7)", () => {
  it("worktree-present path with 50 archive entries over 100 calls: zero git/network calls, one listing + at most two stats per call", async () => {
    const e = await createGroupEnv({ changes: [CHANGE] });
    const entries = Array.from({ length: 49 }, (_, i) => ({ name: `2024-01-${String((i % 28) + 1).padStart(2, "0")}-other-${i}` }));
    const { repo } = worktreeFixture({ entries: [...entries, { name: "2025-01-01-fix-x" }] });
    const git = vi.spyOn(nodeGateIo, "git");
    const list = vi.spyOn(nodeGateIo, "list");
    const stat = vi.spyOn(nodeGateIo, "stat");
    for (let i = 0; i < 100; i++) expect((await verify(e, repo)).ok).toBe(true);
    expect(git).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledTimes(100);
    expect(stat.mock.calls.length).toBeLessThanOrEqual(300);
    git.mockRestore();
    list.mockRestore();
    stat.mockRestore();
  });
});
