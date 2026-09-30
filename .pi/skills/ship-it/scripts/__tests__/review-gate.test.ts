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
  classifyFindings,
  parseReviewReply,
  REVIEW_TIMEOUT_MS,
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

  it("#E3 a headless run escapes at the cap instead of a third review", () => {
    const d = reviewRoundDecision({ round: 2, blockingFindings: [blocking("b2")], interactive: false });
    expect(d.action).toBe("escape");
    expect(d.action).not.toBe("review");
    expect(d.reason).toMatch(/two|cap/i);
  });

  it("#X6 a headless run terminates against a reviewer that emits a NEW blocking finding every round", () => {
    // The exact failure the doubt-review found: every round changes the worktree,
    // so a no-progress bound would never fire. Only a hard cap terminates.
    const actions: string[] = [];
    let round = 0;
    for (let i = 0; i < 10; i++) {
      const d = reviewRoundDecision({ round, blockingFindings: [blocking(`fresh-${i}`)], interactive: false });
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

// ─── harden-review-and-fix-loop (test-plan #E1-#E18) ──────────────────────────

const B = (...ids: string[]) => ids.map(blocking);

describe("reviewRoundDecision — human continuation at the cap (harden #E1-#E10)", () => {
  it("#E1 headless round 1 with a blocking finding runs the verification round", () => {
    const d = reviewRoundDecision({ round: 1, blockingFindings: B("B1"), interactive: false, approvedExtraRounds: 0 });
    expect(d.action).toBe("review");
  });

  it("#E2 headless round 2 escapes, naming every remaining finding", () => {
    const d = reviewRoundDecision({ round: 2, blockingFindings: B("B1", "B3"), interactive: false });
    expect(d.action).toBe("escape");
    expect(d.reason).toContain("B1");
    expect(d.reason).toContain("B3");
  });

  it("#E3 interactive round 2 asks the human instead of escaping", () => {
    const d = reviewRoundDecision({ round: 2, blockingFindings: B("B1"), interactive: true, approvedExtraRounds: 0 });
    expect(d.action).toBe("ask");
    expect(d.reason).toContain("B1");
  });

  it("#E4 one recorded approval buys exactly one more round", () => {
    const d = reviewRoundDecision({ round: 2, blockingFindings: B("B1"), interactive: true, approvedExtraRounds: 1 });
    expect(d.action).toBe("review");
  });

  it("#E5 after the approved round, it asks again — never reviews on its own", () => {
    const d = reviewRoundDecision({ round: 3, blockingFindings: B("B1"), interactive: true, approvedExtraRounds: 1 });
    expect(d.action).toBe("ask");
    expect(d.action).not.toBe("review");
  });

  it("#E6 a clean round 2 proceeds in both modes", () => {
    for (const interactive of [true, false]) {
      expect(reviewRoundDecision({ round: 2, blockingFindings: [], interactive }).action).toBe("proceed");
    }
  });

  it("#E7 a timeout escapes even when interactive — it is not an ask", () => {
    const d = reviewRoundDecision({ round: 2, blockingFindings: B("B1"), interactive: true, timedOut: true });
    expect(d.action).toBe("escape");
    expect(d.reason).toMatch(/timed out|timeout/i);
  });

  it("#E8 an unsatisfiable finding escapes even when interactive", () => {
    const d = reviewRoundDecision({ round: 1, blockingFindings: B("B1"), interactive: true, unsatisfiable: true });
    expect(d.action).toBe("escape");
  });

  it("#E9 one malformed reply is retried once; a second halts", () => {
    const first = reviewRoundDecision({ round: 0, blockingFindings: [], malformedRetries: 1 });
    expect(first.action).toBe("review");
    const second = reviewRoundDecision({ round: 0, blockingFindings: [], malformedRetries: 2 });
    expect(second.action).toBe("escape");
    expect(second.reason).toMatch(/malformed/i);
  });

  it("#E10 the third ledger-validation failure routes as unsatisfiable", () => {
    const two = reviewRoundDecision({ round: 1, blockingFindings: B("B1"), ledgerFailures: 2 });
    expect(two.action).not.toBe("escape");
    const three = reviewRoundDecision({ round: 1, blockingFindings: B("B1"), ledgerFailures: 3 });
    expect(three.action).toBe("escape");
    expect(three.reason).toMatch(/unsatisfiable/i);
  });

  it("a reviewer emitting fresh findings cannot pass round 2 without an approval (interactive)", () => {
    const actions: string[] = [];
    let round = 0;
    for (let i = 0; i < 10; i++) {
      const d = reviewRoundDecision({ round, blockingFindings: B(`B${i}`), interactive: true });
      actions.push(d.action);
      if (d.action !== "review") break;
      round++;
    }
    expect(actions).toEqual(["review", "review", "ask"]);
  });
});

const SWEEP = [
  "| Defect class | What you checked | Result |",
  "|---|---|---|",
  "| Spec and task conformance | tasks 1-3 | ok |",
].join("\n");

describe("parseReviewReply — fail-closed reply parsing (harden #E11-#E18)", () => {
  it("#E11 parses a well-formed blocking reply", () => {
    const r = parseReviewReply(
      ["issue(blocking): B1 — race", "  a.ts:1 — x", "", "issue(blocking): B2 — leak", "", SWEEP, "BLOCKING_COUNT: 2", "VERDICT: block"].join("\n"),
    );
    expect(r).toEqual({ blockingIds: ["B1", "B2"], count: 2, verdict: "block", hasSweepSummary: true, malformed: false });
  });

  it("#E12 lists B1 but claims zero — malformed, never a pass", () => {
    const r = parseReviewReply(["issue(blocking): B1 — race", "BLOCKING_COUNT: 0", "VERDICT: pass"].join("\n"));
    expect(r.malformed).toBe(true);
  });

  it("#E13 zero blocking but VERDICT: block — malformed", () => {
    expect(parseReviewReply(["BLOCKING_COUNT: 0", "VERDICT: block"].join("\n")).malformed).toBe(true);
  });

  it("#E14 duplicate BLOCKING_COUNT lines — malformed", () => {
    const r = parseReviewReply(["BLOCKING_COUNT: 0", "BLOCKING_COUNT: 0", "VERDICT: pass"].join("\n"));
    expect(r.malformed).toBe(true);
  });

  it("#E15 empty and whitespace-only replies — malformed", () => {
    expect(parseReviewReply("").malformed).toBe(true);
    expect(parseReviewReply("  \n ").malformed).toBe(true);
  });

  it("#E16 a missing sweep table is reported, not malformed", () => {
    const r = parseReviewReply(["issue(blocking): B1 — x", "BLOCKING_COUNT: 1", "VERDICT: block"].join("\n"));
    expect(r.malformed).toBe(false);
    expect(r.hasSweepSummary).toBe(false);
  });

  it("#E17 an id cited twice counts once", () => {
    const r = parseReviewReply(
      ["issue(blocking): B1 — x", "", "Summary: issue(blocking): B1 again", "BLOCKING_COUNT: 1", "VERDICT: block"].join("\n"),
    );
    expect(r.malformed).toBe(false);
    expect(r.blockingIds).toEqual(["B1"]);
  });

  it("#E18 non-blocking findings only — a clean pass", () => {
    const r = parseReviewReply(["issue(non-blocking): N1 — style", "BLOCKING_COUNT: 0", "VERDICT: pass"].join("\n"));
    expect(r.malformed).toBe(false);
    expect(r.blockingIds).toEqual([]);
  });

  it("tolerates emphasis around the trailer", () => {
    const r = parseReviewReply(["**issue(blocking): B1** — x", "**BLOCKING_COUNT: 1**", "**VERDICT: block**"].join("\n"));
    expect(r).toMatchObject({ blockingIds: ["B1"], count: 1, verdict: "block", malformed: false });
  });
});
