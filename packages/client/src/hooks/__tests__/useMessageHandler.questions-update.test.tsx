/**
 * `questions_update` feeds the question-stack store with a FULL replacement.
 * See change: add-pending-question-stack.
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { row } from "../../components/questions/__tests__/question-fixtures.js";
import { questionStore } from "../../lib/questions/question-store.js";
import { useMessageHandler } from "../useMessageHandler.js";

function setup() {
  const setters: any = new Proxy({}, { get: () => vi.fn() });
  const deps: any = {
    send: vi.fn(), navigate: vi.fn(), clearSpawningCwd: vi.fn(),
    spawningCwdsRef: { current: new Set() }, subscribedRef: { current: new Set() },
    pendingTerminalCwdRef: { current: null }, lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map() }, selectedSessionIdRef: { current: undefined },
    pendingSpawnsRef: { current: new Map() }, loadingHistoryTimersRef: { current: new Map() },
  };
  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return (m: ServerToBrowserMessage) => result.current(m);
}

afterEach(() => questionStore.reset());

describe("useMessageHandler questions_update", () => {
  it("replaces the stack (newest first), including an empty first frame and removals", () => {
    const dispatch = setup();
    dispatch({ type: "questions_update", questions: [] } as ServerToBrowserMessage);
    expect(questionStore.getSnapshot()).toMatchObject({ rows: [], loaded: true });
    dispatch({ type: "questions_update", questions: [row({ id: "a", askedAt: 1 }), row({ id: "b", askedAt: 2 })] } as ServerToBrowserMessage);
    expect(questionStore.getSnapshot().rows.map((r) => r.id)).toEqual(["b", "a"]);
    dispatch({ type: "questions_update", questions: [row({ id: "a", askedAt: 1 })] } as ServerToBrowserMessage);
    expect(questionStore.getSnapshot().rows.map((r) => r.id)).toEqual(["a"]);
  });
});
