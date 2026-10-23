/**
 * B1r — git option injection. Route-level scenarios SE1–SE5, SE7 and SE38 (test-plan): every
 * caller-supplied git ref / path is validated BEFORE any git process starts; present-invalid →
 * 400 `invalid_ref`, missing → the endpoint's existing code.
 *
 * See change: harden-git-terminal-plugin-boundaries.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as platformExec from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerGitRoutes } from "../routes/git-routes.js";

const KNOWN: string[] = [];
const known = <T extends string>(p: T): T => {
  KNOWN.push(p);
  return p;
};

function git(cmd: string, cwd: string): string {
  return execSync(`git ${cmd}`, { cwd, stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" });
}

function makeRepo(): string {
  const dir = known(realpathSync(mkdtempSync(join(tmpdir(), "git-ref-hard-"))));
  git("-c init.defaultBranch=main init", dir);
  git("config user.email test@test.com", dir);
  git("config user.name Test", dir);
  writeFileSync(join(dir, "README.md"), "init");
  git("add .", dir);
  git("commit -m init", dir);
  return dir;
}

/** Records every git spawn made through the platform exec wrapper (all four entry points). */
function spyGitSpawns(): { calls: string[][]; restore: () => void } {
  const calls: string[][] = [];
  const wrap = (name: "execFileSync" | "spawnSync" | "spawn") => {
    const real = platformExec[name] as (...a: any[]) => unknown;
    return vi.spyOn(platformExec, name).mockImplementation(((file: any, args: any, ...rest: any[]) => {
      if (file === "git" || String(file).endsWith("/git")) calls.push([...(args ?? [])]);
      return real(file, args, ...rest);
    }) as any);
  };
  const realExecSync = platformExec.execSync as (...a: any[]) => unknown;
  const spies = [
    wrap("execFileSync"),
    wrap("spawnSync"),
    wrap("spawn"),
    vi.spyOn(platformExec, "execSync").mockImplementation(((cmd: any, ...rest: any[]) => {
      if (typeof cmd === "string" && cmd.startsWith("git")) calls.push(cmd.split(" ").slice(1));
      return realExecSync(cmd, ...rest);
    }) as any),
  ];
  return { calls, restore: () => spies.forEach((s) => s.mockRestore()) };
}

async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerGitRoutes(app, { networkGuard: async () => {}, knownCwds: () => KNOWN });
  await app.ready();
  return app;
}

const post = (app: FastifyInstance, url: string, payload: unknown) => app.inject({ method: "POST", url, payload: payload as any });

let app: FastifyInstance;
let repo: string;
let spy: ReturnType<typeof spyGitSpawns>;
beforeEach(async () => {
  app = await makeApp();
  repo = makeRepo();
});
afterEach(async () => {
  spy?.restore();
  rmSync(repo, { recursive: true, force: true });
  await app.close();
});

const snapshot = (cwd: string) => ({ status: git("status --porcelain", cwd), head: git("rev-parse HEAD", cwd), branch: git("branch --show-current", cwd) });

describe("SE1 — option-like checkout branch", () => {
  it.each(["-x", "--orphan=x", "-", "--", "-b"])("checkout branch %j → 400 invalid_ref, 0 git spawns, tree unchanged", async (branch) => {
    const before = snapshot(repo);
    spy = spyGitSpawns();
    const res = await post(app, "/api/git/checkout", { cwd: repo, branch });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ success: false, code: "invalid_ref" });
    expect(spy.calls).toEqual([]);
    spy.restore();
    expect(snapshot(repo)).toEqual(before);
  });
});

describe("spawn spy sanity", () => {
  it("records git spawns for a VALID request (so the `0 spawns` assertions are not vacuous)", async () => {
    spy = spyGitSpawns();
    const res = await post(app, "/api/git/checkout", { cwd: repo, branch: "main" });
    expect(res.statusCode).toBe(200);
    expect(spy.calls.length).toBeGreaterThan(0);
  });
});

describe("SE2 — control characters", () => {
  const bad = ["a\nb", "a\u0000b", "a\tb", "a\rb", "a\u001fb", "a\u007fb"];
  const controls = ["a\u0085b", "a\u2028b", "a\u00e9b"];

  it.each(bad)("checkout branch %j → invalid_ref, 0 git spawns", async (branch) => {
    spy = spyGitSpawns();
    const res = await post(app, "/api/git/checkout", { cwd: repo, branch });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("invalid_ref");
    expect(spy.calls).toEqual([]);
  });

  it.each(bad)("worktree-create base %j → invalid_ref, 0 git spawns", async (base) => {
    spy = spyGitSpawns();
    const res = await post(app, "/api/git/worktree", { cwd: repo, base, newBranch: "feat/x" });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("invalid_ref");
    expect(spy.calls).toEqual([]);
  });

  it.each(controls)("C1 / U+2028 / printable non-ASCII %j is NOT refused by this rule (checkout + create)", async (value) => {
    const c = await post(app, "/api/git/checkout", { cwd: repo, branch: value });
    expect(c.json().code).not.toBe("invalid_ref");
    const w = await post(app, "/api/git/worktree", { cwd: repo, base: value, newBranch: "feat/ctl" });
    expect(w.json().code).not.toBe("invalid_ref");
  });
});

describe("SE3 — present non-string / falsy refs are invalid, not missing", () => {
  const values: unknown[] = ["0", 0, false, true, 1, {}, [], ["main"]];

  it.each(values.map((v) => [JSON.stringify(v), v]))("checkout branch %s → invalid_ref", async (_label, branch) => {
    // `"0"` is a valid string ref (kept in the list as a boundary) — only non-strings must be refused.
    spy = spyGitSpawns();
    const res = await post(app, "/api/git/checkout", { cwd: repo, branch });
    if (typeof branch === "string") {
      expect(res.json().code).not.toBe("invalid_ref");
      return;
    }
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("invalid_ref");
    expect(spy.calls).toEqual([]);
  });

  it.each(values.filter((v) => typeof v !== "string").map((v) => [JSON.stringify(v), v]))("worktree-create base / newBranch %s → invalid_ref", async (_label, v) => {
    spy = spyGitSpawns();
    const asBase = await post(app, "/api/git/worktree", { cwd: repo, base: v, newBranch: "feat/x" });
    expect(asBase.statusCode).toBe(400);
    expect(asBase.json().code).toBe("invalid_ref");
    const asNew = await post(app, "/api/git/worktree", { cwd: repo, base: "main", newBranch: v });
    expect(asNew.statusCode).toBe(400);
    expect(asNew.json().code).toBe("invalid_ref");
    expect(spy.calls).toEqual([]);
  });
});

describe("SE4 — missing fields keep their existing codes", () => {
  it.each([[{ cwd: "REPO" }], [{ cwd: "REPO", branch: null }], [{ cwd: "REPO", branch: "" }], [{ branch: "-x" }]])("checkout %j → cwd_and_branch_required", async (body) => {
    const payload = JSON.parse(JSON.stringify(body).replace("REPO", repo));
    const res = await post(app, "/api/git/checkout", payload);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("cwd_and_branch_required");
  });

  it.each([[undefined], [null], [""]])("worktree-create base %j → existing cwd_invalid envelope", async (base) => {
    const res = await post(app, "/api/git/worktree", { cwd: repo, ...(base === undefined ? {} : { base }), newBranch: "feat/x" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ success: false, code: "cwd_invalid", error: "base required" });
  });
});

describe("SE5 — ordinary refs still work", () => {
  it.each(["feature/a-b", "feature/x", "release/1.2.3", "a-b"])("checkout %s is accepted and processed", async (name) => {
    git(`branch '${name}'`, repo);
    const res = await post(app, "/api/git/checkout", { cwd: repo, branch: name });
    expect(res.json().code).not.toBe("invalid_ref");
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });

  it("checkout of a full 40-hex commit hash is accepted", async () => {
    const sha = git("rev-parse HEAD", repo).trim();
    writeFileSync(join(repo, "b.txt"), "b");
    git("add . && git commit -m two", repo);
    const res = await post(app, "/api/git/checkout", { cwd: repo, branch: sha });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });

  it("checkout origin/main (no local main) is accepted: a tracking branch is created", async () => {
    const clone = known(realpathSync(mkdtempSync(join(tmpdir(), "git-ref-clone-"))));
    try {
      execSync(`git clone '${repo}' '${clone}'`, { stdio: "pipe" });
      git("checkout -b side", clone);
      git("branch -D main", clone);
      const res = await post(app, "/api/git/checkout", { cwd: clone, branch: "origin/main" });
      expect(res.json().code).not.toBe("invalid_ref");
      expect(res.statusCode).toBe(200);
      expect(git("branch --show-current", clone).trim()).toBe("main");
    } finally {
      rmSync(clone, { recursive: true, force: true });
    }
  });

  it("a dash that is not leading (`feature/--x`) passes the validator: worktree create works", async () => {
    git("branch 'feature/--x'", repo);
    const res = await post(app, "/api/git/worktree", { cwd: repo, base: "feature/--x" });
    expect(res.json().code).not.toBe("invalid_ref");
    expect(res.statusCode).toBe(200);
  });

  it.each(["main", "0123456789abcdef0123456789abcdef01234567"])("worktree create base %s (fork mode)", async (base) => {
    const value = base === "main" ? "main" : git("rev-parse HEAD", repo).trim();
    const res = await post(app, "/api/git/worktree", { cwd: repo, base: value, newBranch: `feature/n-${base.slice(0, 4)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });

  it("checkout `feature/--x`: the DERIVED local name `--x` is option-like → invalid_ref (derived-name rule, D13)", async () => {
    git("branch 'feature/--x'", repo);
    spy = spyGitSpawns();
    const res = await post(app, "/api/git/checkout", { cwd: repo, branch: "feature/--x" });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("invalid_ref");
    expect(spy.calls).toEqual([]);
  });
});

describe("SE7 — worktree-create field × value", () => {
  it.each([
    ["base", { base: "--upload-pack=x", newBranch: "feat/x" }],
    ["newBranch", { base: "main", newBranch: "--detach" }],
    ["path -x", { base: "main", newBranch: "feat/x", path: "-x" }],
    ["path --force", { base: "main", newBranch: "feat/x", path: "--force" }],
    ["checkout-mode commit-ish", { base: "-x" }],
  ])("%s → 400 invalid_ref, 0 git spawns", async (_label, body) => {
    spy = spyGitSpawns();
    const res = await post(app, "/api/git/worktree", { cwd: repo, ...body });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("invalid_ref");
    expect(spy.calls).toEqual([]);
  });

  it("path absent → default `.worktrees/<slug>`, 200", async () => {
    const res = await post(app, "/api/git/worktree", { cwd: repo, base: "main", newBranch: "feat/dflt" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.path).toBe(join(repo, ".worktrees", "feat-dflt"));
  });

  it("newBranch absent → checkout mode as before", async () => {
    git("branch side", repo);
    const res = await post(app, "/api/git/worktree", { cwd: repo, base: "side" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.branch).toBe("side");
  });
});

describe("SE38 — orphan-cleanup, PR-worktree and worktree-remove inputs", () => {
  const OPTION_LIKE = ["-x", "--force"];

  it.each(OPTION_LIKE)("orphan-cleanup path %s → invalid_ref, 0 git spawns, no fs mutation", async (p) => {
    const marker = join(repo, p);
    mkdirSync(marker, { recursive: true });
    writeFileSync(join(marker, "keep.txt"), "k");
    spy = spyGitSpawns();
    const res = await post(app, "/api/git/worktree/orphan-cleanup", { cwd: repo, path: p });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("invalid_ref");
    expect(spy.calls).toEqual([]);
    expect(existsSync(join(marker, "keep.txt"))).toBe(true);
  });

  it.each(OPTION_LIKE)("from-pr path %s → invalid_ref, 0 git spawns", async (p) => {
    spy = spyGitSpawns();
    const res = await post(app, "/api/git/worktree/from-pr", { cwd: repo, prNumber: 1, path: p });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("invalid_ref");
    expect(spy.calls).toEqual([]);
  });

  it.each(OPTION_LIKE)("worktree-remove path %s → invalid_ref, 0 git spawns", async (p) => {
    spy = spyGitSpawns();
    const res = await post(app, "/api/git/worktree/remove", { cwd: p });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("invalid_ref");
    expect(spy.calls).toEqual([]);
  });

  it("remove-batch item with an option-like cwd → per-item invalid_ref, no git", async () => {
    spy = spyGitSpawns();
    const res = await post(app, "/api/git/worktree/remove-batch", { items: [{ cwd: "-x" }] });
    expect(res.json().data.results[0]).toMatchObject({ ok: false, code: "invalid_ref" });
    expect(spy.calls).toEqual([]);
  });

  it("valid values are processed as before (orphan-cleanup removes an orphan dir)", async () => {
    const orphan = join(repo, ".worktrees", "orphan1");
    mkdirSync(orphan, { recursive: true });
    writeFileSync(join(orphan, "f.txt"), "x");
    const res = await post(app, "/api/git/worktree/orphan-cleanup", { cwd: repo, path: orphan });
    expect(res.statusCode).toBe(200);
    expect(existsSync(orphan)).toBe(false);
  });

  it("valid values are processed as before (from-pr reaches git; no origin → git_failed, not invalid_ref)", async () => {
    const res = await post(app, "/api/git/worktree/from-pr", { cwd: repo, prNumber: 1, path: join(repo, ".worktrees", "pr-1") });
    expect(res.json().code).not.toBe("invalid_ref");
  });

  it("valid values are processed as before (worktree-remove removes a linked worktree)", async () => {
    const wt = known(join(realpathSync(mkdtempSync(join(tmpdir(), "git-ref-wt-"))), "wt"));
    git(`worktree add -b rm1 '${wt}'`, repo);
    const res = await post(app, "/api/git/worktree/remove", { cwd: realpathSync(wt) });
    expect(res.json().code).not.toBe("invalid_ref");
    expect(res.statusCode).toBe(200);
    expect(existsSync(wt)).toBe(false);
  });
});
