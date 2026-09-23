/**
 * Event-loop responsiveness regression guard (6.1 / 6.3) for
 * fix-session-diff-eventloop-block. Uses REAL git (no mock) against a temp
 * repo with many changed files plus one large tracked file — the field-repro
 * shape (issue #353). Asserts the loop keeps servicing timers WHILE the diff
 * computes (the old per-file `spawnSync` loop starved it) and that the diff
 * still resolves correctly. Skips when git is unavailable.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildSessionDiff } from "../session-diff.js";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

let repo: string;
let gitOk = true;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "sd-eventloop-"));
  try {
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "t@t");
    git(repo, "config", "user.name", "t");
    // ~80 small tracked files + one large tracked file (the heavy blob).
    for (let i = 0; i < 80; i++) writeFileSync(join(repo, `f${i}.txt`), `v1-${i}\n`);
    writeFileSync(join(repo, "big.txt"), `${"x".repeat(4 * 1024 * 1024)}\n`);
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "init");
    // Dirty every file so the diff has real work to do.
    for (let i = 0; i < 80; i++) writeFileSync(join(repo, `f${i}.txt`), `v2-${i}\nmore\n`);
    writeFileSync(join(repo, "big.txt"), `${"y".repeat(4 * 1024 * 1024)}\nchanged\n`);
  } catch {
    gitOk = false;
  }
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

describe("session-diff event-loop responsiveness", () => {
  it("services timers while a many-file + large-file diff computes", async () => {
    if (!gitOk) return; // git unavailable — skip

    let ticks = 0;
    let lastTick = Date.now();
    let maxGap = 0;
    const interval = setInterval(() => {
      const now = Date.now();
      maxGap = Math.max(maxGap, now - lastTick);
      lastTick = now;
      ticks++;
    }, 10);

    let result: Awaited<ReturnType<typeof buildSessionDiff>>;
    try {
      result = await buildSessionDiff([], repo);
    } finally {
      clearInterval(interval);
    }

    // The diff resolved with the expected shape (git repo, files listed).
    expect(result.isGitRepo).toBe(true);
    expect(result.otherChanges.length).toBeGreaterThan(0);
    // The oversized tracked file is surfaced without a text gitDiff.
    const big = result.otherChanges.find((f) => f.path === "big.txt");
    expect(big).toBeDefined();
    expect(big?.gitDiff).toBeUndefined();
    // The loop kept ticking during the computation (not wedged by spawnSync).
    expect(ticks).toBeGreaterThan(0);
    // No single tick gap blew a generous responsiveness budget.
    expect(maxGap).toBeLessThan(500);
  });
});

// ── fix-session-diff-heap-retention: batched-diff output limit (32 MiB) ──────

const MiB = 1024 * 1024;

/** Temp repo with one tracked single-line `bigBytes` JSON + `small` small files, all modified. */
function makeBigRepo(prefix: string, bigBytes: number, small: number): string | undefined {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "t@t");
    git(dir, "config", "user.name", "t");
    writeFileSync(join(dir, "big.json"), `"${"a".repeat(bigBytes)}"\n`);
    for (let i = 0; i < small; i++) writeFileSync(join(dir, `s${i}.txt`), `v1-${i}\n`);
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "init");
    writeFileSync(join(dir, "big.json"), `"${"b".repeat(bigBytes)}"\n`);
    for (let i = 0; i < small; i++) writeFileSync(join(dir, `s${i}.txt`), `v2-${i}\n`);
    return dir;
  } catch {
    rmSync(dir, { recursive: true, force: true });
    return undefined;
  }
}

describe("session-diff batched-diff output limit (real git)", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it("X8: an oversized (~34 MiB) worktree diff degrades to counts only with one warning", async () => {
    const dir = makeBigRepo("sd-oversize-", 17 * MiB, 1);
    if (!dir) return; // git unavailable — skip
    dirs.push(dir);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await buildSessionDiff([], dir);
      expect(result.isGitRepo).toBe(true);
      for (const path of ["big.json", "s0.txt"]) {
        const entry = result.otherChanges.find((f) => f.path === path);
        expect(entry, path).toBeDefined();
        expect(entry?.additions).toBe(1);
        expect(entry?.deletions).toBe(1);
        expect(entry?.gitDiff).toBeUndefined();
      }
      expect(warn.mock.calls.filter((c) => String(c[0]).includes("[session-diff]"))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  }, 60_000);

  it("P1: a ~24 MiB (under-limit) diff + 50 small files keeps the loop responsive", async () => {
    const dir = makeBigRepo("sd-underlimit-", 12 * MiB, 50);
    if (!dir) return; // git unavailable — skip
    dirs.push(dir);

    let ticks = 0;
    let lastTick = Date.now();
    let maxGap = 0;
    const interval = setInterval(() => {
      const now = Date.now();
      maxGap = Math.max(maxGap, now - lastTick);
      lastTick = now;
      ticks++;
    }, 10);
    let result: Awaited<ReturnType<typeof buildSessionDiff>>;
    try {
      result = await buildSessionDiff([], dir);
    } finally {
      clearInterval(interval);
    }
    expect(result.isGitRepo).toBe(true);
    // Under the limit: small files still carry text diffs (flattened copies).
    expect(result.otherChanges.find((f) => f.path === "s0.txt")?.gitDiff).toContain("+v2-0");
    expect(ticks).toBeGreaterThan(0);
    expect(maxGap).toBeLessThan(500);
  }, 60_000);
});
