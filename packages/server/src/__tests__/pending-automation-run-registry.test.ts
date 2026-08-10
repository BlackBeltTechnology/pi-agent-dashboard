/**
 * Unit tests for the pending-automation-run registry: FIFO-per-cwd,
 * TTL pruning, and cap enforcement. Mirrors the worktree-base registry
 * tests. See change: add-automation-plugin.
 */
import { describe, it, expect } from "vitest";
import {
  createPendingAutomationRunRegistry,
  PENDING_AUTOMATION_RUN_CAP,
} from "../pending/pending-automation-run-registry.js";

const ident = (cwd: string) => cwd; // bypass realpath in tests

describe("pending-automation-run-registry", () => {
  it("enqueues then consumes a stamp FIFO per cwd", () => {
    const r = createPendingAutomationRunRegistry({ normalize: ident });
    r.enqueue("/repo", { name: "nightly", runId: "2026-06-19-nightly", visibility: "hidden" });
    r.enqueue("/repo", { name: "nightly", runId: "2026-06-20-nightly", visibility: "shown" });
    expect(r.consume("/repo")?.runId).toBe("2026-06-19-nightly");
    expect(r.consume("/repo")?.runId).toBe("2026-06-20-nightly");
    expect(r.consume("/repo")).toBeNull();
  });

  it("isolates stamps by cwd", () => {
    const r = createPendingAutomationRunRegistry({ normalize: ident });
    r.enqueue("/a", { name: "x", runId: "r1" });
    r.enqueue("/b", { name: "y", runId: "r2" });
    expect(r.consume("/b")?.name).toBe("y");
    expect(r.consume("/a")?.name).toBe("x");
  });

  it("rejects malformed stamps", () => {
    const r = createPendingAutomationRunRegistry({ normalize: ident });
    expect(r.enqueue("/a", { name: "", runId: "r" })).toBe(false);
    expect(r.enqueue("/a", { name: "x", runId: "" })).toBe(false);
    expect(r.size("/a")).toBe(0);
  });

  it("prunes stale entries past TTL", () => {
    let t = 0;
    const r = createPendingAutomationRunRegistry({ normalize: ident, now: () => t, warn: () => {} });
    r.enqueue("/a", { name: "x", runId: "r1" });
    t = 61_000;
    expect(r.consume("/a")).toBeNull();
  });

  it("enforces the per-cwd cap", () => {
    const r = createPendingAutomationRunRegistry({ normalize: ident, warn: () => {} });
    for (let i = 0; i < PENDING_AUTOMATION_RUN_CAP; i++) {
      expect(r.enqueue("/a", { name: "x", runId: `r${i}` })).toBe(true);
    }
    expect(r.enqueue("/a", { name: "x", runId: "overflow" })).toBe(false);
  });
});
