/**
 * auth.json lock coordination with pi (test-plan E1–E5, X1, X2).
 *
 * Runs against the REAL `provider-auth-storage` module in the per-file tmp
 * $HOME (`setup-home-perfile.ts`). The competing holder simulates pi 0.86.1's
 * async refresh lock, so it uses pi's LITERAL options and deliberately does
 * NOT import `LOCK_OPTIONS`: importing the value under test would move the
 * holder and the writer together and hide a regression (design D1).
 *
 * Ageing a lock = `fs.utimesSync` on the `auth.json.lock` directory, which is
 * the mtime proper-lockfile's `isLockStale` compares against the ACQUIRER's
 * `stale`.
 *
 * See change: harden-auth-json-lock-coordination.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const _require = createRequire(import.meta.url);
const lockfile = _require("proper-lockfile") as typeof import("proper-lockfile");

/** pi 0.86.1 `auth-storage.js` `withLockAsync` options — literal on purpose. */
const PI_LOCK_OPTIONS = { stale: 30_000, realpath: false } as const;

const AUTH_DIR = path.join(os.homedir(), ".pi", "agent");
const AUTH_PATH = path.join(AUTH_DIR, "auth.json");
const LOCK_PATH = `${AUTH_PATH}.lock`;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const sha = (p: string) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");

/** Set the lockfile's mtime `ageMs` into the past. */
function ageLock(ageMs: number): Date {
  const when = new Date(Date.now() - ageMs);
  fs.utimesSync(LOCK_PATH, when, when);
  return when;
}

/** A pi-like live holder. Its compromise handler is inert: the test ages its
 *  mtime on purpose and releases long before its 15 s update timer fires. */
async function piHolder(): Promise<() => Promise<void>> {
  const release = await lockfile.lock(AUTH_PATH, { ...PI_LOCK_OPTIONS, onCompromised: () => {} });
  let done = false;
  return async () => {
    if (done) return;
    done = true;
    try { await release(); } catch { /* already released */ }
  };
}

async function storage() {
  vi.resetModules();
  return await import("../auth/provider-auth-storage.js");
}

beforeEach(() => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.rmSync(AUTH_PATH, { force: true });
  fs.rmSync(LOCK_PATH, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("auth.json lock staleness — aligned with pi's refresh lock", () => {
  // #E1
  it("E1: LOCK_OPTIONS is exported with stale >= 30 s and realpath:false", async () => {
    const { LOCK_OPTIONS } = await storage();
    expect(LOCK_OPTIONS.stale).toBeGreaterThanOrEqual(30_000);
    expect(LOCK_OPTIONS.realpath).toBe(false);
  });

  // #E2 — inside the OLD theft band (10–15 s): stale:10_000 stole this lock.
  it("E2: a live holder whose mtime is 12 s old is not stolen", async () => {
    const { writeCredential } = await storage();
    await writeCredential("seed", { type: "api_key", key: "seed-key" });
    const before = sha(AUTH_PATH);

    const release = await piHolder();
    const aged = ageLock(12_000);
    try {
      const started = Date.now();
      await expect(writeCredential("e2", { type: "api_key", key: "k" })).rejects.toMatchObject({ code: "ELOCKED" });
      expect(Date.now() - started).toBeGreaterThanOrEqual(1_900);
      expect(fs.existsSync(LOCK_PATH)).toBe(true);
      expect(fs.statSync(LOCK_PATH).mtime.getTime()).toBe(aged.getTime());
      expect(sha(AUTH_PATH)).toBe(before);
    } finally {
      await release();
    }
  }, 10_000);

  // #E3 — just below the threshold. Aged to 27 s, not 29 s: the lock keeps
  // ageing through the 2 s retry window, and a 29 s start would cross 30 s
  // mid-window and be (correctly) reclaimed. 27 s + 2 s stays below stale.
  it("E3: a live holder just below the stale threshold is not stolen", async () => {
    const { writeCredential } = await storage();
    await writeCredential("seed", { type: "api_key", key: "seed-key" });
    const before = sha(AUTH_PATH);

    const release = await piHolder();
    const aged = ageLock(27_000);
    try {
      await expect(writeCredential("e3", { type: "api_key", key: "k" })).rejects.toMatchObject({ code: "ELOCKED" });
      expect(fs.statSync(LOCK_PATH).mtime.getTime()).toBe(aged.getTime());
      expect(sha(AUTH_PATH)).toBe(before);
    } finally {
      await release();
    }
  }, 10_000);

  // #E4
  it("E4: an orphaned lock older than the threshold is reclaimed", async () => {
    const { writeCredential, readAuthJson } = await storage();
    fs.mkdirSync(LOCK_PATH);
    ageLock(31_000);

    await expect(writeCredential("e4", { type: "api_key", key: "k4" })).resolves.toBeUndefined();
    expect(readAuthJson().e4).toEqual({ type: "api_key", key: "k4" });
  }, 10_000);

  // #E5 — the refresh path's longer window must not leak into interactive writes.
  it("E5: interactive removal still gives up after ~2 s", async () => {
    const { writeCredential, removeCredential } = await storage();
    await writeCredential("e5", { type: "api_key", key: "keep" });
    const before = sha(AUTH_PATH);

    const release = await piHolder();
    setTimeout(() => release().catch(() => { /* released by finally */ }), 5_000);
    try {
      const started = Date.now();
      await expect(removeCredential("e5")).rejects.toMatchObject({ code: "ELOCKED" });
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(1_900);
      expect(elapsed).toBeLessThanOrEqual(2_500);
      expect(sha(AUTH_PATH)).toBe(before);
    } finally {
      await release();
    }
  }, 10_000);
});

describe("auth.json lock compromise — contained, never thrown from a timer", () => {
  type LockOpts = { onCompromised?: (err: Error) => void };

  // #X1
  it("X1: a compromise reported before the write fails it with ECOMPROMISED", async () => {
    const { writeCredential } = await storage();
    await writeCredential("seed", { type: "api_key", key: "sk-SEED-SECRET-000" });
    const before = sha(AUTH_PATH);

    const realLock = lockfile.lock.bind(lockfile);
    vi.spyOn(lockfile, "lock").mockImplementation((async (file: string, opts: LockOpts) => {
      const release = await realLock(file, opts as never);
      opts.onCompromised?.(Object.assign(new Error("Unable to update lock within the stale threshold"), { code: "ECOMPROMISED" }));
      return release;
    }) as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(writeCredential("x1", { type: "api_key", key: "sk-X1-SECRET-111" })).rejects.toMatchObject({ code: "ECOMPROMISED" });

    expect(sha(AUTH_PATH)).toBe(before);
    const lines = warn.mock.calls.map((c) => c.map(String).join(" "));
    const compromise = lines.filter((l) => l.includes("ECOMPROMISED"));
    expect(compromise).toHaveLength(1);
    for (const l of lines) {
      expect(l).not.toContain("sk-X1-SECRET-111");
      expect(l).not.toContain("sk-SEED-SECRET-000");
    }
    // The lock was released despite the failure — a follow-up write goes through.
    vi.mocked(lockfile.lock).mockRestore();
    await expect(writeCredential("x1", { type: "api_key", key: "k" })).resolves.toBeUndefined();
  }, 10_000);

  // #X2
  it("X2: a compromise reported after release does not crash the process", async () => {
    const { writeCredential, readAuthJson } = await storage();
    const captured: Array<(err: Error) => void> = [];
    const realLock = lockfile.lock.bind(lockfile);
    vi.spyOn(lockfile, "lock").mockImplementation((async (file: string, opts: LockOpts) => {
      if (opts.onCompromised) captured.push(opts.onCompromised);
      return realLock(file, opts as never);
    }) as never);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const faults: unknown[] = [];
    const onFault = (e: unknown) => { faults.push(e); };
    process.on("uncaughtException", onFault);
    process.on("unhandledRejection", onFault);
    try {
      await writeCredential("x2", { type: "api_key", key: "k2" });
      expect(captured).toHaveLength(1);
      setTimeout(() => {
        captured[0](Object.assign(new Error("lock compromised"), { code: "ECOMPROMISED" }));
      }, 5);
      await sleep(50);
    } finally {
      process.off("uncaughtException", onFault);
      process.off("unhandledRejection", onFault);
    }

    expect(faults).toEqual([]);
    expect(readAuthJson().x2).toEqual({ type: "api_key", key: "k2" });
  }, 10_000);
});
