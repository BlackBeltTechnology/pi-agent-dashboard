/**
 * automation-card-visuals: state derivation + status→class mapping.
 * See change: automation-ui-mockup-parity.
 */
import { describe, it, expect } from "vitest";
import {
  cardButtonClass,
  deriveCardState,
  pillClass,
  runPillClass,
  railBgClass,
  dotClass,
  pillLabel,
  stripeFxClass,
} from "../client/automation-card-visuals.js";

describe("deriveCardState", () => {
  it("running takes precedence over everything", () => {
    expect(deriveCardState({ valid: true, disabled: true, running: true })).toBe("running");
    expect(deriveCardState({ valid: false, disabled: false, running: true })).toBe("running");
  });
  it("invalid before disabled before enabled", () => {
    expect(deriveCardState({ valid: false, disabled: false, running: false })).toBe("invalid");
    expect(deriveCardState({ valid: true, disabled: true, running: false })).toBe("disabled");
    expect(deriveCardState({ valid: true, disabled: false, running: false })).toBe("enabled");
  });
});

describe("status → class mapping", () => {
  it("running → amber dot+pulse, amber rail, stripe overlay", () => {
    expect(dotClass("running")).toContain("bg-[var(--status-working)]");
    expect(dotClass("running")).toContain("animate-pulse");
    expect(railBgClass("running")).toBe("bg-[var(--status-working)]");
    expect(stripeFxClass("running")).toBe("card-stripes-fx card-stripes-running");
    expect(pillLabel("running")).toBe("running");
  });
  it("invalid → error token, no stripe", () => {
    expect(dotClass("invalid")).toBe("bg-[var(--status-error)]");
    expect(railBgClass("invalid")).toBe("bg-[var(--status-error)]");
    expect(stripeFxClass("invalid")).toBe("");
  });
  it("disabled → muted palette", () => {
    expect(dotClass("disabled")).toContain("bg-surface");
    expect(railBgClass("disabled")).toContain("bg-surface");
  });
  it("enabled → idle token", () => {
    expect(dotClass("enabled")).toBe("bg-[var(--status-idle)]");
    expect(railBgClass("enabled")).toBe("bg-[var(--status-idle)]");
    expect(stripeFxClass("enabled")).toBe("");
  });
});

// See change: polish-automation-board (design D10).
describe("orphaned state + theme tokens", () => {
  it("orphaned outranks running and maps to the warning severity", () => {
    expect(deriveCardState({ valid: true, disabled: false, running: true, orphaned: true })).toBe("orphaned");
    expect(railBgClass("orphaned")).toBe("bg-[var(--severity-warning-fg)]");
    expect(pillClass("orphaned")).toContain("bg-[var(--severity-warning-bg)]");
    expect(pillLabel("orphaned")).toBe("orphaned");
    expect(runPillClass("orphaned")).toContain("text-[var(--severity-warning-fg)]");
    expect(stripeFxClass("orphaned")).toBe("");
  });

  it("no raw colour literal or palette class in any state's classes", () => {
    const states = ["running", "orphaned", "invalid", "disabled", "enabled"] as const;
    const runs = ["running", "orphaned", "done", "error", "stopped"] as const;
    const all = [
      ...states.flatMap((st) => [railBgClass(st), dotClass(st), pillClass(st)]),
      ...runs.map((r) => runPillClass(r)),
      cardButtonClass(), cardButtonClass("primary"), cardButtonClass("danger"),
    ].join(" ");
    expect(all).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|\b(bg|text|border)-(red|green|yellow|amber|blue)-\d/i);
  });

  // test-plan #F6 — reduced motion: the only animation the plugin adds carries
  // its motion-reduce off-switch; the static status colour stays (the stripe
  // overlay is frozen by the host CSS under prefers-reduced-motion).
  it("F6: the running pulse is disabled under reduced motion; static colour present", () => {
    const dot = dotClass("running");
    expect(dot).toContain("animate-pulse");
    expect(dot).toContain("motion-reduce:animate-none");
    expect(dot).toContain("bg-[var(--status-working)]");
    for (const st of ["orphaned", "invalid", "disabled", "enabled"] as const) {
      expect(dotClass(st)).not.toContain("animate-");
    }
  });

  it("card buttons meet the contract floor (44px touch, 36px from sm)", () => {
    expect(cardButtonClass()).toContain("min-h-[44px]");
    expect(cardButtonClass()).toContain("sm:min-h-[36px]");
    expect(cardButtonClass("danger")).toContain("bg-[var(--tint-red-bg)]");
  });
});
