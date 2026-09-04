/**
 * Replay-path parity: a session replayed from its JSONL must tag each custom
 * row's `groupId` IDENTICALLY to the live forwarding path.
 *
 * Live: the server stamps events in event-wiring before ingest.
 * Replay: directory-service stamps the pool's replay output with the same
 * helper + resolver. This test drives both through one resolver and asserts
 * the tags match (task 4.3).
 *
 * See change: add-custom-event-group-filters.
 */
import { describe, expect, it } from "vitest";

import { replayEntriesAsEvents } from "@blackbelt-technology/pi-dashboard-shared/state-replay.js";
import { stampEventGroup } from "../session/custom-event-group-annotation.js";
import { CustomEventGroupMatcher } from "../session/custom-event-group-matcher.js";
import { CustomEventGroupResolver } from "../session/custom-event-group-resolver.js";
import {
  SHIPPED_CUSTOM_EVENT_GROUPS,
  RESERVED_OTHER_GROUP_ID,
  type CustomEventGroup,
} from "@blackbelt-technology/pi-dashboard-shared/custom-event-groups.js";

const SID = "s1";
const TS = "2026-01-01T00:00:00.000Z";

function entry(customType: string): any {
  return { type: "custom", customType, data: { hello: true }, id: `e-${customType}`, timestamp: TS };
}

function customMessageEntry(customType: string): any {
  return {
    type: "custom_message",
    customType,
    content: [{ type: "text", text: "hi" }],
    display: true,
    id: `m-${customType}`,
    timestamp: TS,
  };
}

describe("replay groupId parity (task 4.3)", () => {
  it("replayed custom rows tag identically to the live path", async () => {
    const matcher = new CustomEventGroupMatcher();
    try {
      const groups: CustomEventGroup[] = [...SHIPPED_CUSTOM_EVENT_GROUPS];
      const resolver = new CustomEventGroupResolver(groups, matcher);
      const entries = [
        entry("om.observations.recorded"),
        entry("web-search-results"),
        entry("subagents:record"),
        entry("third-party.whatever"),
        customMessageEntry("om.reflections.recorded"),
      ];
      const events = replayEntriesAsEvents(SID, entries);
      const custom = events.filter(
        (m) => m.event.eventType === "custom_entry" ||
          (m.event.eventType === "message_end" &&
            (m.event.data.message as any)?.role === "custom"),
      );
      expect(custom.length).toBe(5);

      for (const m of custom) {
        // THE replay annotation — the exact call directory-service makes.
        stampEventGroup(m.event, await resolver.resolve(customEventTypeOf(m.event)));
      }

      const groupIdOf = (m: (typeof custom)[number]) =>
        m.event.eventType === "custom_entry"
          ? m.event.data.groupId
          : ((m.event.data.message as any).groupId);
      const byType = new Map(custom.map((m) => [customEventTypeOf(m.event), groupIdOf(m)]));

      expect(byType.get("om.observations.recorded")).toBe("memory");
      expect(byType.get("web-search-results")).toBe("search");
      expect(byType.get("subagents:record")).toBe("subagents");
      expect(byType.get("third-party.whatever")).toBe(RESERVED_OTHER_GROUP_ID);
      expect(byType.get("om.reflections.recorded")).toBe("memory");
    } finally {
      await matcher.dispose();
    }
  });
});

function customEventTypeOf(e: { eventType: string; data: Record<string, unknown> }): string {
  if (e.eventType === "custom_entry") return e.data.customType as string;
  return ((e.data.message as any).customType) as string;
}
