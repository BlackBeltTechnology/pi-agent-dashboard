/**
 * Pin for change: openspec-board-spawn-no-focus (test-plan #E11).
 *
 * `handleSpawnSession(..., { focus: false })` records `focus: false` on the
 * pending entry; `{ focus: true }` / no opts leave no `focus` key. The
 * `spawn_session` wire message never carries `focus` (client-local intent).
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unregisterUnsaved, unsavedKey, unsavedStore } from "../../components/editor-pane/unsaved-store.js";
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
  return { actions: result.current, pendingSpawnsRef, send, navigate: deps.navigate as ReturnType<typeof vi.fn>, setMobileOpen: deps.setMobileOpen as ReturnType<typeof vi.fn> };
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

// fix-file-link-editor-routing 4.7 (S48): the sidebar session switch asks about unsaved built-in buffers.
describe("useSessionActions — handleSelect unsaved guard (S48)", () => {
  const keys = [unsavedKey("sA", "a.md"), unsavedKey("folder:/proj", "b.md")];
  afterEach(() => {
    for (const k of keys) unregisterUnsaved(k);
  });
  const dirty = (key: string, dirty = true) => {
    const e = { label: "x.md", dirty, save: vi.fn(async () => true), discard: vi.fn() };
    unsavedStore.registerUnsaved(key, e);
    return e;
  };

  it.each([
    ["session pane", keys[0]],
    ["folder pane", keys[1]],
  ])("%s: dirty ⇒ no navigation until Discard; Cancel never navigates", async (_n, key) => {
    dirty(key);
    const { actions, navigate, setMobileOpen } = setup();
    actions.handleSelect("sB");
    expect(navigate).not.toHaveBeenCalled();
    unsavedStore.resolveDialog("cancel");
    await vi.advanceTimersByTimeAsync(0);
    expect(navigate).not.toHaveBeenCalled();
    actions.handleSelect("sB");
    unsavedStore.resolveDialog("discard");
    await vi.advanceTimersByTimeAsync(0);
    expect(navigate).toHaveBeenCalledWith("/session/sB");
    expect(setMobileOpen).toHaveBeenCalledWith(false);
  });

  it("dirty + Save ok navigates; a failed Save does not", async () => {
    const e = dirty(keys[0]);
    const { actions, navigate } = setup();
    actions.handleSelect("sB");
    unsavedStore.resolveDialog("save");
    await vi.advanceTimersByTimeAsync(0);
    expect(navigate).toHaveBeenCalledTimes(1);
    e.save.mockResolvedValue(false);
    actions.handleSelect("sC");
    unsavedStore.resolveDialog("save");
    await vi.advanceTimersByTimeAsync(0);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("clean ⇒ navigates immediately with no dialog", () => {
    dirty(keys[0], false);
    const { actions, navigate } = setup();
    actions.handleSelect("sB");
    expect(navigate).toHaveBeenCalledWith("/session/sB");
    expect(unsavedStore.getState().dialog).toBeNull();
  });
});
