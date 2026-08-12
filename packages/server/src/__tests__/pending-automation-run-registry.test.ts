/**
 * Unit tests for the pending-automation-run registry: FIFO-per-cwd,
 * TTL pruning, cap enforcement, and spawn-token-exact claiming. Mirrors the
 * worktree-base registry tests.
 * See change: add-automation-plugin, fix-automation-stamp-correlation.
 */
import { describe, expect, it } from "vitest";
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

  it("claims the entry bound to the registering session's spawn token", () => {
    // Two independent plugins spawn stamped sessions into ONE cwd. Whichever
    // session registers first must get ITS OWN run identity, never the queue
    // head: a stolen stamp leaves its real owner unable to correlate the run,
    // so the action is never delivered and the run wedges `running`.
    const r = createPendingAutomationRunRegistry({ normalize: ident });
    r.enqueue("/repo", { name: "intake", runId: "run-A" });
    r.enqueue("/repo", { name: "scoped", runId: "run-B" });
    expect(r.bindToken("/repo", "run-A", "tok-A")).toBe(true);
    expect(r.bindToken("/repo", "run-B", "tok-B")).toBe(true);

    // The SECOND spawn's session registers first.
    expect(r.consume("/repo", "tok-B")?.runId).toBe("run-B");
    expect(r.size("/repo")).toBe(1);
    expect(r.consume("/repo", "tok-A")?.runId).toBe("run-A");
    expect(r.size("/repo")).toBe(0);
  });

  it("never hands a token-bound stamp to a foreign or tokenless session", () => {
    const r = createPendingAutomationRunRegistry({ normalize: ident });
    r.enqueue("/repo", { name: "intake", runId: "run-A" });
    r.bindToken("/repo", "run-A", "tok-A");

    expect(r.consume("/repo", "tok-other")).toBeNull();
    expect(r.consume("/repo")).toBeNull();
    expect(r.size("/repo")).toBe(1);
    expect(r.consume("/repo", "tok-A")?.runId).toBe("run-A");
  });

  it("falls back to the oldest UNBOUND entry when the token is unknown", () => {
    // A bridge can register before `spawnPiSession` resolves, so the entry is
    // still unbound; it must not be stranded.
    const r = createPendingAutomationRunRegistry({ normalize: ident });
    r.enqueue("/repo", { name: "bound", runId: "run-A" });
    r.bindToken("/repo", "run-A", "tok-A");
    r.enqueue("/repo", { name: "racing", runId: "run-B" });

    expect(r.consume("/repo", "tok-fresh")?.runId).toBe("run-B");
  });

  it("keeps legacy tokenless FIFO for spawn paths that mint no token", () => {
    const r = createPendingAutomationRunRegistry({ normalize: ident });
    r.enqueue("/repo", { name: "x", runId: "r1" });
    r.enqueue("/repo", { name: "x", runId: "r2" });
    expect(r.consume("/repo")?.runId).toBe("r1");
    expect(r.consume("/repo")?.runId).toBe("r2");
  });

  it("refuses to bind an unknown or already-claimed run", () => {
    const r = createPendingAutomationRunRegistry({ normalize: ident });
    r.enqueue("/repo", { name: "x", runId: "r1" });
    expect(r.bindToken("/repo", "nope", "tok")).toBe(false);
    expect(r.bindToken("/repo", "r1", "")).toBe(false);
    expect(r.consume("/repo")?.runId).toBe("r1");
    expect(r.bindToken("/repo", "r1", "tok")).toBe(false);
  });

  it("enforces the per-cwd cap", () => {
    const r = createPendingAutomationRunRegistry({ normalize: ident, warn: () => {} });
    for (let i = 0; i < PENDING_AUTOMATION_RUN_CAP; i++) {
      expect(r.enqueue("/a", { name: "x", runId: `r${i}` })).toBe(true);
    }
    expect(r.enqueue("/a", { name: "x", runId: "overflow" })).toBe(false);
  });
});
