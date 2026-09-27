/**
 * OAuth refresh coordination with other auth.json writers (test-plan E7–E17,
 * X3–X10, P1–P3).
 *
 * Runs `InternalAuthStorage` against the REAL `provider-auth-storage` module and
 * a real `auth.json` in the per-file tmp $HOME (`setup-home-perfile.ts`). Only
 * the provider's `refreshToken` is faked, so the locked snapshot, the CAS
 * persist and the lock waits are exercised for real.
 *
 * "pi" is simulated in-process: a proper-lockfile holder with pi 0.86.1's
 * literal options, writing auth.json IN PLACE as pi does.
 *
 * See change: harden-auth-json-lock-coordination.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _setRefreshLockBudgetForTests,
  readAuthJson,
  removeCredential,
  writeCredential,
} from "../../auth/provider-auth-storage.js";
import { InternalAuthStorage, type PiAiOAuthModule } from "../internal-auth-storage.js";

const _require = createRequire(import.meta.url);
const lockfile = _require("proper-lockfile") as typeof import("proper-lockfile");
const PI_LOCK_OPTIONS = { stale: 30_000, realpath: false } as const;

const AUTH_DIR = path.join(os.homedir(), ".pi", "agent");
const AUTH_PATH = path.join(AUTH_DIR, "auth.json");
const LOCK_PATH = `${AUTH_PATH}.lock`;
const HOUR = 3_600_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const sha = () => createHash("sha256").update(fs.readFileSync(AUTH_PATH)).digest("hex");

type Cred = Record<string, unknown>;
const oauth = (access: string, refresh: string, expiresIn: number, extra: Cred = {}) => ({
  type: "oauth" as const,
  access,
  refresh,
  expires: Date.now() + expiresIn,
  ...extra,
});

/** In-place write, as pi's `writeFileSync(authPath, …)` does. */
function writeAuth(data: Record<string, unknown>): void {
  fs.writeFileSync(AUTH_PATH, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

type RefreshFn = (creds: any, signal: AbortSignal) => Promise<unknown>;

function makeStorage(refreshToken: RefreshFn, refreshTimeoutMs?: number) {
  return new InternalAuthStorage(
    {
      isAvailable: () => true,
      getOAuthProvider: () => ({ refreshToken }),
      refreshOAuthToken: async () => ({}),
    } as unknown as PiAiOAuthModule,
    undefined,
    refreshTimeoutMs,
  );
}

const model = { provider: "anthropic", id: "claude", headers: {} };
const apiModel = { provider: "openai", id: "gpt", headers: {} };
const OPENAI = { type: "api_key" as const, key: "sk-openai" };

/** Load `data` into the storage's in-memory cache via an api-key request. */
async function primeCache(storage: InternalAuthStorage, anthropic: Cred): Promise<void> {
  writeAuth({ anthropic, openai: OPENAI });
  await storage.getApiKeyAndHeaders(apiModel);
}

const minted = (access = "dash-a") => ({ accessToken: access, refreshToken: "r-dash", expiresAt: Date.now() + HOUR });

/**
 * A pi-like live holder: resolves once the lock is HELD, then after `holdMs`
 * writes `data` in place and releases. `done` settles on release (wrapped in
 * an object so awaiting the holder does not also await the release).
 */
async function piRefreshHolder(holdMs: number, data?: Record<string, unknown>) {
  const release = await lockfile.lock(AUTH_PATH, { ...PI_LOCK_OPTIONS, onCompromised: () => {} });
  const done = (async () => {
    await sleep(holdMs);
    if (data) writeAuth(data);
    await release();
  })();
  return { done };
}

/**
 * Start a request whose provider refresh stays pending, then run `mutate`
 * while it is in flight, then resolve the refresh with `result`.
 */
async function midRefresh(mutate: () => void | Promise<void>, result: unknown = minted()) {
  const d = deferred<unknown>();
  const refreshToken = vi.fn(() => d.promise);
  const storage = makeStorage(refreshToken);
  await primeCache(storage, oauth("old-a", "r-old", -1));
  const pending = storage.getApiKeyAndHeaders(model);
  pending.catch(() => {});
  await vi.waitFor(() => expect(refreshToken).toHaveBeenCalledTimes(1));
  await mutate();
  d.resolve(result);
  return { pending, refreshToken };
}

beforeEach(() => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.rmSync(AUTH_PATH, { force: true });
  fs.rmSync(LOCK_PATH, { recursive: true, force: true });
  for (const f of fs.readdirSync(AUTH_DIR)) {
    if (f.startsWith("auth.json.corrupt-")) fs.rmSync(path.join(AUTH_DIR, f), { force: true });
  }
});

afterEach(() => {
  _setRefreshLockBudgetForTests(null);
  vi.restoreAllMocks();
});

describe("adopting a credential another writer stored", () => {
  it("E7: a fresher on-disk credential is adopted without a refresh", async () => {
    const refreshToken = vi.fn(async () => minted());
    const storage = makeStorage(refreshToken);
    await primeCache(storage, oauth("mem-a", "r-mem", 10_000));
    writeAuth({ anthropic: oauth("disk-a", "r-disk", HOUR), openai: OPENAI });

    await expect(storage.getApiKeyAndHeaders(model)).resolves.toEqual({ apiKey: "disk-a", headers: {} });
    expect(refreshToken).not.toHaveBeenCalled();
  });

  it("E8: waits out a concurrent pi refresh longer than 2 s and adopts its result", async () => {
    const refreshToken = vi.fn(async () => minted());
    const storage = makeStorage(refreshToken);
    await primeCache(storage, oauth("old-a", "r-old", -1));

    const { done: holder } = await piRefreshHolder(3_000, { anthropic: oauth("pi-a", "r-pi", HOUR), openai: OPENAI });
    const started = Date.now();
    await expect(storage.getApiKeyAndHeaders(model)).resolves.toEqual({ apiKey: "pi-a", headers: {} });
    expect(Date.now() - started).toBeGreaterThanOrEqual(2_900);
    expect(refreshToken).not.toHaveBeenCalled();
    await holder;
  }, 15_000);

  it("E9: the refresh spends the on-disk refresh token", async () => {
    const refreshToken = vi.fn(async (_c: any, _s: AbortSignal) => minted());
    const storage = makeStorage(refreshToken);
    await primeCache(storage, oauth("mem-a", "r-old", -1));
    writeAuth({ anthropic: oauth("disk-a", "r-new", -1), openai: OPENAI });

    await storage.getApiKeyAndHeaders(model);
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(refreshToken.mock.calls[0][0]).toMatchObject({ refreshToken: "r-new", accessToken: "disk-a" });
  });
});

describe("compare-and-swap persist", () => {
  it("E10: an unchanged credential is replaced by the refreshed one", async () => {
    const { pending } = await midRefresh(() => {}, minted("a2"));
    await expect(pending).resolves.toEqual({ apiKey: "a2", headers: {} });
    expect(readAuthJson().anthropic).toMatchObject({ type: "oauth", access: "a2", refresh: "r-dash" });
  });

  it("E11: a changed fresh credential is not overwritten, and is used", async () => {
    let after = "";
    const { pending } = await midRefresh(() => {
      writeAuth({ anthropic: oauth("pi-a", "r-pi", HOUR), openai: OPENAI });
      after = sha();
    });
    await expect(pending).resolves.toEqual({ apiKey: "pi-a", headers: {} });
    expect(sha()).toBe(after);
    expect(fs.readFileSync(AUTH_PATH, "utf-8")).not.toContain("dash-a");
  });

  it("E12: a change to a non-token field alone is not overwritten", async () => {
    const d = deferred<unknown>();
    const refreshToken = vi.fn(() => d.promise);
    const storage = makeStorage(refreshToken);
    const start = oauth("old-a", "r-old", -1, { enterpriseUrl: "a.corp.example" });
    await primeCache(storage, start);
    const pending = storage.getApiKeyAndHeaders(model).catch((e: Error) => e);
    await vi.waitFor(() => expect(refreshToken).toHaveBeenCalledTimes(1));
    writeAuth({ anthropic: { ...start, enterpriseUrl: "b.corp.example" }, openai: OPENAI });
    d.resolve(minted());
    await pending;

    const stored = readAuthJson().anthropic as Cred;
    expect(stored.enterpriseUrl).toBe("b.corp.example");
    expect(stored.access).toBe("old-a");
  });

  it("E13: a changed but expired credential fails diagnosably, nothing written", async () => {
    let after = "";
    const { pending } = await midRefresh(() => {
      writeAuth({ anthropic: oauth("pi-a", "r-pi", 5_000), openai: OPENAI });
      after = sha();
    });
    await expect(pending).rejects.toThrow(/changed during refresh/);
    expect(sha()).toBe(after);
  });

  it("E14: a credential removed during the refresh is not resurrected", async () => {
    const { pending } = await midRefresh(() => removeCredential("anthropic"));
    await expect(pending).rejects.toThrow(/removed/);
    expect(readAuthJson().anthropic).toBeUndefined();
  });

  it("E15: a credential replaced by an api key fails and is left intact", async () => {
    const { pending } = await midRefresh(() => {
      writeAuth({ anthropic: { type: "api_key", key: "sk-x" }, openai: OPENAI });
    });
    const err = await pending.catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/replaced/);
    expect(readAuthJson().anthropic).toEqual({ type: "api_key", key: "sk-x" });
  });

  it("E16: an absent auth.json is not created by the refresh", async () => {
    const refreshToken = vi.fn(async () => minted());
    const storage = makeStorage(refreshToken);
    await primeCache(storage, oauth("old-a", "r-old", -1));
    fs.rmSync(AUTH_PATH);

    await expect(storage.getApiKeyAndHeaders(model)).rejects.toThrow(/removed/);
    expect(fs.existsSync(AUTH_PATH)).toBe(false);
    expect(fs.existsSync(LOCK_PATH)).toBe(false);
    expect(refreshToken).not.toHaveBeenCalled();
  });

  it("E17: auth.json removed mid-refresh is not recreated", async () => {
    const { pending } = await midRefresh(() => fs.rmSync(AUTH_PATH));
    await expect(pending).rejects.toThrow(/removed/);
    expect(fs.existsSync(AUTH_PATH)).toBe(false);
  });
});

describe("corrupt content and lock exhaustion", () => {
  it("X3: corrupt content at snapshot declines the refresh", async () => {
    const refreshToken = vi.fn(async () => minted());
    const storage = makeStorage(refreshToken);
    await primeCache(storage, oauth("old-a", "r-old", -1));
    fs.writeFileSync(AUTH_PATH, '{"trunc');
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const err = await storage.getApiKeyAndHeaders(model).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/corrupt/);
    expect((err as Error).message).not.toMatch(/removed/);
    expect(refreshToken).not.toHaveBeenCalled();
    expect(fs.readdirSync(AUTH_DIR).some((f) => f.startsWith("auth.json.corrupt-"))).toBe(true);
    expect(fs.readFileSync(AUTH_PATH, "utf-8")).toBe('{"trunc');
  });

  it("X4: corrupt content at persist is not written over", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { pending } = await midRefresh(() => fs.writeFileSync(AUTH_PATH, '{"trunc'));
    const err = await pending.catch((e: Error) => e);
    expect((err as Error).message).toMatch(/corrupt/);
    expect(fs.readFileSync(AUTH_PATH, "utf-8")).toBe('{"trunc');
  });

  it("X5: persist blocked past the refresh window discards the minted credential", async () => {
    _setRefreshLockBudgetForTests(500);
    let holder: Promise<void> | undefined;
    let before = "";
    const { pending } = await midRefresh(async () => {
      before = sha();
      holder = (await piRefreshHolder(2_000)).done;
    }, minted("minted-a"));
    const err = await pending.catch((e: { code?: string; message: string }) => e);
    expect(err).toMatchObject({ code: "ELOCKED" });
    expect(sha()).toBe(before);
    expect(fs.readFileSync(AUTH_PATH, "utf-8")).not.toContain("minted-a");
    await holder;
  }, 10_000);
});

describe("a failed refresh", () => {
  it("X6: recovers from a credential stored concurrently", async () => {
    const storage = makeStorage(async () => {
      writeAuth({ anthropic: oauth("pi-a", "r-pi", HOUR), openai: OPENAI });
      throw new Error("invalid_grant");
    });
    await primeCache(storage, oauth("old-a", "r-old", -1));
    await expect(storage.getApiKeyAndHeaders(model)).resolves.toEqual({ apiKey: "pi-a", headers: {} });
  });

  it("X7: surfaces the original error when disk is unchanged", async () => {
    const storage = makeStorage(async () => { throw new Error("invalid_grant"); });
    await primeCache(storage, oauth("old-a", "r-old", -1));
    const before = sha();
    await expect(storage.getApiKeyAndHeaders(model)).rejects.toThrow(/invalid_grant/);
    expect(sha()).toBe(before);
  });

  it("X8: is explained by a concurrent removal", async () => {
    const storage = makeStorage(async () => {
      await removeCredential("anthropic");
      throw new Error("invalid_grant");
    });
    await primeCache(storage, oauth("old-a", "r-old", -1));
    await expect(storage.getApiKeyAndHeaders(model)).rejects.toThrow(/removed/);
    expect(readAuthJson().anthropic).toBeUndefined();
  });

  it("X10: an aborted refresh still persists nothing", async () => {
    const storage = makeStorage(() => new Promise(() => {}), 50);
    await primeCache(storage, oauth("old-a", "r-old", -1));
    const before = sha();
    await expect(storage.getApiKeyAndHeaders(model)).rejects.toThrow(/aborted/);
    expect(sha()).toBe(before);
  });
});

describe("no credential material in coordination errors (X9)", () => {
  it("X9: no error message or log line carries a sentinel", async () => {
    const lines: string[] = [];
    for (const m of ["warn", "error", "log", "info"] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(" ")); });
    }
    const messages: string[] = [];
    const collect = async (p: Promise<unknown>) => {
      const e = await p.then(() => null, (err: Error) => err);
      expect(e).toBeInstanceOf(Error);
      messages.push((e as Error).message);
    };
    const seed = () => oauth("SENTINEL-ACCESS", "SENTINEL-REFRESH", -1);
    const run = async (mutate: () => void | Promise<void>) => {
      const d = deferred<unknown>();
      const refreshToken = vi.fn(() => d.promise);
      const storage = makeStorage(refreshToken);
      await primeCache(storage, seed());
      const pending = storage.getApiKeyAndHeaders(model);
      pending.catch(() => {});
      await vi.waitFor(() => expect(refreshToken).toHaveBeenCalledTimes(1));
      await mutate();
      d.resolve(minted("SENTINEL-MINTED"));
      await collect(pending);
    };

    // changed-and-expired
    await run(() => writeAuth({ anthropic: oauth("SENTINEL-ACCESS-2", "SENTINEL-REFRESH-2", 1_000) }));
    // removed
    await run(() => removeCredential("anthropic"));
    // replaced
    await run(() => writeAuth({ anthropic: { type: "api_key", key: "sk-SENTINEL" } }));
    // corrupt
    await run(() => fs.writeFileSync(AUTH_PATH, '{"trunc SENTINEL-ACCESS'));
    // lock contention
    _setRefreshLockBudgetForTests(300);
    let holder: Promise<void> | undefined;
    await run(async () => { holder = (await piRefreshHolder(1_000)).done; });
    await holder;

    expect(messages).toHaveLength(5);
    for (const text of [...messages, ...lines]) expect(text).not.toContain("SENTINEL");
  }, 15_000);
});

describe("performance", () => {
  it("P1: waiting for the lock on the refresh path does not block the event loop", async () => {
    const storage = makeStorage(async () => minted());
    await primeCache(storage, oauth("old-a", "r-old", -1));
    const { done: holder } = await piRefreshHolder(3_000);

    let resolvedAt = 0;
    const pending = storage.getApiKeyAndHeaders(model).then((r) => { resolvedAt = Date.now(); return r; });
    const delays: number[] = [];
    const firedAt: number[] = [];
    for (let i = 0; i < 20; i++) {
      await sleep(100);
      const scheduled = Date.now();
      await new Promise<void>((r) => setTimeout(() => {
        delays.push(Date.now() - scheduled);
        firedAt.push(Date.now());
        r();
      }, 0));
    }
    await expect(pending).resolves.toEqual({ apiKey: "dash-a", headers: {} });
    await holder;

    const sorted = [...delays].sort((a, b) => a - b);
    expect(sorted[Math.ceil(sorted.length * 0.95) - 1]).toBeLessThan(200);
    expect(Math.max(...firedAt)).toBeLessThanOrEqual(resolvedAt);
  }, 15_000);

  it("P2: an in-flight network refresh does not hold the lock", async () => {
    const d = deferred<unknown>();
    const refreshToken = vi.fn(() => d.promise);
    const storage = makeStorage(refreshToken);
    await primeCache(storage, oauth("old-a", "r-old", -1));
    const pending = storage.getApiKeyAndHeaders(model);
    await vi.waitFor(() => expect(refreshToken).toHaveBeenCalledTimes(1));

    const started = Date.now();
    await writeCredential("other", { type: "api_key", key: "k" });
    expect(Date.now() - started).toBeLessThan(100);

    d.resolve(minted());
    // The write changed only another provider; the CAS compares this one.
    await expect(pending).resolves.toEqual({ apiKey: "dash-a", headers: {} });
  });

  it("P3: concurrent requests share one coordinated refresh", async () => {
    const refreshToken = vi.fn(async () => minted("shared-a"));
    const storage = makeStorage(refreshToken);
    await primeCache(storage, oauth("old-a", "r-old", -1));

    const results = await Promise.all(Array.from({ length: 5 }, () => storage.getApiKeyAndHeaders(model)));
    expect(refreshToken).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r.apiKey).toBe("shared-a");
  });
});
