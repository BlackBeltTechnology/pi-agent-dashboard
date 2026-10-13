/**
 * `resource-page-section` slot taxonomy (test-plan #E23, shared half).
 * See change: add-skill-atlas-screen.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import type { ResourcePageSectionProps, SlotPropsMap } from "../slot-props.js";
import { SLOT_DEFINITIONS, type SlotPredicateInput } from "../slot-types.js";

describe("resource-page-section slot", () => {
  it("is a many / react-only slot", () => {
    expect(SLOT_DEFINITIONS["resource-page-section"].multiplicity).toBe("many");
    expect(SLOT_DEFINITIONS["resource-page-section"].payloadTier).toBe("react-only");
  });

  it("maps props and has predicate input never", () => {
    expectTypeOf<SlotPropsMap["resource-page-section"]>().toEqualTypeOf<ResourcePageSectionProps>();
    expectTypeOf<SlotPredicateInput<"resource-page-section">>().toBeNever();
  });
});
