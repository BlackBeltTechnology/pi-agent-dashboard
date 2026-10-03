/**
 * In-process terminal-hosted reload: requesting side (B1), handler, reloaded
 * side (B2) and the bridge re-entry guard. Mocked `pi`, vitest fake timers.
 * Scenario ids reference openspec/changes/fix-terminal-session-dashboard-reload/test-plan.md.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCommandHandler } from "../command-handler.js";
import {
  consumePendingReloadOnSessionStart,
  createTerminalReload,
  FINISH_TIMEOUT_MS,
  isBridgeReentry,
  type PendingReloadSlot,
  readPendingReload,
  releaseBridgeOwnerOnShutdown,
  START_TIMEOUT_MS,
  writePendingReload,
} from "../terminal-reload.js";

const SID = "sess-1";

function setup(opts: { send?: (text: string, o: any) => void } = {}) {
  let n = 0;
  const sendUserMessage = vi.fn(opts.send ?? (() => {}));
  const tr = createTerminalReload({
    pi: { sendUserMessage },
    getSessionId: () => SID,
    mintToken: () => `tok-${++n}`,
  });
  return { tr, sendUserMessage };
}

/**
 * Run the handler the way pi does (not awaited by the dispatcher). A rejection
 * would be a test bug, so surface it instead of discarding it.
 */
function fire(p: Promise<void>): void {
  void p.catch((err) => console.error("handler rejected", err));
}

function mockCtx(reloadImpl: () => Promise<void> = async () => {}) {
  return { reload: vi.fn(reloadImpl), ui: { notify: vi.fn() } };
}

function reloadFeedback(sink: ReturnType<typeof vi.fn>) {
  return sink.mock.calls
    .map((c) => c[0])
    .filter((m: any) => m?.event?.eventType === "command_feedback" && m.event.data.command === "/reload")
    .map((m: any) => m.event.data);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  writePendingReload(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  writePendingReload(undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("requesting side (B1)", () => {
  it("E2: no pi version gate — reload self-dispatches immediately and arms the slot", async () => {
    // pi >= 1.0.0 is the single supported pi; the 0.84.2 gate is retired.
    // See change: update-pi-core-1-0-adopt-apis.
    const { tr, sendUserMessage } = setup();
    const p = tr.reload();
    expect(sendUserMessage).toHaveBeenCalledWith("/__dashboard_reload tok-1", { expandPromptTemplates: true });
    expect(readPendingReload()).toMatchObject({ token: "tok-1", sessionId: SID, state: "armed" });
    // Settle the dispatch (no handler runs) so the promise is observed, not discarded.
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS);
    await expect(p).resolves.toMatchObject({ ok: false });
  });

  it.each([
    { name: "same session, fresh", slot: { sessionId: SID, ageMs: 10_000 }, refused: true },
    { name: "other session", slot: { sessionId: "other", ageMs: 10_000 }, refused: false },
    { name: "same session, 61 s old", slot: { sessionId: SID, ageMs: 61_000 }, refused: false },
  ])("E4: in-flight table — $name", async ({ slot, refused }) => {
    const existing: PendingReloadSlot = {
      token: "old",
      sessionId: slot.sessionId,
      state: "started",
      armedAt: Date.now() - slot.ageMs,
    };
    writePendingReload(existing);
    const { tr, sendUserMessage } = setup();
    const p = tr.reload();
    if (refused) {
      const outcome = await p;
      expect(outcome).toEqual({ ok: false, reason: expect.stringContaining("already in progress") });
      expect(sendUserMessage).not.toHaveBeenCalled();
      expect(readPendingReload()).toEqual(existing);
    } else {
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      expect(sendUserMessage).toHaveBeenCalledWith("/__dashboard_reload tok-1", { expandPromptTemplates: true });
      expect(readPendingReload()).toMatchObject({ token: "tok-1", sessionId: SID, state: "armed" });
    }
  });

  it("X1: handler never starts → 'did not run' at 5 s, slot deleted, late handler does not reload", async () => {
    const { tr } = setup();
    const p = tr.reload();
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS);
    const outcome = await p;
    expect(outcome).toEqual({ ok: false, reason: expect.stringContaining("did not run") });
    expect(readPendingReload()).toBeUndefined();

    const ctx = mockCtx();
    await tr.handleReloadCommand("tok-1", ctx);
    expect(ctx.reload).not.toHaveBeenCalled();
  });

  it("X2: handler started at 4999 ms → no start timeout at 5001 ms", async () => {
    const { tr } = setup();
    const outcome = tr.reload();
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS - 1);
    const ctx = mockCtx(() => new Promise<void>(() => {}));
    fire(tr.handleReloadCommand("tok-1", ctx));
    await vi.advanceTimersByTimeAsync(2);
    const state = await Promise.race([outcome.then(() => "settled"), Promise.resolve("pending")]);
    expect(state).toBe("pending");
    expect(readPendingReload()?.state).toBe("started");
  });

  it("X3: ctx.reload resolves without session_start → 'pi did not reload', slot deleted", async () => {
    const { tr } = setup({
      send: () => {
        fire(tr.handleReloadCommand("tok-1", mockCtx()));
      },
    });
    const outcome = await tr.reload();
    expect(outcome).toEqual({ ok: false, reason: expect.stringContaining("pi did not reload") });
    expect(readPendingReload()).toBeUndefined();
  });

  it("X4: ctx.reload never settles → timeout at 60 s, slot expired, B2 emits nothing", async () => {
    const { tr } = setup({
      send: () => {
        fire(tr.handleReloadCommand("tok-1", mockCtx(() => new Promise<void>(() => {}))));
      },
    });
    const p = tr.reload();
    await vi.advanceTimersByTimeAsync(FINISH_TIMEOUT_MS);
    const outcome = await p;
    expect(outcome).toEqual({ ok: false, reason: expect.stringContaining("60 s") });
    expect(readPendingReload()?.state).toBe("expired");
    expect(consumePendingReloadOnSessionStart("reload", SID)).toBe(false);
  });

  it("X5: slow success (B2 delivered at 59 s, reload resolves at 61 s) → handedOff, one feedback total", async () => {
    let resolveReload!: () => void;
    const { tr } = setup({
      send: () => {
        fire(tr.handleReloadCommand("tok-1", mockCtx(() => new Promise<void>((r) => (resolveReload = r)))));
      },
    });
    const sink = vi.fn();
    const handler = createCommandHandler({} as any, SID, { eventSink: sink, reload: tr.reload });
    const handled = handler.handle({ type: "send_prompt", sessionId: SID, text: "/reload" } as any);

    await vi.advanceTimersByTimeAsync(59_000);
    const b2Emits = consumePendingReloadOnSessionStart("reload", SID) ? 1 : 0;
    await vi.advanceTimersByTimeAsync(2_000); // through the 60 s finish timer
    resolveReload();
    await handled;

    expect(reloadFeedback(sink)).toEqual([]);
    expect(b2Emits + reloadFeedback(sink).length).toBe(1);
  });

  it("happy path: B2 delivers before ctx.reload resolves → handedOff, slot cleared", async () => {
    const { tr } = setup({
      send: () => {
        fire(tr.handleReloadCommand(
          "tok-1",
          mockCtx(async () => {
            expect(consumePendingReloadOnSessionStart("reload", SID)).toBe(true);
          }),
        ));
      },
    });
    expect(await tr.reload()).toEqual({ ok: true, handedOff: true });
    expect(readPendingReload()).toBeUndefined();
  });

  it("a slot replaced before ctx.reload settles is not a handoff → error, foreign slot untouched", async () => {
    const foreign: PendingReloadSlot = { token: "other", sessionId: "other-session", state: "armed", armedAt: Date.now() };
    const { tr } = setup({
      send: () => {
        fire(
          tr.handleReloadCommand(
            "tok-1",
            mockCtx(async () => {
              writePendingReload({ ...foreign });
            }),
          ),
        );
      },
    });
    const outcome = await tr.reload();
    expect(outcome).toEqual({ ok: false, reason: expect.stringContaining("superseded") });
    expect(readPendingReload()).toEqual(foreign);
  });

  it("a slot replaced before the handler starts → superseded error at the 5 s start deadline", async () => {
    const { tr } = setup();
    const outcome = tr.reload();
    writePendingReload({ token: "other", sessionId: "other-session", state: "armed", armedAt: Date.now() });
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS);
    expect(await outcome).toEqual({ ok: false, reason: expect.stringContaining("superseded") });
    expect(readPendingReload()?.token).toBe("other");
  });

  it("X6: sendUserMessage throws synchronously → one error feedback, nothing escapes, slot deleted", async () => {
    const { tr } = setup({
      send: () => {
        throw new Error("stale");
      },
    });
    const sink = vi.fn();
    const handler = createCommandHandler({} as any, SID, { eventSink: sink, reload: tr.reload });
    await expect(
      handler.handle({ type: "send_prompt", sessionId: SID, text: "/reload" } as any),
    ).resolves.not.toThrow();
    const fb = reloadFeedback(sink);
    expect(fb).toHaveLength(1);
    expect(fb[0]).toMatchObject({ status: "error", message: expect.stringContaining("stale") });
    expect(readPendingReload()).toBeUndefined();
  });

  it("X7: ctx.reload rejects → 'pi did not reload', slot deleted, no completed", async () => {
    const { tr } = setup({
      send: () => {
        fire(tr.handleReloadCommand(
          "tok-1",
          mockCtx(async () => {
            throw new Error("boom");
          }),
        ));
      },
    });
    const outcome = await tr.reload();
    expect(outcome).toEqual({ ok: false, reason: expect.stringContaining("pi did not reload") });
    expect((outcome as any).reason).toContain("boom");
    expect(readPendingReload()).toBeUndefined();
  });
});

describe("__dashboard_reload handler (E3)", () => {
  const armed = (token: string, state: PendingReloadSlot["state"], ageMs = 0): PendingReloadSlot => ({
    token,
    sessionId: SID,
    state,
    armedAt: Date.now() - ageMs,
  });

  it.each([
    { name: "no args, no slot (TUI)", args: "", slot: undefined, reloads: 1, warns: 0 },
    { name: "matching armed token", args: "tokA", slot: armed("tokA", "armed"), reloads: 1, warns: 0 },
    { name: "mismatched token", args: "tokB", slot: armed("tokA", "armed"), reloads: 0, warns: 0 },
    { name: "expired slot", args: "tokA", slot: armed("tokA", "expired"), reloads: 0, warns: 0 },
    { name: "no args while in flight", args: "", slot: armed("tokA", "started", 1_000), reloads: 0, warns: 1 },
  ])("$name", async ({ args, slot, reloads, warns }) => {
    writePendingReload(slot && { ...slot });
    const { tr, sendUserMessage } = setup();
    const ctx = mockCtx();
    await tr.handleReloadCommand(args, ctx);
    expect(ctx.reload).toHaveBeenCalledTimes(reloads);
    expect(ctx.ui.notify).toHaveBeenCalledTimes(warns);
    if (warns) expect(ctx.ui.notify).toHaveBeenCalledWith(expect.any(String), "warning");
    if (args === "tokA" && slot?.state === "armed") expect(readPendingReload()?.state).toBe("started");
    // The handler never emits dashboard feedback itself.
    expect(sendUserMessage).not.toHaveBeenCalled();
  });
});

describe("reloaded side (B2) slot consumption (E5)", () => {
  it.each([
    { name: "reload, match, started, 59 s", reason: "reload", sid: SID, state: "started", age: 59_000, emit: true, after: "delivered" },
    { name: "reload, match, started, 61 s", reason: "reload", sid: SID, state: "started", age: 61_000, emit: false, after: "deleted" },
    { name: "reload, match, expired, 10 s", reason: "reload", sid: SID, state: "expired", age: 10_000, emit: false, after: "deleted" },
    { name: "reload, other session, started", reason: "reload", sid: "other", state: "started", age: 10_000, emit: false, after: "untouched" },
    { name: "startup, match, started", reason: "startup", sid: SID, state: "started", age: 10_000, emit: false, after: "untouched" },
  ] as const)("$name", ({ reason, sid, state, age, emit, after }) => {
    const slot: PendingReloadSlot = { token: "t", sessionId: sid, state, armedAt: Date.now() - age };
    writePendingReload({ ...slot });
    expect(consumePendingReloadOnSessionStart(reason, SID)).toBe(emit);
    const now = readPendingReload();
    if (after === "delivered") expect(now?.state).toBe("delivered");
    if (after === "deleted") expect(now).toBeUndefined();
    if (after === "untouched") expect(now).toEqual(slot);
  });
});

describe("bridge wiring (E6, E7)", () => {
  it("E6: completed is sent after replay_complete, from the session_start handler", () => {
    // Structural pin: the bridge module is not instantiable under a unit test
    // (live WS, timers). Source order in the session_start handler is the
    // contract: consume at the top (synchronous CAS), emit after replay_complete.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, "..", "bridge.ts"), "utf8");
    const start = src.indexOf('pi.on("session_start"');
    const end = src.indexOf("pi.on(", start + 10);
    const body = src.slice(start, end);
    const consume = body.indexOf("consumePendingReloadOnSessionStart(");
    const register = body.indexOf('type: "session_register"');
    const replay = body.indexOf("replaySessionEntries();");
    const replayComplete = body.indexOf('type: "replay_complete"');
    const completed = body.indexOf("reloadCompletedFeedback(");
    expect(consume).toBeGreaterThan(-1);
    expect(consume).toBeLessThan(register);
    expect(register).toBeLessThan(replay);
    expect(replay).toBeLessThan(replayComplete);
    expect(replayComplete).toBeLessThan(completed);
    expect(body.split("reloadCompletedFeedback(").length - 1).toBe(1);
  });

  it("E7a: session_shutdown{reload} releases ownership → the reloaded instance re-initialises", () => {
    const P1 = {};
    const P2 = {};
    const prev = { generation: 1, pi: P1 as unknown };
    releaseBridgeOwnerOnShutdown(prev, "reload");
    expect(isBridgeReentry(prev, P2)).toBe(false);
  });

  it("E7b: no shutdown → a different pi (subagent load) is still skipped", () => {
    const P1 = {};
    const P3 = {};
    const prev = { generation: 1, pi: P1 as unknown };
    releaseBridgeOwnerOnShutdown(prev, "quit");
    expect(isBridgeReentry(prev, P3)).toBe(true);
    expect(prev.pi).toBe(P1);
  });
});
