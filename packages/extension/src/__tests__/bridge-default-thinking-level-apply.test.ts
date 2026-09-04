/**
 * Tests for the bridge applying `config.defaultThinkingLevel` alongside the
 * default model inside `applyDefaultModel()`'s success branch.
 *
 * Pure-model mirror of bridge.ts `applyDefaultModel()` success branch:
 *
 *   (pi as any).setModel(found).then(() => {
 *     const level = freshConfig.defaultThinkingLevel;
 *     if (level) (pi as any).setThinkingLevel?.(level);
 *     setTimeout(() => sendModelUpdateIfChanged(), 50);
 *   }).catch(() => {});
 *
 * If production drifts from this shape, this test drifts in lockstep.
 *
 * Spec: openspec/changes/add-default-thinking-level/specs/bridge-default-model-gate/spec.md
 * See change: add-default-thinking-level.
 */
import { describe, it, expect, vi } from "vitest";
import { shouldApplyDefaultModel } from "../bridge-default-model-gate.js";

interface FakePi {
  setModel: (m: unknown) => Promise<void>;
  setThinkingLevel?: (level: string) => void;
}

/**
 * Mirror of the applyDefaultModel success branch. Records call ordering into
 * `order` so tests can assert setModel resolves before setThinkingLevel, which
 * itself runs before the model-update push.
 */
async function applyDefaultModelSuccessBranch(opts: {
  pi: FakePi;
  found: unknown;
  defaultThinkingLevel: string;
  order: string[];
}): Promise<void> {
  const { pi, found, defaultThinkingLevel, order } = opts;
  await pi.setModel(found).then(() => {
    order.push("setModel:resolved");
    const level = defaultThinkingLevel;
    if (level) {
      pi.setThinkingLevel?.(level);
      order.push(`setThinkingLevel:${level}`);
    }
    order.push("sendModelUpdate");
  });
}

describe("bridge applies default thinking level alongside default model", () => {
  // ── E5: empty level → setThinkingLevel NOT called ──────────────────────
  it("does NOT call setThinkingLevel when defaultThinkingLevel is empty", async () => {
    const setThinkingLevel = vi.fn();
    const setModel = vi.fn(() => Promise.resolve());
    const order: string[] = [];
    await applyDefaultModelSuccessBranch({
      pi: { setModel, setThinkingLevel },
      found: { provider: "anthropic", id: "claude-sonnet-4-5" },
      defaultThinkingLevel: "",
      order,
    });
    expect(setModel).toHaveBeenCalledTimes(1);
    expect(setThinkingLevel).not.toHaveBeenCalled();
  });

  // ── X1: brand-new startup applies both model AND level, in order ───────
  it("applies model then thinking level before the model-update push", async () => {
    const setThinkingLevel = vi.fn();
    const setModel = vi.fn(() => Promise.resolve());
    const order: string[] = [];
    await applyDefaultModelSuccessBranch({
      pi: { setModel, setThinkingLevel },
      found: { provider: "anthropic", id: "claude-sonnet-4-5" },
      defaultThinkingLevel: "high",
      order,
    });
    expect(setModel).toHaveBeenCalledTimes(1);
    expect(setThinkingLevel).toHaveBeenCalledWith("high");
    // setModel resolves → setThinkingLevel → model-update push.
    expect(order).toEqual([
      "setModel:resolved",
      "setThinkingLevel:high",
      "sendModelUpdate",
    ]);
  });

  // ── X2: unsupported level passed unchanged, no throw ───────────────────
  it("passes an unsupported level to pi unchanged and does not throw", async () => {
    // pi clamps internally; the bridge stays dumb and forwards the string.
    const setThinkingLevel = vi.fn(); // pi would clamp; bridge just forwards
    const setModel = vi.fn(() => Promise.resolve());
    const order: string[] = [];
    await expect(
      applyDefaultModelSuccessBranch({
        pi: { setModel, setThinkingLevel },
        found: { provider: "openai", id: "gpt-4o" },
        defaultThinkingLevel: "xhigh",
        order,
      }),
    ).resolves.toBeUndefined();
    expect(setThinkingLevel).toHaveBeenCalledWith("xhigh");
  });

  // ── X4: custom-provider-late resolution reuses the same branch ─────────
  it("applies the level on late provider resolution (same success branch)", async () => {
    // The pending-provider retry calls applyDefaultModel() again; once `found`
    // resolves, the identical success branch applies the level.
    const setThinkingLevel = vi.fn();
    const setModel = vi.fn(() => Promise.resolve());
    const order: string[] = [];
    await applyDefaultModelSuccessBranch({
      pi: { setModel, setThinkingLevel },
      found: { provider: "custom", id: "late-model" },
      defaultThinkingLevel: "high",
      order,
    });
    expect(setThinkingLevel).toHaveBeenCalledWith("high");
  });

  // ── X3: resumed session — gate false → neither applied ─────────────────
  it("does not enter the apply branch for a resumed session (gate false)", () => {
    // A non-zero message-history count means the gate rejects; neither the
    // model nor the level is applied.
    const apply = shouldApplyDefaultModel({
      reason: "startup",
      entryCount: 30,
      hasModelRegistry: true,
      hasDefaultModel: true,
      hasExplicitModel: false,
    });
    expect(apply).toBe(false);
  });

  // ── X2: explicit-model session — gate false → thinking level skipped too ─
  // Deliberate CLI parity: plain `pi --model X` gets no dashboard thinking
  // level either. See change: fix-default-model-clobbers-explicit-model
  // (test-plan #X2).
  it("does not enter the apply branch for an explicit-model session (gate false)", async () => {
    const setThinkingLevel = vi.fn();
    const setModel = vi.fn(() => Promise.resolve());
    const order: string[] = [];
    const apply = shouldApplyDefaultModel({
      reason: "startup",
      entryCount: 0,
      hasModelRegistry: true,
      hasDefaultModel: true,
      hasExplicitModel: true,
    });
    expect(apply).toBe(false);
    // Session_start branch runs; the gate verdict routes around the success
    // branch entirely — setThinkingLevel is never called.
    if (apply) {
      await applyDefaultModelSuccessBranch({
        pi: { setModel, setThinkingLevel },
        found: { provider: "anthropic", id: "claude-sonnet-4-5" },
        defaultThinkingLevel: "high",
        order,
      });
    }
    expect(setModel).not.toHaveBeenCalled();
    expect(setThinkingLevel).not.toHaveBeenCalled();
  });
});
