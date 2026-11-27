/**
 * Test-plan #E38 (dashboard-plugin-loader: finalizer by owned type).
 *
 * A session event without a `toolName` (`subagent_completed`) is settled by the finalizer of the
 * plugin that OWNS the type — core names no tool. Plugin enabled: its `onSessionEvent` runs.
 * Plugin disabled: the type falls into the absent-owner group row and no plugin state slot appears.
 *
 * See change: move-subagents-to-plugin (D8, task 9.10).
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disableSubagentsPlugin, registerSubagentsReducerSlice, SUBAGENTS_PLUGIN_ID, toolRowFinalizers } from "../../test-support/subagents-reducer-slice.js";
import { createInitialState, reduceEvent } from "../chat/event-reducer.js";

const completed: DashboardEvent = {
  eventType: "subagent_completed",
  timestamp: 10,
  data: { id: "a1", result: "done" },
};

describe("finalizer lookup by owned event type (E38)", () => {
  beforeEach(() => registerSubagentsReducerSlice());
  afterEach(() => {
    vi.restoreAllMocks();
    registerSubagentsReducerSlice();
  });

  it("plugin enabled: the owner's onSessionEvent is called and writes its slot", () => {
    const spy = vi.spyOn(toolRowFinalizers[0], "onSessionEvent");
    const next = reduceEvent(createInitialState(), completed);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toMatchObject({ eventType: "subagent_completed" });
    expect(next.pluginState.has(SUBAGENTS_PLUGIN_ID)).toBe(true);
    expect(next.messages.filter((m) => m.ownedGroup)).toHaveLength(0);
  });

  it("plugin disabled: absent-owner group row, finalizer not called, no slot change", () => {
    const spy = vi.spyOn(toolRowFinalizers[0], "onSessionEvent");
    disableSubagentsPlugin();
    const before = createInitialState();
    const next = reduceEvent(before, completed);
    expect(spy).not.toHaveBeenCalled();
    expect(next.pluginState).toBe(before.pluginState);
    expect(next.pluginState.size).toBe(0);
    const groups = next.messages.filter((m) => m.role === "rawEvent" && m.ownedGroup);
    expect(groups.map((m) => [m.toolName, m.ownedGroup?.ownerId])).toEqual([["subagent_completed", "subagents"]]);
  });
});
