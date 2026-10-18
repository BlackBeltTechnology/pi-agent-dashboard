/**
 * Register-time `sessionFile` supersede (test-plan #E7-#E11, #X6).
 *
 * When a new registrant claims a transcript an ENDED resident session still
 * holds, that predecessor is evicted (never left as a fileless, un-archivable
 * orphan). A non-ended holder keeps the legacy clear-and-broadcast.
 *
 * Harness: `archive-on-end-wiring.test.ts` (real wireEvents + memory session
 * manager + browser gateway) with a REAL archive owner.
 * See change: fix-orphaned-ended-session-archive.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergeSessionMeta, readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireEvents } from "../event-wiring.js";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createPendingForkRegistry } from "../pending/pending-fork-registry.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { createSessionArchive } from "../session/session-archive.js";
import { makeFakeDirectoryService } from "./helpers/load-fixtures.js";

describe("register sessionFile supersede", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "supersede-"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function setup(opts: { withArchive?: boolean } = {}) {
    const withArchive = opts.withArchive ?? true;
    const sessionManager = createMemorySessionManager();
    const piGateway = {
      start: vi.fn(), stop: vi.fn(), sendToSession: vi.fn(), clearHostPressure: vi.fn(),
      getConnectedSessionIds: vi.fn(() => []), hasSession: vi.fn(() => true), onEvent: undefined,
      isSessionConnected: vi.fn(() => false),
    } as any;
    const eventStore = createMemoryEventStore(() => false);
    const browserGateway = createBrowserGateway(sessionManager, eventStore, piGateway);
    const archivedMsgs: Array<{ sessionId: string; cwd: string; count: number }> = [];
    const updates: Array<{ id: string; updates: any }> = [];
    const realUpdated = browserGateway.broadcastSessionUpdated.bind(browserGateway);
    vi.spyOn(browserGateway, "broadcastSessionUpdated").mockImplementation((id: string, u: any) => {
      updates.push({ id, updates: u });
      realUpdated(id, u);
    });
    const sessionArchive = createSessionArchive({
      sessionManager,
      metaPersistence: { flush: () => {} },
      getPinnedDirs: () => [],
      platform: "linux",
      deleteEvents: (id) => { eventStore.deleteEventsForSession(id); },
    });
    sessionArchive.setEmitter({
      sessionArchived: (sessionId, cwd, count) => archivedMsgs.push({ sessionId, cwd, count }),
      archivedCountUpdated: () => {},
      sessionAdded: () => {},
    });
    wireEvents({
      sessionManager,
      eventStore,
      piGateway,
      browserGateway,
      sessionOrderManager: {
        insert: vi.fn(), remove: vi.fn(), getOrder: vi.fn(() => []), reorder: vi.fn(),
        getAllOrders: vi.fn(() => ({})), moveToFront: vi.fn(), rekey: vi.fn(),
      } as any,
      preferencesStore: {
        getPinnedDirectories: () => [], setPinnedDirectories: () => {},
        getSessionOrder: () => ({}), setSessionOrder: () => {},
        getAutoNameSessions: () => false,
      } as any,
      pendingForkRegistry: createPendingForkRegistry(),
      directoryService: makeFakeDirectoryService().service,
      knownSessionIds: new Set<string>(),
      pendingDashboardSpawns: new Map<string, number>(),
      ...(withArchive ? { sessionArchive } : {}),
    } as any);
    return { sessionManager, piGateway, sessionArchive, archivedMsgs, updates };
  }

  function transcript(name = "F"): string {
    const file = path.join(tmp, `2026-09-24T00-00-00-000Z_${name}.jsonl`);
    fs.writeFileSync(file, "");
    return file;
  }

  function endedHolder(sessionManager: ReturnType<typeof createMemorySessionManager>, id: string, file: string, over: Partial<DashboardSession> = {}) {
    sessionManager.restore({
      id, cwd: "/repo", source: "tui", status: "ended", startedAt: 1, endedAt: 2, sessionFile: file, ...over,
    } as DashboardSession);
  }

  /** Mirrors the real order: the gateway registers the session, then the event is dispatched. */
  function register(rig: ReturnType<typeof setup>, id: string, file: string) {
    rig.sessionManager.register({ id, cwd: "/repo", source: "tui", startedAt: 3, sessionFile: file } as any);
    rig.piGateway.onEvent(id, { type: "session_register", sessionId: id, cwd: "/repo", source: "tui", sessionFile: file });
  }

  it("#E7 evicts an ended predecessor; the new owner keeps the file; sidecar untouched", () => {
    const rig = setup();
    const F = transcript();
    mergeSessionMeta(F, { name: "x" });
    endedHolder(rig.sessionManager, "S1", F);

    register(rig, "S2", F);

    expect(rig.sessionManager.get("S1")).toBeUndefined();
    expect(rig.archivedMsgs.filter((m) => m.sessionId === "S1")).toHaveLength(1);
    expect(rig.updates.filter((u) => u.id === "S1" && u.updates.sessionFile === null)).toEqual([]);
    expect(rig.sessionManager.get("S2")?.sessionFile).toBe(F);
    const meta = readSessionMeta(F);
    expect(meta?.name).toBe("x");
    expect(meta).not.toHaveProperty("archived");
  });

  it("#E8 evicts an ended predecessor that is marked live", () => {
    const rig = setup();
    const F = transcript();
    endedHolder(rig.sessionManager, "S1", F, { live: true });

    register(rig, "S2", F);

    expect(rig.sessionManager.get("S1")).toBeUndefined();
  });

  it("#E9 a non-ended holder keeps the legacy clear-and-broadcast", () => {
    const rig = setup();
    const F = transcript();
    endedHolder(rig.sessionManager, "S1", F, { status: "idle", endedAt: undefined });

    register(rig, "S2", F);

    const s1 = rig.sessionManager.get("S1");
    expect(s1).toBeDefined();
    expect(s1?.sessionFile).toBeUndefined();
    expect(rig.updates.some((u) => u.id === "S1" && u.updates.sessionFile === null)).toBe(true);
    expect(rig.archivedMsgs).toEqual([]);
  });

  it("#E10 a same-id re-register never evicts", () => {
    const rig = setup();
    const F = transcript();
    endedHolder(rig.sessionManager, "S1", F);

    register(rig, "S1", F);

    expect(rig.sessionManager.get("S1")).toBeDefined();
    expect(rig.sessionManager.get("S1")?.status).not.toBe("ended");
    expect(rig.archivedMsgs).toEqual([]);
  });

  it("#E11 leaves no fileless ended orphan behind and does not touch unrelated sessions", () => {
    const rig = setup();
    const F = transcript();
    const G = transcript("G");
    endedHolder(rig.sessionManager, "S1", F);
    endedHolder(rig.sessionManager, "S3", G, { cwd: "/other" });

    register(rig, "S2", F);

    const orphans = rig.sessionManager.listAll().filter((s) => s.status === "ended" && !s.sessionFile);
    expect(orphans).toEqual([]);
    expect(rig.sessionManager.get("S3")?.sessionFile).toBe(G);
    expect(rig.archivedMsgs.map((m) => m.sessionId)).toEqual(["S1"]);
  });

  it("an ended holder from a different origin device is not evicted (same path, different transcript)", () => {
    const rig = setup();
    const F = transcript();
    endedHolder(rig.sessionManager, "S1", F, { originDeviceId: "remote-dev" });

    register(rig, "S2", F);

    expect(rig.sessionManager.get("S1")).toBeDefined();
    expect(rig.archivedMsgs).toEqual([]);
  });

  it("#X6 without an archive service the legacy clear applies and a skip is logged", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const rig = setup({ withArchive: false });
    const F = transcript();
    endedHolder(rig.sessionManager, "S1", F);

    register(rig, "S2", F);

    expect(rig.sessionManager.get("S1")?.sessionFile).toBeUndefined();
    expect(info.mock.calls.flat().join("\n")).toContain("[archive] supersede skipped: archive unavailable");
  });
});
