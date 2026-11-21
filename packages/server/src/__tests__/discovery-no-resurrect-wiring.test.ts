/**
 * First-session-in-folder discovery (`event-wiring.ts` `isNewCwd` branch)
 * must never resurrect an archived session nor rewrite a discovered
 * session's sidecar; it seeds only sidecar-less history, via `restore()`.
 *
 * test-plan #E1, #E4, #E7, #E8, #X1, #X2.
 * Harness: `archive-on-end-wiring.test.ts` (real wireEvents + memory session
 * manager + browser gateway), plus a real archive index.
 * See change: fix-discovery-resurrects-archived.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { metaPath, writeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireEvents } from "../event-wiring.js";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createPendingForkRegistry } from "../pending/pending-fork-registry.js";
import { createPendingPluginRefRegistry } from "../pending/pending-plugin-ref-registry.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createMetaPersistence } from "../persistence/meta-persistence.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { createSessionArchive } from "../session/session-archive.js";
import type { DiscoveredSession } from "../session/session-discovery.js";
import { emptyOpenSpecData, makeFakeDirectoryService } from "./helpers/load-fixtures.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("first-session-in-folder discovery does not resurrect archived sessions", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-no-resurrect-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setup() {
    const sessionManager = createMemorySessionManager();
    const piGateway = {
      start: vi.fn(), stop: vi.fn(), sendToSession: vi.fn(), clearHostPressure: vi.fn(),
      getConnectedSessionIds: vi.fn(() => []), hasSession: vi.fn(() => true), isSessionConnected: vi.fn(() => true), onEvent: undefined,
    } as any;
    const browserGateway = createBrowserGateway(sessionManager, createMemoryEventStore(() => false), piGateway);
    const added: string[] = [];
    const sent: Array<{ type: string; cwd?: string }> = [];
    vi.spyOn(browserGateway, "broadcastSessionAdded").mockImplementation((s) => { added.push(s.id); });
    vi.spyOn(browserGateway, "broadcastToAll").mockImplementation((m: any) => { sent.push(m); });
    const metaPersistence = createMetaPersistence();
    const setLiveness = vi.spyOn(metaPersistence, "setLiveness");
    const save = vi.spyOn(metaPersistence, "save");
    const pluginEnded = vi.fn();
    const sessionArchive = createSessionArchive({ sessionManager, metaPersistence, getPinnedDirs: () => [] });
    const fake = makeFakeDirectoryService();
    let release: (v: { sessions: DiscoveredSession[]; openspecData: any }) => void = () => {};
    let discovered: DiscoveredSession[] = [];
    let deferred = false;
    fake.service.onDirectoryAdded = vi.fn(() => deferred
      ? new Promise((res) => { release = res as typeof release; })
      : Promise.resolve({ sessions: discovered, openspecData: emptyOpenSpecData() })) as any;
    wireEvents({
      sessionManager,
      eventStore: createMemoryEventStore(() => false),
      piGateway,
      browserGateway,
      sessionOrderManager: {
        insert: vi.fn(), remove: vi.fn(), getOrder: vi.fn(() => []), reorder: vi.fn(),
        getAllOrders: vi.fn(() => ({})), moveToFront: vi.fn(), rekey: vi.fn(),
      } as any,
      preferencesStore: {
        getPinnedDirectories: () => [], setPinnedDirectories: () => {},
        getSessionOrder: () => ({}), setSessionOrder: () => {},
        getAutoNameSessions: () => false, getClaudeSubscriptionCompat: () => false,
      } as any,
      pendingForkRegistry: createPendingForkRegistry(),
      directoryService: fake.service,
      knownSessionIds: new Set<string>(),
      pendingDashboardSpawns: new Map<string, number>(),
      pendingPluginRefRegistry: createPendingPluginRefRegistry(),
      dispatchPluginSessionEnded: pluginEnded,
      metaPersistence,
      sessionArchive,
    } as any);

    /** Bridge register, in the pi-gateway order: register → onSessionRegistered → onEvent. */
    function bridgeRegister(id: string, cwd: string) {
      sessionManager.register({ id, cwd, source: "dashboard", startedAt: Date.now() } as any);
      piGateway.onSessionRegistered?.(id, cwd);
      piGateway.onEvent(id, { type: "session_register", sessionId: id, cwd, source: "dashboard" });
    }
    return {
      sessionManager, sessionArchive, added, sent, setLiveness, save, pluginEnded, bridgeRegister,
      discover: (list: DiscoveredSession[]) => { discovered = list; },
      defer: (list: DiscoveredSession[]) => { deferred = true; discovered = list; },
      release: () => release({ sessions: discovered, openspecData: emptyOpenSpecData() }),
    };
  }

  function transcript(id: string, cwd: string, startedAt = 1000): DiscoveredSession {
    const sessionFile = path.join(tmpDir, `2026-01-01T00-00-00-000Z_${id}.jsonl`);
    fs.writeFileSync(sessionFile, `${JSON.stringify({ type: "session", id, cwd })}\n`);
    return { id, cwd, startedAt, modifiedAt: startedAt, sessionFile, sessionDir: tmpDir };
  }

  /** An archived session: sidecar `archived:true` + a row in the index. */
  function archived(rig: ReturnType<typeof setup>, ids: string[], cwd: string): DiscoveredSession[] {
    const list = ids.map((id) => transcript(id, cwd));
    for (const d of list) {
      writeSessionMeta(d.sessionFile, { cwd, status: "ended", startedAt: 1000, endedAt: 2000, archived: true, archivedAt: 3000 } as any);
    }
    rig.sessionArchive.seed(list.map((d) => ({
      id: d.id, cwd, groupPath: cwd, endedAt: 2000, archivedAt: 3000, sessionFile: d.sessionFile,
    })));
    return list;
  }

  const bytes = (list: DiscoveredSession[]) => list.map((d) => fs.readFileSync(metaPath(d.sessionFile), "utf-8"));

  it("#E1 a first session in a folder leaves its archived sessions archived", async () => {
    const rig = setup();
    const list = archived(rig, ["a1", "a2", "a3"], "/w/a");
    const before = bytes(list);
    rig.discover(list);

    rig.bridgeRegister("n1", "/w/a");
    await flush();

    for (const d of list) expect(rig.sessionManager.get(d.id)).toBeUndefined();
    expect(rig.added.filter((id) => id !== "n1")).toEqual([]);
    expect(rig.sessionArchive.countsByKey()["/w/a"]).toBe(3);
    expect(bytes(list)).toEqual(before);
    expect(rig.sent.filter((m) => m.type === "openspec_update" && m.cwd === "/w/a")).toHaveLength(1);
  });

  it("#E4 a sidecar-less transcript is seeded in the boot shape", async () => {
    const rig = setup();
    const t1 = transcript("t1", "/w/c", 1_000);
    const t1Mtime = new Date("2026-01-02T00:00:00Z");
    fs.utimesSync(t1.sessionFile, t1Mtime, t1Mtime);
    rig.discover([t1]);

    rig.bridgeRegister("n1", "/w/c");
    await flush();

    expect(rig.sessionManager.get("t1")).toMatchObject({
      status: "ended", hidden: false, dataUnavailable: true, endedAt: t1Mtime.getTime(),
    });
    expect(rig.added.filter((id) => id === "t1")).toHaveLength(1);
    expect(fs.existsSync(metaPath(t1.sessionFile))).toBe(false);
  });

  it("#E8 seeding fires no lifecycle side effects", async () => {
    const rig = setup();
    const e1 = transcript("e1", "/w/e");
    rig.discover([e1]);

    rig.bridgeRegister("n1", "/w/e");
    await flush();

    expect(rig.sessionManager.get("e1")).toBeDefined();
    expect(rig.setLiveness.mock.calls.filter(([file]) => file === e1.sessionFile)).toEqual([]);
    expect(rig.save.mock.calls.filter(([file]) => file === e1.sessionFile)).toEqual([]);
    expect(rig.pluginEnded.mock.calls.filter(([id]) => id === "e1")).toEqual([]);
  });

  it("#E7 a bridge registration of an archived id still wins", async () => {
    const rig = setup();
    const list = archived(rig, ["z1"], "/w/z");
    rig.discover(list);

    rig.bridgeRegister("z1", "/w/z");
    await flush();

    expect(rig.sessionManager.get("z1")?.status).not.toBe("ended");
    expect(rig.sessionArchive.has("z1")).toBe(false);
    expect(rig.sessionArchive.countsByKey()["/w/z"]).toBeUndefined();
    expect(rig.added.filter((id) => id === "z1")).toHaveLength(1);
  });

  it("#X1 an id archived (or given a sidecar) while discovery is in flight is not seeded", async () => {
    const rig = setup();
    const g1 = transcript("g1", "/w/g");
    const g2 = transcript("g2", "/w/g");
    rig.defer([g1, g2]);

    rig.bridgeRegister("n1", "/w/g");
    rig.sessionArchive.seed([{ id: "g1", cwd: "/w/g", groupPath: "/w/g", endedAt: 2, archivedAt: 3, sessionFile: g1.sessionFile }]);
    writeSessionMeta(g2.sessionFile, { cwd: "/w/g", archived: true } as any);
    rig.release();
    await flush();

    expect(rig.sessionManager.get("g1")).toBeUndefined();
    expect(rig.sessionManager.get("g2")).toBeUndefined();
    expect(rig.added.filter((id) => id === "g1" || id === "g2")).toEqual([]);
  });

  it("#X2 a bridge register during discovery keeps the live record", async () => {
    const rig = setup();
    const h1 = transcript("h1", "/w/h");
    rig.defer([h1]);

    rig.bridgeRegister("n1", "/w/h");
    rig.bridgeRegister("h1", "/w/h");
    const live = rig.sessionManager.get("h1");
    rig.release();
    await flush();

    expect(rig.sessionManager.get("h1")).toBe(live);
    expect(rig.sessionManager.get("h1")?.status).not.toBe("ended");
    expect(rig.sessionManager.get("h1")?.source).toBe("dashboard");
    expect(rig.added.filter((id) => id === "h1")).toHaveLength(1);
  });
});
