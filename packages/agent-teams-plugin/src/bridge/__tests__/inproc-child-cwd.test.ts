/**
 * Working directory rules of an in-process child (test-plan S47; design D8, tasks 6.8): core's confinement runs first on the server
 * (`cwd_outside_lead`, zero commands), then the lead-side host applies the package's own `cwdScope:"repo"` check on real paths:
 * a directory outside it is refused `cwd_outside_scope` unless feature `cwd_scope` exists, in which case the request — and ONLY then —
 * carries `cwdScope:"any"`. Real temp directories, a real git repository and a real worktree; the upstream is the contract double.
 * See change: add-agent-teams-in-process.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createChildWorld } from "../../__tests__/harness/inproc-child-env.js";
import { createHostEnv, spawnCommand } from "../../__tests__/harness/inproc-host-env.js";
import { validCapabilities } from "../../__tests__/harness/subagents-double.js";
import { REQUIRED_FEATURES } from "../../shared/subagents-contract.js";
import { classifyCwd, decideCwd } from "../inproc-spawn-checks.js";

const git = (cwd: string, ...args: string[]): void => void execFileSync("git", args, { cwd, stdio: "ignore", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });

interface Fixture {
  root: string;
  repo: string;
  sub: string;
  worktree: string;
  outside: string;
  linkToOutside: string;
}
let fx: Fixture;

beforeAll(() => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "cwd-rules-")));
  const repo = path.join(root, "repo");
  mkdirSync(path.join(repo, "sub"), { recursive: true });
  git(repo, "init", "-q");
  writeFileSync(path.join(repo, "f"), "x");
  git(repo, "add", "f");
  git(repo, "commit", "-q", "-m", "init");
  const worktree = path.join(root, "wt");
  git(repo, "worktree", "add", "-q", worktree);
  const outside = path.join(root, "outside");
  mkdirSync(outside);
  const linkToOutside = path.join(repo, "sub", "escape");
  symlinkSync(outside, linkToOutside);
  fx = { root, repo, sub: path.join(repo, "sub"), worktree, outside, linkToOutside };
});

describe("S47 classifyCwd — the package's own cwdScope:repo rule on real paths", () => {
  it("accepts the lead cwd subtree and a worktree sharing the lead's git common dir; refuses a sibling, a symlink to outside, `..` traversal", async () => {
    expect((await classifyCwd(fx.repo, fx.sub)).kind).toBe("in_scope");
    expect((await classifyCwd(fx.repo, "sub")).kind).toBe("in_scope"); // relative paths resolve against the lead cwd
    expect((await classifyCwd(fx.repo, fx.worktree)).kind).toBe("in_scope");
    expect((await classifyCwd(fx.repo, fx.outside)).kind).toBe("outside");
    expect((await classifyCwd(fx.repo, fx.linkToOutside)).kind).toBe("outside"); // the symlink is followed
    expect((await classifyCwd(fx.repo, path.join(fx.sub, "..", "..", "outside"))).kind).toBe("outside");
  });

  it("rejects a missing path, a file, a NUL byte and an empty path that does not exist", async () => {
    expect(await classifyCwd(fx.repo, path.join(fx.repo, "nope"))).toEqual({ kind: "invalid", reason: "cwd_not_found" });
    expect(await classifyCwd(fx.repo, path.join(fx.repo, "f"))).toEqual({ kind: "invalid", reason: "cwd_not_dir" });
    expect(await classifyCwd(fx.repo, `${fx.sub}\u0000x`)).toEqual({ kind: "invalid", reason: "cwd_not_found" });
    expect((await classifyCwd(fx.repo, "")).kind).toBe("in_scope"); // empty = the lead cwd itself
  });

  it("decideCwd: outside + feature absent ⇒ cwd_outside_scope; outside + feature ⇒ cwdScope any; in scope ⇒ nothing; a global scope any ⇒ nothing", async () => {
    expect(await decideCwd(fx.repo, fx.outside, { features: [...REQUIRED_FEATURES] })).toMatchObject({ refusal: { error: "cwd_outside_scope" } });
    expect(await decideCwd(fx.repo, fx.outside, { features: [...REQUIRED_FEATURES, "cwd_scope"] })).toEqual({ cwdScope: "any" });
    expect(await decideCwd(fx.repo, fx.worktree, { features: [...REQUIRED_FEATURES, "cwd_scope"] })).toEqual({});
    expect(await decideCwd(fx.repo, fx.outside, { features: [...REQUIRED_FEATURES], globalScope: "any" })).toEqual({});
  });
});

describe("S47 core confinement first (server): zero commands for a directory outside the lead cwd and extraCwdRoots", () => {
  for (const [label, cwd] of [
    ["sibling dir outside", () => fx.outside],
    ["`..` traversal", () => path.join(fx.sub, "..", "..", "outside")],
    ["symlink to outside", () => fx.linkToOutside],
    ["NUL byte", () => `${fx.sub}\u0000`],
    ["4096+ chars", () => path.join(fx.sub, "d".repeat(4100))],
  ] as const) {
    it(`${label} is rejected before any command is emitted`, async () => {
      const w = await createChildWorld({ leadCwd: fx.repo });
      const { result } = await w.spawn("bob", { cwd: cwd() });
      expect(result.ok).toBe(false);
      expect(w.link.commands.filter((c) => c.cmd === "spawn")).toHaveLength(0);
    });
  }

  it("a lead repo subdirectory passes core and the command carries it", async () => {
    const w = await createChildWorld({ leadCwd: fx.repo });
    const { result, command } = await w.spawn("bob", { cwd: fx.sub });
    expect(result.ok).toBe(true);
    expect(command?.spec.cwd).toBe(fx.sub);
    expect(command?.spec.cwdScope).toBeUndefined();
  });
});

/** The host over the double with the REAL fs/git probes, the command built by the REAL server for `cwd`. */
async function hostSpawn(cwd: string, features: readonly string[]) {
  const w = await createChildWorld({ leadCwd: fx.repo, config: { extraCwdRoots: [fx.worktree, fx.outside] } });
  const { result, command } = await w.spawn("bob", { cwd });
  expect(result.ok).toBe(true); // passes core (extra roots)
  const env = createHostEnv({ double: { answer: validCapabilities({ features: [...features] }) }, hostDeps: { leadCwd: () => fx.repo } });
  await env.start();
  env.command({ ...spawnCommand("bob"), ...(command as object), cmdId: "spawn-1" });
  await vi.waitFor(() => expect(env.ackOf("spawn-1")).toBeDefined());
  return { ack: env.ackOf("spawn-1"), env };
}

describe("S47 the lead-side host applies the scope after core", () => {
  const required = [...REQUIRED_FEATURES];

  it("worktree of the lead repo (extra root): child starts there, request carries no cwdScope", async () => {
    const { ack, env } = await hostSpawn(fx.worktree, [...required, "cwd_scope"]);
    expect(ack?.ok).toBe(true);
    expect(env.double.spawnRequests).toHaveLength(1);
    expect(env.double.spawnRequests[0]?.cwd).toBe(fx.worktree);
    expect(env.double.spawnRequests[0]?.cwdScope).toBeUndefined();
  });

  it("outside the repo, feature absent: cwd_outside_scope, no upstream call (no child)", async () => {
    const { ack, env } = await hostSpawn(fx.outside, required);
    expect(ack).toMatchObject({ ok: false, error: "cwd_outside_scope" });
    expect(env.double.spawnRequests).toHaveLength(0);
    expect(env.double.children.size).toBe(0);
  });

  it("outside the repo, feature cwd_scope present: the request carries cwdScope any — and only in that case", async () => {
    const { ack, env } = await hostSpawn(fx.outside, [...required, "cwd_scope"]);
    expect(ack?.ok).toBe(true);
    expect(env.double.spawnRequests[0]?.cwdScope).toBe("any");
  });

  it("a server-asserted cwdScope any is dropped when the directory is inside the scope", async () => {
    const env = createHostEnv({ hostDeps: { leadCwd: () => fx.repo } });
    await env.start();
    const base = spawnCommand("bob");
    env.command({ ...base, cmdId: "s1", spec: { ...(base.spec as object), cwd: fx.sub, cwdScope: "any" } });
    await vi.waitFor(() => expect(env.ackOf("s1")?.ok).toBe(true));
    expect(env.double.spawnRequests[0]?.cwdScope).toBeUndefined();
  });

  it("a rejected directory (missing) never creates a child", async () => {
    const env = createHostEnv({ hostDeps: { leadCwd: () => fx.repo } });
    await env.start();
    const base = spawnCommand("bob");
    env.command({ ...base, cmdId: "s2", spec: { ...(base.spec as object), cwd: path.join(fx.repo, "missing") } });
    await vi.waitFor(() => expect(env.ackOf("s2")).toMatchObject({ ok: false, error: "cwd_outside_scope" }));
    expect(env.double.children.size).toBe(0);
  });
});
