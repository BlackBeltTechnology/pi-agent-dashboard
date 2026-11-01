/**
 * Per-project `flow.set-edit-mode` action: emits `flow:set-edit-mode` only
 * when the desired value differs from the effective one, waits for pi-flows'
 * project write and pushes one frame per session in the cwd.
 * See change: stop-flows-edit-mode-project-writes (D5; test-plan #E10, #X3, #X4).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSetEditMode, SET_EDIT_MODE_POLL } from "../server/edit-mode.js";

let home: string;
let cwd: string;
let other: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "ema-home-"));
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ema-cwd-"));
  other = fs.mkdtempSync(path.join(os.tmpdir(), "ema-other-"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const d of [home, cwd, other]) fs.rmSync(d, { recursive: true, force: true });
});

const setProject = (c: string, v: boolean) => {
  fs.mkdirSync(path.join(c, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(c, ".pi", "settings.json"), JSON.stringify({ flows: { editFlow: v } }));
};

function deps(emit: (sid: string, t: string, d: Record<string, unknown>) => boolean) {
  const broadcast = vi.fn();
  const emitEventToSession = vi.fn(emit);
  return {
    broadcast,
    emitEventToSession,
    d: {
      sessionManager: {
        listActive: () => [
          { id: "a", cwd },
          { id: "b", cwd },
          { id: "c", cwd: other },
        ],
      },
      broadcastToSubscribers: broadcast,
      emitEventToSession,
      home,
    },
  };
}
const frames = (b: ReturnType<typeof vi.fn>) => b.mock.calls.map((c) => c[0]);

describe("flow.set-edit-mode", () => {
  it("already at the desired value: no emit, one frame per session in cwd (#E10)", async () => {
    setProject(cwd, true);
    const { d, broadcast, emitEventToSession } = deps(() => true);
    await handleSetEditMode(d, "a", { enabled: true });
    expect(emitEventToSession).not.toHaveBeenCalled();
    expect(frames(broadcast)).toEqual([
      { type: "flows_edit_mode_state", sessionId: "a", enabled: true },
      { type: "flows_edit_mode_state", sessionId: "b", enabled: true },
    ]);
  });

  it("emits to the clicked session only, then pushes the landed value to siblings", async () => {
    const { d, broadcast, emitEventToSession } = deps((_sid, _t, data) => {
      setTimeout(() => setProject(cwd, data.enabled as boolean), 50); // pi-flows writes later
      return true;
    });
    await handleSetEditMode(d, "a", { enabled: true });
    expect(emitEventToSession).toHaveBeenCalledTimes(1);
    expect(emitEventToSession).toHaveBeenCalledWith("a", "flow:set-edit-mode", { enabled: true });
    expect(frames(broadcast)).toEqual([
      { type: "flows_edit_mode_state", sessionId: "a", enabled: true },
      { type: "flows_edit_mode_state", sessionId: "b", enabled: true },
    ]);
  });

  it("not delivered: no poll, frame carries error and the unchanged value (#X3)", async () => {
    const readSpy = vi.spyOn(fs, "readFileSync");
    const { d, broadcast } = deps(() => false);
    await handleSetEditMode(d, "a", { enabled: true });
    const projectReads = readSpy.mock.calls.filter((c) => String(c[0]) === path.join(cwd, ".pi", "settings.json"));
    // one pre-check + one broadcast resolve; no polling
    expect(projectReads).toHaveLength(2);
    expect(frames(broadcast)).toEqual([
      { type: "flows_edit_mode_state", sessionId: "a", enabled: false, error: "not-delivered" },
      { type: "flows_edit_mode_state", sessionId: "b", enabled: false },
    ]);
  });

  it("write never lands: 10 polls at 200 ms, then a timeout frame (#X4)", async () => {
    vi.useFakeTimers();
    const readSpy = vi.spyOn(fs, "readFileSync");
    const { d, broadcast } = deps(() => true);
    const done = handleSetEditMode(d, "a", { enabled: true });
    const projectReads = () => readSpy.mock.calls.filter((c) => String(c[0]) === path.join(cwd, ".pi", "settings.json")).length;
    expect(projectReads()).toBe(1); // pre-check
    for (let i = 1; i <= SET_EDIT_MODE_POLL.attempts; i++) {
      await vi.advanceTimersByTimeAsync(199);
      expect(projectReads()).toBe(i);
      await vi.advanceTimersByTimeAsync(1);
      // poll i landed (+1 for the final broadcast resolve after the 10th poll)
      expect(projectReads()).toBe(i < SET_EDIT_MODE_POLL.attempts ? i + 1 : i + 2);
    }
    await done;
    expect(SET_EDIT_MODE_POLL).toEqual({ attempts: 10, intervalMs: 200 });
    expect(frames(broadcast)).toEqual([
      { type: "flows_edit_mode_state", sessionId: "a", enabled: false, error: "timeout" },
      { type: "flows_edit_mode_state", sessionId: "b", enabled: false },
    ]);
  });

  it("non-boolean or unknown session: nothing emitted, nothing broadcast", async () => {
    const { d, broadcast, emitEventToSession } = deps(() => true);
    await handleSetEditMode(d, "a", { enabled: "yes" });
    await handleSetEditMode(d, "ghost", { enabled: true });
    expect(emitEventToSession).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });
});
