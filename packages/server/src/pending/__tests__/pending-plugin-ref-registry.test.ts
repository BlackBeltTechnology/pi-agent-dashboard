/**
 * Unified token-keyed pending-plugin-ref registry — the generic
 * session-ownership seam's pending store.
 *
 * Covers test-plan scenarios: E4 (key ownership), E10 (parallel same-cwd,
 * no cap), X1 (malformed fail-open + warn-once), X2 (register-during-await
 * resolves by token), X4 (rollback removes only its own token), X5 (late
 * failure after a register is a no-op), X6 (60s TTL boundary).
 * See change: detach-automation-goal-from-core.
 */
import { describe, it, expect, vi } from "vitest";
import {
  createPendingPluginRefRegistry,
  PENDING_PLUGIN_REF_TTL_MS,
} from "../pending-plugin-ref-registry.js";

describe("pending-plugin-ref-registry", () => {
  it("E4: a ref cannot set a key it does not own, nor a core-reserved key", () => {
    const reg = createPendingPluginRefRegistry();
    // Owner A claims `goalId` first (first-writer-wins).
    expect(reg.file("tA", { goalId: "A" }, "ownerA")).toBe(true);
    expect(reg.resolve("tA")?.ref).toEqual({ goalId: "A" });

    // Owner B files the SAME key it does not own → dropped on sanitize.
    expect(reg.file("tB", { goalId: "B", mine: 1 }, "ownerB")).toBe(true);
    const rB = reg.resolve("tB");
    expect(rB?.ref).toEqual({ mine: 1 }); // goalId stripped, own key kept
    expect(rB?.ref.goalId).toBeUndefined();

    // A core-reserved key is rejected regardless of owner.
    expect(reg.file("tC", { live: true, kind: "automation" }, "ownerA")).toBe(true);
    const rC = reg.resolve("tC");
    expect(rC?.ref).toEqual({ kind: "automation" }); // `live` reserved → dropped
    expect(rC?.ref.live).toBeUndefined();
  });

  it("E10: 12 parallel same-cwd automation refs each resolve their own run; no cap drop", () => {
    const reg = createPendingPluginRefRegistry();
    const tokens = Array.from({ length: 12 }, (_, i) => `tok-${i}`);
    // File all 12 (interleave file-before-any-resolve = the spawn-await gap).
    tokens.forEach((t, i) =>
      reg.file(t, { kind: "automation", automationRun: { runId: `run-${i}` } }, "automation"),
    );
    // The old per-cwd FIFO-8 cap would have dropped the 9th–12th; the
    // token-keyed store has NO cap.
    expect(reg.size()).toBe(12);
    // Each resolves its OWN run; zero cross-assignment.
    tokens.forEach((t, i) => {
      const r = reg.resolve(t);
      expect((r?.ref.automationRun as { runId: string } | undefined)?.runId).toBe(`run-${i}`);
    });
    expect(reg.size()).toBe(0);
  });

  it("X1: a malformed ref is dropped fail-open, warns once per key, never throws", () => {
    const warn = vi.fn();
    const reg = createPendingPluginRefRegistry({ warn });
    // Non-object ref: dropped entirely, nothing filed, warns once under `*`.
    expect(() => reg.file("t1", "not-an-object", "p")).not.toThrow();
    expect(reg.file("t1", 42 as unknown, "p")).toBe(false);
    expect(reg.size()).toBe(0);
    // A second malformed file for the same key does NOT warn again.
    reg.file("t2", null as unknown, "p");
    const starWarns = warn.mock.calls.filter((c) => String(c[0]).includes('"*"'));
    expect(starWarns.length).toBe(1);
  });

  it("X2: a register during the spawn await resolves the ref via its token", () => {
    const reg = createPendingPluginRefRegistry();
    // File before the (simulated) await resolves…
    reg.file("race-tok", { goalId: "g1" }, "goal", { recover: false });
    // …then the register arrives while the spawn promise is still pending.
    const resolved = reg.resolve("race-tok");
    expect(resolved?.ref).toEqual({ goalId: "g1" });
    expect(resolved?.ownerId).toBe("goal");
    expect(resolved?.lifecycle).toEqual({ recover: false });
    // An unknown token resolves nothing (would force a lower correlation tier).
    expect(reg.resolve("no-such")).toBeNull();
  });

  it("X4: spawn-failure rollback removes only its own token; siblings intact", () => {
    const reg = createPendingPluginRefRegistry();
    reg.file("A", { kind: "automation", automationRun: { runId: "a" } }, "automation");
    reg.file("B", { kind: "automation", automationRun: { runId: "b" } }, "automation");
    reg.file("C", { kind: "automation", automationRun: { runId: "c" } }, "automation");
    // A's spawn rejects → rollback A only.
    reg.remove("A");
    expect(reg.resolve("A")).toBeNull();
    expect((reg.resolve("B")?.ref.automationRun as { runId: string } | undefined)?.runId).toBe("b");
    expect((reg.resolve("C")?.ref.automationRun as { runId: string } | undefined)?.runId).toBe("c");
  });

  it("X5: a late spawn-failure after the register already consumed the token is a no-op", () => {
    const reg = createPendingPluginRefRegistry();
    reg.file("A", { goalId: "g" }, "goal");
    // Register consumes it first.
    expect(reg.resolve("A")?.ref).toEqual({ goalId: "g" });
    // The late failure handler fires remove(A) — idempotent no-op, no throw.
    expect(() => reg.remove("A")).not.toThrow();
    expect(reg.resolve("A")).toBeNull();
  });

  it("X6: register past the 60s TTL resolves no ref; a t0+59s register still resolves", () => {
    let now = 1_000_000;
    const reg = createPendingPluginRefRegistry({ now: () => now });
    reg.file("late", { goalId: "g" }, "goal");
    // Just past the TTL → swept on touch → unowned.
    now += PENDING_PLUGIN_REF_TTL_MS + 1_000;
    expect(reg.resolve("late")).toBeNull();

    // Control: a fresh file resolved at t0+59s (inside the window) still hits.
    reg.file("intime", { goalId: "h" }, "goal");
    now += PENDING_PLUGIN_REF_TTL_MS - 1_000;
    expect(reg.resolve("intime")?.ref).toEqual({ goalId: "h" });
  });
});
