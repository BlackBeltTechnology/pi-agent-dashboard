/**
 * `shell-headless` slot taxonomy (test-plan #E6).
 * See change: fix-empty-status-subcard.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import type { SlotPropsMap } from "../slot-props.js";
import { SLOT_DEFINITIONS, type SlotPredicateInput } from "../slot-types.js";

describe("shell-headless slot", () => {
  it("is a many / react-only slot", () => {
    expect(SLOT_DEFINITIONS["shell-headless"].multiplicity).toBe("many");
    expect(SLOT_DEFINITIONS["shell-headless"].payloadTier).toBe("react-only");
  });

  it("has an empty props map and predicate input never", () => {
    expectTypeOf<SlotPropsMap["shell-headless"]>().toEqualTypeOf<Record<string, never>>();
    expectTypeOf<SlotPredicateInput<"shell-headless">>().toBeNever();
  });
});
