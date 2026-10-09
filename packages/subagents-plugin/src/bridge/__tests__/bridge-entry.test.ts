/**
 * subagents-plugin bridge entry declares the step + delta streams (test-plan #E26).
 * See change: add-plugin-bridge-contributions.
 */

import {
  BRIDGE_READY_CHANNEL,
  REGISTER_EVENT_FORWARD_CHANNEL,
} from "@blackbelt-technology/pi-dashboard-shared/event-forward-declaration.js";
import { describe, expect, it } from "vitest";
import activate, { SUBAGENTS_FORWARD_DECLARATION } from "../index.js";

function fakePi() {
  const emitted: Array<{ channel: string; data: unknown }> = [];
  const handlers = new Map<string, Array<(d: unknown) => void>>();
  return {
    emitted,
    events: {
      emit: (channel: string, data: unknown) => {
        emitted.push({ channel, data });
        for (const h of handlers.get(channel) ?? []) h(data);
      },
      on: (channel: string, h: (d: unknown) => void) => {
        handlers.set(channel, [...(handlers.get(channel) ?? []), h]);
      },
    },
  };
}

describe("subagents-plugin bridge entry", () => {
  it("declares entry + delta streams on activate and on every bridge-ready", () => {
    const pi = fakePi();
    activate(pi);
    pi.events.emit(BRIDGE_READY_CHANNEL, {});
    pi.events.emit(BRIDGE_READY_CHANNEL, {});
    const decls = pi.emitted.filter((e) => e.channel === REGISTER_EVENT_FORWARD_CHANNEL);
    expect(decls).toHaveLength(3);
    for (const d of decls) {
      expect(d.data).toEqual({
        pluginId: "subagents",
        channels: {
          "subagents:entry": { as: "subagent_entry", delivery: "stream", key: "agentId" },
          "subagents:delta": { as: "subagent_delta", delivery: "stream", key: "agentId" },
        },
      });
    }
    expect(SUBAGENTS_FORWARD_DECLARATION.pluginId).toBe("subagents");
  });

  it("accepts ctx wrapped as { pi } and is a no-op without an event bus", () => {
    const pi = fakePi();
    activate({ pi });
    expect(pi.emitted.some((e) => e.channel === REGISTER_EVENT_FORWARD_CHANNEL)).toBe(true);
    expect(() => activate({})).not.toThrow();
  });
});
