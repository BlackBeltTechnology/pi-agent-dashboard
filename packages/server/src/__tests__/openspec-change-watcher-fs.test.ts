/**
 * Real `fs.watch` integration test for OpenSpecChangeWatcher.
 *
 * Verifies that:
 *  - Writing to `<cwd>/openspec/changes/<change>/tasks.md` fires `onChange`
 *    within ≤ 1 second.
 *  - Attaching to a cwd without `openspec/changes/` does not throw and
 *    silently degrades (failure path covered by the periodic poll).
 *
 * Uses real timers + real fs.watch so this exercises the platform integration.
 * Skipped on platforms where fs.watch is known to be unreliable (set
 * SKIP_FS_WATCH_TESTS=1 to force-skip in CI if needed).
 *
 * See change: fix-openspec-taskcheck-delay.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createOpenSpecChangeWatcher } from "../openspec/openspec-change-watcher.js";

const skipFsWatch = process.env.SKIP_FS_WATCH_TESTS === "1";

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openspec-watcher-"));
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`timeout after ${timeoutMs}ms`));
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe.skipIf(skipFsWatch)("OpenSpecChangeWatcher (real fs.watch)", () => {
  it("fires onChange within 1s when tasks.md is written", async () => {
    const cwd = mkTmpDir();
    const changesDir = path.join(cwd, "openspec", "changes", "demo");
    fs.mkdirSync(changesDir, { recursive: true });
    const tasksPath = path.join(changesDir, "tasks.md");
    fs.writeFileSync(tasksPath, "## Tasks\n- [ ] one\n");

    const calls: string[] = [];
    const watcher = createOpenSpecChangeWatcher({
      onChange: (c) => calls.push(c),
      debounceMs: 50,
    });
    watcher.attach(cwd);

    // Wait a beat so the watcher has actually subscribed.
    await new Promise((r) => setTimeout(r, 100));

    fs.writeFileSync(tasksPath, "## Tasks\n- [x] one\n");

    try {
      await waitFor(() => calls.length >= 1, 1000);
    } finally {
      watcher.detachAll();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
    expect(calls).toEqual([cwd]);
  });

  it("attach to cwd without openspec/changes/ does not throw and returns false", () => {
    const cwd = mkTmpDir();
    try {
      const watcher = createOpenSpecChangeWatcher({ onChange: () => {}, logger: () => {} });
      let result: boolean | undefined;
      expect(() => { result = watcher.attach(cwd); }).not.toThrow();
      expect(result).toBe(false);
      // Failed-attach yields no entry in the attached set.
      expect(watcher.size()).toBe(0);
      watcher.detachAll();
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("deferred retry: failed attach succeeds on second call after openspec/changes/ is created", async () => {
    const cwd = mkTmpDir();
    try {
      const calls: string[] = [];
      const watcher = createOpenSpecChangeWatcher({
        onChange: (c) => calls.push(c),
        debounceMs: 50,
        logger: () => {},
      });

      // First attach fails (no openspec/changes/ yet).
      expect(watcher.attach(cwd)).toBe(false);
      expect(watcher.size()).toBe(0);

      // Caller creates the dir + a change with tasks.md, then retries.
      const changesDir = path.join(cwd, "openspec", "changes", "demo");
      fs.mkdirSync(changesDir, { recursive: true });
      const tasksPath = path.join(changesDir, "tasks.md");
      fs.writeFileSync(tasksPath, "## Tasks\n- [ ] one\n");

      // Second attach should succeed and start watching.
      expect(watcher.attach(cwd)).toBe(true);
      expect(watcher.size()).toBe(1);

      await new Promise((r) => setTimeout(r, 100));
      fs.writeFileSync(tasksPath, "## Tasks\n- [x] one\n");
      await waitFor(() => calls.length >= 1, 1000);
      expect(calls).toEqual([cwd]);

      watcher.detachAll();
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("does not fire for irrelevant files (README.md)", async () => {
    const cwd = mkTmpDir();
    const changesDir = path.join(cwd, "openspec", "changes", "demo");
    fs.mkdirSync(changesDir, { recursive: true });
    const irrelevantPath = path.join(changesDir, "README.md");

    const calls: string[] = [];
    const watcher = createOpenSpecChangeWatcher({
      onChange: (c) => calls.push(c),
      debounceMs: 50,
    });
    watcher.attach(cwd);
    await new Promise((r) => setTimeout(r, 100));

    fs.writeFileSync(irrelevantPath, "hello\n");
    // Give the event loop a generous window — assert NO call.
    await new Promise((r) => setTimeout(r, 400));
    watcher.detachAll();
    fs.rmSync(cwd, { recursive: true, force: true });
    expect(calls).toEqual([]);
  });
});
