/**
 * Decision table for the shared folder-admission guard. This module was
 * extracted from `kb-plugin/src/server/kb-routes.ts` so kb-plugin and
 * mcp-client share ONE implementation; the kb routes keep exercising it
 * through the re-export in their own suite.
 * See change: extract-mcp-client-plugin.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  ADMISSION_MAX_CONCURRENT,
  type Admission,
  admissionAllows,
  admitCwd,
  canonPath,
  isAdmissionLive,
  isAllowedCwd,
  issueHeldAdmission,
  releaseAdmission,
} from "../cwd-guard.js";
import { GIT_COMMON_DIR_ABS, GIT_DIR_ABS, type GitProbeRunner } from "../platform/git.js";
import { type ExecError, type Recipe, runAsync } from "../platform/runner.js";
import { cleanupGitShims, makeGitShim, resolveRealGit, useGitPath } from "../test-support/git-shim.js";

const cleanup: string[] = [];
afterAll(() => {
  cleanupGitShims();
  for (const p of cleanup) {
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

function makeDir(prefix: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanup.push(d);
  return d;
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", ["-c", "user.email=t@t.com", "-c", "user.name=T", ...args], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function makeRepoWithWorktree(): { main: string; worktree: string } {
  const main = makeDir("cwd-guard-main-");
  git(main, ["-c", "init.defaultBranch=main", "init"]);
  git(main, ["commit", "--allow-empty", "-m", "init"]);
  const worktree = join(realpathSync(tmpdir()), `cwd-guard-wt-${process.pid}-${Math.random().toString(36).slice(2)}`);
  cleanup.push(worktree);
  git(main, ["worktree", "add", "-b", "wt", worktree]);
  return { main, worktree };
}

describe("isAllowedCwd", () => {
  it("refuses an undefined or empty cwd", () => {
    expect(isAllowedCwd(undefined, () => [makeDir("cwd-guard-")])).toBe(false);
    expect(isAllowedCwd("", () => [makeDir("cwd-guard-")])).toBe(false);
  });

  it("admits a known folder and refuses an unknown one", () => {
    const known = makeDir("cwd-guard-known-");
    const other = makeDir("cwd-guard-other-");
    expect(isAllowedCwd(known, () => [known])).toBe(true);
    expect(isAllowedCwd(other, () => [known])).toBe(false);
  });

  it("canonicalizes both sides (trailing slash, symlink to known)", () => {
    const known = makeDir("cwd-guard-known-");
    expect(isAllowedCwd(`${known}/`, () => [known])).toBe(true);
    const link = join(realpathSync(tmpdir()), `cwd-guard-link-${process.pid}-${Math.random().toString(36).slice(2)}`);
    symlinkSync(known, link, "dir");
    cleanup.push(link);
    expect(isAllowedCwd(link, () => [known])).toBe(true);
  });

  it("refuses a git-internal path even when its parent is known", () => {
    const known = makeDir("cwd-guard-known-");
    mkdirSync(join(known, ".git"), { recursive: true });
    expect(isAllowedCwd(join(known, ".git"), () => [known])).toBe(false);
  });

  it("refuses a traversal alias escaping a known folder", () => {
    const known = makeDir("cwd-guard-known-");
    const other = makeDir("cwd-guard-other-");
    expect(isAllowedCwd(join(known, "..", other.split("/").pop()!), () => [known])).toBe(false);
  });

  it("refuses a subdirectory that is not itself a known folder", () => {
    const known = makeDir("cwd-guard-known-");
    const sub = join(known, "sub");
    mkdirSync(sub, { recursive: true });
    expect(isAllowedCwd(sub, () => [known])).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "admits a worktree whose MAIN checkout is a known folder",
    () => {
      const { main, worktree } = makeRepoWithWorktree();
      expect(isAllowedCwd(worktree, () => [main])).toBe(true);
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses a worktree whose main checkout is NOT known",
    () => {
      const { worktree } = makeRepoWithWorktree();
      expect(isAllowedCwd(worktree, () => [makeDir("cwd-guard-unrelated-")])).toBe(false);
    },
  );
});

describe("canonPath", () => {
  it("resolves relative segments and keeps a non-existent path resolved", () => {
    const known = makeDir("cwd-guard-known-");
    expect(canonPath(join(known, "a", "..", "b"))).toBe(join(known, "b"));
  });
});


// ── admitCwd — async tri-state admission (harden-plugin-cwd-admission) ───────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface SpyOpts {
  delayMs?: number;
  /** Fail this recipe with this error instead of running git. */
  fail?: { recipe: Recipe<never, unknown>; error: ExecError };
  /** Force every probe to this error. */
  failAll?: ExecError;
}

/** A runner that counts spawns, optionally delays/fails, and otherwise runs real git. */
function spyRunner(o: SpyOpts = {}) {
  const spy = {
    total: 0,
    derivations: 0,
    activeCwds: new Set<string>(),
    maxActiveCwds: 0,
    perCwdLive: new Map<string, number>(),
    startOrder: [] as string[],
  };
  const runner: GitProbeRunner = async (recipe, input, ctx) => {
    const cwd = (input as { cwd: string }).cwd;
    spy.total++;
    if ((recipe as unknown) === GIT_DIR_ABS) {
      spy.derivations++;
      spy.startOrder.push(cwd);
    }
    spy.perCwdLive.set(cwd, (spy.perCwdLive.get(cwd) ?? 0) + 1);
    spy.activeCwds.add(cwd);
    spy.maxActiveCwds = Math.max(spy.maxActiveCwds, spy.activeCwds.size);
    try {
      if (o.delayMs) await sleep(o.delayMs);
      if (o.failAll) return { ok: false, error: o.failAll };
      if (o.fail && (recipe as unknown) === (o.fail.recipe as unknown)) return { ok: false, error: o.fail.error };
      return await runAsync(recipe, input, ctx);
    } finally {
      const n = (spy.perCwdLive.get(cwd) ?? 1) - 1;
      spy.perCwdLive.set(cwd, n);
      if (n === 0) spy.activeCwds.delete(cwd);
    }
  };
  return { runner, spy };
}

const TIMEOUT_ERR: ExecError = { kind: "timeout", timeoutMs: 1000, binary: "git" };

function kindOf(a: Admission): string {
  return a.kind;
}

describe("admitCwd", () => {
  it("E8: a pinned cwd is admitted without spawning git", async () => {
    const known = makeDir("admit-known-");
    const { runner, spy } = spyRunner();
    const r = await admitCwd(known, () => [known], { runner });
    expect(kindOf(r)).toBe("admit");
    expect(spy.total).toBe(0);
  });

  it("E9: a .git cwd is refused even when it is in the known set, with no git", async () => {
    const repo = makeDir("admit-gitdir-");
    const dotGit = join(repo, ".git");
    mkdirSync(dotGit);
    const { runner, spy } = spyRunner();
    const r = await admitCwd(dotGit, () => [dotGit], { runner });
    expect(kindOf(r)).toBe("refuse");
    expect(spy.total).toBe(0);
  });

  it("E10: a deleted directory that is not known is refused without git", async () => {
    const repo = makeDir("admit-gone-");
    const gone = join(repo, ".worktrees", "gone");
    const { runner, spy } = spyRunner();
    expect(kindOf(await admitCwd(gone, () => [repo], { runner }))).toBe("refuse");
    expect(spy.total).toBe(0);
  });

  it("E11: a non-ENOENT realpath error is indeterminate and names realpath", async () => {
    const dir = makeDir("admit-eacces-");
    const onIndeterminate = vi.fn();
    const r = await admitCwd(dir, () => [], {
      realpath: async () => ({ kind: "error", code: "EACCES" }),
      onIndeterminate,
    });
    expect(r.kind).toBe("indeterminate");
    if (r.kind === "indeterminate") expect(r.failedProbes).toEqual(["realpath"]);
    expect(onIndeterminate).toHaveBeenCalledWith(expect.objectContaining({ failedProbes: ["realpath"] }));
  });

  it("E12: a worktree of a pinned repo is admitted", async () => {
    const { main, worktree } = makeRepoWithWorktree();
    expect(kindOf(await admitCwd(worktree, () => [main]))).toBe("admit");
  });

  it("E13: a worktree of an unpinned repo is refused", async () => {
    const { worktree } = makeRepoWithWorktree();
    const other = makeDir("admit-other-");
    expect(kindOf(await admitCwd(worktree, () => [other]))).toBe("refuse");
  });

  it("E14: a worktree of a pinned repo whose --git-common-dir times out is indeterminate, never admit", async () => {
    const { main, worktree } = makeRepoWithWorktree();
    const { runner } = spyRunner({ fail: { recipe: GIT_COMMON_DIR_ABS as never, error: TIMEOUT_ERR } });
    const r = await admitCwd(worktree, () => [main], { runner });
    expect(r.kind).toBe("indeterminate");
    if (r.kind === "indeterminate") expect(r.failedProbes).toContain("git-common-dir");
  });

  it("E15: concurrent admissions of one canonical cwd share one derivation", async () => {
    const { main, worktree } = makeRepoWithWorktree();
    const { runner, spy } = spyRunner({ delayMs: 200 });
    const results = await Promise.all(Array.from({ length: 5 }, () => admitCwd(worktree, () => [main], { runner })));
    // One derivation starts exactly once for the shared cwd (the binding
    // re-resolution of the main checkout probes a different directory).
    expect(spy.startOrder.filter((c) => c === worktree)).toHaveLength(1);
    expect(new Set(results.map(kindOf))).toEqual(new Set(["admit"]));
  });

  it("E16: the global cap bounds concurrent derivations; the 5th starts only after a slot frees", async () => {
    const dirs = Array.from({ length: 6 }, (_, i) => makeDir(`admit-cap${i}-`));
    const { runner, spy } = spyRunner({ delayMs: 500 });
    const started = Date.now();
    const results = await Promise.all(dirs.map((d) => admitCwd(d, () => [], { runner })));
    expect(spy.maxActiveCwds).toBe(ADMISSION_MAX_CONCURRENT);
    expect(new Set(results.map(kindOf))).toEqual(new Set(["refuse"]));
    // Two waves of ~500 ms: the last two derivations could not start in the first.
    expect(Date.now() - started).toBeGreaterThanOrEqual(950);
  });

  it("E17: no cross-request cache — unpinning takes effect on the next call", async () => {
    const { main, worktree } = makeRepoWithWorktree();
    let pins = [main];
    expect(kindOf(await admitCwd(worktree, () => pins))).toBe("admit");
    pins = [];
    expect(kindOf(await admitCwd(worktree, () => pins))).toBe("refuse");
  });

  it("E18: a re-created path is decided afresh", async () => {
    const { main, worktree } = makeRepoWithWorktree();
    expect(kindOf(await admitCwd(worktree, () => [main]))).toBe("admit");
    rmSync(worktree, { recursive: true, force: true });
    mkdirSync(worktree);
    git(worktree, ["-c", "init.defaultBranch=main", "init"]);
    git(worktree, ["commit", "--allow-empty", "-m", "init"]);
    expect(kindOf(await admitCwd(worktree, () => [main]))).toBe("refuse");
  });

  it("X1: git not found is indeterminate", async () => {
    const dir = makeDir("admit-nogit-");
    const { runner } = spyRunner({ failAll: { kind: "not-found", binary: "git" } });
    expect(kindOf(await admitCwd(dir, () => [], { runner }))).toBe("indeterminate");
  });

  it("X2: a spawn failure on an existing directory is indeterminate", async () => {
    const dir = makeDir("admit-spawnfail-");
    const { runner } = spyRunner({ failAll: { kind: "spawn-failure", message: "EAGAIN" } });
    expect(kindOf(await admitCwd(dir, () => [], { runner }))).toBe("indeterminate");
  });

  it("a definitive 'not a repository' is a refusal, not indeterminate", async () => {
    const dir = makeDir("admit-nonrepo-");
    expect(kindOf(await admitCwd(dir, () => []))).toBe("refuse");
  });

  it("an admit's token is bound to the raw cwd string and dies on release", async () => {
    const known = makeDir("admit-token-");
    const r = await admitCwd(known, () => [known]);
    expect(admissionAllows(r, known)).toBe(true);
    expect(admissionAllows(r, `${known}/`)).toBe(false); // bound to the string admitted
    if (r.kind !== "admit") throw new Error("expected admit");
    expect(isAdmissionLive(r.token)).toBe(true);
    releaseAdmission(r.token);
    expect(isAdmissionLive(r.token)).toBe(false);
    expect(admissionAllows(r, known)).toBe(false);
    expect(admissionAllows({ kind: "refuse" }, known)).toBe(false);
  });

  it("issueHeldAdmission mints only for a decision whose canonical cwd matches", async () => {
    const dir = makeDir("admit-held-");
    const good = await issueHeldAdmission({ kind: "admit", canonCwd: dir }, dir);
    expect(good.kind).toBe("admit");
    expect((await issueHeldAdmission({ kind: "admit", canonCwd: `${dir}-other` }, dir)).kind).toBe("refuse");
    expect((await issueHeldAdmission({ kind: "indeterminate" }, dir)).kind).toBe("refuse");
    expect((await issueHeldAdmission({ kind: "refuse" }, dir)).kind).toBe("refuse");
  });
});

describe("admitCwd — deadline, abort and slot-on-exit", () => {
  it("a hung runner resolves indeterminate at the deadline and frees the slot only on exit", async () => {
    const dirs = Array.from({ length: ADMISSION_MAX_CONCURRENT }, (_, i) => makeDir(`admit-hang${i}-`));
    const exits: Array<() => void> = [];
    let aborted = 0;
    // Aborts immediately but reports the child's exit late, like a real SIGKILL escalation.
    const hung: GitProbeRunner = (_recipe, _input, ctx) =>
      new Promise((resolve) => {
        ctx.signal?.addEventListener("abort", () => {
          aborted++;
          resolve({ ok: false, error: { kind: "aborted", binary: "git", message: "aborted" } });
          exits.push(() => ctx.onClose?.());
        });
      });
    const t0 = Date.now();
    const hungResults = await Promise.all(dirs.map((d) => admitCwd(d, () => [], { runner: hung, deadlineMs: 300 })));
    expect(new Set(hungResults.map(kindOf))).toEqual(new Set(["indeterminate"]));
    expect(Date.now() - t0).toBeLessThan(900);
    expect(aborted).toBeGreaterThan(0);

    // Children have NOT exited yet → all four slots are still held.
    const probe = makeDir("admit-after-hang-");
    const { runner, spy } = spyRunner();
    const later = admitCwd(probe, () => [], { runner, deadlineMs: 5000 });
    await sleep(150);
    expect(spy.derivations).toBe(0); // queued behind the held slots
    for (const e of exits) e(); // the children finally exit
    expect(kindOf(await later)).toBe("refuse"); // ran to completion once slots freed
    expect(spy.derivations).toBe(1);
  });

  it.skipIf(process.platform === "win32")(
    "X3: four 60 s git derivations are cut at the deadline, children die, slots free, later requests admit",
    async () => {
      const real = resolveRealGit();
      const pidFile = join(makeDir("admit-x3-pids-"), "pids");
      const hangShim = makeGitShim(
        `echo $$ >> ${JSON.stringify(pidFile)}\nsleep 60 &\nslp=$!\ntrap 'kill $slp 2>/dev/null; exit 143' TERM\nwait $slp\nexec ${JSON.stringify(real)} "$@"`,
      );
      const { main, worktree } = makeRepoWithWorktree();
      const hangDirs = Array.from({ length: 5 }, (_, i) => makeDir(`admit-x3-${i}-`));
      const restore = useGitPath(hangShim);
      let results: Admission[];
      const t0 = Date.now();
      let elapsed = 0;
      try {
        // 4 occupy every slot; the 5th waits in the queue from t=0.
        results = await Promise.all(
          hangDirs.map((d) => admitCwd(d, () => [], { deadlineMs: 3000, probeTimeoutMs: 120_000 })),
        );
        elapsed = Date.now() - t0;
      } finally {
        restore();
      }
      expect(new Set(results.map(kindOf))).toEqual(new Set(["indeterminate"]));
      expect(elapsed).toBeGreaterThanOrEqual(2800);
      expect(elapsed).toBeLessThan(3400);

      const pids = readFileSync(pidFile, "utf8").split("\n").filter(Boolean).map(Number);
      expect(pids.length).toBeGreaterThanOrEqual(ADMISSION_MAX_CONCURRENT);
      const deadline = Date.now() + 3500; // 6500 ms from t0
      const alive = (pid: number) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      while (Date.now() < deadline && pids.some(alive)) await sleep(50);
      expect(pids.filter(alive)).toEqual([]);

      // Slots are free again: a later admissible request is decided and admitted.
      expect(kindOf(await admitCwd(worktree, () => [main]))).toBe("admit");
    },
    30_000,
  );
});
