/**
 * Debounce semantics for OpenSpecChangeWatcher. Real fs.watch is replaced
 * with a manual event emitter so this test stays platform-agnostic and uses
 * vitest fake timers.
 *
 * See change: fix-openspec-taskcheck-delay.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// Mock fs.watch so attach() succeeds without touching the real filesystem.
type FakeWatcher = EventEmitter & { close: () => void };
const fakeWatchers: FakeWatcher[] = [];
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    watch: vi.fn(() => {
      const w = Object.assign(new EventEmitter(), { close: () => {} }) as FakeWatcher;
      fakeWatchers.push(w);
      return w as unknown as ReturnType<typeof import("node:fs").watch>;
    }),
  };
});

import { createOpenSpecChangeWatcher } from "../openspec/openspec-change-watcher.js";

describe("OpenSpecChangeWatcher debounce", () => {
  beforeEach(() => {
    fakeWatchers.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses three rapid events into one onChange call (trailing edge)", () => {
    const onChange = vi.fn();
    const watcher = createOpenSpecChangeWatcher({ onChange, debounceMs: 300 });
    watcher.attach("/some/cwd");

    const fakeWatcher = fakeWatchers[0]!;
    fakeWatcher.emit("change", "change", "my-change/tasks.md");
    vi.advanceTimersByTime(100);
    fakeWatcher.emit("change", "change", "my-change/tasks.md");
    vi.advanceTimersByTime(100);
    fakeWatcher.emit("change", "change", "my-change/tasks.md");

    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("/some/cwd");
  });

  it("ignores non-matching filenames (no debounce armed)", () => {
    const onChange = vi.fn();
    const watcher = createOpenSpecChangeWatcher({ onChange, debounceMs: 300 });
    watcher.attach("/some/cwd");

    fakeWatchers[0]!.emit("change", "change", "my-change/README.md");
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("fires onChange per-cwd independently", () => {
    const onChange = vi.fn();
    const watcher = createOpenSpecChangeWatcher({ onChange, debounceMs: 200 });
    watcher.attach("/cwd/a");
    watcher.attach("/cwd/b");

    fakeWatchers[0]!.emit("change", "change", "x/tasks.md");
    fakeWatchers[1]!.emit("change", "change", "y/proposal.md");
    vi.advanceTimersByTime(250);

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledWith("/cwd/a");
    expect(onChange).toHaveBeenCalledWith("/cwd/b");
  });

  it("detach clears the pending debounce timer", () => {
    const onChange = vi.fn();
    const watcher = createOpenSpecChangeWatcher({ onChange, debounceMs: 300 });
    watcher.attach("/some/cwd");

    fakeWatchers[0]!.emit("change", "change", "my-change/tasks.md");
    vi.advanceTimersByTime(100);
    watcher.detach("/some/cwd");
    vi.advanceTimersByTime(500);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("attach is idempotent (second attach is a no-op)", () => {
    const onChange = vi.fn();
    const watcher = createOpenSpecChangeWatcher({ onChange, debounceMs: 100 });
    watcher.attach("/x");
    watcher.attach("/x");
    expect(watcher.size()).toBe(1);
    expect(fakeWatchers.length).toBe(1);
  });

  it("rename events also trigger the debounce", () => {
    const onChange = vi.fn();
    const watcher = createOpenSpecChangeWatcher({ onChange, debounceMs: 150 });
    watcher.attach("/cwd");

    fakeWatchers[0]!.emit("rename", "rename", "my-change/specs/cap/spec.md");
    vi.advanceTimersByTime(200);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
