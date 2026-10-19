import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createFileWatchManager } from "../file-watch-manager.js";

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
});

// ── Watch survives atomic replace + quick re-create ──────────────────────────
// See change: gate-changed-on-disk-by-content (D5; test-plan #X1–#X7).

function atomicReplace(root: string, name: string, content: string): void {
  const tmpFile = join(root, `.${name}.tmp`);
  writeFileSync(tmpFile, content);
  renameSync(tmpFile, join(root, name));
}

describe("FileWatchManager — atomic replace (X1)", () => {
  for (const delay of [0, 20, 500]) {
    it(`still reports a write ${delay} ms after a tmp+rename; one watcher throughout`, async () => {
      const root = tmp();
      writeFileSync(join(root, "foo.ts"), "a");
      const onChange = vi.fn();
      const mgr = createFileWatchManager();
      mgr.setWatched(wsA, "s1", root, ["foo.ts"], onChange);
      await wait(50);

      atomicReplace(root, "foo.ts", "b");
      await wait(delay);
      writeFileSync(join(root, "foo.ts"), "c");
      await wait(300);

      expect(onChange).toHaveBeenCalledWith("s1", "foo.ts");
      expect(mgr.activeWatchCount()).toBe(1);
      mgr.clearConnection(wsA);
    });
  }

  it("a write after the re-attach is reported by the NEW watcher (second event)", async () => {
    const root = tmp();
    writeFileSync(join(root, "foo.ts"), "a");
    const onChange = vi.fn();
    const mgr = createFileWatchManager();
    mgr.setWatched(wsA, "s1", root, ["foo.ts"], onChange);
    await wait(50);
    atomicReplace(root, "foo.ts", "b");
    await wait(200);
    const afterRename = onChange.mock.calls.length;
    expect(afterRename).toBeGreaterThanOrEqual(1);
    writeFileSync(join(root, "foo.ts"), "c");
    await wait(200);
    expect(onChange.mock.calls.length).toBeGreaterThan(afterRename);
    mgr.clearConnection(wsA);
  });
});

describe("FileWatchManager — delete + re-create (X2, X3)", () => {
  it("X2: re-attaches at the 300 ms retry when the file returns at 250 ms; later writes fire", async () => {
    const root = tmp();
    writeFileSync(join(root, "foo.ts"), "a");
    const onChange = vi.fn();
    const mgr = createFileWatchManager();
    mgr.setWatched(wsA, "s1", root, ["foo.ts"], onChange);
    await wait(50);

    unlinkSync(join(root, "foo.ts"));
    await wait(250);
    writeFileSync(join(root, "foo.ts"), "b");
    await wait(450); // past the 300 ms retry
    expect(mgr.activeWatchCount()).toBe(1);

    onChange.mockClear();
    await wait(100);
    writeFileSync(join(root, "foo.ts"), "c");
    await wait(250);
    expect(onChange).toHaveBeenCalledWith("s1", "foo.ts");
    mgr.clearConnection(wsA);
  });

  describe("X3 (fake timers)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("drops the key after the last retry when the file never returns; no timers left", async () => {
      const root = tmp();
      writeFileSync(join(root, "foo.ts"), "a");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const onChange = vi.fn();
      const mgr = createFileWatchManager();
      mgr.setWatched(wsA, "s1", root, ["foo.ts"], onChange);
      const armed = Date.now();
      while (Date.now() - armed < 60) await new Promise((r) => setImmediate(r)); // let the watch arm
      unlinkSync(join(root, "foo.ts"));
      // Real I/O delivers the `rename` event; wait for the manager's timers to appear.
      const t0 = Date.now();
      while (mgr.pendingTimerCount() === 0 && Date.now() - t0 < 2000) await new Promise((r) => setImmediate(r));
      expect(mgr.pendingTimerCount()).toBeGreaterThan(0);

      await vi.advanceTimersByTimeAsync(1100);
      expect(mgr.activeWatchCount()).toBe(0);
      expect(mgr.pendingTimerCount()).toBe(0);
      expect(onChange).toHaveBeenCalledTimes(1);
      mgr.clearConnection(wsA);
    });
  });
});

describe("FileWatchManager — replaced by a directory (X4)", () => {
  it("drops the key (never watches a directory) and signals once", async () => {
    const root = tmp();
    writeFileSync(join(root, "foo.ts"), "a");
    const onChange = vi.fn();
    const mgr = createFileWatchManager();
    mgr.setWatched(wsA, "s1", root, ["foo.ts"], onChange);
    await wait(50);

    renameSync(join(root, "foo.ts"), join(root, "foo.ts.bak"));
    mkdirSync(join(root, "foo.ts"));
    await wait(300);

    expect(mgr.activeWatchCount()).toBe(0);
    expect(mgr.pendingTimerCount()).toBe(0);
    expect(onChange).toHaveBeenCalledTimes(1);
    mgr.clearConnection(wsA);
  });
});

describe("FileWatchManager — retry vs teardown (X5)", () => {
  async function deleteAndWaitForRetry(root: string, mgr: ReturnType<typeof createFileWatchManager>) {
    unlinkSync(join(root, "foo.ts"));
    for (let i = 0; i < 100 && mgr.pendingTimerCount() === 0; i++) await wait(5);
    expect(mgr.pendingTimerCount()).toBeGreaterThan(0);
  }

  it("clearConnection during a pending retry creates no watcher afterwards", async () => {
    const root = tmp();
    writeFileSync(join(root, "foo.ts"), "a");
    const onChange = vi.fn();
    const mgr = createFileWatchManager();
    mgr.setWatched(wsA, "s1", root, ["foo.ts"], onChange);
    await wait(50);
    await deleteAndWaitForRetry(root, mgr);
    mgr.clearConnection(wsA);
    writeFileSync(join(root, "foo.ts"), "b"); // would be re-attached by a leaked retry
    await wait(1200);
    expect(mgr.activeWatchCount()).toBe(0);
    expect(mgr.pendingTimerCount()).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reconcile removal during a pending retry creates no watcher afterwards", async () => {
    const root = tmp();
    writeFileSync(join(root, "foo.ts"), "a");
    const onChange = vi.fn();
    const mgr = createFileWatchManager();
    mgr.setWatched(wsA, "s1", root, ["foo.ts"], onChange);
    await wait(50);
    await deleteAndWaitForRetry(root, mgr);
    mgr.setWatched(wsA, "s1", root, [], onChange);
    writeFileSync(join(root, "foo.ts"), "b");
    await wait(1200);
    expect(mgr.activeWatchCount()).toBe(0);
    expect(mgr.pendingTimerCount()).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
    mgr.clearConnection(wsA);
  });
});

describe("FileWatchManager — stale watcher instance (X6)", () => {
  it("an old watcher's late `error` does not close its re-attached successor", async () => {
    const root = tmp();
    writeFileSync(join(root, "foo.ts"), "a");
    interface Fake extends EventEmitter {
      closed: boolean;
      close(): void;
      cb: (eventType: string) => void;
    }
    const made: Fake[] = [];
    const fakeWatch = ((_p: string, cb: (eventType: string) => void) => {
      const w = new EventEmitter() as Fake;
      w.closed = false;
      w.close = () => {
        w.closed = true;
      };
      w.cb = cb;
      made.push(w);
      return w;
    }) as unknown as typeof watch;
    const mgr = createFileWatchManager({ watchFn: fakeWatch });
    mgr.setWatched(wsA, "s1", root, ["foo.ts"], vi.fn());
    expect(made).toHaveLength(1);

    made[0].cb("rename"); // path still a regular file → synchronous re-attach
    expect(made).toHaveLength(2);
    expect(made[0].closed).toBe(true);

    made[0].emit("error", new Error("late"));
    expect(made[1].closed).toBe(false);
    expect(mgr.activeWatchCount()).toBe(1);

    made[0].cb("change"); // stale events from the old instance are ignored too
    mgr.clearConnection(wsA);
    expect(made[1].closed).toBe(true);
  });
});

describe("FileWatchManager — no churn on in-place writes (X7)", () => {
  it("five in-place writes keep the same watcher instance", async () => {
    const root = tmp();
    writeFileSync(join(root, "foo.ts"), "a");
    const spy = vi.fn(watch);
    const mgr = createFileWatchManager({ watchFn: spy as unknown as typeof watch });
    const onChange = vi.fn();
    mgr.setWatched(wsA, "s1", root, ["foo.ts"], onChange);
    await wait(50);
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(root, "foo.ts"), `v${i}`);
      await wait(80);
    }
    expect(spy).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalled();
    mgr.clearConnection(wsA);
  });
});
