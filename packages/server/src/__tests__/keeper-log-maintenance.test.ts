/**
 * Keeper-log maintenance tests — startup sweep + cached stats
 * (fix-runaway-keeper-log-growth, tasks 3.5-3.13 and 4.3-4.7).
 *
 * Sweep contract (design D5): truncate oversized+aged keeper logs of sessions
 * with NO live keeper process; NEVER unlink; launch logs are never swept.
 * The liveness gate reads the keeper PID sidecar with isProcessAlive —
 * deliberately NOT isKeeperAlive (which would demand a live pi too).
 *
 * Stats contract (design D6): cached at most statsTtlMs; `runawayFiles`
 * counts logs at/over 2× cap; launch logs counted separately; reclaimedBytes
 * owned by the sweep and preserved across refreshes.
 */
import { chmodSync, existsSync, readdirSync, mkdirSync, mkdtempSync, rmSync, statSync, truncateSync as realTruncateSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createKeeperManager,
  EMPTY_KEEPER_LOG_STATS,
  DEFAULT_KEEPER_LOG_MAX_BYTES,
  DEFAULT_SWEEP_MIN_AGE_MS,
  DEFAULT_KEEPER_LOG_STATS_TTL_MS,
  pidPathFor,
  piPidPathFor,
  type KeeperManagerOptions,
} from "../rpc-keeper/keeper-manager.js";

const KNOWN_DEAD_PID = 99999999;

let tmpRoot: string;
let sessionsDir: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "klog-"));
  sessionsDir = path.join(tmpRoot, ".pi", "dashboard", "sessions");
  mkdirSync(sessionsDir, { recursive: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmpRoot, { recursive: true, force: true });
});

function baseOpts(extra: Partial<KeeperManagerOptions> = {}): KeeperManagerOptions {
  return {
    sessionsDir,
    keeperPath: path.resolve(__dirname, "..", "rpc-keeper", "keeper.cjs"),
    nodeBinary: "/usr/bin/node",
    platform: process.platform,
    ...extra,
  };
}

function makeManager(extra: Partial<KeeperManagerOptions> = {}) {
  return createKeeperManager(baseOpts(extra));
}

function writeLog(name: string, bytes: number): string {
  const p = path.join(sessionsDir, name);
  writeFileSync(p, "x".repeat(Math.min(bytes, 4096)));
  if (bytes > 4096) realTruncateSync(p, bytes); // sparse — stat.size is what matters
  return p;
}

function ageLog(p: string, minutesAgo: number): void {
  const t = new Date(Date.now() - minutesAgo * 60_000);
  utimesSync(p, t, t);
}

function writePidSidecar(sid: string, pid: number): void {
  writeFileSync(pidPathFor(sessionsDir, sid), String(pid));
}

// ── Sweep ────────────────────────────────────────────────────────────────────

describe("sweepKeeperLogs — size/age gates", () => {
  it("E10: log at maxBytes−1 keeps its size; at exactly maxBytes is truncated to 0; both files still exist", () => {
    const cap = 1024;
    const below = writeLog("keeper-below.log", cap - 1);
    const at = writeLog("keeper-at.log", cap);
    ageLog(below, 10);
    ageLog(at, 10);

    const r = makeManager({ maxBytes: cap, sweepMinAgeMs: 60_000 }).sweepKeeperLogs();

    expect(statSync(below).size).toBe(cap - 1); // untouched
    expect(statSync(at).size).toBe(0); // reclaimed
    expect(existsSync(below)).toBe(true); // never unlinked
    expect(existsSync(at)).toBe(true);
    expect(r.reclaimedFiles).toBe(1);
    expect(r.reclaimedBytes).toBe(cap);
  });

  it("E11: age gate — 4-min-old oversized log untouched; 6-min-old truncated (sweepMinAgeMs 5 min)", () => {
    const cap = 1024;
    const fresh = writeLog("keeper-fresh.log", cap * 4);
    const old = writeLog("keeper-old.log", cap * 4);
    ageLog(fresh, 4);
    ageLog(old, 6);

    const r = makeManager({ maxBytes: cap, sweepMinAgeMs: 5 * 60_000 }).sweepKeeperLogs();

    expect(statSync(fresh).size).toBe(cap * 4);
    expect(statSync(old).size).toBe(0);
    expect(r.reclaimedFiles).toBe(1);
  });

  it("E12: launch logs are excluded from the sweep — even at 10× cap, aged, with no live process", () => {
    const cap = 1024;
    const launch = writeLog("keeper-launch-abc123.log", cap * 10);
    ageLog(launch, 30);

    const r = makeManager({ maxBytes: cap, sweepMinAgeMs: 60_000 }).sweepKeeperLogs();

    expect(statSync(launch).size).toBe(cap * 10); // untouched
    expect(r.reclaimedFiles).toBe(0);
    expect(r.reclaimedBytes).toBe(0);
  });

  it("E15: with NO threshold options the defaults hold (128 MiB cap, 5 min age, 60 s TTL)", () => {
    // Sparse files make the 128 MiB boundary cheap: stat.size is what the
    // sweep reads; truncate-to-zero of a sparse file frees no real blocks.
    const under = writeLog("keeper-under-default.log", DEFAULT_KEEPER_LOG_MAX_BYTES - 1);
    const over = writeLog("keeper-over-default.log", DEFAULT_KEEPER_LOG_MAX_BYTES);
    ageLog(under, 4);
    ageLog(over, 6);

    const km = makeManager(); // no options at all
    const r = km.sweepKeeperLogs();

    expect(statSync(under).size).toBe(DEFAULT_KEEPER_LOG_MAX_BYTES - 1); // 4 min < 5 min age gate
    expect(statSync(over).size).toBe(0); // 6 min, at the 128 MiB cap → reclaimed
    expect(r.reclaimedFiles).toBe(1);
    expect(r.reclaimedBytes).toBe(DEFAULT_KEEPER_LOG_MAX_BYTES);
    // The default constants match the documented values.
    expect(DEFAULT_SWEEP_MIN_AGE_MS).toBe(300_000);
    expect(DEFAULT_KEEPER_LOG_STATS_TTL_MS).toBe(60_000);
  });
});

describe("sweepKeeperLogs — liveness gate (PID sidecar → isProcessAlive, NOT isKeeperAlive)", () => {
  it("X5: a live keeper's oversized aged log survives, counted as skipped-live", () => {
    const cap = 1024;
    const log = writeLog("keeper-live.log", cap * 4);
    ageLog(log, 30);
    writePidSidecar("live", process.pid); // alive

    const r = makeManager({ maxBytes: cap, sweepMinAgeMs: 60_000 }).sweepKeeperLogs();

    expect(statSync(log).size).toBe(cap * 4);
    expect(r.skippedLive).toBe(1);
    expect(r.reclaimedFiles).toBe(0);
  });

  it("X6: a live keeper with a DEAD pi survives — isKeeperAlive would say false; the sweep does not", () => {
    const cap = 1024;
    const log = writeLog("keeper-orphan.log", cap * 4);
    ageLog(log, 30);
    writePidSidecar("orphan", process.pid); // keeper alive
    writeFileSync(piPidPathFor(sessionsDir, "orphan"), String(KNOWN_DEAD_PID)); // pi dead

    const r = makeManager({ maxBytes: cap, sweepMinAgeMs: 60_000 }).sweepKeeperLogs();

    expect(statSync(log).size).toBe(cap * 4);
    expect(r.skippedLive).toBe(1);
  });

  it("a fresh oversized log with NO sidecar yet survives (still-starting keeper; age gate covers it)", () => {
    const cap = 1024;
    const log = writeLog("keeper-starting.log", cap * 4); // mtime = now
    writePidSidecar("starting", KNOWN_DEAD_PID); // stale sidecar would be unlinked by discovery

    const r = makeManager({ maxBytes: cap, sweepMinAgeMs: 60_000 }).sweepKeeperLogs();

    expect(statSync(log).size).toBe(cap * 4);
    expect(r.reclaimedFiles).toBe(0);
  });

  it("X7: the sweep NEVER unlinks — mixed fixture, readdir set equality before and after", () => {
    const cap = 1024;
    const names = [
      "keeper-live-big.log", // live + big → skip
      "keeper-dead-big.log", // dead + big + aged → truncate
      "keeper-dead-small.log", // dead + small → keep
      "keeper-dead-fresh.log", // dead + big + fresh → keep
      "keeper-launch-big.log", // launch → never swept
      "keeper-dead-aged.log", // dead + big + aged → truncate
    ];
    const sizes: Record<string, number> = {
      "keeper-live-big.log": cap * 4,
      "keeper-dead-big.log": cap * 4,
      "keeper-dead-small.log": 10,
      "keeper-dead-fresh.log": cap * 4,
      "keeper-launch-big.log": cap * 10,
      "keeper-dead-aged.log": cap * 4,
    };
    for (const n of names) {
      const p = writeLog(n, sizes[n]);
      if (n !== "keeper-dead-fresh.log") ageLog(p, 30);
    }
    writePidSidecar("live-big", process.pid);
    writePidSidecar("dead-big", KNOWN_DEAD_PID);
    writePidSidecar("dead-small", KNOWN_DEAD_PID);
    writePidSidecar("dead-fresh", KNOWN_DEAD_PID);
    writePidSidecar("dead-aged", KNOWN_DEAD_PID);
    // keeper-launch-big + one untracked file stay sidecar-less.

    const before = new Set([...readdirSync(sessionsDir)]);
    makeManager({ maxBytes: cap, sweepMinAgeMs: 60_000 }).sweepKeeperLogs();
    const after = new Set([...readdirSync(sessionsDir)]);

    expect([...after].sort()).toEqual([...before].sort()); // NOTHING removed
    expect(statSync(path.join(sessionsDir, "keeper-dead-big.log")).size).toBe(0);
    expect(statSync(path.join(sessionsDir, "keeper-dead-aged.log")).size).toBe(0);
    expect(statSync(path.join(sessionsDir, "keeper-launch-big.log")).size).toBe(cap * 10);
  });

  it("X8: a truncate failure on one file does not fail the sweep — the others are reclaimed", () => {
    // Real EACCES via file mode (write bit stripped) instead of an fs spy —
    // node:fs's ESM namespace is not spyable. Root ignores file modes, so
    // this scenario is skipped there.
    if (typeof process.getuid === "function" && process.getuid() === 0) return;
    const cap = 1024;
    const a = writeLog("keeper-a.log", cap * 2);
    const b = writeLog("keeper-b.log", cap * 2);
    const c = writeLog("keeper-c.log", cap * 2);
    for (const p of [a, b, c]) ageLog(p, 30);
    chmodSync(b, 0o444); // truncateSync(path) → EACCES for this one file

    const r = makeManager({ maxBytes: cap, sweepMinAgeMs: 60_000 }).sweepKeeperLogs();

    expect(statSync(a).size).toBe(0);
    expect(statSync(b).size).toBe(cap * 2); // failed — untouched
    expect(statSync(c).size).toBe(0);
    expect(r.reclaimedFiles).toBe(2);
    expect(r.reclaimedBytes).toBe(cap * 4);
  });

  it("X9: unsafe test home — the sweep is blocked entirely: nothing scanned, nothing touched", () => {
    const cap = 1024;
    const log = writeLog("keeper-victim.log", cap * 8);
    ageLog(log, 60);
    // An oversized aged DEAD log that a guarded-off sweep would reclaim.
    writePidSidecar("victim", KNOWN_DEAD_PID);

    const r = makeManager({ maxBytes: cap, sweepMinAgeMs: 60_000, isUnsafeTestHomeScan: () => true }).sweepKeeperLogs();

    expect(r).toEqual({ scanned: 0, reclaimedFiles: 0, reclaimedBytes: 0, skippedLive: 0 });
    expect(statSync(log).size).toBe(cap * 8); // no directory scan reached it
  });
});

// ── Stats ────────────────────────────────────────────────────────────────────

describe("getKeeperLogStats — cached snapshot", () => {
  it("E13: launch logs counted separately; fileCount/totalBytes exclude them", () => {
    writeLog("keeper-launch-one.log", 1024);
    writeLog("keeper-launch-two.log", 3072);
    writeLog("keeper-real.log", 512);

    const stats = makeManager({ maxBytes: 1024 }).getKeeperLogStats();

    expect(stats.launchLogFiles).toBe(2);
    expect(stats.launchLogBytes).toBe(4096);
    expect(stats.fileCount).toBe(1);
    expect(stats.totalBytes).toBe(512);
  });

  it("E14: runawayFiles threshold — counts only logs at/over 2× cap; largestBytes is the raw max", () => {
    writeLog("keeper-cap.log", 1024); // exactly cap → not runaway
    writeLog("keeper-under2x.log", 2047); // 2×cap − 1 → not runaway
    writeLog("keeper-at2x.log", 2048); // 2×cap → runaway

    const stats = makeManager({ maxBytes: 1024 }).getKeeperLogStats();

    expect(stats.runawayFiles).toBe(1);
    expect(stats.largestBytes).toBe(2048);
  });

  it("X11: reclaimedBytes survives a TTL expiry + rescan (owned by the sweep, not the refresh)", async () => {
    const cap = 1024;
    const victim = writeLog("keeper-victim11.log", 3 * 1024 * 1024); // sparse 3 MiB
    ageLog(victim, 30);
    writePidSidecar("victim11", KNOWN_DEAD_PID);

    const km = makeManager({ maxBytes: cap, sweepMinAgeMs: 60_000, statsTtlMs: 30 });
    const sweep = km.sweepKeeperLogs();
    expect(sweep.reclaimedBytes).toBe(3 * 1024 * 1024);
    expect(km.getKeeperLogStats().reclaimedBytes).toBe(3 * 1024 * 1024);

    // Mutate the directory (as an unrelated later write would), expire the TTL…
    writeLog("keeper-after-sweep.log", 777);
    await new Promise((r) => setTimeout(r, 60));

    const after = km.getKeeperLogStats();
    expect(after.reclaimedBytes).toBe(3 * 1024 * 1024); // NOT zeroed by the rescan
    expect(after.totalBytes).toBe(777); // …but the live fields DID refresh
  });

  it("P4: 50 stats reads inside the TTL trigger no additional directory scan", () => {
    // Behavioral scan-count proxy (node:fs is not spyable in ESM): after the
    // boot sweep seeds the snapshot, a directory mutation within the TTL
    // window must stay INVISIBLE across 50 reads — only a rescan could see it.
    writeLog("keeper-p4.log", 4096);
    const km = makeManager({ maxBytes: 1024, statsTtlMs: DEFAULT_KEEPER_LOG_STATS_TTL_MS });
    km.sweepKeeperLogs(); // boot-time sweep: scan #1 (also seeds the snapshot)
    expect(km.getKeeperLogStats().totalBytes).toBe(4096);

    writeLog("keeper-p4-added-later.log", 111); // mutation AFTER the snapshot
    for (let i = 0; i < 50; i++) {
      expect(km.getKeeperLogStats().totalBytes).toBe(4096); // cached — the mutation is invisible
    }
  });

  it("X10 (unit half): a deleted sessions dir yields the typed zero constant from the stats path", () => {
    rmSync(sessionsDir, { recursive: true, force: true });
    const km = makeManager({ maxBytes: 1024 });
    km.sweepKeeperLogs(); // must not throw
    expect(km.getKeeperLogStats()).toEqual(EMPTY_KEEPER_LOG_STATS);
    expect(EMPTY_KEEPER_LOG_STATS).toEqual({
      totalBytes: 0,
      fileCount: 0,
      largestBytes: 0,
      reclaimedBytes: 0,
      runawayFiles: 0,
      launchLogFiles: 0,
      launchLogBytes: 0,
    });
  });
});
