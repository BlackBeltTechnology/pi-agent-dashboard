import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFileWatchManager } from "../file-watch-manager.js";

// Pass-through spy so tests can see how many `fs.watch` handles were opened and
// reach an individual watcher (error-handler test).
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, watch: vi.fn(actual.watch) };
});
import { watch as watchSpy } from "node:fs";

const cleanup: string[] = [];
afterAll(() => {
  for (const r of cleanup) rmSync(r, { recursive: true, force: true });
});

function tmp(): string {
  const root = mkdtempSync(join(tmpdir(), "fwm-"));
  cleanup.push(root);
  return root;
}

/** Fake WebSocket key. */
const wsA = {} as any;
const wsB = {} as any;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("FileWatchManager", () => {
  it("fires onChange when a watched open file is written", async () => {
    const root = tmp();
    writeFileSync(join(root, "foo.ts"), "a");
    const onChange = vi.fn();
    const mgr = createFileWatchManager();

    mgr.setWatched(wsA, "s1", root, ["foo.ts"], onChange);
    await wait(50);
    writeFileSync(join(root, "foo.ts"), "b");
    await wait(150);

    expect(onChange).toHaveBeenCalledWith("s1", "foo.ts");
    mgr.clearConnection(wsA);
  });

  it("does not fire for a file that is not in the watched set", async () => {
    const root = tmp();
    writeFileSync(join(root, "foo.ts"), "a");
    writeFileSync(join(root, "bar.ts"), "a");
    const onChange = vi.fn();
    const mgr = createFileWatchManager();

    mgr.setWatched(wsA, "s1", root, ["foo.ts"], onChange);
    await wait(50);
    writeFileSync(join(root, "bar.ts"), "b");
    await wait(150);

    expect(onChange).not.toHaveBeenCalled();
    mgr.clearConnection(wsA);
  });

  it("reconciles the watched set — a removed path stops firing", async () => {
    const root = tmp();
    writeFileSync(join(root, "foo.ts"), "a");
    const onChange = vi.fn();
    const mgr = createFileWatchManager();

    mgr.setWatched(wsA, "s1", root, ["foo.ts"], onChange);
    await wait(50);
    mgr.setWatched(wsA, "s1", root, [], onChange); // drop foo.ts
    await wait(50);
    writeFileSync(join(root, "foo.ts"), "b");
    await wait(150);

    expect(onChange).not.toHaveBeenCalled();
    expect(mgr.activeWatchCount()).toBe(0);
    mgr.clearConnection(wsA);
  });

  it("clearConnection tears down all of a connection's watchers (no fd leak)", async () => {
    const root = tmp();
    writeFileSync(join(root, "foo.ts"), "a");
    const mgr = createFileWatchManager();

    mgr.setWatched(wsA, "s1", root, ["foo.ts"], vi.fn());
    mgr.setWatched(wsB, "s2", root, ["foo.ts"], vi.fn());
    expect(mgr.activeWatchCount()).toBe(2);

    mgr.clearConnection(wsA);
    expect(mgr.activeWatchCount()).toBe(1);
    mgr.clearConnection(wsB);
    expect(mgr.activeWatchCount()).toBe(0);
  });

  describe("atomic replace (tmp + rename)", () => {
    /** Replace `name` the way the editor/agents do: write a tmp sibling, rename over. */
    function replace(root: string, name: string, content: string): void {
      const tmpPath = join(root, `.${name}.tmp`);
      writeFileSync(tmpPath, content);
      renameSync(tmpPath, join(root, name));
    }

    it("keeps firing for writes after a tmp+rename replace; one key throughout", async () => {
      const root = tmp();
      writeFileSync(join(root, "foo.ts"), "a");
      const onChange = vi.fn();
      const mgr = createFileWatchManager();
      mgr.setWatched(wsA, "s1", root, ["foo.ts"], onChange);
      await wait(50);

      replace(root, "foo.ts", "b");
      await wait(150);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(mgr.activeWatchCount()).toBe(1);

      // In-place write on the NEW inode, then a second replace + immediate write.
      writeFileSync(join(root, "foo.ts"), "c");
      await wait(150);
      expect(onChange).toHaveBeenCalledTimes(2);
      replace(root, "foo.ts", "d");
      await wait(20);
      writeFileSync(join(root, "foo.ts"), "e");
      await wait(200);
      expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(mgr.activeWatchCount()).toBe(1);
      mgr.clearConnection(wsA);
      expect(mgr.activeWatchCount()).toBe(0);
    });

    it("re-attaches via the retry when the file is re-created after a delete", async () => {
      const root = tmp();
      writeFileSync(join(root, "foo.ts"), "a");
      const onChange = vi.fn();
      const mgr = createFileWatchManager();
      mgr.setWatched(wsA, "s1", root, ["foo.ts"], onChange);
      await wait(50);

      unlinkSync(join(root, "foo.ts"));
      await wait(250);
      writeFileSync(join(root, "foo.ts"), "re-created");
      await wait(150); // past the 300 ms retry
      expect(mgr.activeWatchCount()).toBe(1);
      const before = onChange.mock.calls.length;
      writeFileSync(join(root, "foo.ts"), "later");
      await wait(150);
      expect(onChange.mock.calls.length).toBeGreaterThan(before);
      mgr.clearConnection(wsA);
    });

    it("drops the key ~1000 ms after a delete that is never re-created", async () => {
      const root = tmp();
      writeFileSync(join(root, "foo.ts"), "a");
      const onChange = vi.fn();
      const mgr = createFileWatchManager();
      mgr.setWatched(wsA, "s1", root, ["foo.ts"], onChange);
      await wait(50);

      unlinkSync(join(root, "foo.ts"));
      await wait(150);
      expect(onChange).toHaveBeenCalledWith("s1", "foo.ts"); // the delete itself is reported
      expect(mgr.activeWatchCount()).toBe(1); // still retrying
      await wait(1000);
      expect(mgr.activeWatchCount()).toBe(0);
    });

    it("drops the key (no directory watch) when the path becomes a directory", async () => {
      const root = tmp();
      writeFileSync(join(root, "foo.ts"), "a");
      const onChange = vi.fn();
      const mgr = createFileWatchManager();
      mgr.setWatched(wsA, "s1", root, ["foo.ts"], onChange);
      await wait(50);
      const opened = vi.mocked(watchSpy).mock.calls.length;

      renameSync(join(root, "foo.ts"), join(root, "moved.ts"));
      mkdirSync(join(root, "foo.ts"));
      await wait(150);

      expect(mgr.activeWatchCount()).toBe(0);
      expect(vi.mocked(watchSpy).mock.calls.length).toBe(opened); // no new watch on the directory
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("clearConnection cancels a pending retry: nothing is attached afterwards", async () => {
      const root = tmp();
      writeFileSync(join(root, "foo.ts"), "a");
      const onChange = vi.fn();
      const mgr = createFileWatchManager();
      mgr.setWatched(wsA, "s1", root, ["foo.ts"], onChange);
      await wait(50);
      unlinkSync(join(root, "foo.ts"));
      await wait(50);
      mgr.clearConnection(wsA);
      const opened = vi.mocked(watchSpy).mock.calls.length;
      writeFileSync(join(root, "foo.ts"), "back");
      await wait(450);
      expect(vi.mocked(watchSpy).mock.calls.length).toBe(opened);
      expect(mgr.activeWatchCount()).toBe(0);
    });

    it("reconcile removal cancels a pending retry", async () => {
      const root = tmp();
      writeFileSync(join(root, "foo.ts"), "a");
      const mgr = createFileWatchManager();
      mgr.setWatched(wsA, "s1", root, ["foo.ts"], vi.fn());
      await wait(50);
      unlinkSync(join(root, "foo.ts"));
      await wait(50);
      mgr.setWatched(wsA, "s1", root, [], vi.fn());
      const opened = vi.mocked(watchSpy).mock.calls.length;
      writeFileSync(join(root, "foo.ts"), "back");
      await wait(450);
      expect(vi.mocked(watchSpy).mock.calls.length).toBe(opened);
      expect(mgr.activeWatchCount()).toBe(0);
      mgr.clearConnection(wsA);
    });

    it("an error on the superseded watcher does not close its successor", async () => {
      const root = tmp();
      writeFileSync(join(root, "foo.ts"), "a");
      const onChange = vi.fn();
      const mgr = createFileWatchManager();
      const before = vi.mocked(watchSpy).mock.results.length;
      mgr.setWatched(wsA, "s1", root, ["foo.ts"], onChange);
      await wait(50);
      const oldWatcher = vi.mocked(watchSpy).mock.results[before].value as import("node:fs").FSWatcher;

      replace(root, "foo.ts", "b");
      await wait(150);
      oldWatcher.emit("error", new Error("EPERM on the old inode"));

      expect(mgr.activeWatchCount()).toBe(1);
      const calls = onChange.mock.calls.length;
      writeFileSync(join(root, "foo.ts"), "c");
      await wait(150);
      expect(onChange.mock.calls.length).toBeGreaterThan(calls);
      mgr.clearConnection(wsA);
    });

    it("in-place writes do not churn the watcher", async () => {
      const root = tmp();
      writeFileSync(join(root, "foo.ts"), "a");
      const mgr = createFileWatchManager();
      const before = vi.mocked(watchSpy).mock.calls.length;
      mgr.setWatched(wsA, "s1", root, ["foo.ts"], vi.fn());
      await wait(50);
      for (let i = 0; i < 5; i++) {
        writeFileSync(join(root, "foo.ts"), `v${i}`);
        await wait(60);
      }
      expect(vi.mocked(watchSpy).mock.calls.length - before).toBe(1);
      mgr.clearConnection(wsA);
    });
  });
});
