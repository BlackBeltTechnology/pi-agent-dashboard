/**
 * Rejection-owner assertions for the openspec directory handlers.
 *
 * `handleOpenSpecRefresh` and `handleOpenSpecBulkArchive` are fire-and-forget
 * from a synchronous WS dispatch handler: a rejected refresh / post-archive
 * poll must be logged and absorbed, never floated, and the gateway must stay
 * responsive to the next message.
 *
 * New test file (no sibling existed); harness idiom mirrors the sibling
 * `session-action-handler.test.ts` (build a minimal BrowserHandlerContext,
 * drive one handler, assert on spies).
 *
 * See change: cleanup-async-semantics-server-extension (test-plan #X6, #X7).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `handleOpenSpecBulkArchive` calls the shared openspec tool (which would spawn
// the CLI). Stub it so the test exercises only the post-archive poll path.
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/openspec.js", () => ({
  archiveCompleted: vi.fn(),
}));

import type { BrowserHandlerContext } from "../handler-context.js";
import type { OpenSpecGetResultMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { handleOpenSpecBulkArchive, handleOpenSpecGet, handleOpenSpecRefresh } from "../directory-handler.js";

async function flush() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

describe("handleOpenSpecGet — unicast fetch (fix-connect-snapshot-frame-loss D6)", () => {
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    unhandled = [];
    process.on("unhandledRejection", onUnhandled);
  });
  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
    vi.clearAllMocks();
  });

  const pendingPlaceholder: OpenSpecData = {
    initialized: false,
    pending: true,
    changes: [],
    hasOpenspecDir: true,
    readiness: { state: "PENDING" },
  };

  function makeGetCtx(getOrPollOpenSpec: (cwd: string) => { hit?: OpenSpecData; poll?: Promise<OpenSpecData> }) {
    const sendTo = vi.fn();
    const broadcast = vi.fn();
    const ctx = {
      ws: {},
      sendTo,
      broadcast,
      directoryService: { getOrPollOpenSpec },
    } as unknown as BrowserHandlerContext;
    return { ctx, sendTo, broadcast };
  }

  function results(sendTo: ReturnType<typeof vi.fn>): OpenSpecGetResultMessage[] {
    return sendTo.mock.calls.map((c) => c[1] as OpenSpecGetResultMessage);
  }

  it("E23 cache hit: one final:true with the cached payload, unicast only, no poll", () => {
    const cached: OpenSpecData = { initialized: true, changes: [], hasOpenspecDir: true };
    const getOrPoll = vi.fn(() => ({ hit: cached }));
    const { ctx, sendTo, broadcast } = makeGetCtx(getOrPoll);

    handleOpenSpecGet({ type: "openspec_get", requestId: "r1", cwd: "/a" } as any, ctx);

    expect(results(sendTo)).toEqual([
      { type: "openspec_get_result", requestId: "r1", cwd: "/a", data: cached, final: true },
    ]);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("E24 cold miss: [final:false PENDING, final:true outcome], both requestId-correlated; handler never broadcasts", async () => {
    const D: OpenSpecData = { initialized: true, changes: [], hasOpenspecDir: true };
    let resolvePoll!: (d: OpenSpecData) => void;
    const poll = new Promise<OpenSpecData>((res) => { resolvePoll = res; });
    const { ctx, sendTo, broadcast } = makeGetCtx(() => ({ hit: pendingPlaceholder, poll }));

    handleOpenSpecGet({ type: "openspec_get", requestId: "r7", cwd: "/b" } as any, ctx);
    expect(results(sendTo)).toEqual([
      { type: "openspec_get_result", requestId: "r7", cwd: "/b", data: pendingPlaceholder, final: false },
    ]);

    resolvePoll(D);
    await flush();
    expect(results(sendTo)).toEqual([
      { type: "openspec_get_result", requestId: "r7", cwd: "/b", data: pendingPlaceholder, final: false },
      { type: "openspec_get_result", requestId: "r7", cwd: "/b", data: D, final: true },
    ]);
    // Others' frames (transitional pending / openspec_update) are the
    // SERVICE's broadcasts — the handler itself never broadcasts.
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("E25 second get after a completed poll: cache hit, one final:true, nothing further", () => {
    const D: OpenSpecData = { initialized: true, changes: [], hasOpenspecDir: true };
    const { ctx, sendTo, broadcast } = makeGetCtx(() => ({ hit: D }));

    handleOpenSpecGet({ type: "openspec_get", requestId: "r8", cwd: "/b" } as any, ctx);

    expect(results(sendTo)).toHaveLength(1);
    expect(results(sendTo)[0]).toMatchObject({ requestId: "r8", final: true, data: D });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("E26 concurrent gets share one poll: each requester gets its own placeholder+final with its own requestId", async () => {
    const D: OpenSpecData = { initialized: true, changes: [], hasOpenspecDir: true };
    let resolvePoll!: (d: OpenSpecData) => void;
    const poll = new Promise<OpenSpecData>((res) => { resolvePoll = res; });
    // One shared in-flight answer, as the real service returns for a cold cwd.
    const shared = { hit: pendingPlaceholder, poll };
    const getOrPoll = vi.fn(() => shared);
    const browsers = [1, 2, 3].map((i) => makeGetCtx(getOrPoll));

    for (const [i, b] of browsers.entries()) {
      handleOpenSpecGet({ type: "openspec_get", requestId: `r${i + 1}`, cwd: "/c" } as any, b.ctx);
    }
    expect(getOrPoll).toHaveBeenCalledTimes(3);
    for (const [i, b] of browsers.entries()) {
      expect(results(b.sendTo)).toHaveLength(1);
      expect(results(b.sendTo)[0]).toMatchObject({ requestId: `r${i + 1}`, final: false });
    }

    resolvePoll(D);
    await flush();
    for (const [i, b] of browsers.entries()) {
      expect(results(b.sendTo)).toHaveLength(2);
      expect(results(b.sendTo)[1]).toMatchObject({ requestId: `r${i + 1}`, final: true, data: D });
    }
  });

  it("X1 poll rejects: final:true BROKEN · cli-failed; no unhandled rejection", async () => {
    const poll = Promise.reject(new Error("boom"));
    const { ctx, sendTo } = makeGetCtx(() => ({ hit: pendingPlaceholder, poll }));

    handleOpenSpecGet({ type: "openspec_get", requestId: "r9", cwd: "/d" } as any, ctx);
    await flush();

    expect(results(sendTo)).toHaveLength(2);
    expect(results(sendTo)[0]).toMatchObject({ requestId: "r9", final: false });
    expect(results(sendTo)[1]).toMatchObject({
      requestId: "r9",
      final: true,
      data: { readiness: { state: "BROKEN", reason: "cli-failed" } },
    });
    expect(unhandled).toEqual([]);
  });

  it("X2 poll stalls and the requester socket closes: no unhandled rejection, no throw; a later requester shares the promise", async () => {
    const D: OpenSpecData = { initialized: true, changes: [], hasOpenspecDir: true };
    let resolvePoll!: (d: OpenSpecData) => void;
    const poll = new Promise<OpenSpecData>((res) => { resolvePoll = res; });
    const shared = { hit: pendingPlaceholder, poll };
    const getOrPoll = vi.fn(() => shared);
    const b1 = makeGetCtx(getOrPoll);
    const b2 = makeGetCtx(getOrPoll);

    // Browser 1 requests; its socket then closes. sendTo on a closed socket
    // is guarded upstream (gateway `sendTo`/`sendState` readyState guard, E9)
    // — the handler must not throw and the stall must not float a rejection.
    handleOpenSpecGet({ type: "openspec_get", requestId: "q1", cwd: "/e" } as any, b1.ctx);
    expect(() => handleOpenSpecGet({ type: "openspec_get", requestId: "q2", cwd: "/e" } as any, b2.ctx)).not.toThrow();
    await flush();
    expect(results(b1.sendTo)).toHaveLength(1);
    expect(results(b2.sendTo)).toHaveLength(1);

    resolvePoll(D);
    await flush();
    expect(results(b1.sendTo)[1]).toMatchObject({ requestId: "q1", final: true, data: D });
    expect(results(b2.sendTo)[1]).toMatchObject({ requestId: "q2", final: true, data: D });
    expect(unhandled).toEqual([]);
  });

  it("X8 hostile cwds: single final:true ABSENT reply, no poll, no throw", () => {
    const absent: OpenSpecData = {
      initialized: false,
      pending: false,
      changes: [],
      hasOpenspecDir: false,
      readiness: { state: "ABSENT" },
    };
    for (const hostile of ["/etc", "../../", ""]) {
      const { ctx, sendTo, broadcast } = makeGetCtx(() => ({ hit: absent }));
      expect(() =>
        handleOpenSpecGet({ type: "openspec_get", requestId: "rX", cwd: hostile } as any, ctx),
      ).not.toThrow();
      expect(results(sendTo)).toEqual([
        { type: "openspec_get_result", requestId: "rX", cwd: hostile, data: absent, final: true },
      ]);
      expect(broadcast).not.toHaveBeenCalled();
    }
  });
});

describe("openspec directory handlers — rejection is owned", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    unhandled = [];
    process.on("unhandledRejection", onUnhandled);
  });
  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
    warnSpy.mockRestore();
    vi.clearAllMocks();
  });

  function loggedWarn(fragment: string): boolean {
    return warnSpy.mock.calls.some((c: unknown[]) => typeof c[0] === "string" && c[0].includes(fragment));
  }

  it("X6 a rejected openspec_refresh is logged and absorbed; the gateway handles the next message", async () => {
    const refreshOpenSpec = vi
      .fn()
      .mockRejectedValueOnce(new Error("refresh boom"))
      .mockResolvedValueOnce({ initialized: true, changes: [] });
    const broadcast = vi.fn();
    const ctx = { directoryService: { refreshOpenSpec }, broadcast } as unknown as BrowserHandlerContext;

    handleOpenSpecRefresh({ type: "openspec_refresh", cwd: "/repo" } as any, ctx);
    await flush();

    expect(loggedWarn("[openspec] refresh failed")).toBe(true);
    expect(unhandled).toEqual([]);
    // No broadcast for the failed refresh.
    expect(broadcast).not.toHaveBeenCalled();

    // Subsequent message: the handler still works and broadcasts the update.
    handleOpenSpecRefresh({ type: "openspec_refresh", cwd: "/repo" } as any, ctx);
    await flush();
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "openspec_update", cwd: "/repo" }),
    );
  });

  it("X7 a rejected post-archive poll is logged and absorbed; the gateway handles the next message", async () => {
    const pollDirectoryGated = vi
      .fn()
      .mockRejectedValueOnce(new Error("poll boom"))
      .mockResolvedValueOnce({ initialized: true, changes: [] });
    const broadcast = vi.fn();
    const ctx = { directoryService: { pollDirectoryGated }, broadcast } as unknown as BrowserHandlerContext;

    handleOpenSpecBulkArchive({ type: "openspec_bulk_archive", cwd: "/repo" } as any, ctx);
    await flush();

    expect(loggedWarn("[openspec] post-archive poll failed")).toBe(true);
    expect(unhandled).toEqual([]);
    expect(broadcast).not.toHaveBeenCalled();

    // Subsequent bulk-archive: the poll resolves and the update broadcasts.
    handleOpenSpecBulkArchive({ type: "openspec_bulk_archive", cwd: "/repo" } as any, ctx);
    await flush();
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "openspec_update", cwd: "/repo" }),
    );
  });
});
