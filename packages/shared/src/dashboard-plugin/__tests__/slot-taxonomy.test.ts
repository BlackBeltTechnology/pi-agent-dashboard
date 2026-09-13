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
import { SLOT_DEFINITIONS, type SlotId } from "../slot-types.js";
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
