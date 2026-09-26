/**
 * Forwarded-reload watch (design D5): in-flight refusal, feedback deadline,
 * late-feedback drop, retry, fan-out. Fake `DispatchReloadContext` + fake timers.
 * Scenario ids reference openspec/changes/fix-terminal-session-dashboard-reload/test-plan.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetForwardedReloads,
  type DispatchReloadContext,
  dispatchReload,
  FORWARDED_RELOAD_DEADLINE_MS,
  isTerminalReloadFeedback,
  routeReloadFeedback,
  settleForwardedReload,
} from "../rpc-keeper/dispatch-reload.js";

function terminalCtx(opts: { connected?: (sid: string) => boolean } = {}) {
  const feedback: Array<{ sessionId: string; command: string; status: string; message?: string }> = [];
  const sendToSession = vi.fn(() => true);
  const ctx: DispatchReloadContext = {
    headlessPidRegistry: { getPid: () => undefined, listSessions: () => [] },
    getSession: () => ({ status: "idle" }),
    isSessionConnected: opts.connected ?? (() => true),
    sendToSession,
    respawn: vi.fn(async () => {}),
    emitCommandFeedback: (sessionId, command, status, message) =>
      feedback.push({ sessionId, command, status, message }),
  };
  return { ctx, feedback, sendToSession };
}

beforeEach(() => {
  vi.useFakeTimers();
  _resetForwardedReloads();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  _resetForwardedReloads();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("forwarded-reload watch", () => {
  it("E8: a second reload while the first is in flight is refused and not forwarded", async () => {
    const h = terminalCtx();
    expect(await dispatchReload("S1", h.ctx)).toBe("forwarded");
    expect(await dispatchReload("S1", h.ctx)).toBe("refused");
    expect(h.sendToSession).toHaveBeenCalledTimes(1);
    expect(h.feedback).toHaveLength(1);
    expect(h.feedback[0]).toMatchObject({ command: "/reload", status: "error" });
    expect(h.feedback[0].message).toMatch(/already in progress/);
  });

  it("E9: the watch survives unregister/re-register and is settled by the bridge feedback", async () => {
    let connected = true;
    const h = terminalCtx({ connected: () => connected });
    expect(await dispatchReload("S1", h.ctx)).toBe("forwarded");
    await vi.advanceTimersByTimeAsync(1_000);
    connected = false; // session_unregister → ended
    await vi.advanceTimersByTimeAsync(1_000);
    connected = true; // B2 re-registers
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settleForwardedReload("S1")).toBe("settled");
    await vi.advanceTimersByTimeAsync(77_000);
    expect(h.feedback).toEqual([]);
    // Watch map empty: a new reload is forwarded, not refused.
    expect(await dispatchReload("S1", h.ctx)).toBe("forwarded");
  });

  it("X8: deadline boundary — nothing at 74 999 ms, one error by 75 001 ms, watch removed", async () => {
    const h = terminalCtx();
    await dispatchReload("S1", h.ctx);
    await vi.advanceTimersByTimeAsync(FORWARDED_RELOAD_DEADLINE_MS - 1);
    expect(h.feedback).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    expect(h.feedback).toHaveLength(1);
    expect(h.feedback[0]).toMatchObject({ command: "/reload", status: "error" });
    expect(h.feedback[0].message).toMatch(/did not report completion/);
    expect(await dispatchReload("S1", h.ctx)).toBe("forwarded");
  });

  it("X9: late bridge feedback after expiry is dropped once, then the mark is cleared", async () => {
    const h = terminalCtx();
    await dispatchReload("S1", h.ctx);
    await vi.advanceTimersByTimeAsync(80_000);
    expect(settleForwardedReload("S1")).toBe("drop");
    expect(settleForwardedReload("S1")).toBe("none");
  });

  it("X10: a retry after expiry is forwarded and its feedback is not swallowed", async () => {
    const h = terminalCtx();
    await dispatchReload("S1", h.ctx);
    await vi.advanceTimersByTimeAsync(76_000); // expired at 75 s
    expect(await dispatchReload("S1", h.ctx)).toBe("forwarded");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(settleForwardedReload("S1")).toBe("settled");
    await vi.advanceTimersByTimeAsync(82_000); // to 160 s
    expect(h.feedback.filter((f) => /did not report completion/.test(f.message ?? ""))).toHaveLength(1);
    expect(h.sendToSession).toHaveBeenCalledTimes(2);
  });

  it("X12: fan-out with one in-flight session → refused + one error; the other forwarded; count excludes the refusal", async () => {
    const h = terminalCtx();
    await dispatchReload("BUSY", h.ctx);
    h.sendToSession.mockClear();
    const outcomes: string[] = [];
    let reloaded = 0;
    for (const sid of ["BUSY", "IDLE"]) {
      const outcome = await dispatchReload(sid, h.ctx);
      outcomes.push(outcome);
      // Same counting rule as `/api/resources/reload`.
      if (outcome !== "error" && outcome !== "refused") reloaded++;
    }
    expect(outcomes).toEqual(["refused", "forwarded"]);
    expect(reloaded).toBe(1);
    expect(h.sendToSession).toHaveBeenCalledTimes(1);
    expect(h.sendToSession).toHaveBeenCalledWith("IDLE", "/reload");
    expect(h.feedback.filter((f) => f.sessionId === "BUSY" && f.status === "error")).toHaveLength(1);
  });

  it("X11: feedback inside a replay-skip window is persisted + broadcast once and settles the watch", async () => {
    const h = terminalCtx();
    await dispatchReload("S1", h.ctx);
    const persistAndBroadcast = vi.fn();
    const replayed = routeReloadFeedback(
      "S1",
      { eventType: "user_message", data: { text: "hi" } },
      { inReplaySkipWindow: true, persistAndBroadcast },
    );
    const feedback = routeReloadFeedback(
      "S1",
      { eventType: "command_feedback", data: { command: "/reload", status: "completed" } },
      { inReplaySkipWindow: true, persistAndBroadcast },
    );
    // Other replayed events keep the existing skip path.
    expect(replayed).toBe("continue");
    expect(feedback).toBe("handled");
    expect(persistAndBroadcast).toHaveBeenCalledTimes(1);
    expect(await dispatchReload("S1", h.ctx)).toBe("forwarded"); // watch cleared
  });

  it("routes a live terminal feedback through, and drops a late one after expiry", async () => {
    const h = terminalCtx();
    const persistAndBroadcast = vi.fn();
    const ev = { eventType: "command_feedback", data: { command: "/reload", status: "completed" } };
    await dispatchReload("S1", h.ctx);
    expect(routeReloadFeedback("S1", ev, { inReplaySkipWindow: false, persistAndBroadcast })).toBe("continue");
    await dispatchReload("S1", h.ctx);
    await vi.advanceTimersByTimeAsync(FORWARDED_RELOAD_DEADLINE_MS + 1);
    expect(routeReloadFeedback("S1", ev, { inReplaySkipWindow: false, persistAndBroadcast })).toBe("handled");
    expect(persistAndBroadcast).not.toHaveBeenCalled();
  });

  it("classifies terminal /reload feedback only", () => {
    expect(isTerminalReloadFeedback({ command: "/reload", status: "completed" })).toBe(true);
    expect(isTerminalReloadFeedback({ command: "/reload", status: "error" })).toBe(true);
    expect(isTerminalReloadFeedback({ command: "/reload", status: "started" })).toBe(false);
    expect(isTerminalReloadFeedback({ command: "/compact", status: "completed" })).toBe(false);
    expect(isTerminalReloadFeedback(undefined)).toBe(false);
  });
});
