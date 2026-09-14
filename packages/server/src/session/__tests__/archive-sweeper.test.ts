/**
 * Runtime auto-archive sweeper (test-plan #E15, #E16, #E17, #E18, #E19).
 *
 * Covers the age rule's boundary values, the `restoredAt` clock restart, the
 * never-archive decision table, the per-tick batch cap, and the
 * `archiveAfterDays: 0` kill switch (tick AND boot scan).
 *
 * See change: archive-sessions-lazy-load.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSessionMeta, writeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createArchiveSweeper } from "../archive-sweeper.js";
import type { SessionArchive } from "../session-archive.js";
import type { SessionManager } from "../memory-session-manager.js";
import { scanAllSessions } from "../session-scanner.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);

function session(over: Partial<DashboardSession> & { id: string }): DashboardSession {
  return {
    cwd: "/repo",
    source: "tui",
    status: "ended",
    startedAt: T0 - 90 * DAY,
    sessionFile: `/sessions/--repo--/${over.id}.jsonl`,
    ...over,
  } as DashboardSession;
}

/**
 * Minimal live-set + archive pair. `archiveSession` mirrors the real
 * transition's observable effect: the session leaves the live set.
 */
function makeRig(sessions: DashboardSession[]) {
  const live = new Map(sessions.map((s) => [s.id, s]));
  const archivedIds: string[] = [];
  const viewed = new Set<string>();
  const config = { sessionList: { archiveAfterDays: 30, archiveSweepIntervalMinutes: 60 } };

  const sessionManager = {
    listAll: () => [...live.values()],
    get: (id: string) => live.get(id),
    remove: (id: string) => { live.delete(id); },
  } as unknown as SessionManager;

  const sessionArchive = {
    archiveSession(id: string) {
      if (!live.has(id)) return { ok: false, error: "session not found" };
      live.delete(id);
      archivedIds.push(id);
      return { ok: true };
    },
  } as unknown as SessionArchive;

  const sweeper = createArchiveSweeper({
    sessionManager,
    sessionArchive,
    isViewed: (id) => viewed.has(id),
    getConfig: () => config,
  });

  return {
    sweeper,
    archivedIds,
    viewed,
    config,
    residentIds: () => [...live.keys()],
    isResident: (id: string) => live.has(id),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("archive sweeper age rule (E15)", () => {
  it("archives only sessions strictly older than the 30 d threshold", () => {
    const rig = makeRig([
      session({ id: "young", endedAt: T0 - (29 * DAY + 23 * HOUR) }),
      session({ id: "exact", endedAt: T0 - 30 * DAY }),
      session({ id: "old", endedAt: T0 - (30 * DAY + 1) }),
    ]);

    expect(rig.sweeper.tick()).toBe(1);
    expect(rig.archivedIds).toEqual(["old"]);
    expect(rig.residentIds().sort()).toEqual(["exact", "young"]);
  });
});

describe("archive sweeper restoredAt clock (E16)", () => {
  it("restarts the age clock at restoredAt", () => {
    const rig = makeRig([
      session({ id: "restored", endedAt: T0 - 60 * DAY, restoredAt: T0 - 5 * DAY }),
    ]);

    expect(rig.sweeper.tick()).toBe(0);
    expect(rig.isResident("restored")).toBe(true);

    vi.advanceTimersByTime(26 * DAY);

    expect(rig.sweeper.tick()).toBe(1);
    expect(rig.archivedIds).toEqual(["restored"]);
    expect(rig.isResident("restored")).toBe(false);
  });
});

describe("archive sweeper never-archive rules (E17)", () => {
  it("skips live, viewed and non-ended sessions; the viewed one archives after unview", () => {
    const aged = T0 - 45 * DAY;
    const rig = makeRig([
      session({ id: "live", endedAt: aged, live: true }),
      session({ id: "viewed", endedAt: aged }),
      session({ id: "idle", status: "idle", endedAt: undefined, lastActivityAt: aged }),
    ]);
    rig.viewed.add("viewed");

    expect(rig.sweeper.tick()).toBe(0);
    expect(rig.archivedIds).toEqual([]);
    expect(rig.residentIds().sort()).toEqual(["idle", "live", "viewed"]);

    rig.viewed.delete("viewed");

    expect(rig.sweeper.tick()).toBe(1);
    expect(rig.archivedIds).toEqual(["viewed"]);
    expect(rig.residentIds().sort()).toEqual(["idle", "live"]);
  });
});

describe("archive sweeper per-tick cap (E18)", () => {
  it("archives 200 oldest per tick and logs once per non-empty tick", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    // id i has endedAt T0 - (1031 - i) days → id 0 is the oldest, id 999 is
    // 32 d old, so all 1000 are past the 30 d threshold.
    const sessions = Array.from({ length: 1000 }, (_, i) =>
      session({ id: `s${String(i).padStart(4, "0")}`, endedAt: T0 - (1031 - i) * DAY }),
    );
    const rig = makeRig(sessions);

    const perTick: number[] = [];
    for (let t = 0; t < 6; t++) perTick.push(rig.sweeper.tick());

    expect(perTick).toEqual([200, 200, 200, 200, 200, 0]);
    expect(rig.archivedIds).toHaveLength(1000);
    expect(rig.residentIds()).toEqual([]);
    // Oldest-first ordering across the batches.
    expect(rig.archivedIds[0]).toBe("s0000");
    expect(rig.archivedIds[199]).toBe("s0199");
    expect(rig.archivedIds[200]).toBe("s0200");
    expect(rig.archivedIds[999]).toBe("s0999");
    // One log line per non-empty tick — the 6th tick archived nothing.
    expect(info.mock.calls.filter((c) => String(c[0]).startsWith("[archive] sweep"))).toHaveLength(5);
  });
});

describe("archive sweeper zero disables (E19)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sweeper-zero-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("archives nothing on a tick when archiveAfterDays is 0", () => {
    const sessions = Array.from({ length: 100 }, (_, i) =>
      session({ id: `s${i}`, endedAt: T0 - (100 + i) * DAY }),
    );
    const rig = makeRig(sessions);
    rig.config.sessionList.archiveAfterDays = 0;

    expect(rig.sweeper.tick()).toBe(0);
    expect(rig.archivedIds).toEqual([]);
    expect(rig.residentIds()).toHaveLength(100);
  });

  it("rewrites no sidecar on the boot scan when archiveAfterDays is 0", () => {
    const dir = path.join(tmpDir, "--repo--");
    fs.mkdirSync(dir, { recursive: true });
    const files: string[] = [];
    for (let i = 0; i < 100; i++) {
      const id = `aged-${i}`;
      const file = path.join(dir, `2025-01-01T00-00-00-000Z_${id}.jsonl`);
      fs.writeFileSync(file, `${JSON.stringify({ type: "session", id, cwd: "/repo" })}\n`);
      writeSessionMeta(file, {
        cwd: "/repo",
        status: "ended",
        startedAt: T0 - 200 * DAY,
        endedAt: T0 - (100 + i) * DAY,
        // Far-future cache stamp → never stale, so only the archive rule could
        // rewrite the sidecar. (The .jsonl mtime is real wall-clock time.)
        cachedAt: 8_640_000_000_000,
      });
      files.push(file);
    }

    const result = scanAllSessions(tmpDir, { archiveAfterDays: 0, now: T0 });

    expect(result.agedOut).toBe(0);
    expect(result.archived).toEqual([]);
    expect(result.migrated).toBe(0);
    expect(result.cacheUpdates).toBe(0);
    expect(result.sessions).toHaveLength(100);
    for (const file of files) {
      expect(readSessionMeta(file)?.archived).toBeUndefined();
    }
  });
});
