/**
 * Shared YOLO status (change: add-access-grant-dialog, tasks 8b.7, 8b.7a):
 * in-scope rule, remaining time, and the one polled store every surface reads.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { YoloSessionView, YoloView } from "../access-prompts-types.js";
import { formatRemaining, isCwdInYoloScope, remainingMs, YoloStatusStore } from "../yolo-status.js";

const scoped = (...paths: string[]): YoloSessionView => ({
  source: "operator",
  activatedAt: 0,
  expiresAt: 900_000,
  unscoped: false,
  roots: paths.map((path) => ({ path, addedAt: 0 })),
});

describe("isCwdInYoloScope", () => {
  it("matches the root itself and its descendants", () => {
    const s = scoped("/repo");
    expect(isCwdInYoloScope("/repo", s)).toBe(true);
    expect(isCwdInYoloScope("/repo/", s)).toBe(true);
    expect(isCwdInYoloScope("/repo/pkg/a", s)).toBe(true);
  });

  it("is component-wise, never a string prefix", () => {
    expect(isCwdInYoloScope("/repo-secrets", scoped("/repo"))).toBe(false);
    expect(isCwdInYoloScope("/re", scoped("/repo"))).toBe(false);
    expect(isCwdInYoloScope("/other", scoped("/repo"))).toBe(false);
  });

  it("any root of the set counts; a filesystem-root root covers everything", () => {
    expect(isCwdInYoloScope("/tmp/x", scoped("/repo", "/tmp"))).toBe(true);
    expect(isCwdInYoloScope("/anything", scoped("/"))).toBe(true);
  });

  it("handles Windows separators component-wise", () => {
    expect(isCwdInYoloScope("C:\\repo\\pkg", scoped("C:\\repo"))).toBe(true);
    expect(isCwdInYoloScope("C:\\repo-x", scoped("C:\\repo"))).toBe(false);
  });

  it("an unscoped session covers every cwd; no session covers none", () => {
    expect(isCwdInYoloScope("/anywhere", { ...scoped(), unscoped: true })).toBe(true);
    expect(isCwdInYoloScope("/repo", null)).toBe(false);
    expect(isCwdInYoloScope(undefined, scoped("/repo"))).toBe(false);
  });
});

describe("remaining time", () => {
  it("counts down from expiresAt, clamped at zero; env sessions have none", () => {
    expect(remainingMs(scoped("/r"), 899_000)).toBe(1_000);
    expect(remainingMs(scoped("/r"), 950_000)).toBe(0);
    expect(remainingMs({ ...scoped("/r"), source: "env", expiresAt: null }, 1)).toBeNull();
  });

  it("formats as m:ss / h:mm:ss", () => {
    expect(formatRemaining(0)).toBe("0:00");
    expect(formatRemaining(61_000)).toBe("1:01");
    expect(formatRemaining(15 * 60_000)).toBe("15:00");
    expect(formatRemaining(60 * 60_000)).toBe("1:00:00");
    // Rounds UP so a live session never reads 0:00.
    expect(formatRemaining(500)).toBe("0:01");
  });
});

describe("YoloStatusStore", () => {
  afterEach(() => vi.useRealTimers());
  const view = (session: YoloSessionView | null): YoloView => ({ available: true, durationsMinutes: [15, 30, 60], session });

  it("loads on first subscribe, polls while subscribed, stops after the last unsubscribe", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => view(null));
    const store = new YoloStatusStore(load, 1_000);
    const off = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual(view(null));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(load).toHaveBeenCalledTimes(3);
    off();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("publish notifies only on a real change (stable snapshot otherwise)", () => {
    const store = new YoloStatusStore(async () => null);
    const listener = vi.fn();
    store.subscribe(listener);
    store.publish(view(scoped("/r")));
    const first = store.getSnapshot();
    store.publish(view(scoped("/r")));
    expect(store.getSnapshot()).toBe(first);
    store.publish(view(null));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("a failed load keeps the last known view", async () => {
    const store = new YoloStatusStore(async () => {
      throw new Error("offline");
    });
    store.publish(view(scoped("/r")));
    await store.refresh();
    expect(store.getSnapshot()?.session?.roots[0].path).toBe("/r");
  });
});
