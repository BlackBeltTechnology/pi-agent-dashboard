/**
 * Client path of `plugin_event_carry` — test-plan F1, F2 for change:
 * move-subagents-to-plugin (D2). Drives the REAL hook with real state setters.
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { createInitialState, type SessionState } from "../../lib/chat/event-reducer.js";
import { HISTORY_GAP_ROW_ID, type HistoryGapState } from "../../lib/chat/history-gap.js";
import { type MessageHandlerSetters, useMessageHandler } from "../useMessageHandler.js";

const SID = "s1";
const ev = (eventType: string, data: Record<string, unknown>): DashboardEvent => ({ eventType, timestamp: 1, data });
const userMsg = (text: string): DashboardEvent =>
  ev("message_start", { message: { role: "user", content: [{ type: "text", text }] } });

function mount() {
  let latest!: { handle: (m: ServerToBrowserMessage) => void; states: Map<string, SessionState>; gaps: Map<string, HistoryGapState>; maxSeqs: Map<string, number> };
  renderHook(() => {
    const [states, setSessionStates] = useState(new Map<string, SessionState>([[SID, createInitialState()]]));
    const [gaps, setHistoryGaps] = useState(new Map<string, HistoryGapState>());
    const maxSeqMapRef = useRef(new Map<string, number>());
    const setters = new Proxy({ setSessionStates, setHistoryGaps }, { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : vi.fn()) }) as unknown as MessageHandlerSetters;
    const deps: any = {
      send: vi.fn(), navigate: vi.fn(), clearSpawningCwd: vi.fn(),
      spawningCwdsRef: useRef(new Set<string>()), subscribedRef: useRef(new Set<string>()),
      pendingTerminalCwdRef: useRef(null), lastCreatedTerminalIdRef: useRef(null),
      maxSeqMapRef, selectedSessionIdRef: useRef(SID), pendingSpawnsRef: useRef(new Map()),
      loadingHistoryTimersRef: useRef(new Map()), replayInFlightTimersRef: useRef(new Map()),
    };
    latest = { handle: useMessageHandler(setters, deps), states, gaps, maxSeqs: maxSeqMapRef.current };
    return null;
  });
  return { get: () => latest, fire: (m: ServerToBrowserMessage) => act(() => latest.handle(m)) };
}

const windowMsg = { type: "history_window", sessionId: SID, headMaxSeq: 20, tailMinSeq: 12040, gapCount: 12019, oldestGapSeq: 21 } as ServerToBrowserMessage;
const headTailReplay = (): ServerToBrowserMessage => ({
  type: "event_replay",
  sessionId: SID,
  isLast: true,
  events: [
    ...Array.from({ length: 20 }, (_, i) => ({ seq: i + 1, event: userMsg(`head ${i}`) })),
    ...Array.from({ length: 3 }, (_, i) => ({ seq: 12040 + i, event: userMsg(`tail ${i}`) })),
  ],
}) as ServerToBrowserMessage;
const carryOf = (events: Array<{ seq: number; event: DashboardEvent }>): ServerToBrowserMessage =>
  ({ type: "plugin_event_carry", sessionId: SID, pluginId: "subagents", events }) as ServerToBrowserMessage;

const entry = (index: number) => ev("subagent_entry", { agentId: "a1", index, entry: { kind: "text", text: `s${index}` } });
const carry90 = () => carryOf([
  { seq: 9000, event: ev("subagent_created", { id: "a1", type: "t", description: "d" }) },
  ...Array.from({ length: 89 }, (_, i) => ({ seq: 9001 + i, event: entry(i) })),
]);

describe("plugin_event_carry client path", () => {
  it("F1: a 90-event carry leaves the gap divider, chat rows and maxSeq untouched", () => {
    const h = mount();
    h.fire(windowMsg);
    h.fire(headTailReplay());
    const rows = h.get().states.get(SID)!.messages.length;
    const maxSeq = h.get().maxSeqs.get(SID);
    h.fire(carry90());
    const state = h.get().states.get(SID)!;
    expect(state.messages).toHaveLength(rows);
    expect(state.messages.some((m) => m.id === HISTORY_GAP_ROW_ID)).toBe(true);
    expect(h.get().gaps.get(SID)!.gapCount).toBe(12019);
    expect(h.get().maxSeqs.get(SID)).toBe(maxSeq);
    expect(state.subagents.get("a1")?.entries?.length).toBe(89);
  });

  it("carry before a head-tail replay survives the replay's reset", () => {
    const h = mount();
    h.fire(windowMsg);
    h.fire(carry90());
    h.fire(headTailReplay());
    expect(h.get().states.get(SID)!.subagents.get("a1")?.entries?.length).toBe(89);
  });

  it("F2: backfilling a range that contains a carried seq leaves the timeline with index 5 once", () => {
    const h = mount();
    h.fire(windowMsg);
    h.fire(headTailReplay());
    h.fire(carry90());
    h.fire({
      type: "history_backfill_result",
      sessionId: SID,
      events: [{ seq: 9006, event: entry(5) }, { seq: 9007, event: userMsg("mid") }],
      servedFrom: 9006,
      servedTo: 9007,
      remainingGapCount: 100,
    } as ServerToBrowserMessage);
    const entries = h.get().states.get(SID)!.subagents.get("a1")!.entries!;
    expect(entries.filter((e) => e !== undefined)).toHaveLength(89);
    expect(entries[5]).toEqual({ kind: "text", text: "s5" });
  });

  it("a carry for a plugin with no slice changes nothing", () => {
    const h = mount();
    h.fire(windowMsg);
    h.fire(headTailReplay());
    const before = h.get().states.get(SID)!;
    h.fire({ type: "plugin_event_carry", sessionId: SID, pluginId: "nope", events: [{ seq: 9000, event: ev("subagent_created", { id: "x" }) }] } as ServerToBrowserMessage);
    expect(h.get().states.get(SID)).toBe(before);
  });
});
