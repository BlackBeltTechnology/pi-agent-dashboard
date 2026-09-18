/**
 * Non-blocking lock acquisition for `auth.json` (test-plan E1–E7).
 *
 * Runs against the REAL `provider-auth-storage` module in the fresh tmp $HOME
 * each test file gets (see `setup-home-perfile.ts`) — the module captures
 * `AUTH_PATH` at import time, so a test that rewrites $HOME re-imports it.
 *
 * The competing holder is a same-process `proper-lockfile` acquisition. That is
 * a faithful stand-in for "another process" here because proper-lockfile's
 * mutex is a filesystem `mkdir` on `auth.json.lock`, not process-local state:
 * a second acquisition — same process or not — is refused with ELOCKED. It is
 * also deterministic, where a worker thread only adds scheduler noise to a
 * timing assertion. The "acquired handshake" the test-plan asks for is the
 * awaited acquisition itself: the lock is provably held before the call under
 * test is issued.
 *
 * See change: fix-provider-auth-lock-contention.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);
const lockfile = _require("proper-lockfile") as typeof import("proper-lockfile");

/** Mirrors the production lock options — `stale` keeps a live holder from
 *  being reclaimed mid-test, `realpath:false` the spelling under test. */
const HOLD_OPTIONS = { stale: 10_000, realpath: false } as const;

const AUTH_DIR = path.join(os.homedir(), ".pi", "agent");
const AUTH_PATH = path.join(AUTH_DIR, "auth.json");
const LOCK_PATH = `${AUTH_PATH}.lock`;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Mode bits only — the full `stat` mode carries the file-type bits. */
const modeOf = (p: string) => fs.statSync(p).mode & 0o777;

/**
 * Acquire the lock and release it `ms` after ACQUISITION — the "worker holds
 * the lock, releases at N ms" arm of every timing row.
 *
 * The release is scheduled at acquisition, not deferred until the returned
 * function is called: the writer under test has to find the lock released while
 * it is still retrying. Idempotent, so a test may both wait for the timer and
 * release explicitly.
 */
async function holdLock(ms: number): Promise<() => Promise<void>> {
  const release = await lockfile.lock(AUTH_PATH, HOLD_OPTIONS);
  const acquired = Date.now();
  let pending: Promise<void> | null = null;
  const releaseAt = () => {
    pending ??= sleep(Math.max(0, ms - (Date.now() - acquired))).then(() => release());
    return pending;
  };
  setTimeout(() => { void releaseAt(); }, ms + 10);
  return releaseAt;
}

/** A fresh module instance, so a rewritten $HOME is picked up. */
async function storage() {
  vi.resetModules();
  return await import("../auth/provider-auth-storage.js");
}

let originalHome: string | undefined;

beforeEach(() => {
  originalHome = process.env.HOME;
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  try { fs.rmSync(AUTH_PATH, { force: true }); } catch { /* absent */ }
  try { fs.rmSync(LOCK_PATH, { recursive: true, force: true }); } catch { /* absent */ }
});

afterEach(() => {
  try { fs.chmodSync(AUTH_DIR, 0o700); } catch { /* absent */ }
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
});

describe("auth.json lock contention — bounded, non-blocking retry", () => {
  // #E1
  it("resolves a write whose holder releases inside the window", async () => {
    const { writeCredential, readAuthJson } = await storage();
    await writeCredential("lock-contention-test", { type: "api_key", key: "k1" });

    const release = await holdLock(300);
    const started = Date.now();
    await expect(writeCredential("lock-contention-test", { type: "api_key", key: "k2" })).resolves.toBeUndefined();
    const elapsed = Date.now() - started;
    await release();

    // A first-attempt win would be sub-millisecond; ≥300 ms proves a retry ran.
    expect(elapsed).toBeGreaterThanOrEqual(300);
    expect(readAuthJson()["lock-contention-test"]).toEqual({ type: "api_key", key: "k2" });
  }, 10_000);

  // #E2
  it("does not delay an uncontended write", async () => {
    const { writeCredential, readAuthJson } = await storage();
    const started = Date.now();
    await writeCredential("e2-provider", { type: "api_key", key: "sk-test-000000000" });
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(50);
    expect(readAuthJson()["e2-provider"]).toEqual({ type: "api_key", key: "sk-test-000000000" });
  }, 10_000);

  // #E3
  it("resolves a write whose holder releases just inside the bound", async () => {
    const { writeCredential, removeCredential, readAuthJson } = await storage();
    await writeCredential("e3-provider", { type: "api_key", key: "k" });

    const release = await holdLock(1_500);
    await expect(removeCredential("e3-provider")).resolves.toBeUndefined();
    await release();

    expect(readAuthJson()["e3-provider"]).toBeUndefined();
  }, 10_000);

  // #E4
  it("rejects without touching auth.json once the bound is exhausted", async () => {
    const { writeCredential, removeCredential } = await storage();
    await writeCredential("e4-provider", { type: "api_key", key: "keep-me" });
    const before = fs.readFileSync(AUTH_PATH);
    const beforeHash = createHash(before);

    const release = await holdLock(3_000);
    const started = Date.now();
    let elapsed = 0;
    try {
      await expect(removeCredential("e4-provider")).rejects.toMatchObject({ code: "ELOCKED" });
      elapsed = Date.now() - started;
    } finally {
      await release();
    }

    // It consumed a real window, but a bounded one — not the whole 3 s hold.
    expect(elapsed).toBeGreaterThan(1_000);
    expect(elapsed).toBeLessThan(3_000);
    expect(createHash(fs.readFileSync(AUTH_PATH))).toBe(beforeHash);
  }, 10_000);

  // #E5
  it("propagates a non-contention lock failure immediately, unretried", async () => {
    const { writeCredential } = await storage();
    // A read-only auth dir makes the lockfile's mkdir fail EACCES.
    fs.chmodSync(AUTH_DIR, 0o500);
    try {
      const started = Date.now();
      const err = await writeCredential("e5-provider", { type: "api_key", key: "k" }).then(
        () => null,
        (e: { code?: string }) => e,
      );
      expect(err).not.toBeNull();
      // Not the lock-held condition, and nowhere near the 2 s retry window.
      expect(err!.code).not.toBe("ELOCKED");
      expect(Date.now() - started).toBeLessThan(100);
    } finally {
      fs.chmodSync(AUTH_DIR, 0o700);
    }
  }, 10_000);

  // #E7
  it("keeps every locked write at mode 0600, placeholder included", async () => {
    const { writeCredential } = await storage();
    const release = await holdLock(200);

    // `withLock` creates the placeholder synchronously before its first await,
    // so the file (and its mode) is observable while the acquisition is still
    // being retried.
    const pending = writeCredential("e7-provider", { type: "api_key", key: "k" });
    expect(fs.existsSync(AUTH_PATH)).toBe(true);
    expect(modeOf(AUTH_PATH)).toBe(0o600);

    await release();
    await expect(pending).resolves.toBeUndefined();
    expect(modeOf(AUTH_PATH)).toBe(0o600);
  }, 10_000);
});

describe("auth.json lock options — realpath:false survives the sync→async switch", () => {
  // #E6 — the discriminating case: async `lock()` defaults `realpath: true`,
  // which would resolve the symlink and lock a DIFFERENT lockfile, letting the
  // dashboard and pi exclude each other on nothing. A holder at the resolved
  // spelling is therefore the test: it must NOT block the writer.
  it("locks the non-resolved spelling, not the symlink target", async () => {
    const target = path.join(os.homedir(), "auth-real");
    fs.mkdirSync(target, { recursive: true });
    const resolvedTarget = path.join(target, "auth-real.json");
    fs.writeFileSync(resolvedTarget, "{}\n", { mode: 0o600 });
    fs.rmSync(AUTH_PATH, { force: true });
    fs.symlinkSync(resolvedTarget, AUTH_PATH);

    // Held at the RESOLVED lockfile — what a `realpath:true` acquisition would use.
    const release = lockfile.lockSync(resolvedTarget, { stale: 10_000, realpath: true });
    const { writeCredential } = await storage();
    try {
      const started = Date.now();
      await expect(writeCredential("e6-provider", { type: "api_key", key: "k" })).resolves.toBeUndefined();
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      release();
      fs.rmSync(resolvedTarget, { force: true });
      fs.rmSync(`${resolvedTarget}.lock`, { recursive: true, force: true });
      fs.rmSync(AUTH_PATH, { force: true });
    }
  }, 10_000);

  // #E6 — mutual exclusion is by directory entry, so a home reached through a
  // symlink locks the same lockfile as the resolved spelling.
  it("refuses a second acquisition through a symlinked home", async () => {
    const realHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-e6-real-"));
    const linkHome = path.join(os.tmpdir(), `pi-e6-link-${Date.now()}`);
    fs.mkdirSync(path.join(realHome, ".pi", "agent"), { recursive: true });
    fs.symlinkSync(realHome, linkHome, "dir");

    process.env.HOME = linkHome;
    const { writeCredential, readAuthJson } = await storage();
    // Held at the RESOLVED spelling; the module locks <linkHome>/... .
    const release = lockfile.lockSync(path.join(realHome, ".pi", "agent", "auth.json"), HOLD_OPTIONS);

    try {
      const pending = writeCredential("e6-symlink", { type: "api_key", key: "k" });
      let settled = false;
      void pending.then(() => { settled = true; }, () => { settled = true; });
      await sleep(150);
      // Refused, so the writer is still retrying rather than through the lock.
      expect(settled).toBe(false);

      release();
      await expect(pending).resolves.toBeUndefined();
      expect(readAuthJson()["e6-symlink"]).toEqual({ type: "api_key", key: "k" });
    } finally {
      try { release(); } catch { /* already released */ }
      fs.rmSync(linkHome, { force: true });
      fs.rmSync(realHome, { recursive: true, force: true });
    }
  }, 10_000);
});

describe("auth.json lock release — a failed unlock is contained", () => {
  // #X3 — `release()` is async now, so the old sync `try { release() } catch {}`
  // could not catch an unlock failure: it would surface as an unhandled
  // rejection and take the process down. Fault injection is the rmdir that
  // removes the lock directory (proper-lockfile's own removal step), patched on
  // the very `graceful-fs` object the library reads its fs methods from.
  it("a rejecting release neither fails the write nor raises an unhandled rejection", async () => {
    type RmdirLike = (p: string, cb: (err: NodeJS.ErrnoException | null) => void) => void;
    const gracefulFs = _require("graceful-fs") as unknown as { rmdir: RmdirLike };
    const realRmdir = gracefulFs.rmdir;

    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => { rejections.push(reason); };

    const { writeCredential, readAuthJson } = await storage();
    gracefulFs.rmdir = (p, cb) =>
      p === LOCK_PATH
        ? cb(Object.assign(new Error("simulated EACCES"), { code: "EACCES" }))
        : realRmdir(p, cb);
    process.on("unhandledRejection", onRejection);

    try {
      await expect(writeCredential("x3-provider", { type: "api_key", key: "k" })).resolves.toBeUndefined();
      // A rejection is delivered on a later tick than the settle it follows.
      await sleep(50);
    } finally {
      process.off("unhandledRejection", onRejection);
      gracefulFs.rmdir = realRmdir;
    }

    expect(rejections).toEqual([]);
    expect(readAuthJson()["x3-provider"]).toEqual({ type: "api_key", key: "k" });
  }, 10_000);
});

/** sha256 of the bytes as they are on disk. */
function createHash(bytes: Buffer): string {
  // Kept local: node:crypto's createHash is the only one needed here.
  const { createHash: nodeCreateHash } = _require("node:crypto") as typeof import("node:crypto");
  return nodeCreateHash("sha256").update(bytes).digest("hex");
}
