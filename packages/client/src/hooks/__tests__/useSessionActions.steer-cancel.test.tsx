/**
 * Held-steer cancel senders put the bridge mutation on the wire, keyed by the
 * selected session. See change: bridge-owned-cancellable-steer (test-plan #E32).
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSessionActions } from "../useSessionActions.js";

function setup(selectedId: string | undefined) {
  const send = vi.fn();
  const deps: any = {
    selectedId,
    send,
    navigate: vi.fn(),
    setMobileOpen: vi.fn(),
    sessions: new Map(),
    setSessions: vi.fn(),
    setSessionStates: vi.fn(),
    sessionStatesRef: { current: new Map() },
    setSpawningCwds: vi.fn(),
    setTerminals: vi.fn(),
    clearSpawningCwd: vi.fn(),
    spawnTimeoutsRef: { current: new Map() },
    pendingTerminalCwdRef: { current: null },
    terminals: new Map(),
    pendingSpawnsRef: { current: new Map() },
  };
  const { result } = renderHook(() => useSessionActions(deps));
  return { actions: result.current, send };
}

describe("useSessionActions — steer cancel", () => {
  it("E32: remove / clear send remove_steering_entry and clear_steering_entries for the selected session", () => {
    const { actions, send } = setup("S1");
    actions.removeSteeringEntry("n:1");
    actions.clearSteeringEntries();
    expect(send.mock.calls).toEqual([
      [{ type: "remove_steering_entry", sessionId: "S1", id: "n:1" }],
      [{ type: "clear_steering_entries", sessionId: "S1" }],
    ]);
  });

  it("no selected session → nothing is sent", () => {
    const { actions, send } = setup(undefined);
    actions.removeSteeringEntry("n:1");
    actions.clearSteeringEntries();
    expect(send).not.toHaveBeenCalled();
  });
});
