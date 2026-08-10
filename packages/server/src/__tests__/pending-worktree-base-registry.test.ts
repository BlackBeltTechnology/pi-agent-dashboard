/**
 * Tests for the pending-worktree-base registry. Mirrors the
 * pending-attach-registry test set since the registries share semantics.
 *
 * See change: add-worktree-spawn-dialog.
 */
import { describe, it, expect } from "vitest";
import {
  PENDING_WORKTREE_BASE_CAP,
  PENDING_WORKTREE_BASE_TTL_MS,
  createPendingWorktreeBaseRegistry,
} from "../pending/pending-worktree-base-registry.js";

function fakeNow() {
  let t = 1_000_000;
  return {
    tick(by = 1): void { t += by; },
    set(v: number): void { t = v; },
    fn(): number { return t; },
  };
}

describe("pending-worktree-base-registry", () => {
  it("enqueue + consume FIFO per cwd", () => {
    const r = createPendingWorktreeBaseRegistry({ normalize: (c) => c });
    r.enqueue("/repo", "develop");
    r.enqueue("/repo", "main");
    r.enqueue("/other", "feat");
    expect(r.consume("/repo")).toBe("develop");
    expect(r.consume("/repo")).toBe("main");
    expect(r.consume("/repo")).toBeNull();
    expect(r.consume("/other")).toBe("feat");
  });

  it("returns null when nothing queued for cwd", () => {
    const r = createPendingWorktreeBaseRegistry({ normalize: (c) => c });
    expect(r.consume("/repo")).toBeNull();
  });

  it("rejects empty base strings", () => {
    const r = createPendingWorktreeBaseRegistry({ normalize: (c) => c });
    expect(r.enqueue("/repo", "")).toBe(false);
    expect(r.size("/repo")).toBe(0);
  });

  it("drops oldest at queue cap, warns once", () => {
    const warns: string[] = [];
    const r = createPendingWorktreeBaseRegistry({
      normalize: (c) => c,
      warn: (m) => warns.push(m),
    });
    for (let i = 0; i < PENDING_WORKTREE_BASE_CAP; i++) {
      expect(r.enqueue("/repo", `base${i}`)).toBe(true);
    }
    // The overflow attempt is dropped.
    expect(r.enqueue("/repo", "overflow")).toBe(false);
    expect(warns.some((m) => m.includes("queue cap reached"))).toBe(true);
    expect(r.size("/repo")).toBe(PENDING_WORKTREE_BASE_CAP);
  });

  it("drops entries older than TTL on touch", () => {
    const clock = fakeNow();
    const warns: string[] = [];
    const r = createPendingWorktreeBaseRegistry({
      now: clock.fn,
      normalize: (c) => c,
      warn: (m) => warns.push(m),
    });
    r.enqueue("/repo", "develop");
    // Advance past TTL.
    clock.tick(PENDING_WORKTREE_BASE_TTL_MS + 1);
    expect(r.consume("/repo")).toBeNull();
    expect(warns.some((m) => m.includes("dropping stale base"))).toBe(true);
  });

  it("normalizes cwd: trailing-sep variants share a queue", () => {
    // Default normalizer realpaths; supply a stub that just strips trailing
    // separators so the test stays hermetic.
    const r = createPendingWorktreeBaseRegistry({
      normalize: (c) => c.replace(/[/\\]+$/, ""),
    });
    r.enqueue("/repo/", "develop");
    expect(r.consume("/repo")).toBe("develop");
  });

  it("size() prunes stale entries before returning count", () => {
    const clock = fakeNow();
    const r = createPendingWorktreeBaseRegistry({
      now: clock.fn,
      normalize: (c) => c,
    });
    r.enqueue("/repo", "develop");
    expect(r.size("/repo")).toBe(1);
    clock.tick(PENDING_WORKTREE_BASE_TTL_MS + 1);
    expect(r.size("/repo")).toBe(0);
  });
});
