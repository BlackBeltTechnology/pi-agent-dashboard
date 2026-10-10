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
import { STATS_EXTRACTOR_VERSION } from "@blackbelt-technology/pi-dashboard-shared/usage-totals.js";
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
  const archiveCalls: Array<[string, string]> = [];
  const viewed = new Set<string>();
  const config = {
    sessionList: { archiveAfterDays: 30, archiveSweepIntervalMinutes: 60, archiveServiceSessionsOnEnd: true },
  };
  const faults = { failArchive: false };

  const sessionManager = {
    listAll: () => [...live.values()],
    get: (id: string) => live.get(id),
    remove: (id: string) => { live.delete(id); },
  } as unknown as SessionManager;

  const sessionArchive = {
    archiveSession(id: string, reason: string) {
      archiveCalls.push([id, reason]);
      if (faults.failArchive) return { ok: false, error: "disk full" };
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
    archiveCalls,
    faults,
    live,
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
        // Current extractor version, so no version-triggered re-extract either.
        // See change: count-non-message-usage.
        statsExtractorVersion: STATS_EXTRACTOR_VERSION,
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

// ── On-end graced archive of declared-disposable sessions ─────────────────
// test-plan #E6–#E17, #X3, #X4, #X6. Sessions are ended at T0; the
// `sessionManager.onEnded` owner calls `scheduleServiceArchive` (simulated).
// See change: archive-service-sessions-on-end.

const GRACE = 30_000;

function declared(id: string, over: Partial<DashboardSession> = {}): DashboardSession {
  return session({ id, endedAt: T0, archiveOnEnd: true, ...over });
}

describe("service archive: declared session archived after the grace (E6, E7)", () => {
  it("archives once with reason service-end and logs the id", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const rig = makeRig([declared("svc")]);
    rig.sweeper.scheduleServiceArchive("svc");
    vi.advanceTimersByTime(GRACE);
    expect(rig.archiveCalls).toEqual([["svc", "service-end"]]);
    expect(rig.isResident("svc")).toBe(false);
    expect(info.mock.calls.map((c) => String(c[0]))).toContain("[archive] service-end archived svc");
  });

  it("is resident at 29 999 ms and archived at 30 000 ms", () => {
    const rig = makeRig([declared("svc")]);
    rig.sweeper.scheduleServiceArchive("svc");
    vi.advanceTimersByTime(GRACE - 1);
    expect(rig.isResident("svc")).toBe(true);
    expect(rig.archivedIds).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(rig.archivedIds).toEqual(["svc"]);
  });
});

describe("service archive: who is NOT scheduled (E8, E9, E16, E17)", () => {
  it.each<[string, Partial<DashboardSession>]>([
    ["undeclared", { archiveOnEnd: undefined }],
    ["ephemeral only", { archiveOnEnd: undefined, lifecyclePolicy: "ephemeral" }],
  ])("%s: no timer, stays resident", (_label, over) => {
    const rig = makeRig([declared("s", over)]);
    rig.sweeper.scheduleServiceArchive("s");
    expect(rig.sweeper.pendingServiceArchiveCount()).toBe(0);
    vi.advanceTimersByTime(2 * GRACE);
    expect(rig.isResident("s")).toBe(true);
    expect(rig.archiveCalls).toEqual([]);
  });

  it("setting off at end: not archived", () => {
    const rig = makeRig([declared("s")]);
    rig.config.sessionList.archiveServiceSessionsOnEnd = false;
    rig.sweeper.scheduleServiceArchive("s");
    vi.advanceTimersByTime(2 * GRACE);
    expect(rig.isResident("s")).toBe(true);
    expect(rig.archiveCalls).toEqual([]);
  });

  it("not retroactive: enabling the setting later does not archive", () => {
    const rig = makeRig([declared("s")]);
    rig.config.sessionList.archiveServiceSessionsOnEnd = false;
    rig.sweeper.scheduleServiceArchive("s");
    rig.config.sessionList.archiveServiceSessionsOnEnd = true;
    vi.advanceTimersByTime(2 * GRACE);
    expect(rig.isResident("s")).toBe(true);
    expect(rig.archiveCalls).toEqual([]);
  });

  it("restored session re-notified as ended: no timer", () => {
    const rig = makeRig([declared("s", { endedAt: T0 - DAY, restoredAt: T0 - HOUR })]);
    rig.sweeper.scheduleServiceArchive("s");
    expect(rig.sweeper.pendingServiceArchiveCount()).toBe(0);
    vi.advanceTimersByTime(2 * GRACE);
    expect(rig.isResident("s")).toBe(true);
  });
});

describe("service archive: independent of the age threshold (E10)", () => {
  it("archives with archiveAfterDays = 0", () => {
    const rig = makeRig([declared("s")]);
    rig.config.sessionList.archiveAfterDays = 0;
    rig.sweeper.scheduleServiceArchive("s");
    vi.advanceTimersByTime(GRACE);
    expect(rig.archivedIds).toEqual(["s"]);
  });
});

describe("service archive: fire-time re-validation (E11)", () => {
  it.each<[string, (rig: ReturnType<typeof makeRig>) => void]>([
    ["removed", (rig) => { rig.live.delete("s"); }],
    ["status back to idle", (rig) => { rig.live.get("s")!.status = "idle"; }],
    ["declaration cleared", (rig) => { rig.live.get("s")!.archiveOnEnd = undefined; }],
    ["live:true", (rig) => { rig.live.get("s")!.live = true; }],
    ["setting flipped off", (rig) => { rig.config.sessionList.archiveServiceSessionsOnEnd = false; }],
  ])("%s: not archived, timer dropped, no re-arm", (_label, mutate) => {
    const rig = makeRig([declared("s")]);
    rig.sweeper.scheduleServiceArchive("s");
    mutate(rig);
    vi.advanceTimersByTime(GRACE);
    expect(rig.archiveCalls).toEqual([]);
    expect(rig.sweeper.pendingServiceArchiveCount()).toBe(0);
    vi.advanceTimersByTime(10 * GRACE);
    expect(rig.archiveCalls).toEqual([]);
  });
});

describe("service archive: idempotent per id (E12)", () => {
  it("a re-notified end inside the window archives exactly once", () => {
    const rig = makeRig([declared("s")]);
    rig.sweeper.scheduleServiceArchive("s");
    vi.advanceTimersByTime(10_000);
    rig.sweeper.scheduleServiceArchive("s");
    expect(rig.sweeper.pendingServiceArchiveCount()).toBe(1);
    vi.advanceTimersByTime(2 * GRACE);
    expect(rig.archiveCalls).toEqual([["s", "service-end"]]);
  });
});

// CodeRabbit PR #843: a session resumed and ended AGAIN inside the window
// must get a full grace from its latest end (its end handlers run again).
describe("service archive: a new end transition restarts the grace", () => {
  it("archives 30 s after the latest end, not the first", () => {
    const rig = makeRig([declared("s")]);
    rig.sweeper.scheduleServiceArchive("s");
    vi.advanceTimersByTime(20_000);
    const s = rig.live.get("s")!;
    s.endedAt = Date.now(); // resumed + ended again at t=20 s
    rig.sweeper.scheduleServiceArchive("s");
    expect(rig.sweeper.pendingServiceArchiveCount()).toBe(1);
    vi.advanceTimersByTime(GRACE - 20_000);
    expect(rig.isResident("s")).toBe(true);
    vi.advanceTimersByTime(20_000);
    expect(rig.archiveCalls).toEqual([["s", "service-end"]]);
  });
});

describe("service archive: viewed re-arms (E13)", () => {
  it("is deferred while viewed and archived one grace after unview", () => {
    const rig = makeRig([declared("s")]);
    rig.viewed.add("s");
    rig.sweeper.scheduleServiceArchive("s");
    vi.advanceTimersByTime(GRACE);
    expect(rig.isResident("s")).toBe(true);
    expect(rig.sweeper.pendingServiceArchiveCount()).toBe(1);
    rig.viewed.delete("s");
    vi.advanceTimersByTime(GRACE);
    expect(rig.archivedIds).toEqual(["s"]);
  });
});

describe("service archive: restore inside the grace (E14, E15)", () => {
  function archiveThenRestore(rig: ReturnType<typeof makeRig>) {
    vi.advanceTimersByTime(5_000);
    const s = rig.live.get("s")!;
    rig.live.delete("s"); // manual archive evicts
    vi.advanceTimersByTime(5_000);
    rig.live.set("s", { ...s, restoredAt: Date.now(), archived: false }); // unarchive
  }

  it("a manual archive → unarchive is not followed by an automatic re-archive", () => {
    const rig = makeRig([declared("s")]);
    rig.sweeper.scheduleServiceArchive("s");
    archiveThenRestore(rig);
    vi.advanceTimersByTime(25_000);
    expect(rig.isResident("s")).toBe(true);
    expect(rig.archiveCalls).toEqual([]);
  });

  it("restore beats view: dropped, not re-armed", () => {
    const rig = makeRig([declared("s")]);
    rig.sweeper.scheduleServiceArchive("s");
    archiveThenRestore(rig);
    rig.viewed.add("s");
    vi.advanceTimersByTime(25_000);
    expect(rig.sweeper.pendingServiceArchiveCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(rig.isResident("s")).toBe(true);
    expect(rig.archiveCalls).toEqual([]);
  });
});

describe("service archive: stop() (X3, X4)", () => {
  it("cancels every pending timer", () => {
    const rig = makeRig([declared("a"), declared("b"), declared("c")]);
    for (const id of ["a", "b", "c"]) rig.sweeper.scheduleServiceArchive(id);
    expect(rig.sweeper.pendingServiceArchiveCount()).toBe(3);
    rig.sweeper.stop();
    expect(rig.sweeper.pendingServiceArchiveCount()).toBe(0);
    vi.advanceTimersByTime(2 * GRACE);
    expect(rig.archiveCalls).toEqual([]);
  });

  it("latches: no scheduling and no interval after stop()", () => {
    const rig = makeRig([declared("s", { endedAt: T0 - 90 * DAY })]);
    rig.sweeper.stop();
    rig.sweeper.scheduleServiceArchive("s");
    rig.sweeper.start();
    expect(rig.sweeper.pendingServiceArchiveCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(2 * HOUR);
    expect(rig.archiveCalls).toEqual([]);
  });
});

describe("service archive: archive failure at fire (X6)", () => {
  it("does not throw, drops the timer, logs no success", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const rig = makeRig([declared("s")]);
    rig.faults.failArchive = true;
    rig.sweeper.scheduleServiceArchive("s");
    expect(() => vi.advanceTimersByTime(GRACE)).not.toThrow();
    expect(rig.archiveCalls).toEqual([["s", "service-end"]]);
    expect(rig.sweeper.pendingServiceArchiveCount()).toBe(0);
    expect(info.mock.calls.some((c) => String(c[0]).includes("service-end archived"))).toBe(false);
  });
});
