/**
 * Unit tests for the per-HOME advisory lock.
 * See change: single-dashboard-per-home.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireOrAttach,
  canonicalHomedir,
  getLockPath,
  getMetaPath,
  InstanceLockMismatchError,
  isLockDisabled,
  isLockHolderResponsive,
  type LockMetadata,
  readMetadata,
  readMetadataDetailed,
  removeMetadata,
  writeMetadataAtomic,
} from "../lifecycle/home-lock.js";
import {
  __resetInstanceIdCache,
  ensureInstanceId,
  getInstanceIdPath,
  INSTANCE_ID_HEALTH_FIELD,
  instanceIdHealthFields,
} from "../lifecycle/instance-id.js";

// Fresh tmp dir per test → real FS (proper-lockfile needs real FS semantics).
let tmpHome: string;
let lockPath: string;
let metaPath: string;

beforeEach(() => {
  __resetInstanceIdCache();
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-home-lock-test-"));
  lockPath = path.join(tmpHome, ".pi", "dashboard", "server.lock");
  metaPath = `${lockPath}.meta.json`;
});

afterEach(() => {
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function baseConfig(overrides: Partial<Parameters<typeof acquireOrAttach>[0]> = {}) {
  return {
    httpPort: 8000,
    piPort: 9999,
    version: "0.0.0-test",
    // NOTE: `...overrides` comes BEFORE `hooks`, otherwise an override that
    // carries its own `hooks` replaces the whole object and silently drops the
    // injected `lockPath`/`metaPath` — every such test would then run against
    // the real HOME and prove nothing.
    ...overrides,
    hooks: {
      lockPath,
      metaPath,
      staleMs: 500,
      probeHealth: async () => ({ running: false }),
      isProcessAlive: () => false,
      ...(overrides.hooks ?? {}),
    },
  };
}

describe("canonicalHomedir + paths", () => {
  it("returns a path containing .pi/dashboard/server.lock", () => {
    const p = getLockPath();
    expect(p.endsWith(path.join(".pi", "dashboard", "server.lock"))).toBe(true);
  });

  it("getMetaPath appends .meta.json", () => {
    expect(getMetaPath("/x/y/server.lock")).toBe("/x/y/server.lock.meta.json");
  });

  it("canonicalHomedir survives even when homedir is unreadable (tolerant)", () => {
    expect(typeof canonicalHomedir()).toBe("string");
  });

  it.skipIf(process.platform === "win32")("HONOURS $HOME — the lock shares one root with the gateway socket", () => {
    // REVERSED by add-pi-gateway-transport-identity (D2, task 2.0b).
    //
    // The original invariant was $HOME-IMMUNITY, to stop Git Bash
    // ($HOME=/c/Users/R vs os.homedir()=C:\Users\R) producing two divergent
    // canonical locks. That reasoning still holds for `canonicalHomedir()`,
    // which is unchanged and still exported.
    //
    // But the rendezvous record is now the selector a bridge reads to find
    // its dashboard, and the gateway socket next to it resolves through
    // `dashboard-paths.ts`, which HONOURS $HOME. Two different roots would
    // give the temp-HOME isolated-verification workflow an isolated socket
    // and a SHARED lock — precisely the cross-talk that workflow prevents.
    // The record and the socket must share one root, and it is this one.
    const original = process.env.HOME;
    const before = getLockPath();
    try {
      process.env.HOME = "/garbage/not/a/real/path/" + Math.random();
      const after = getLockPath();
      expect(after).not.toBe(before);
      expect(after.startsWith(process.env.HOME)).toBe(true);
      expect(after).toBe(path.join(process.env.HOME, ".pi", "dashboard", "server.lock"));
      // …and `canonicalHomedir()` keeps its $HOME-immunity untouched.
      expect(canonicalHomedir().startsWith(process.env.HOME)).toBe(false);
    } finally {
      if (original === undefined) delete process.env.HOME;
      else process.env.HOME = original;
    }
  });

  it("symlinked homedir canonicalizes to the same lock path on repeated calls", () => {
    const real = fs.mkdtempSync(path.join(os.tmpdir(), "pi-real-"));
    const link = path.join(os.tmpdir(), `pi-link-${Date.now()}-${Math.random()}`);
    fs.symlinkSync(real, link);
    try {
      const a = fs.realpathSync(link);
      const b = fs.realpathSync(link);
      expect(a).toBe(b);
      expect(a).toBe(fs.realpathSync(real));
    } finally {
      try { fs.unlinkSync(link); } catch { /* ignore */ }
      fs.rmSync(real, { recursive: true, force: true });
    }
  });
});

describe("writeMetadataAtomic + readMetadata", () => {
  it("round-trips a metadata object", () => {
    const meta: LockMetadata = {
      pid: 1, ppid: 0, httpPort: 8000, piPort: 9999,
      startedAt: 1, identity: "i", version: "v", url: "http://localhost:8000", hostname: "h",
    };
    writeMetadataAtomic(meta, metaPath);
    expect(readMetadata(metaPath)).toEqual(meta);
  });

  it("readMetadata returns null when file is missing", () => {
    expect(readMetadata(metaPath)).toBeNull();
  });

  it("readMetadata returns null when JSON is corrupt", () => {
    fs.mkdirSync(path.dirname(metaPath), { recursive: true });
    fs.writeFileSync(metaPath, "{not json");
    expect(readMetadata(metaPath)).toBeNull();
  });

  it("readMetadata returns null for shape-mismatched JSON", () => {
    fs.mkdirSync(path.dirname(metaPath), { recursive: true });
    fs.writeFileSync(metaPath, JSON.stringify({ foo: "bar" }));
    expect(readMetadata(metaPath)).toBeNull();
  });

  it("removeMetadata is silent on missing file", () => {
    expect(() => removeMetadata(metaPath)).not.toThrow();
  });
});

describe("isLockHolderResponsive", () => {
  const meta: LockMetadata = {
    pid: 12345, ppid: 0, httpPort: 8000, piPort: 9999,
    startedAt: 0, identity: "id-A", version: "v", url: "http://localhost:8000", hostname: "h",
  };

  it("returns 'dead' when PID is gone", async () => {
    const result = await isLockHolderResponsive(meta, { isProcessAlive: () => false });
    expect(result).toBe("dead");
  });

  it("returns 'dead' when port is not responding", async () => {
    const result = await isLockHolderResponsive(meta, {
      isProcessAlive: () => true,
      probeHealth: async () => ({ running: false }),
    });
    expect(result).toBe("dead");
  });

  it("returns 'alive-match' when identity matches", async () => {
    const result = await isLockHolderResponsive(meta, {
      isProcessAlive: () => true,
      probeHealth: async () => ({ running: true, identity: "id-A", pid: 12345 }),
    });
    expect(result).toBe("alive-match");
  });

  it("returns 'alive-mismatch' when identity differs", async () => {
    const result = await isLockHolderResponsive(meta, {
      isProcessAlive: () => true,
      probeHealth: async () => ({ running: true, identity: "id-B", pid: 99999 }),
    });
    expect(result).toBe("alive-mismatch");
  });

  it("falls back to PID match when identity missing", async () => {
    const matchByPid = await isLockHolderResponsive(meta, {
      isProcessAlive: () => true,
      probeHealth: async () => ({ running: true, pid: 12345 }),
    });
    expect(matchByPid).toBe("alive-match");

    const misMatchByPid = await isLockHolderResponsive(meta, {
      isProcessAlive: () => true,
      probeHealth: async () => ({ running: true, pid: 99999 }),
    });
    expect(misMatchByPid).toBe("alive-mismatch");
  });
});

describe("acquireOrAttach", () => {
  it("acquires a fresh lock and writes metadata", async () => {
    const result = await acquireOrAttach(baseConfig());
    expect(result.mode).toBe("acquired");
    const meta = readMetadata(metaPath);
    expect(meta).not.toBeNull();
    expect(meta?.pid).toBe(process.pid);
    expect(meta?.httpPort).toBe(8000);
    if (result.mode === "acquired") await result.release();
  });

  it("release() removes the metadata sidecar", async () => {
    const result = await acquireOrAttach(baseConfig());
    expect(result.mode).toBe("acquired");
    if (result.mode === "acquired") {
      await result.release();
      expect(readMetadata(metaPath)).toBeNull();
    }
  });

  it("release() is idempotent", async () => {
    const result = await acquireOrAttach(baseConfig());
    if (result.mode === "acquired") {
      await result.release();
      await expect(result.release()).resolves.toBeUndefined();
    }
  });

  it("attaches when a live dashboard already holds the lock", async () => {
    // Acquire as "another process" first.
    const first = await acquireOrAttach(baseConfig({
      identity: "first-instance",
    }));
    expect(first.mode).toBe("acquired");

    // Now mount a probe that says the first is alive + matches.
    const second = await acquireOrAttach(baseConfig({
      hooks: {
        lockPath, metaPath, staleMs: 500,
        isProcessAlive: () => true,
        probeHealth: async () => ({ running: true, identity: "first-instance", pid: process.pid }),
      },
    }));
    expect(second.mode).toBe("attach");
    if (second.mode === "attach") {
      expect(second.meta.identity).toBe("first-instance");
    }
    if (first.mode === "acquired") await first.release();
  });

  it("throws InstanceLockMismatchError on identity mismatch", async () => {
    const first = await acquireOrAttach(baseConfig({ identity: "mine" }));
    expect(first.mode).toBe("acquired");

    await expect(
      acquireOrAttach(baseConfig({
        hooks: {
          lockPath, metaPath, staleMs: 500,
          isProcessAlive: () => true,
          probeHealth: async () => ({ running: true, identity: "someone-else", pid: 99999 }),
        },
      })),
    ).rejects.toBeInstanceOf(InstanceLockMismatchError);

    if (first.mode === "acquired") await first.release();
  });

  it("steals a stale lock (process dead)", async () => {
    const first = await acquireOrAttach(baseConfig({ identity: "stale-holder" }));
    expect(first.mode).toBe("acquired");
    // Don't release — simulate a crash. Then attempt to reacquire with
    // isProcessAlive=false → steal path.

    // proper-lockfile's `stale` option needs the staleMs to have elapsed.
    // We pass a 1ms stale threshold in baseConfig via the hooks override.
    await new Promise(r => setTimeout(r, 50));
    const second = await acquireOrAttach(baseConfig({
      hooks: {
        lockPath, metaPath, staleMs: 1,
        isProcessAlive: () => false,
        probeHealth: async () => ({ running: false }),
      },
    }));
    expect(second.mode).toBe("acquired");
    if (second.mode === "acquired") await second.release();
  });

  it("steals lock when metadata is corrupt", async () => {
    const first = await acquireOrAttach(baseConfig());
    expect(first.mode).toBe("acquired");
    // Corrupt metadata but leave proper-lockfile in place.
    fs.writeFileSync(metaPath, "{not json");
    await new Promise(r => setTimeout(r, 50));

    const second = await acquireOrAttach(baseConfig({
      hooks: {
        lockPath, metaPath, staleMs: 1,
        isProcessAlive: () => false,
        probeHealth: async () => ({ running: false }),
      },
    }));
    expect(second.mode).toBe("acquired");
    if (second.mode === "acquired") await second.release();
  });
});

describe("isLockDisabled", () => {
  it("returns true for PI_DASHBOARD_ALLOW_MULTIPLE=1", () => {
    expect(isLockDisabled({ PI_DASHBOARD_ALLOW_MULTIPLE: "1" })).toBe(true);
  });
  it("returns true for PI_DASHBOARD_ALLOW_MULTIPLE=true", () => {
    expect(isLockDisabled({ PI_DASHBOARD_ALLOW_MULTIPLE: "true" })).toBe(true);
  });
  it("returns false when unset", () => {
    expect(isLockDisabled({})).toBe(false);
  });
  it("returns false for other values", () => {
    expect(isLockDisabled({ PI_DASHBOARD_ALLOW_MULTIPLE: "0" })).toBe(false);
    expect(isLockDisabled({ PI_DASHBOARD_ALLOW_MULTIPLE: "yes" })).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// Persisted per-instance rendezvous id (D14 / defect B1)
// See change: add-pi-gateway-transport-identity.
// ──────────────────────────────────────────────────────────

describe("ensureInstanceId", () => {
  // (test-plan #E3) The id must survive a restart, or a benign restart is
  // indistinguishable from an endpoint capture and D4 stickiness refuses a
  // bridge its own dashboard.
  it("is unchanged across a restart on the same port", () => {
    const env = { homedir: tmpHome };
    const first = ensureInstanceId(env, 9999);
    const second = ensureInstanceId(env, 9999);
    expect(second).toBe(first);
    expect(first).not.toHaveLength(0);
  });

  // (test-plan #E4) …and distinct across instances, or a foreign listener
  // cannot be rejected.
  it("differs between two instances on different ports", () => {
    const env = { homedir: tmpHome };
    expect(ensureInstanceId(env, 9999)).not.toBe(ensureInstanceId(env, 9594));
  });

  // (test-plan #E5)
  it("writes the id file 0600 inside a 0700 dir", () => {
    const env = { homedir: tmpHome };
    ensureInstanceId(env, 9999);
    const file = getInstanceIdPath(env, 9999);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
  });

  // Task 2.0d-ii: a cross-model reviewer conflated the per-HOME Ed25519
  // fingerprint with the per-instance rendezvous id. They are different
  // things; the fingerprint cannot answer "which instance".
  it("is not the per-HOME Ed25519 fingerprint (two instances, one HOME)", () => {
    const env = { homedir: tmpHome };
    const a = ensureInstanceId(env, 9999);
    const b = ensureInstanceId(env, 9594);
    // A per-HOME value would be equal here; a per-instance one is not.
    expect(a).not.toBe(b);
    // …and it is not derived from identity.key, which need not even exist.
    expect(fs.existsSync(path.join(tmpHome, ".pi", "dashboard", "identity.key"))).toBe(false);
  });

  it("stores the id under <configDir>/instances/<piPort>.id", () => {
    const env = { homedir: tmpHome };
    expect(getInstanceIdPath(env, 9999)).toBe(
      path.join(tmpHome, ".pi", "dashboard", "instances", "9999.id"),
    );
  });

  it("regenerates when the stored id is empty or corrupt", () => {
    const env = { homedir: tmpHome };
    const first = ensureInstanceId(env, 9999);
    fs.writeFileSync(getInstanceIdPath(env, 9999), "   ");
    __resetInstanceIdCache();
    const second = ensureInstanceId(env, 9999);
    expect(second).not.toBe(first);
    expect(second.trim()).toBe(second);
  });
});

// (test-plan #E6) Health field naming regression — defect B1 / task 2.0e-i.
//
// `isLockHolderResponsive` used to read `identity` while the route published
// nothing of the sort, so the comparison fell through to the PID branch and
// the verification silently never ran. These tests pin the two ends together:
// the probe reads the SAME field `/api/health` publishes, and the PID branch
// is provably not what produced the verdict (the pids deliberately disagree).
describe("instance id: publish site and probe site agree", () => {
  const meta = (identity: string): LockMetadata => ({
    pid: 4242,
    ppid: 1,
    httpPort: 8000,
    piPort: 9999,
    startedAt: Date.now(),
    identity,
    version: "test",
    url: "http://localhost:8000",
    hostname: "test-host",
  });

  it("matches on the published field, not on the pid", async () => {
    const published = instanceIdHealthFields("instance-A");
    const verdict = await isLockHolderResponsive(meta("instance-A"), {
      isProcessAlive: () => true,
      // Exactly what defaultProbeHealth extracts from the health body.
      probeHealth: async () => ({
        running: true,
        pid: 9999, // deliberately NOT meta.pid — the PID branch would mismatch
        instanceId: published[INSTANCE_ID_HEALTH_FIELD],
      }),
    });
    expect(verdict).toBe("alive-match");
  });

  it("mismatches a foreign instance even when the pid happens to match", async () => {
    const published = instanceIdHealthFields("instance-B");
    const verdict = await isLockHolderResponsive(meta("instance-A"), {
      isProcessAlive: () => true,
      probeHealth: async () => ({
        running: true,
        pid: 4242, // same pid — the PID branch would wrongly say alive-match
        instanceId: published[INSTANCE_ID_HEALTH_FIELD],
      }),
    });
    expect(verdict).toBe("alive-mismatch");
  });

  it("publishes under `instanceId`, never under `identity`", () => {
    const fields = instanceIdHealthFields("x");
    expect(INSTANCE_ID_HEALTH_FIELD).toBe("instanceId");
    expect(fields).toEqual({ instanceId: "x" });
    // `identity` is already bound to the Ed25519 object in server.ts; reusing
    // it here makes every second instance throw InstanceLockMismatchError.
    expect(fields).not.toHaveProperty("identity");
  });
});

// (test-plan #E10, #E11) Absent ≠ unreadable ≠ invalid — defect B2, task 2.0i.
describe("readMetadataDetailed", () => {
  const write = (body: string): string => {
    fs.mkdirSync(path.dirname(metaPath), { recursive: true });
    fs.writeFileSync(metaPath, body);
    return metaPath;
  };

  it("absent record reports `absent` (takeover permitted)", () => {
    expect(readMetadataDetailed(metaPath)).toEqual({ status: "absent" });
  });

  it.skipIf(process.getuid?.() === 0)("unreadable record reports `unreadable`, NOT absent", () => {
    write(JSON.stringify({ pid: 1 }));
    fs.chmodSync(metaPath, 0o000);
    // Mode 000 is what makes this unreadable; root would defeat it, hence the
    // skipIf above (a silent early-return would report a vacuous PASS).
    expect(readMetadataDetailed(metaPath).status).toBe("unreadable");
  });

  it("record truncated mid-JSON is treated as absent, never partially trusted", () => {
    const full = JSON.stringify({
      pid: 1, ppid: 0, httpPort: 8000, piPort: 9999, startedAt: 1,
      identity: "i", version: "v", url: "u", hostname: "h",
    });
    write(full.slice(0, Math.floor(full.length / 2)));
    const res = readMetadataDetailed(metaPath);
    expect(res.status).toBe("invalid");
    expect(readMetadata(metaPath)).toBeNull();
  });

  it("a well-formed record reads back", () => {
    const meta: LockMetadata = {
      pid: 1, ppid: 0, httpPort: 8000, piPort: 9999, startedAt: 1,
      identity: "i", version: "v", url: "u", hostname: "h",
    };
    writeMetadataAtomic(meta, metaPath);
    expect(readMetadataDetailed(metaPath)).toEqual({ status: "ok", meta });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// (test-plan #E13) Takeover is acquire-then-verify — task 2.0h/2.0h-i.
//
// The old steal path unlocked and removed the metadata UNCONDITIONALLY, so
// two starters that each observed the SAME dead holder could each delete the
// other's live lock and fresh record: both end up "acquired", both believe
// they own the HOME, and the record names whichever wrote last.
//
// `proper-lockfile` does not fix this — its stale path is
// `stat → isLockStale → removeLock → acquireLock` with no re-stat before the
// removal (`proper-lockfile/lib/lockfile.js:70-79`).
// ──────────────────────────────────────────────────────────────────────────
describe("lock takeover under a race (defect B2)", () => {
  const deadHolder = (identity: string): LockMetadata => ({
    pid: 2147483646, // never alive
    ppid: 1,
    httpPort: 8000,
    piPort: 9999,
    startedAt: 1,
    identity,
    version: "0.0.0-dead",
    url: "http://localhost:8000",
    hostname: "dead-host",
  });

  /** Put a dead holder's lock + record on disk, exactly as a crash leaves it. */
  const seedDeadHolder = async (identity: string) => {
    const properLockfile = (await import("proper-lockfile")).default;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "# seeded\n");
    // `update: 0` disables proper-lockfile's mtime refresher: with it running,
    // a same-process seed lock notices its own takeover and self-destructs,
    // which would let a later acquire succeed for a reason the test is not
    // about.
    await properLockfile.lock(lockPath, {
      stale: 60_000,
      retries: 0,
      realpath: false,
      update: 0,
    });
    writeMetadataAtomic(deadHolder(identity), metaPath);
  };

  it("two starters observing one dead holder yield exactly ONE owner", async () => {
    await seedDeadHolder("dead-1");

    const results = await Promise.allSettled([
      acquireOrAttach(baseConfig({ identity: "starter-a" })),
      acquireOrAttach(baseConfig({ identity: "starter-b" })),
    ]);

    const acquired = results.filter(
      (r) => r.status === "fulfilled" && r.value.mode === "acquired",
    );
    expect(acquired).toHaveLength(1);

    // And the record must name the single owner — not a deleted/blank state.
    const owner = (acquired[0] as PromiseFulfilledResult<{ meta: LockMetadata }>).value.meta;
    expect(readMetadata(metaPath)?.identity).toBe(owner.identity);

    for (const r of results) {
      if (r.status === "fulfilled" && r.value.mode === "acquired") await r.value.release();
    }
  });

  it("a newcomer does NOT clobber a record that stopped naming the holder it observed dead", async () => {
    // The window this closes: we read the record, conclude the holder is dead,
    // and by the time we hold the lock somebody else has already taken over
    // and written a FRESH record. Unconditional removal would delete a live
    // owner's record; acquire-then-verify must abandon and attach instead.
    await seedDeadHolder("dead-1");

    let probes = 0;
    const late = await acquireOrAttach(
      baseConfig({
        identity: "latecomer",
        hooks: {
          isProcessAlive: () => true,
          probeHealth: async () => {
            probes += 1;
            if (probes === 1) {
              // Our observation: the recorded holder is gone. Meanwhile a
              // winner takes over and rewrites the record.
              writeMetadataAtomic({ ...deadHolder("winner"), pid: process.pid }, metaPath);
              return { running: false };
            }
            return { running: true, instanceId: "winner" };
          },
        },
      }),
    );

    expect(late.mode).toBe("attach");
    expect(readMetadata(metaPath)?.identity).toBe("winner");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// (@review Audit, major) `readMetadataDetailed` was added to fix defect B2 —
// "a live holder whose sidecar is momentarily unreadable can be stolen from" —
// but `acquireOrAttach` still read through `readMetadata`, which collapses
// EACCES/EIO to null. A null record after 500ms is treated as stale and
// force-stolen: unlock another process's LIVE lock, remove its record, rebind.
// Two dashboards per HOME, from a permissions blip.
// ──────────────────────────────────────────────────────────────────────────
describe("an UNREADABLE record is not a stealable one (defect B2)", () => {
  it.skipIf(process.getuid?.() === 0)("fails loudly instead of stealing", async () => {
    const properLockfile = (await import("proper-lockfile")).default;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "# seeded\n");
    await properLockfile.lock(lockPath, { stale: 60_000, retries: 0, realpath: false, update: 0 });
    writeMetadataAtomic(
      {
        pid: process.pid, ppid: 1, httpPort: 8000, piPort: 9999, startedAt: 1,
        identity: "live-holder", version: "v", url: "u", hostname: "h",
      },
      metaPath,
    );
    // Mode 000 is what makes it unreadable; root would defeat it, hence skipIf.
    fs.chmodSync(metaPath, 0o000);

    await expect(acquireOrAttach(baseConfig({ identity: "thief" }))).rejects.toThrow(
      /unreadable/i,
    );
    // And the live holder's record is still there, untouched.
    fs.chmodSync(metaPath, 0o600);
    expect(readMetadata(metaPath)?.identity).toBe("live-holder");
  });
});
