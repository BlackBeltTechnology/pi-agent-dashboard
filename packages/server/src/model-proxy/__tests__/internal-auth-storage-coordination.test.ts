/**
 * OAuth refresh coordination with other auth.json writers, driven through
 * `DashboardCredentialStore.modify` EXACTLY as pi-ai drives it (test-plan
 * #X1, #X5, #X6, #X15; carries the harden-auth-json-lock-coordination
 * fixtures E7–E17, X3–X10, P1–P3 onto the store).
 *
 * Runs a REAL pi-ai `Models` collection (`pi-models-fixture.ts`) over the REAL
 * `provider-auth-storage` module and a real `auth.json` in the per-file tmp
 * $HOME. Only the provider's OAuth `refresh` is faked, so pi's expiry window,
 * the locked snapshot, the CAS persist and the lock waits are exercised for
 * real. Named errors are read through `unwrapRuntimeAuthError` — the same
 * `ModelsError.cause` unwrap the facade applies (design D2).
 *
 * "pi" (another process) is simulated in-process: a proper-lockfile holder
 * with pi's literal options, writing auth.json IN PLACE as pi does.
 *
 * See changes: harden-auth-json-lock-coordination, collapse-model-proxy-onto-modelruntime.
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
import { type FakeRefresh, piModelsOver } from "../../__tests__/helpers/pi-models-fixture.js";
import { unwrapRuntimeAuthError } from "../internal-auth-storage.js";

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
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const OPENAI = { type: "api_key" as const, key: "sk-openai" };

/** pi-driven auth resolution for `anthropic`, with the facade's error unwrap. */
function driver(refresh: FakeRefresh) {
  const fx = piModelsOver({ oauth: { anthropic: refresh } });
  const getAuth = async (signal?: AbortSignal): Promise<string | undefined> => {
    try {
      const result = await fx.models.getAuth("anthropic", signal ? { signal } : {});
      return result?.auth.apiKey;
    } catch (err) {
      throw unwrapRuntimeAuthError(err);
    }
  };
  return { ...fx, getAuth };
}

/** A refreshed credential as pi's `oauth.refresh` returns it. */
const minted = (access = "dash-a") => ({ type: "oauth" as const, access, refresh: "r-dash", expires: Date.now() + HOUR });

/**
 * A pi-like live holder: resolves once the lock is HELD, then after `holdMs`
 * writes `data` in place and releases. `done` settles on release.
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
 * Start a resolution whose provider refresh stays pending, run `mutate` while
 * it is in flight, then resolve the refresh with `result`.
 */
async function midRefresh(mutate: () => void | Promise<void>, result: unknown = minted()) {
  const d = deferred<unknown>();
  const refresh = vi.fn(() => d.promise);
  const { getAuth } = driver(refresh);
  writeAuth({ anthropic: oauth("old-a", "r-old", -1), openai: OPENAI });
  const pending = getAuth();
  pending.catch(() => {});
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  await mutate();
  d.resolve(result);
  return { pending, refresh };
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

describe("adopting a credential another writer stored (X6)", () => {
  it("E7: a fresh on-disk credential is used without a refresh", async () => {
    const refresh = vi.fn(async () => minted());
    const { getAuth } = driver(refresh);
    writeAuth({ anthropic: oauth("disk-a", "r-disk", HOUR), openai: OPENAI });

    await expect(getAuth()).resolves.toBe("disk-a");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("E8: waits out a concurrent pi refresh longer than 2 s and adopts its result", async () => {
    const refresh = vi.fn(async () => minted());
    const { getAuth } = driver(refresh);
    writeAuth({ anthropic: oauth("old-a", "r-old", -1), openai: OPENAI });

    const { done: holder } = await piRefreshHolder(3_000, { anthropic: oauth("pi-a", "r-pi", HOUR), openai: OPENAI });
    const started = Date.now();
    await expect(getAuth()).resolves.toBe("pi-a");
    expect(Date.now() - started).toBeGreaterThanOrEqual(2_900);
    expect(refresh).not.toHaveBeenCalled();
    await holder;
  }, 15_000);

  it("E9: the refresh spends the on-disk refresh token", async () => {
    const refresh = vi.fn(async (_c: any, _s: AbortSignal) => minted());
    const { getAuth } = driver(refresh);
    writeAuth({ anthropic: oauth("disk-a", "r-new", -1), openai: OPENAI });

    await getAuth();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls[0][0]).toMatchObject({ refresh: "r-new", access: "disk-a" });
  });
});

describe("compare-and-swap persist (X6)", () => {
  it("E10: an unchanged credential is replaced by the refreshed one", async () => {
    const { pending } = await midRefresh(() => {}, minted("a2"));
    await expect(pending).resolves.toBe("a2");
    expect(readAuthJson().anthropic).toMatchObject({ type: "oauth", access: "a2", refresh: "r-dash" });
  });

  it("E11: a changed fresh credential is not overwritten, and is used", async () => {
    let after = "";
    const { pending } = await midRefresh(() => {
      writeAuth({ anthropic: oauth("pi-a", "r-pi", HOUR), openai: OPENAI });
      after = sha();
    });
    await expect(pending).resolves.toBe("pi-a");
    expect(sha()).toBe(after);
    expect(fs.readFileSync(AUTH_PATH, "utf-8")).not.toContain("dash-a");
  });

  it("E12: a change to a non-token field alone is not overwritten", async () => {
    const d = deferred<unknown>();
    const refresh = vi.fn(() => d.promise);
    const { getAuth } = driver(refresh);
    const start = oauth("old-a", "r-old", -1, { enterpriseUrl: "a.corp.example" });
    writeAuth({ anthropic: start, openai: OPENAI });
    const pending = getAuth().catch((e: Error) => e);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    writeAuth({ anthropic: { ...start, enterpriseUrl: "b.corp.example" }, openai: OPENAI });
    d.resolve(minted());
    // The changed credential is still expired → changed-during-refresh, not a write.
    expect(await pending).toBeInstanceOf(Error);
    expect(((await pending) as Error).message).toMatch(/changed during refresh/);

    const stored = readAuthJson().anthropic as Cred;
    expect(stored.enterpriseUrl).toBe("b.corp.example");
    expect(stored.access).toBe("old-a");
  });

  it("E13: a changed but expiring credential fails diagnosably, nothing written", async () => {
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

  it("E16: an absent auth.json is neither created nor refreshed against", async () => {
    const refresh = vi.fn(async () => minted());
    const { getAuth } = driver(refresh);

    // No stored credential → pi resolves nothing (the facade then reports
    // "No credentials"); the file and the lock dir are never created.
    await expect(getAuth()).resolves.toBeUndefined();
    expect(fs.existsSync(AUTH_PATH)).toBe(false);
    expect(fs.existsSync(LOCK_PATH)).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("E17: auth.json removed mid-refresh is not recreated", async () => {
    const { pending } = await midRefresh(() => fs.rmSync(AUTH_PATH));
    await expect(pending).rejects.toThrow(/removed/);
    expect(fs.existsSync(AUTH_PATH)).toBe(false);
  });
});

describe("corrupt content and lock exhaustion (X6)", () => {
  it("X3: corrupt content declines the refresh and is quarantined, bytes kept", async () => {
    const refresh = vi.fn(async () => minted());
    const { getAuth } = driver(refresh);
    fs.writeFileSync(AUTH_PATH, '{"trunc');
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // Tolerant read: nothing stored is served, nothing is refreshed.
    await expect(getAuth()).resolves.toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
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

describe("a failed refresh (X6)", () => {
  it("X6: recovers from a credential stored concurrently", async () => {
    const { getAuth } = driver(async () => {
      writeAuth({ anthropic: oauth("pi-a", "r-pi", HOUR), openai: OPENAI });
      throw new Error("invalid_grant");
    });
    writeAuth({ anthropic: oauth("old-a", "r-old", -1), openai: OPENAI });
    await expect(getAuth()).resolves.toBe("pi-a");
  });

  it("X7: surfaces the original error when disk is unchanged", async () => {
    const { getAuth } = driver(async () => {
      throw new Error("invalid_grant");
    });
    writeAuth({ anthropic: oauth("old-a", "r-old", -1), openai: OPENAI });
    const before = sha();
    await expect(getAuth()).rejects.toThrow(/invalid_grant/);
    expect(sha()).toBe(before);
  });

  it("X8: is explained by a concurrent removal", async () => {
    const { getAuth } = driver(async () => {
      await removeCredential("anthropic");
      throw new Error("invalid_grant");
    });
    writeAuth({ anthropic: oauth("old-a", "r-old", -1), openai: OPENAI });
    await expect(getAuth()).rejects.toThrow(/removed/);
    expect(readAuthJson().anthropic).toBeUndefined();
  });

  it("X10: an aborted refresh still persists nothing", async () => {
    const { getAuth } = driver(() => new Promise(() => {}));
    writeAuth({ anthropic: oauth("old-a", "r-old", -1), openai: OPENAI });
    const before = sha();
    await expect(getAuth(AbortSignal.timeout(50))).rejects.toThrow(/abort|timeout|timed out/i);
    expect(sha()).toBe(before);
  });
});

describe("store.modify contract (X5, X15)", () => {
  it("X5: a lost race is never persisted when the callback ignores `current` (changed, still fresh → stored returned)", async () => {
    const { store } = piModelsOver({});
    writeAuth({ anthropic: oauth("old-a", "r-old", -1), openai: OPENAI });
    const result = await store.modify("anthropic", async () => {
      writeAuth({ anthropic: oauth("pi-a", "r-pi", HOUR), openai: OPENAI });
      return minted("LOST-RACE");
    });
    expect(result).toMatchObject({ access: "pi-a" });
    expect(fs.readFileSync(AUTH_PATH, "utf-8")).not.toContain("LOST-RACE");
  });

  it("X5: a lost race against an expiring credential is a named error, never persisted", async () => {
    const { store } = piModelsOver({});
    writeAuth({ anthropic: oauth("old-a", "r-old", -1), openai: OPENAI });
    const pending = store.modify("anthropic", async () => {
      writeAuth({ anthropic: oauth("pi-a", "r-pi", 1_000), openai: OPENAI });
      return minted("LOST-RACE");
    });
    await expect(pending).rejects.toThrow(/changed during refresh/);
    expect(fs.readFileSync(AUTH_PATH, "utf-8")).not.toContain("LOST-RACE");
  });

  it("X15: delete issued during a 2 s modify starts only after it settles", async () => {
    const { store } = piModelsOver({});
    writeAuth({ anthropic: oauth("old-a", "r-old", -1), openai: OPENAI });
    const d = deferred<unknown>();
    const modifying = store.modify("anthropic", () => d.promise as Promise<any>);

    let deleted = false;
    const deleting = store.delete("anthropic").then(() => {
      deleted = true;
    });
    await sleep(2_000);
    // The modify still runs: delete has not touched the file.
    expect(deleted).toBe(false);
    expect(readAuthJson().anthropic).toMatchObject({ access: "old-a" });

    d.resolve(minted("m-a"));
    await expect(modifying).resolves.toMatchObject({ access: "m-a" });
    await deleting;
    expect(readAuthJson().anthropic).toBeUndefined();
  }, 10_000);
});

describe("no credential material in coordination errors (X9)", () => {
  it("X9: no error message or log line carries a sentinel", async () => {
    const lines: string[] = [];
    for (const m of ["warn", "error", "log", "info"] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
        lines.push(a.map(String).join(" "));
      });
    }
    const messages: string[] = [];
    const run = async (mutate: () => void | Promise<void>) => {
      const d = deferred<unknown>();
      const refresh = vi.fn(() => d.promise);
      const { getAuth } = driver(refresh);
      writeAuth({ anthropic: oauth("SENTINEL-ACCESS", "SENTINEL-REFRESH", -1) });
      const pending = getAuth();
      pending.catch(() => {});
      await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      await mutate();
      d.resolve(minted("SENTINEL-MINTED"));
      const e = await pending.then(
        () => null,
        (err: Error) => err,
      );
      expect(e).toBeInstanceOf(Error);
      messages.push((e as Error).message);
    };

    // changed-and-expiring
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
    await run(async () => {
      holder = (await piRefreshHolder(1_000)).done;
    });
    await holder;

    expect(messages).toHaveLength(5);
    for (const text of [...messages, ...lines]) expect(text).not.toContain("SENTINEL");
  }, 15_000);
});

describe("performance", () => {
  it("P1: waiting for the lock on the refresh path does not block the event loop", async () => {
    const { getAuth } = driver(async () => minted());
    writeAuth({ anthropic: oauth("old-a", "r-old", -1), openai: OPENAI });
    const { done: holder } = await piRefreshHolder(3_000);

    let resolvedAt = 0;
    const pending = getAuth().then((r) => {
      resolvedAt = Date.now();
      return r;
    });
    const delays: number[] = [];
    const firedAt: number[] = [];
    for (let i = 0; i < 20; i++) {
      await sleep(100);
      const scheduled = Date.now();
      await new Promise<void>((r) =>
        setTimeout(() => {
          delays.push(Date.now() - scheduled);
          firedAt.push(Date.now());
          r();
        }, 0),
      );
    }
    await expect(pending).resolves.toBe("dash-a");
    await holder;

    const sorted = [...delays].sort((a, b) => a - b);
    expect(sorted[Math.ceil(sorted.length * 0.95) - 1]).toBeLessThan(200);
    expect(Math.max(...firedAt)).toBeLessThanOrEqual(resolvedAt);
  }, 15_000);

  it("X1: during a 5 s runtime-triggered refresh the auth.json lock stays acquirable", async () => {
    const d = deferred<unknown>();
    const refresh = vi.fn(() => d.promise);
    const { getAuth } = driver(refresh);
    writeAuth({ anthropic: oauth("old-a", "r-old", -1), openai: OPENAI });
    const pending = getAuth();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    // Another process (pi's literal lock options) acquires immediately.
    const started = Date.now();
    const release = await lockfile.lock(AUTH_PATH, { ...PI_LOCK_OPTIONS, onCompromised: () => {} });
    expect(Date.now() - started).toBeLessThan(100);
    await release();
    // An interactive dashboard write too.
    await writeCredential("other", { type: "api_key", key: "k" });
    expect(Date.now() - started).toBeLessThan(200);

    d.resolve(minted());
    // The write changed only another provider; the CAS compares this one.
    await expect(pending).resolves.toBe("dash-a");
  });

  it("P3: concurrent requests share one coordinated refresh", async () => {
    const refresh = vi.fn(async () => minted("shared-a"));
    const { getAuth } = driver(refresh);
    writeAuth({ anthropic: oauth("old-a", "r-old", -1), openai: OPENAI });

    const results = await Promise.all(Array.from({ length: 5 }, () => getAuth()));
    expect(refresh).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r).toBe("shared-a");
  });
});
