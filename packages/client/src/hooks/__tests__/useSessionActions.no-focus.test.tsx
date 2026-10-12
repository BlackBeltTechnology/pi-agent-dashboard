/**
 * Pin for change: openspec-board-spawn-no-focus (test-plan #E11).
 *
 * `handleSpawnSession(..., { focus: false })` records `focus: false` on the
 * pending entry; `{ focus: true }` / no opts leave no `focus` key. The
 * `spawn_session` wire message never carries `focus` (client-local intent).
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type PendingSpawnEntry, useSessionActions } from "../useSessionActions.js";

function setup() {
  const pendingSpawnsRef = { current: new Map<string, PendingSpawnEntry>() };
  const send = vi.fn();
  const deps: any = {
    selectedId: undefined,
    send,
    navigate: vi.fn(),
    setMobileOpen: vi.fn(),
    sessions: new Map(),
    setSessions: vi.fn(),
    setSessionStates: vi.fn(),
    setSpawningCwds: vi.fn(),
    setTerminals: vi.fn(),
    clearSpawningCwd: vi.fn(),
    spawnTimeoutsRef: { current: new Map() },
    pendingTerminalCwdRef: { current: null },
    terminals: new Map(),
    pendingSpawnsRef,
  };
  const { result } = renderHook(() => useSessionActions(deps));
  return { actions: result.current, pendingSpawnsRef, send };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("useSessionActions — handleSpawnSession focus opt-out", () => {
  it("records focus:false only when opted out; never sends focus on the wire", () => {
    const { actions, pendingSpawnsRef, send } = setup();
    actions.handleSpawnSession("/p", undefined, { focus: false });
    actions.handleSpawnSession("/p", undefined, { focus: true });
    actions.handleSpawnSession("/p");

    const entries = [...pendingSpawnsRef.current.values()];
    expect(entries).toHaveLength(3);
    expect(entries[0].focus).toBe(false);
    expect("focus" in entries[1]).toBe(false);
    expect("focus" in entries[2]).toBe(false);

    expect(send).toHaveBeenCalledTimes(3);
    for (const [msg] of send.mock.calls) {
      expect(msg.type).toBe("spawn_session");
      expect("focus" in msg).toBe(false);
    }
  });
});
