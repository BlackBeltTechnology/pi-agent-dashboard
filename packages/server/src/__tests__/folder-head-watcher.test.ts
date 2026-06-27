/**
 * Unit / integration tests for the folder-HEAD watcher.
 * See change: refresh-folder-header-branch.
 */
import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createFolderHeadWatcher, matchesHeadFile } from "../folder-head-watcher.js";

const skipFsWatch = process.env.SKIP_FS_WATCH_TESTS === "1";

function mkTmpGitDir(): { cwd: string; gitDir: string } {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "folder-head-watcher-"));
  const gitDir = path.join(cwd, ".git");
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
  return { cwd, gitDir };
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error(`timeout after ${timeoutMs}ms`));
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe("createFolderHeadWatcher", () => {
  it("attach returns true once, then false (already attached)", () => {
    const { cwd, gitDir } = mkTmpGitDir();
    try {
      const watcher = createFolderHeadWatcher({
        onChange: () => {},
        resolveGitDir: () => gitDir,
        logger: () => {},
      });
      expect(watcher.attach(cwd)).toBe(true);
      expect(watcher.attach(cwd)).toBe(false);
      expect(watcher.size()).toBe(1);
      watcher.detachAll();
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("non-git cwd (resolveGitDir → null) returns false, no throw, size 0", () => {
    const watcher = createFolderHeadWatcher({
      onChange: () => {},
      resolveGitDir: () => null,
      logger: () => {},
    });
    let result: boolean | undefined;
    expect(() => { result = watcher.attach("/not-a-repo"); }).not.toThrow();
    expect(result).toBe(false);
    expect(watcher.size()).toBe(0);
  });

  it("fs.watch throw (ENOENT gitdir) → attach false + logged once, no throw propagated", () => {
    const logs: string[] = [];
    // Point resolveGitDir at a path that does not exist; real fs.watch throws
    // ENOENT synchronously, exercising the graceful-degrade branch.
    const missing = path.join(os.tmpdir(), "folder-head-watcher-does-not-exist-xyz");
    const watcher = createFolderHeadWatcher({
      onChange: () => {},
      resolveGitDir: () => missing,
      logger: (m) => logs.push(m),
    });
    expect(() => watcher.attach("/some/cwd")).not.toThrow();
    expect(watcher.attach("/some/cwd")).toBe(false);
    // logged once despite two attach attempts
    expect(logs.length).toBe(1);
    expect(watcher.size()).toBe(0);
  });

  it.skipIf(skipFsWatch)("a HEAD write fires the debounced onChange", async () => {
    const { cwd, gitDir } = mkTmpGitDir();
    const calls: string[] = [];
    const watcher = createFolderHeadWatcher({
      onChange: (c) => calls.push(c),
      resolveGitDir: () => gitDir,
      debounceMs: 50,
    });
    expect(watcher.attach(cwd)).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/develop\n");
    try {
      await waitFor(() => calls.length >= 1, 1000);
    } finally {
      watcher.detachAll();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
    expect(calls).toEqual([cwd]);
  });

  it("filename filter: only HEAD matches", () => {
    // Deterministic filter check (real fs.watch filename reporting is
    // platform-unreliable for negative cases, esp. macOS FSEvents).
    expect(matchesHeadFile("HEAD")).toBe(true);
    expect(matchesHeadFile("config")).toBe(false);
    expect(matchesHeadFile("ORIG_HEAD")).toBe(false);
    expect(matchesHeadFile(null)).toBe(false);
    expect(matchesHeadFile(undefined)).toBe(false);
  });

  it("worktree cwd resolves to the gitdir HEAD via resolveGitDir", () => {
    // Simulate a worktree: .git is a FILE pointing at a per-worktree gitdir.
    const main = fs.mkdtempSync(path.join(os.tmpdir(), "fhw-main-"));
    const wtGitDir = path.join(main, ".git", "worktrees", "feature");
    fs.mkdirSync(wtGitDir, { recursive: true });
    fs.writeFileSync(path.join(wtGitDir, "HEAD"), "ref: refs/heads/feature\n");
    const wtCwd = fs.mkdtempSync(path.join(os.tmpdir(), "fhw-wt-"));

    const resolveGitDir = vi.fn((c: string) => (c === wtCwd ? wtGitDir : null));
    const watcher = createFolderHeadWatcher({
      onChange: () => {},
      resolveGitDir,
      logger: () => {},
    });
    try {
      expect(watcher.attach(wtCwd)).toBe(true);
      expect(resolveGitDir).toHaveBeenCalledWith(wtCwd);
      watcher.detachAll();
    } finally {
      fs.rmSync(main, { recursive: true, force: true });
      fs.rmSync(wtCwd, { recursive: true, force: true });
    }
  });
});
