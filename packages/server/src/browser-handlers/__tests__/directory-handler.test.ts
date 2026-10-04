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

// The openspec_refresh admission-gate tests (harden-server-request-surfaces)
// drive a REAL DirectoryService, so the OpenSpec CLI entry points are mocked
// the same way `src/__tests__/directory-service.test.ts` mocks them: these
// three mocks ARE the spawn spies the gate tests assert on.
vi.mock("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js")>();
  return {
    ...actual,
    pollOpenSpecAsync: vi.fn(async () => ({ initialized: false, changes: [] })),
    runOpenSpecList: vi.fn(async () => ({ changes: [] })),
    runOpenSpecStatus: vi.fn(async () => ({ artifacts: [], isComplete: false })),
  };
});

// E6 (tracked gate precedes the filesystem probe) needs a statSync spy that
// reaches the `import * as fs from "node:fs"` namespaces INSIDE
// directory-service.ts / openspec-poll-fs-helpers.ts. A plain
// `vi.spyOn(fs, "statSync")` from the test does not intercept those calls, so
// the module itself is wrapped: the spy records and calls through, and every
// other fs function stays the real implementation.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    statSync: vi.fn((...args: Parameters<typeof actual.statSync>) => actual.statSync(...args)),
  };
});

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { BrowserHandlerContext } from "../handler-context.js";
import type { OpenSpecGetResultMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { pollOpenSpecAsync, runOpenSpecList, runOpenSpecStatus } from "@blackbelt-technology/pi-dashboard-shared/openspec-poller.js";
import { createDirectoryService, type DirectoryService } from "../../directory-service.js";
import type { PreferencesStore } from "../../persistence/preferences-store.js";
import type { SessionManager } from "../../session/memory-session-manager.js";
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
    // D1: the handler enters through the GATED service method; a rejection
    // (e.g. the delegated force-poll failing) is still owned by the handler.
    const refreshOpenSpecGated = vi
      .fn()
      .mockRejectedValueOnce(new Error("refresh boom"))
      .mockResolvedValueOnce({ initialized: true, changes: [] });
    const broadcast = vi.fn();
    const ctx = { directoryService: { refreshOpenSpecGated }, broadcast } as unknown as BrowserHandlerContext;

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

// ────────────────────────────────────────────────────────────────────────
// openspec_refresh admission gates — harden-server-request-surfaces (D1).
//
// The browser-initiated refresh must pass the SAME admission chain as
// `openspec_get` (enabled → opted-out → tracked → `<cwd>/openspec/` root,
// fs probe LAST), spawn no CLI process and write no cache entry on a gate
// failure, and must NOT broadcast. Driven through the REAL service so the
// gate chain itself is under test; the mocked openspec-poller entry points
// above are the spawn spies.
// See change: harden-server-request-surfaces (test-plan #E1–#E8, #X7, #P1).
// ────────────────────────────────────────────────────────────────────────
describe("openspec_refresh admission gates — harden-server-request-surfaces", () => {
  const spawnSpies = () => ({
    list: vi.mocked(runOpenSpecList),
    status: vi.mocked(runOpenSpecStatus),
    legacy: vi.mocked(pollOpenSpecAsync),
  });

  const totalSpawns = (...spies: Array<ReturnType<typeof vi.fn>>) =>
    spies.reduce((n, spy) => n + spy.mock.calls.length, 0);

  interface GateHarness {
    service: DirectoryService;
    ctx: BrowserHandlerContext;
    broadcast: ReturnType<typeof vi.fn>;
    tmp: string;
  }

  function gateHarness(opts: {
    /** Session rows seeded into the registry; cwd may reference the created tmp. */
    sessions?: (tmp: string) => Array<{ id: string; cwd: string; status?: "active" | "ended" }>;
    pins?: (tmp: string) => string[];
    /** Partial `OpenSpecPollConfig` overrides (enabled / optOutDirectories). */
    config?: (tmp: string) => { enabled?: boolean; optOutDirectories?: string[] };
    /** Create `<tmp>/openspec/changes/` (no change subdirs). */
    withRoot?: boolean;
  }): GateHarness {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dh-gate-"));
    created.push(tmp);
    if (opts.withRoot) fs.mkdirSync(path.join(tmp, "openspec", "changes"), { recursive: true });
    const preferencesStore = {
      getPinnedDirectories: () => (opts.pins ? opts.pins(tmp) : []),
      getOpenSpecUpdateSignature: () => undefined,
    } as unknown as PreferencesStore;
    const rows = (opts.sessions ? opts.sessions(tmp) : []).map((s) => ({
      id: s.id,
      cwd: s.cwd,
      source: "tui" as const,
      status: s.status ?? ("active" as const),
      startedAt: 1,
    }));
    const sessionManager = { listAll: () => rows } as unknown as SessionManager;
    const service = createDirectoryService(preferencesStore, sessionManager, opts.config ? opts.config(tmp) : {});
    services.push(service);
    const broadcast = vi.fn();
    const ctx = { broadcast, directoryService: service } as unknown as BrowserHandlerContext;
    return { service, ctx, broadcast, tmp };
  }

  const created: string[] = [];
  const services: DirectoryService[] = [];

  afterEach(() => {
    for (const s of services) s.stopPolling();
    services.length = 0;
    for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
    created.length = 0;
    // The openspec-poller mocks (and the fs.statSync spy) are module-level
    // singletons — drop their call records so each test asserts only its own
    // spawns. Implementations from the module factory survive mockClear.
    vi.clearAllMocks();
  });

  /** A cwd that is neither pinned nor present in any session registry. */
  const untrackedCwd = (label: string) => path.join(os.tmpdir(), `dh-untracked-${label}`);

  const openspecUpdatesTo = (broadcast: ReturnType<typeof vi.fn>, cwd: string) =>
    broadcast.mock.calls.filter(
      (c) => (c[0] as { type?: string; cwd?: string })?.type === "openspec_update" && (c[0] as { cwd?: string }).cwd === cwd,
    );

  it("E1 untracked cwd does not spawn and does not broadcast", async () => {
    const cwd = untrackedCwd("e1");
    const h = gateHarness({}); // empty registry, no pins
    const spawns = spawnSpies();

    handleOpenSpecRefresh({ type: "openspec_refresh", cwd } as any, h.ctx);
    await flush();

    expect(totalSpawns(spawns.list, spawns.status, spawns.legacy)).toBe(0);
    expect(h.broadcast).not.toHaveBeenCalled();
  });

  it("E2 opted-out cwd does not spawn and does not broadcast", async () => {
    const h = gateHarness({
      sessions: (tmp) => [{ id: "s1", cwd: tmp }],
      config: (tmp) => ({ optOutDirectories: [tmp] }),
      withRoot: true, // only the opt-out gate may stop it
    });
    const spawns = spawnSpies();

    handleOpenSpecRefresh({ type: "openspec_refresh", cwd: h.tmp } as any, h.ctx);
    await flush();

    expect(totalSpawns(spawns.list, spawns.status, spawns.legacy)).toBe(0);
    expect(h.broadcast).not.toHaveBeenCalled();
  });

  it("E3 tracked cwd without an openspec root does not spawn and does not broadcast", async () => {
    const h = gateHarness({ sessions: (tmp) => [{ id: "s1", cwd: tmp }] }); // no root
    const spawns = spawnSpies();

    handleOpenSpecRefresh({ type: "openspec_refresh", cwd: h.tmp } as any, h.ctx);
    await flush();

    expect(totalSpawns(spawns.list, spawns.status, spawns.legacy)).toBe(0);
    expect(h.broadcast).not.toHaveBeenCalled();
  });

  it("E4 global disable still wins", async () => {
    const h = gateHarness({
      sessions: (tmp) => [{ id: "s1", cwd: tmp }],
      config: () => ({ enabled: false }),
      withRoot: true, // tracked AND holding a root — the master gate decides
    });
    const spawns = spawnSpies();

    handleOpenSpecRefresh({ type: "openspec_refresh", cwd: h.tmp } as any, h.ctx);
    await flush();

    expect(totalSpawns(spawns.list, spawns.status, spawns.legacy)).toBe(0);
    expect(h.broadcast).not.toHaveBeenCalled();
  });

  it("E5 tracked cwd still force-polls — over-gating guard", async () => {
    const h = gateHarness({ sessions: (tmp) => [{ id: "s1", cwd: tmp }], withRoot: true });
    // Warm the cache so a gated poll would skip on unchanged mtimes.
    await h.service.refreshOpenSpec(h.tmp);
    const spawns = spawnSpies();
    spawns.list.mockClear();
    spawns.status.mockClear();
    spawns.legacy.mockClear();

    handleOpenSpecRefresh({ type: "openspec_refresh", cwd: h.tmp } as any, h.ctx);
    await flush();

    // Force path bypasses the mtime gate: exactly one list spawn; the
    // changeless root means no per-change status spawn.
    expect(spawns.list).toHaveBeenCalledTimes(1);
    expect(spawns.status).toHaveBeenCalledTimes(0);
    expect(spawns.legacy).not.toHaveBeenCalled();
    expect(openspecUpdatesTo(h.broadcast, h.tmp)).toHaveLength(1);
  });

  it("E6 tracked gate precedes the filesystem probe", async () => {
    const cwd = untrackedCwd("e6");
    const h = gateHarness({});
    const statSpy = vi.mocked(fs.statSync);
    statSpy.mockClear();

    handleOpenSpecRefresh({ type: "openspec_refresh", cwd } as any, h.ctx);
    await flush();

    const probed = statSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((p) => p === cwd || p.startsWith(cwd + path.sep));
    expect(probed).toEqual([]);
    expect(h.broadcast).not.toHaveBeenCalled();
  });

  it("E7 ended session's cwd is still refreshable — parity with openspec_get", async () => {
    const h = gateHarness({
      sessions: (tmp) => [{ id: "s1", cwd: tmp, status: "ended" }],
      withRoot: true,
    });
    const spawns = spawnSpies();

    handleOpenSpecRefresh({ type: "openspec_refresh", cwd: h.tmp } as any, h.ctx);
    await flush();

    expect(spawns.list).toHaveBeenCalledTimes(1);
    expect(openspecUpdatesTo(h.broadcast, h.tmp)).toHaveLength(1);
  });

  it("E8 non-canonical cwd gates — pins the strict-equality trade-off", async () => {
    const h = gateHarness({ sessions: (tmp) => [{ id: "s1", cwd: tmp }], withRoot: true });
    const spawns = spawnSpies();

    handleOpenSpecRefresh({ type: "openspec_refresh", cwd: h.tmp + "/" } as any, h.ctx);
    await flush();

    expect(totalSpawns(spawns.list, spawns.status, spawns.legacy)).toBe(0);
    expect(h.broadcast).not.toHaveBeenCalled();
  });

  it("X7 gated refresh leaves no cache residue", async () => {
    const cwd = untrackedCwd("x7");
    const h = gateHarness({});

    handleOpenSpecRefresh({ type: "openspec_refresh", cwd } as any, h.ctx);
    await flush();

    expect(h.service.getOpenSpecData(cwd)).toBeUndefined();
  });

  it("P1 100 untracked refreshes back-to-back cannot force a single spawn", async () => {
    const h = gateHarness({});
    const spawns = spawnSpies();
    const cwds = Array.from({ length: 100 }, (_, i) => untrackedCwd(`p1-${i}`));

    for (const cwd of cwds) {
      handleOpenSpecRefresh({ type: "openspec_refresh", cwd } as any, h.ctx);
    }
    await flush();

    expect(totalSpawns(spawns.list, spawns.status, spawns.legacy)).toBe(0);
    expect(h.broadcast).not.toHaveBeenCalled();
  });
});
