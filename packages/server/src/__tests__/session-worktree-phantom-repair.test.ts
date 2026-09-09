/**
 * Load-time repair of persisted phantom `gitWorktree.mainPath` values.
 *
 * A phantom written by the superseded `dirname(--git-common-dir)` derivation is
 * IMMORTAL without this filter: `.meta.json` is re-seeded into memory at every
 * boot and an ended session never re-probes git. These tests drive
 * `scanAllSessions` over hand-seeded metadata — records the current code would
 * never produce — and pin both the predicate and its documented limitation.
 *
 * Covers test-plan E14–E17, X5, P1.
 * See change: add-git-checkout-root-resolver.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `node:fs` is mocked at MODULE level, not via `vi.spyOn(fs, "statSync")`:
 * session-scanner imports `statSync` as an ESM NAMED binding, which a property
 * spy cannot rebind. A spy therefore never fires — X5 would report the
 * unfiltered record and P1 would count zero and pass vacuously.
 * The mock passes every call through to the real implementation.
 */
const fsHooks = vi.hoisted(() => ({
  statCalls: [] as string[],
  spawns: [] as string[],
  fault: null as null | ((p: string) => void),
}));

// Same reason as the fs mock: `spawnSync` / `execFileSync` are imported as ESM
// named bindings by the platform runner, so a property spy never fires and a
// "zero subprocesses" assertion would pass without proving anything.
vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  const wrap = <T extends (...a: never[]) => unknown>(name: string, fn: T): T =>
    ((...args: never[]) => {
      fsHooks.spawns.push(name);
      return fn(...args);
    }) as T;
  const patched = {
    ...real,
    spawnSync: wrap("spawnSync", real.spawnSync),
    execFileSync: wrap("execFileSync", real.execFileSync),
    execSync: wrap("execSync", real.execSync),
  };
  return { ...patched, default: patched };
});

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const statSync = ((p: fs.PathLike, ...rest: unknown[]) => {
    fsHooks.statCalls.push(String(p));
    fsHooks.fault?.(String(p));
    return (real.statSync as (...a: unknown[]) => unknown)(p, ...rest);
  }) as typeof real.statSync;
  return { ...real, statSync, default: { ...real, statSync } };
});

import { scanAllSessions } from "../session/session-scanner.js";

let sessionsDir: string;
let scratch: string;

beforeEach(() => {
  sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-phantom-sessions-"));
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wt-phantom-")));
});

afterEach(() => {
  fsHooks.fault = null;
  fsHooks.statCalls.length = 0;
  fsHooks.spawns.length = 0;
  vi.restoreAllMocks();
  fs.rmSync(sessionsDir, { recursive: true, force: true });
  fs.rmSync(scratch, { recursive: true, force: true });
});

/** Seed one ended session whose `.meta.json` carries `gitWorktree.mainPath`. */
function seedSession(id: string, cwd: string, mainPath: string): { metaFile: string } {
  const dir = path.join(sessionsDir, `--seed-${id}--`);
  fs.mkdirSync(dir, { recursive: true });
  const sessionFile = path.join(dir, `2026-03-30T21-39-43-034Z_${id}.jsonl`);
  fs.writeFileSync(sessionFile, `${JSON.stringify({ type: "session", id, cwd })}\n`);
  const metaFile = `${sessionFile.replace(/\.jsonl$/, "")}.meta.json`;
  fs.writeFileSync(
    metaFile,
    JSON.stringify({
      id,
      cwd,
      source: "tui",
      startedAt: 1000,
      status: "ended",
      jsonlMtime: fs.statSync(sessionFile).mtimeMs,
      jsonlSize: fs.statSync(sessionFile).size,
      gitWorktree: { mainPath, name: path.basename(cwd) },
    }),
  );
  return { metaFile };
}

function worktreeOf(id: string): { mainPath: string; name: string } | undefined {
  return scanAllSessions(sessionsDir).sessions.find((s) => s.id === id)?.gitWorktree;
}



/** A directory that looks like a real checkout: it carries a `.git` entry. */
function makeCheckoutLike(name: string, gitEntry: "dir" | "file" = "dir"): string {
  const root = path.join(scratch, name);
  fs.mkdirSync(root, { recursive: true });
  if (gitEntry === "dir") fs.mkdirSync(path.join(root, ".git"));
  else fs.writeFileSync(path.join(root, ".git"), "gitdir: /elsewhere\n");
  return root;
}

describe("persisted gitWorktree repair on load", () => {
  it("E14: drops a `<super>/.git/modules/<name>` phantom and does not rewrite meta", () => {
    const superRoot = makeCheckoutLike("super");
    const phantom = path.join(superRoot, ".git", "modules", "models");
    fs.mkdirSync(phantom, { recursive: true }); // it EXISTS — only the segment test sees it
    const cwd = path.join(superRoot, "models", "sub");
    const { metaFile } = seedSession("phantom-sub", cwd, phantom);
    const before = fs.readFileSync(metaFile, "utf8");

    expect(worktreeOf("phantom-sub")).toBeUndefined();
    // Degrades to grouping by its own cwd.
    expect(scanAllSessions(sessionsDir).sessions.find((s) => s.id === "phantom-sub")?.cwd).toBe(cwd);
    expect(fs.readFileSync(metaFile, "utf8")).toBe(before);
  });

  it("E15: drops an existing directory that carries no `.git` entry", () => {
    const bare = path.join(scratch, "unrelated");
    fs.mkdirSync(bare);
    seedSession("real-but-not-checkout", path.join(scratch, "cwd-a"), bare);
    expect(fs.existsSync(bare)).toBe(true); // existence alone must not qualify it
    expect(worktreeOf("real-but-not-checkout")).toBeUndefined();
  });

  it("drops a mainPath that no longer exists on disk", () => {
    seedSession("gone", path.join(scratch, "cwd-b"), path.join(scratch, "vanished"));
    expect(worktreeOf("gone")).toBeUndefined();
  });

  it("E16: preserves an existing directory that directly contains a `.git` entry", () => {
    const checkout = makeCheckoutLike("legit");
    seedSession("legit", path.join(scratch, "cwd-c"), checkout);
    expect(worktreeOf("legit")).toEqual({ mainPath: checkout, name: "cwd-c" });
  });

  it("preserves a checkout whose `.git` is a FILE (submodule / linked worktree)", () => {
    const checkout = makeCheckoutLike("gitfile", "file");
    seedSession("gitfile", path.join(scratch, "cwd-d"), checkout);
    expect(worktreeOf("gitfile")?.mainPath).toBe(checkout);
  });

  it("E11: does not drop a checkout whose directory name merely ends in `.git`", () => {
    const checkout = makeCheckoutLike("app.git");
    seedSession("dotgit-name", path.join(scratch, "cwd-e"), checkout);
    expect(worktreeOf("dotgit-name")?.mainPath).toBe(checkout);
  });

  it("E17: a phantom landing on a REAL checkout survives (documented limitation)", () => {
    // Bare hub at <home>/bare.git → superseded derivation produced <home>;
    // <home> is itself a dotfiles checkout, so it passes all three conditions.
    const home = makeCheckoutLike("home");
    fs.mkdirSync(path.join(home, "bare.git"), { recursive: true });
    seedSession("shape-blind", path.join(home, "bare.git"), home);
    // Shape, not identity: this is pinned so it cannot silently change.
    expect(worktreeOf("shape-blind")?.mainPath).toBe(home);
  });

  it("X5: drops the record when stat fails for a reason other than not-found", () => {
    const checkout = makeCheckoutLike("unmounted");
    seedSession("eio", path.join(scratch, "cwd-f"), checkout);
    expect(worktreeOf("eio")?.mainPath).toBe(checkout); // baseline: reachable

    fsHooks.fault = (p) => {
      if (p === path.join(checkout, ".git")) {
        const err = new Error("unreachable volume") as NodeJS.ErrnoException;
        err.code = "EIO";
        throw err;
      }
    };

    expect(() => scanAllSessions(sessionsDir)).not.toThrow();
    expect(worktreeOf("eio")).toBeUndefined();
  });

  it("P1: 200 records cost zero subprocesses and at most one stat each", () => {
    const checkout = makeCheckoutLike("perf");
    for (let i = 0; i < 200; i++) seedSession(`perf-${i}`, path.join(scratch, `cwd-${i}`), checkout);

    const gitEntry = path.join(checkout, ".git");
    fsHooks.statCalls.length = 0;
    fsHooks.spawns.length = 0;

    const { sessions } = scanAllSessions(sessionsDir);

    expect(sessions.filter((s) => s.id.startsWith("perf-")).length).toBe(200);
    // The filter's whole filesystem cost: one stat of `<mainPath>/.git` per
    // record, and it never stats `<mainPath>` itself.
    const onGitEntry = fsHooks.statCalls.filter((p) => p === gitEntry).length;
    const onMainPath = fsHooks.statCalls.filter((p) => p === checkout).length;
    expect(onGitEntry).toBe(200);
    expect(onMainPath).toBe(0);
    // Zero git subprocesses: no probe recipe may run on the load path.
    expect(fsHooks.statCalls.length).toBeGreaterThan(0); // the counter is live
    expect(fsHooks.spawns).toEqual([]);
  });
});
