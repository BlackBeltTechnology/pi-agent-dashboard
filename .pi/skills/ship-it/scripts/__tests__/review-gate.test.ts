/**
 * Review-gate decision helpers (test-plan #E1-#E3, #X1, #X2, #X4-#X9).
 *
 * Style mirrors `scripts/__tests__/lint-ledger.test.mjs` — drive the exported
 * pure fns directly, no I/O. The module owns the DECISIONS; the ship-it skill
 * owns the I/O (spawning the reviewer, timing it). That split is what makes the
 * two-round cap testable at all: as skill prose it was unverifiable.
 *
 * See change: wire-local-review-gate.
 */
import { describe, expect, it } from "vitest";
import {
  REVIEW_TIMEOUT_MS,
  classifyFindings,
  resolveReviewer,
  reviewRoundDecision,
} from "../review-gate.ts";

const blocking = (id: string) => ({ id, severity: "issue(blocking)" as const, note: id });
const nit = (id: string) => ({ id, severity: "nit" as const, note: id });

describe("reviewRoundDecision — the hard two-round cap (#E1-#E3, #X6)", () => {
  it("#E1 runs the first review when no round has happened yet", () => {
    expect(reviewRoundDecision({ round: 0, blockingFindings: [blocking("b1")] }).action).toBe(
      "review",
    );
  });

  it("#E2 runs a second review after one round of fixes", () => {
    expect(reviewRoundDecision({ round: 1, blockingFindings: [blocking("b1")] }).action).toBe(
      "review",
    );
  });

  it("#E3 escapes at the cap instead of a third review", () => {
    const d = reviewRoundDecision({ round: 2, blockingFindings: [blocking("b2")] });
    expect(d.action).toBe("escape");
    expect(d.action).not.toBe("review");
    expect(d.reason).toMatch(/two|cap/i);
  });

  it("#X6 terminates against a reviewer that emits a NEW blocking finding every round", () => {
    // The exact failure the doubt-review found: every round changes the worktree,
    // so a no-progress bound would never fire. Only a hard cap terminates.
    const actions: string[] = [];
    let round = 0;
    for (let i = 0; i < 10; i++) {
      const d = reviewRoundDecision({ round, blockingFindings: [blocking(`fresh-${i}`)] });
      actions.push(d.action);
      if (d.action === "escape") break;
      round++;
    }
    expect(actions.at(-1)).toBe("escape");
    expect(actions.filter((a) => a === "review")).toHaveLength(2);
  });

  it("proceeds when a round comes back clean", () => {
    expect(reviewRoundDecision({ round: 1, blockingFindings: [] }).action).toBe("proceed");
  });

  it("#X5 a timeout is neither a pass nor a blocking finding", () => {
    const d = reviewRoundDecision({ round: 0, blockingFindings: [], timedOut: true });
    expect(d.action).toBe("escape");
    expect(d.reason).toMatch(/timeout|timed out/i);
  });

  it("#X7 an unsatisfiable finding escalates instead of looping", () => {
    const d = reviewRoundDecision({
      round: 1,
      blockingFindings: [blocking("b1")],
      unsatisfiable: true,
    });
    expect(d.action).toBe("escape");
    expect(d.reason).toMatch(/no-weakening|unsatisfiable/i);
  });

  it("#X8 every escape names a reason for SHIP_IT_BLOCKED.md", () => {
    for (const state of [
      { round: 2, blockingFindings: [blocking("b")] },
      { round: 0, blockingFindings: [], timedOut: true },
      { round: 1, blockingFindings: [blocking("b")], unsatisfiable: true },
    ]) {
      const d = reviewRoundDecision(state);
      expect(d.action).toBe("escape");
      expect(d.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("classifyFindings — severity routing (#X9)", () => {
  it("#X9 only issue(blocking) blocks the ship", () => {
    const r = classifyFindings([
      nit("n1"),
      { id: "s1", severity: "suggestion", note: "s" },
      { id: "q1", severity: "question", note: "q" },
      { id: "p1", severity: "praise", note: "p" },
    ]);
    expect(r.blocking).toHaveLength(0);
    expect(r.nonBlocking).toHaveLength(4);
  });

  it("separates blocking from advisory findings", () => {
    const r = classifyFindings([blocking("b1"), nit("n1")]);
    expect(r.blocking.map((f) => f.id)).toEqual(["b1"]);
    expect(r.nonBlocking.map((f) => f.id)).toEqual(["n1"]);
  });
});

describe("resolveReviewer — @review is REQUIRED (#X1, #X2)", () => {
  it("#X1 hard-fails when @review is unconfigured, naming the fix", () => {
    const r = resolveReviewer({ roles: { coding: "anthropic/x" }, interactive: false });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/update_roles|Roles panel/);
    expect(r.error).toMatch(/@propose-review/);
  });

  it("#X1 never silently falls back to the session default model", () => {
    const r = resolveReviewer({
      roles: { coding: "anthropic/x" },
      sessionDefault: "anthropic/x",
      interactive: false,
    });
    expect(r.ok).toBe(false);
    expect(r.model).toBeUndefined();
  });

  it("#X2 non-interactive runs hard-fail without prompting or persisting state", () => {
    const r = resolveReviewer({ roles: {}, interactive: false });
    expect(r.ok).toBe(false);
    expect(r.prompt).toBe(false);
  });

  it("#X2 interactive runs offer the bootstrap prompt on every hard-fail", () => {
    const a = resolveReviewer({ roles: {}, interactive: true });
    const b = resolveReviewer({ roles: {}, interactive: true });
    expect(a.prompt).toBe(true);
    expect(b.prompt).toBe(true); // self-extinguishing, not persisted
  });

  it("resolves the configured @review model", () => {
    const r = resolveReviewer({ roles: { review: "zai/glm-5.2" }, interactive: false });
    expect(r.ok).toBe(true);
    expect(r.model).toBe("zai/glm-5.2");
  });
});

describe("#X4 reviewer deadline", () => {
  it("pins the timeout at 300s", () => {
    expect(REVIEW_TIMEOUT_MS).toBe(300_000);
  });
});
