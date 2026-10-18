/**
 * Fileless ended-session eviction + supersede eviction in the archive owner
 * (test-plan #E1-#E6, #E12, #E13, #E15).
 *
 * A manual archive of an ended, non-live session with no `sessionFile` evicts it
 * from the live set (no sidecar write, no index row, folder count unchanged).
 * `evictSuperseded` is the same eviction for an ended holder whose transcript a
 * new registrant took over.
 *
 * Harness: real memory session manager + real archive owner (exemplar:
 * `session-archive-index.test.ts`).
 * See change: fix-orphaned-ended-session-archive.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as sessionMeta from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import type { ArchivedSessionSummary } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { createArchiveSweeper } from "../archive-sweeper.js";
import { createMemorySessionManager } from "../memory-session-manager.js";
import { createSessionArchive } from "../session-archive.js";

vi.mock("@blackbelt-technology/pi-dashboard-shared/session-meta.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/session-meta.js")>();
  return {
    ...actual,
    writeSessionMeta: vi.fn(actual.writeSessionMeta),
    mergeSessionMeta: vi.fn(actual.mergeSessionMeta),
  };
});

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

interface Emitted {
  id: string;
  key: string;
  count: number;
}

let tmp: string;
let sessionManager: ReturnType<typeof createMemorySessionManager>;
let deleteEvents: Mock<(id: string) => void>;
let emitted: Emitted[];
let countUpdates: Array<{ cwd: string; count: number }>;
let archive: ReturnType<typeof createSessionArchive>;

function ended(over: Partial<DashboardSession> & { id: string }): DashboardSession {
  return {
    cwd: "/w",
    source: "tui",
    status: "ended",
    startedAt: NOW - 90 * DAY,
    endedAt: NOW - 60 * DAY,
    ...over,
  } as DashboardSession;
}

function seedRow(id: string, cwd: string): ArchivedSessionSummary {
  return { id, cwd, groupPath: cwd, endedAt: 2000, archivedAt: 2100, sessionFile: `/sessions/${id}.jsonl` };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archive-fileless-"));
  vi.mocked(sessionMeta.writeSessionMeta).mockClear();
  vi.mocked(sessionMeta.mergeSessionMeta).mockClear();
  sessionManager = createMemorySessionManager();
  deleteEvents = vi.fn<(id: string) => void>();
  emitted = [];
  countUpdates = [];
  archive = createSessionArchive({
    sessionManager,
    metaPersistence: { flush: () => {} },
    getPinnedDirs: () => [],
    platform: "linux",
    now: () => NOW,
    deleteEvents,
  });
  archive.setEmitter({
    sessionArchived: (id, key, count) => emitted.push({ id, key, count }),
    archivedCountUpdated: (cwd, count) => countUpdates.push({ cwd, count }),
    sessionAdded: () => {},
  });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("fileless ended manual archive (D1)", () => {
  it("#E1 evicts a fileless ended session, broadcasts with the unchanged count", () => {
    sessionManager.restore(ended({ id: "S" }));
    const before = archive.countsByKey()["/w"] ?? 0;

    expect(archive.archiveSession("S", "manual")).toEqual({ ok: true });

    expect(sessionManager.get("S")).toBeUndefined();
    expect(emitted).toEqual([{ id: "S", key: "/w", count: before }]);
    expect(archive.has("S")).toBe(false);
  });

  it("#E2 writes nothing to disk", () => {
    sessionManager.restore(ended({ id: "S" }));
    archive.archiveSession("S", "manual");

    expect(sessionMeta.writeSessionMeta).not.toHaveBeenCalled();
    expect(sessionMeta.mergeSessionMeta).not.toHaveBeenCalled();
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it("#E3 an evicted session is not listed and cannot be unarchived", () => {
    sessionManager.restore(ended({ id: "S" }));
    archive.archiveSession("S", "manual");

    expect(archive.list({ cwd: "/w", limit: 50 }).items.map((r) => r.id)).not.toContain("S");
    expect(archive.unarchiveSession("S")).toEqual({ ok: false, error: "session is not archived" });
  });

  it("#E4 a fileless interrupted (live) session is still refused", () => {
    sessionManager.restore(ended({ id: "S", live: true }));

    expect(archive.archiveSession("S", "manual")).toEqual({ ok: false, error: "session is live (interrupted)" });
    expect(sessionManager.get("S")).toBeDefined();
    expect(emitted).toEqual([]);
    expect(deleteEvents).not.toHaveBeenCalled();
  });

  it("#E5 sweep and service-end never evict a fileless session", () => {
    sessionManager.restore(ended({ id: "S" }));
    const sweeper = createArchiveSweeper({
      sessionManager,
      sessionArchive: archive,
      isViewed: () => false,
      now: () => NOW,
      getConfig: () => ({
        sessionList: { archiveAfterDays: 30, archiveSweepIntervalMinutes: 60, archiveServiceSessionsOnEnd: true },
      }),
    });

    expect(sweeper.tick()).toBe(0);
    expect(archive.archiveSession("S", "service-end")).toEqual({ ok: false, error: "session file is unknown" });
    expect(archive.archiveSession("S", "sweep")).toEqual({ ok: false, error: "session file is unknown" });
    expect(archive.archiveSession("S", "migration")).toEqual({ ok: false, error: "session file is unknown" });

    expect(sessionManager.get("S")).toBeDefined();
    expect(emitted).toEqual([]);
  });

  it("#E6 a file-backed manual archive is unchanged", () => {
    const file = path.join(tmp, "2026-01-01T00-00-00-000Z_S.jsonl");
    fs.writeFileSync(file, "");
    sessionManager.restore(ended({ id: "S", sessionFile: file }));

    expect(archive.archiveSession("S", "manual")).toEqual({ ok: true });

    expect(sessionMeta.readSessionMeta(file)?.archived).toBe(true);
    expect(archive.has("S")).toBe(true);
    expect(emitted).toEqual([{ id: "S", key: "/w", count: 1 }]);
    expect(deleteEvents).not.toHaveBeenCalled();
  });

  it("#E13 purges the in-memory events exactly once per fileless eviction", () => {
    sessionManager.restore(ended({ id: "S" }));
    archive.archiveSession("S", "manual");
    expect(deleteEvents).toHaveBeenCalledTimes(1);
    expect(deleteEvents).toHaveBeenCalledWith("S");
  });

  it("a missing deleteEvents dep is tolerated", () => {
    const bare = createSessionArchive({
      sessionManager,
      metaPersistence: { flush: () => {} },
      getPinnedDirs: () => [],
      platform: "linux",
    });
    sessionManager.restore(ended({ id: "S" }));
    expect(bare.archiveSession("S", "manual")).toEqual({ ok: true });
    expect(sessionManager.get("S")).toBeUndefined();
  });
});

describe("evictSuperseded (D2)", () => {
  it("#E13 evicts an ended holder, purging events once, ignoring the live guard", () => {
    sessionManager.restore(ended({ id: "S1", sessionFile: "/sessions/F.jsonl", live: true }));

    expect(archive.evictSuperseded("S1", "S2")).toEqual({ ok: true });

    expect(sessionManager.get("S1")).toBeUndefined();
    expect(deleteEvents).toHaveBeenCalledTimes(1);
    expect(deleteEvents).toHaveBeenCalledWith("S1");
    expect(emitted).toHaveLength(1);
    expect(sessionMeta.mergeSessionMeta).not.toHaveBeenCalled();
    expect(archive.has("S1")).toBe(false);
  });

  it("#E12 re-validates: a non-ended holder is a no-op", () => {
    sessionManager.restore(ended({ id: "S1", sessionFile: "/sessions/F.jsonl", status: "idle", endedAt: undefined }));

    const res = archive.evictSuperseded("S1", "S2");

    expect(res.ok).toBe(false);
    expect(sessionManager.get("S1")).toBeDefined();
    expect(emitted).toEqual([]);
    expect(deleteEvents).not.toHaveBeenCalled();
  });

  it("an unknown id is a no-op", () => {
    expect(archive.evictSuperseded("nope", "S2").ok).toBe(false);
    expect(emitted).toEqual([]);
  });
});

describe("evictions keep the folder count (#E15)", () => {
  it("both eviction paths emit the unchanged count and never touch the index", () => {
    archive.seed([seedRow("a1", "/a"), seedRow("a2", "/a")]);
    sessionManager.restore(ended({ id: "S", cwd: "/a" }));
    sessionManager.restore(ended({ id: "S1", cwd: "/a", sessionFile: "/sessions/F.jsonl" }));

    archive.archiveSession("S", "manual");
    archive.evictSuperseded("S1", "S2");

    expect(emitted.map((e) => e.count)).toEqual([2, 2]);
    expect(archive.countsByKey()["/a"]).toBe(2);
    expect(countUpdates).toEqual([]);
  });
});
