/**
 * Tests for custom-event-group event annotation (server-side stamping).
 *
 * See change: add-custom-event-group-filters (tasks 4.1–4.3).
 */
import { describe, expect, it } from "vitest";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

import {
  isGroupableCustomEvent,
  stampEventGroup,
  customEventTypeOfEvent,
} from "../session/custom-event-group-annotation.js";

function event(eventType: string, data: Record<string, unknown>): DashboardEvent {
  return { eventType, timestamp: 1_700_000_000_000, data };
}

describe("isGroupableCustomEvent", () => {
  it("accepts custom_entry events", () => {
    expect(isGroupableCustomEvent(event("custom_entry", { customType: "om.x" }))).toBe(true);
  });

  it("accepts message_end events carrying a custom-role message", () => {
    expect(
      isGroupableCustomEvent(event("message_end", { message: { role: "custom", customType: "om.x" } })),
    ).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isGroupableCustomEvent(event("message_end", { message: { role: "assistant" } }))).toBe(false);
    expect(isGroupableCustomEvent(event("tool_execution_start", { toolName: "bash" }))).toBe(false);
    expect(isGroupableCustomEvent(event("agent_end", {}))).toBe(false);
  });
});

describe("customEventTypeOfEvent", () => {
  it("reads customType from both event shapes", () => {
    expect(customEventTypeOfEvent(event("custom_entry", { customType: "om.x" }))).toBe("om.x");
    expect(
      customEventTypeOfEvent(event("message_end", { message: { role: "custom", customType: "web-search-results" } })),
    ).toBe("web-search-results");
  });
});

describe("stampEventGroup", () => {
  it("stamps groupId on a custom_entry event", () => {
    const e = event("custom_entry", { customType: "om.observations.recorded" });
    stampEventGroup(e, "memory");
    expect(e.data.groupId).toBe("memory");
  });

  it("stamps groupId on the message of a custom message_end event", () => {
    const e = event("message_end", { message: { role: "custom", customType: "om.x" } });
    stampEventGroup(e, "memory");
    expect((e.data.message as Record<string, unknown>).groupId).toBe("memory");
  });

  it("never stamps when the group is undefined (flow-event exclusion)", () => {
    const e = event("custom_entry", { customType: "flow-event" });
    stampEventGroup(e, undefined);
    expect("groupId" in e.data).toBe(false);
  });
});
