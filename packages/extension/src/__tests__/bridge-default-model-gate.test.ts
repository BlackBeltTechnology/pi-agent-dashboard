import { describe, it, expect } from "vitest";
import {
  hasExplicitModelArg,
  shouldApplyDefaultModel,
} from "../bridge-default-model-gate.js";

// Note: `entryCount` is the message count from
// `ctx.sessionManager.buildSessionContext().messages.length`, not the raw
// `getEntries()` count. See change: fix-default-model-new-session-entry-count.
describe("shouldApplyDefaultModel", () => {
  const base = { hasModelRegistry: true, hasDefaultModel: true, hasExplicitModel: false };

  it("applies for a brand-new session (reason=startup, messages=0)", () => {
    expect(shouldApplyDefaultModel({ ...base, reason: "startup", entryCount: 0 })).toBe(true);
  });

  it("does NOT apply for resumed sessions (messages>0, reason=startup)", () => {
    expect(shouldApplyDefaultModel({ ...base, reason: "startup", entryCount: 5 })).toBe(false);
  });

  it("does NOT apply for in-process new (reason=new)", () => {
    // pi handles its own default for in-process /new — bridge stays out
    expect(shouldApplyDefaultModel({ ...base, reason: "new", entryCount: 0 })).toBe(false);
  });

  it("does NOT apply for in-process resume (reason=resume)", () => {
    expect(shouldApplyDefaultModel({ ...base, reason: "resume", entryCount: 5 })).toBe(false);
  });

  it("does NOT apply for in-process fork (reason=fork)", () => {
    expect(shouldApplyDefaultModel({ ...base, reason: "fork", entryCount: 5 })).toBe(false);
  });

  it("does NOT apply for reload of in-flight session (reason=reload, messages>0)", () => {
    expect(shouldApplyDefaultModel({ ...base, reason: "reload", entryCount: 5 })).toBe(false);
  });

  it("does NOT apply when defaultModel is not configured", () => {
    expect(
      shouldApplyDefaultModel({ ...base, hasDefaultModel: false, reason: "startup", entryCount: 0 }),
    ).toBe(false);
  });

  it("does NOT apply when model registry not yet available", () => {
    expect(
      shouldApplyDefaultModel({ ...base, hasModelRegistry: false, reason: "startup", entryCount: 0 }),
    ).toBe(false);
  });

  it("does NOT apply when reason is undefined", () => {
    expect(shouldApplyDefaultModel({ ...base, reason: undefined, entryCount: 0 })).toBe(false);
  });

  // ── Regression (E5): every pre-existing false case stays false with an ──
  // explicit hasExplicitModel:false input — no pre-existing case may flip.
  // See change: fix-default-model-clobbers-explicit-model (test-plan #E5).
  describe("regression: hasExplicitModel:false leaves every pre-existing case unchanged", () => {
    const explicitFalse = { ...base, hasExplicitModel: false };

    it("brand-new startup still applies", () => {
      expect(
        shouldApplyDefaultModel({ ...explicitFalse, reason: "startup", entryCount: 0 }),
      ).toBe(true);
    });

    it("resumed sessions (messages>0) still do NOT apply", () => {
      expect(
        shouldApplyDefaultModel({ ...explicitFalse, reason: "startup", entryCount: 5 }),
      ).toBe(false);
    });

    it("in-process new (reason=new) still does NOT apply", () => {
      expect(shouldApplyDefaultModel({ ...explicitFalse, reason: "new", entryCount: 0 })).toBe(
        false,
      );
    });

    it("in-process resume (reason=resume) still does NOT apply", () => {
      expect(shouldApplyDefaultModel({ ...explicitFalse, reason: "resume", entryCount: 5 })).toBe(
        false,
      );
    });

    it("in-process fork (reason=fork) still does NOT apply", () => {
      expect(shouldApplyDefaultModel({ ...explicitFalse, reason: "fork", entryCount: 5 })).toBe(
        false,
      );
    });

    it("reload of in-flight session still does NOT apply", () => {
      expect(shouldApplyDefaultModel({ ...explicitFalse, reason: "reload", entryCount: 5 })).toBe(
        false,
      );
    });

    it("no defaultModel configured still does NOT apply", () => {
      expect(
        shouldApplyDefaultModel({
          ...explicitFalse,
          hasDefaultModel: false,
          reason: "startup",
          entryCount: 0,
        }),
      ).toBe(false);
    });

    it("no model registry still does NOT apply", () => {
      expect(
        shouldApplyDefaultModel({
          ...explicitFalse,
          hasModelRegistry: false,
          reason: "startup",
          entryCount: 0,
        }),
      ).toBe(false);
    });

    it("undefined reason still does NOT apply", () => {
      expect(
        shouldApplyDefaultModel({ ...explicitFalse, reason: undefined, entryCount: 0 }),
      ).toBe(false);
    });
  });

  // ── Explicit-model dominates (E1/E2) — issue #595 ────────────────────────
  // See change: fix-default-model-clobbers-explicit-model (test-plan #E1, #E2).
  describe("explicit model on the launch argv dominates", () => {
    const full = { ...base, reason: "startup", entryCount: 0 } as const;

    it("does NOT apply the default when hasExplicitModel is true (E1)", () => {
      expect(shouldApplyDefaultModel({ ...full, hasExplicitModel: true })).toBe(false);
    });

    it("still applies the default when hasExplicitModel is false (E2)", () => {
      expect(shouldApplyDefaultModel({ ...full, hasExplicitModel: false })).toBe(true);
    });
  });

  // ── argv derivation (E3/E4) ──────────────────────────────────────────────
  // See change: fix-default-model-clobbers-explicit-model (test-plan #E3, #E4).
  describe("hasExplicitModelArg", () => {
    it("detects a --model token with a value (E3)", () => {
      expect(hasExplicitModelArg(["pi", "--mode", "rpc", "--model", "x/y"])).toBe(true);
    });

    it("does NOT match the distinct --models token (E3)", () => {
      expect(hasExplicitModelArg(["pi", "--models", "a,b"])).toBe(false);
    });

    it("returns false for argv without the token (E3)", () => {
      expect(hasExplicitModelArg(["pi", "--mode", "rpc"])).toBe(false);
    });

    it("fail-safe: trailing dangling --model counts as explicit (E4)", () => {
      expect(hasExplicitModelArg(["pi", "--model"])).toBe(true);
    });

    it("fail-safe: --model after the -- separator counts as explicit (E4)", () => {
      expect(hasExplicitModelArg(["pi", "--", "--model"])).toBe(true);
    });

    it("fail-safe: --model swallowed as another flag's value counts as explicit (E4)", () => {
      expect(hasExplicitModelArg(["pi", "--name", "--model"])).toBe(true);
    });
  });
});
