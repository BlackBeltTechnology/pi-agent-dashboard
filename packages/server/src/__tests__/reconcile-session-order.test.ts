import { describe, it, expect } from "vitest";
import { reconcileSessionOrder, type ReconcileSession } from "../session/reconcile-session-order.js";

const key = (s: ReconcileSession) => "/repo"; // single-key default for most cases

function s(id: string, status: string, opts: Partial<ReconcileSession> = {}): ReconcileSession {
  return { id, status, startedAt: opts.startedAt ?? 0, ...opts };
}

describe("reconcileSessionOrder", () => {
  it("keeps ended ids that are already in the stored order (no stripping)", () => {
    const orders = { "/repo": ["a", "b", "c"] };
    const sessions = [s("a", "active"), s("b", "ended", { endedAt: 1 }), s("c", "active")];
    expect(reconcileSessionOrder(orders, sessions, key)).toEqual({});
  });

  it("prunes ids not present in the manager", () => {
    const orders = { "/repo": ["a", "ghost", "b"] };
    const sessions = [s("a", "active"), s("b", "active")];
    expect(reconcileSessionOrder(orders, sessions, key)).toEqual({ "/repo": ["a", "b"] });
  });

  it("backfills absent ended ids by endedAt desc (migration seed)", () => {
    const orders = { "/repo": ["a"] };
    const sessions = [
      s("a", "active"),
      s("e2", "ended", { endedAt: 8000 }),
      s("e1", "ended", { endedAt: 9000 }),
    ];
    // e1 (9000) before e2 (8000), appended after the alive id.
    expect(reconcileSessionOrder(orders, sessions, key)).toEqual({ "/repo": ["a", "e1", "e2"] });
  });

  it("is idempotent when ended ids already present", () => {
    const orders = { "/repo": ["a", "e1", "e2"] };
    const sessions = [
      s("a", "active"),
      s("e1", "ended", { endedAt: 9000 }),
      s("e2", "ended", { endedAt: 8000 }),
    ];
    expect(reconcileSessionOrder(orders, sessions, key)).toEqual({});
  });

  it("falls back to startedAt when endedAt is absent", () => {
    const orders = {};
    const sessions = [
      s("e2", "ended", { startedAt: 100 }),
      s("e1", "ended", { startedAt: 200 }),
    ];
    expect(reconcileSessionOrder(orders, sessions, key)).toEqual({ "/repo": ["e1", "e2"] });
  });

  it("creates an order entry for a key that has only cold-start ended sessions", () => {
    const orders = {};
    const sessions = [s("e1", "ended", { endedAt: 5 })];
    expect(reconcileSessionOrder(orders, sessions, key)).toEqual({ "/repo": ["e1"] });
  });

  it("groups ended ids under their resolved key (worktree collapses to parent)", () => {
    const orders = {};
    const sessions = [
      s("w1", "ended", { endedAt: 2 }),
      s("p1", "ended", { endedAt: 1 }),
    ];
    const resolve = (x: ReconcileSession) => (x.id === "w1" ? "/repo" : "/other");
    expect(reconcileSessionOrder(orders, sessions, resolve)).toEqual({
      "/repo": ["w1"],
      "/other": ["p1"],
    });
  });
});
