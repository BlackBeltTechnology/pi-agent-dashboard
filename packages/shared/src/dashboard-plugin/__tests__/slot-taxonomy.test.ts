/**
 * Frozen slot-taxonomy contract for the composer context group slot.
 *
 * `composer-context-group` (change: move-quota-to-context-strip) is an
 * additive, React-only, `many` slot rendered inside the chat composer's
 * session-action strip. These assertions pin its descriptor so a future edit
 * cannot silently change its multiplicity/tier while keeping the union
 * member.
 */
import { describe, expect, it } from "vitest";
import { SLOT_DEFINITIONS, type SlotId, type SlotPredicateInput } from "../slot-types.js";
import type { SlotPropsMap } from "../slot-props.js";

describe("composer-context-group slot taxonomy", () => {
  it("is a `many`, react-only slot", () => {
    expect(SLOT_DEFINITIONS["composer-context-group"].multiplicity).toBe("many");
    expect(SLOT_DEFINITIONS["composer-context-group"].payloadTier).toBe("react-only");
  });

  it("is a member of the SlotId union", () => {
    const id: SlotId = "composer-context-group";
    expect(id).toBe("composer-context-group");
  });

  it("declares session + pluginContext props", () => {
    const props: SlotPropsMap["composer-context-group"] = {
      session: { id: "s1", cwd: "/repo", source: "tui", status: "active", startedAt: 0 },
      pluginContext: {},
    };
    expect(props.session.id).toBe("s1");
  });
});

describe("custom-entry-renderer slot taxonomy (change: add-custom-entry-renderer-slot)", () => {
  it("is a `many`, react-only slot", () => {
    expect(SLOT_DEFINITIONS["custom-entry-renderer"].multiplicity).toBe("many");
    expect(SLOT_DEFINITIONS["custom-entry-renderer"].payloadTier).toBe("react-only");
  });

  it("is a member of the SlotId union", () => {
    const id: SlotId = "custom-entry-renderer";
    expect(id).toBe("custom-entry-renderer");
  });

  it("takes no predicate input (gating is shouldRender-only, like tool-renderer)", () => {
    // A real compile-time pin: SlotPredicateInput<"custom-entry-renderer"> must
    // resolve to `never`, so a folder descriptor is rejected. If the slot were
    // re-classified folder-scoped this directive would go UNUSED and fail the
    // build; `never` is also why the old `undefined as never` form was vacuous.
    // @ts-expect-error — a concrete input is a type error against `never`.
    const bad: SlotPredicateInput<"custom-entry-renderer"> = { cwd: "/x" };
    expect(bad).toEqual({ cwd: "/x" });
  });

  it("declares the collapsed-first render contract props", () => {
    const props: SlotPropsMap["custom-entry-renderer"] = {
      customType: "om.observations.recorded",
      body: "[]",
      timestamp: 0,
      expanded: false,
      onToggle: () => {},
      payloadLoading: false,
    };
    expect(props.customType).toBe("om.observations.recorded");
    expect(props.expanded).toBe(false);
  });
});
