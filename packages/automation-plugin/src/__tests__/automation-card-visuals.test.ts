/**
 * automation-card-visuals: state derivation + status→class mapping.
 * See change: automation-ui-mockup-parity.
 */
import { describe, it, expect } from "vitest";
import {
  deriveCardState,
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
    expect(dotClass("running")).toContain("bg-yellow-500");
    expect(dotClass("running")).toContain("animate-pulse");
    expect(railBgClass("running")).toBe("bg-yellow-500/40");
    expect(stripeFxClass("running")).toBe("card-stripes-fx card-stripes-running");
    expect(pillLabel("running")).toBe("running");
  });
  it("invalid → red palette, no stripe", () => {
    expect(dotClass("invalid")).toBe("bg-red-500");
    expect(railBgClass("invalid")).toBe("bg-red-500/40");
    expect(stripeFxClass("invalid")).toBe("");
  });
  it("disabled → muted palette", () => {
    expect(dotClass("disabled")).toContain("bg-surface");
    expect(railBgClass("disabled")).toContain("bg-surface");
  });
  it("enabled → green palette", () => {
    expect(dotClass("enabled")).toBe("bg-green-500");
    expect(railBgClass("enabled")).toBe("bg-green-500/40");
    expect(stripeFxClass("enabled")).toBe("");
  });
});
