/**
 * Unit tests for the in-memory pending-attach registry.
 * See change: add-folder-task-checker-and-spawn-attach.
 */
import { describe, it, expect, vi } from "vitest";
import {
  createPendingAttachRegistry,
  PENDING_ATTACH_QUEUE_CAP,
  PENDING_ATTACH_TTL_MS,
} from "../pending/pending-attach-registry.js";

function fakeNow() {
  let t = 1_000_000;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

describe("pending-attach-registry", () => {
  it("FIFO enqueue + consume returns names in order", () => {
    const reg = createPendingAttachRegistry({ normalize: (s) => s, warn: () => {} });
    expect(reg.enqueue("/p", "a")).toBe(true);
    expect(reg.enqueue("/p", "b")).toBe(true);
    expect(reg.enqueue("/p", "c")).toBe(true);
    expect(reg.size("/p")).toBe(3);
    expect(reg.consume("/p")).toBe("a");
    expect(reg.consume("/p")).toBe("b");
    expect(reg.consume("/p")).toBe("c");
    expect(reg.consume("/p")).toBeNull();
    expect(reg.size("/p")).toBe(0);
  });

  it("empty queue consume returns null", () => {
    const reg = createPendingAttachRegistry({ normalize: (s) => s, warn: () => {} });
    expect(reg.consume("/never-enqueued")).toBeNull();
  });

  it("isolated per cwd", () => {
    const reg = createPendingAttachRegistry({ normalize: (s) => s, warn: () => {} });
    reg.enqueue("/a", "x");
    reg.enqueue("/b", "y");
    expect(reg.consume("/a")).toBe("x");
    expect(reg.consume("/b")).toBe("y");
  });

  it("normalizes cwd: trailing slash collapses", () => {
    // We exercise the default stripTrailingSep behaviour by using identity
    // realpath to keep the test platform-agnostic.
    const reg = createPendingAttachRegistry({ normalize: (s) => s.replace(/[/\\]+$/, ""), warn: () => {} });
    reg.enqueue("/p/", "a");
    expect(reg.size("/p")).toBe(1);
    expect(reg.consume("/p")).toBe("a");
  });

  it("normalizes cwd: realpath equivalence", () => {
    const reg = createPendingAttachRegistry({
      normalize: (s) => (s === "/symlink" ? "/real" : s),
      warn: () => {},
    });
    reg.enqueue("/symlink", "a");
    expect(reg.size("/real")).toBe(1);
    expect(reg.consume("/real")).toBe("a");
  });

  it(`drops at queue cap (${PENDING_ATTACH_QUEUE_CAP}) and warns`, () => {
    const warn = vi.fn();
    const reg = createPendingAttachRegistry({ normalize: (s) => s, warn });
    for (let i = 0; i < PENDING_ATTACH_QUEUE_CAP; i++) {
      expect(reg.enqueue("/p", `c${i}`)).toBe(true);
    }
    expect(reg.size("/p")).toBe(PENDING_ATTACH_QUEUE_CAP);
    expect(warn).not.toHaveBeenCalled();
    expect(reg.enqueue("/p", "overflow")).toBe(false);
    expect(reg.size("/p")).toBe(PENDING_ATTACH_QUEUE_CAP);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/cap reached/);
    expect(warn.mock.calls[0]![0]).toMatch(/overflow/);
  });

  it("expires entries older than 60 s on read", () => {
    const clock = fakeNow();
    const reg = createPendingAttachRegistry({ normalize: (s) => s, now: clock.now, warn: () => {} });
    reg.enqueue("/p", "a");
    clock.advance(PENDING_ATTACH_TTL_MS + 1);
    expect(reg.size("/p")).toBe(0);
    expect(reg.consume("/p")).toBeNull();
  });

  it("expires entries older than 60 s on write", () => {
    const clock = fakeNow();
    const warn = vi.fn();
    const reg = createPendingAttachRegistry({ normalize: (s) => s, now: clock.now, warn });
    reg.enqueue("/p", "a");
    clock.advance(PENDING_ATTACH_TTL_MS + 1);
    // A new enqueue should drop the stale entry first, then push the new one.
    reg.enqueue("/p", "b");
    expect(reg.size("/p")).toBe(1);
    expect(reg.consume("/p")).toBe("b");
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.some((c) => /stale intent/.test(String(c[0])))).toBe(true);
  });

  it("rejects empty changeName", () => {
    const reg = createPendingAttachRegistry({ normalize: (s) => s, warn: () => {} });
    expect(reg.enqueue("/p", "")).toBe(false);
    expect(reg.size("/p")).toBe(0);
  });

  it("partial expiry preserves fresh entries", () => {
    const clock = fakeNow();
    const reg = createPendingAttachRegistry({ normalize: (s) => s, now: clock.now, warn: () => {} });
    reg.enqueue("/p", "old");
    clock.advance(PENDING_ATTACH_TTL_MS / 2);
    reg.enqueue("/p", "new");
    clock.advance(PENDING_ATTACH_TTL_MS / 2 + 1);
    // "old" is now stale; "new" is fresh.
    expect(reg.consume("/p")).toBe("new");
    expect(reg.consume("/p")).toBeNull();
  });
});
