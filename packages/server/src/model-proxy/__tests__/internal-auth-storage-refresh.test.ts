/**
 * `InternalAuthStorage` — the auth facade over the model runtime.
 *
 * Driven against a REAL pi-ai `Models` collection over the REAL
 * `DashboardCredentialStore` and a real `auth.json` in the per-file tmp $HOME
 * (`pi-models-fixture.ts`). Only the provider's OAuth `refresh` is faked.
 *
 * Covers test-plan #X2 (one refresh under concurrency), #X10 (a failed
 * refresh is attempted once and shared), #X14 (the initiating request's abort
 * reaches the refresh; nothing written) and the facade half of #E6 (named
 * missing-OAuth-capability error, api-key providers unaffected).
 *
 * Supersedes the pi 0.84.0 refresh-internals suite: refresh signal, timeout
 * and credential mapping now live in pi's `resolveStoredOAuth`, not here.
 *
 * See change: collapse-model-proxy-onto-modelruntime (D1, D5).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readAuthJson } from "../../auth/provider-auth-storage.js";
import { type FakeRefresh, piModelsOver } from "../../__tests__/helpers/pi-models-fixture.js";
import { InternalAuthStorage, MissingOAuthCapabilityError } from "../internal-auth-storage.js";

const AUTH_DIR = path.join(os.homedir(), ".pi", "agent");
const AUTH_PATH = path.join(AUTH_DIR, "auth.json");
const HOUR = 3_600_000;

const sha = () => createHash("sha256").update(fs.readFileSync(AUTH_PATH)).digest("hex");
const expired = () => ({ type: "oauth" as const, access: "old-a", refresh: "r-old", expires: Date.now() - 1 });
const minted = (access: string) => ({ type: "oauth" as const, access, refresh: "r-new", expires: Date.now() + HOUR });

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

function facade(refresh: FakeRefresh, extra: { apiKey?: string[]; bare?: string[] } = {}) {
  const { models } = piModelsOver({ oauth: { anthropic: refresh }, ...extra });
  return new InternalAuthStorage(models as never);
}

const model = { provider: "anthropic", id: "claude", headers: { "X-Org": "a" } };

beforeEach(() => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.rmSync(AUTH_PATH, { force: true });
  fs.rmSync(`${AUTH_PATH}.lock`, { recursive: true, force: true });
});

describe("facade auth resolution", () => {
  it("returns the runtime-resolved credential with the model's own headers", async () => {
    writeAuth({ anthropic: { type: "oauth", access: "live-a", refresh: "r", expires: Date.now() + HOUR } });
    const storage = facade(async () => minted("never"));
    await expect(storage.getApiKeyAndHeaders(model)).resolves.toEqual({
      apiKey: "live-a",
      headers: { "X-Org": "a" },
    });
  });

  it("X2: two parallel requests with an expiring credential call refresh exactly once", async () => {
    writeAuth({ anthropic: expired() });
    const d = deferred<unknown>();
    const refresh = vi.fn(() => d.promise);
    const storage = facade(refresh);

    const a = storage.getApiKeyAndHeaders(model);
    const b = storage.getApiKeyAndHeaders(model);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    d.resolve(minted("shared-a"));

    const [ra, rb] = await Promise.all([a, b]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(ra.apiKey).toBe("shared-a");
    expect(rb.apiKey).toBe("shared-a");
  });

  it("X10: a rejected refresh is attempted once and both requests fail with that error", async () => {
    writeAuth({ anthropic: expired() });
    const d = deferred<unknown>();
    const refresh = vi.fn(() => d.promise);
    const storage = facade(refresh);

    const a = storage.getApiKeyAndHeaders(model).catch((e: Error) => e);
    const b = storage.getApiKeyAndHeaders(model).catch((e: Error) => e);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    d.reject(new Error("invalid_grant"));

    const [ea, eb] = await Promise.all([a, b]);
    expect(refresh).toHaveBeenCalledTimes(1);
    for (const e of [ea, eb]) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toMatch(/invalid_grant/);
    }
  });

  it("X14: aborting the initiating request aborts the refresh signal and writes nothing", async () => {
    writeAuth({ anthropic: expired() });
    const before = sha();
    let refreshSignal: AbortSignal | undefined;
    const refresh = vi.fn((_c: unknown, signal: AbortSignal) => {
      refreshSignal = signal;
      // A provider that honours its signal.
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("refresh aborted")), { once: true });
      });
    });
    const storage = facade(refresh);
    const controller = new AbortController();

    const pending = storage.getApiKeyAndHeaders(model, controller.signal).catch((e: Error) => e);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    controller.abort();

    expect(await pending).toBeInstanceOf(Error);
    expect(refreshSignal?.aborted).toBe(true);
    expect(sha()).toBe(before);
    expect(readAuthJson().anthropic).toMatchObject({ access: "old-a" });
  });

  it("X14: a provider that IGNORES its signal still cannot persist after the abort", async () => {
    writeAuth({ anthropic: expired() });
    const before = sha();
    const d = deferred<unknown>();
    const refresh = vi.fn(() => d.promise);
    const storage = facade(refresh);
    const controller = new AbortController();

    const pending = storage.getApiKeyAndHeaders(model, controller.signal).catch((e: Error) => e);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    controller.abort();
    expect(await pending).toBeInstanceOf(Error);

    // The late answer is discarded, never written.
    d.resolve(minted("LATE"));
    await new Promise((r) => setTimeout(r, 50));
    expect(sha()).toBe(before);
  });
});

describe("a joined request is not failed by someone else's disconnect (audit)", () => {
  it("initiator aborts mid-refresh; a still-connected joiner resolves through its own attempt", async () => {
    writeAuth({ anthropic: expired() });
    let calls = 0;
    const refresh = vi.fn((_c: unknown, signal: AbortSignal) => {
      calls += 1;
      if (calls === 1) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("refresh aborted")), { once: true });
        });
      }
      return Promise.resolve(minted("joiner-a"));
    });
    const storage = facade(refresh);
    const initiator = new AbortController();

    const first = storage.getApiKeyAndHeaders(model, initiator.signal).catch((e: Error) => e);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const joiner = storage.getApiKeyAndHeaders(model);
    initiator.abort();

    expect(await first).toBeInstanceOf(Error);
    await expect(joiner).resolves.toMatchObject({ apiKey: "joiner-a" });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("a joiner's own abort ends its wait without aborting the shared refresh", async () => {
    writeAuth({ anthropic: expired() });
    const d = deferred<unknown>();
    const refresh = vi.fn(() => d.promise);
    const storage = facade(refresh);

    const first = storage.getApiKeyAndHeaders(model);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const own = new AbortController();
    const joiner = storage.getApiKeyAndHeaders(model, own.signal).catch((e: Error) => e);
    own.abort();
    expect(await joiner).toBeDefined();

    d.resolve(minted("first-a"));
    await expect(first).resolves.toMatchObject({ apiKey: "first-a" });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("missing OAuth capability (E6, facade half)", () => {
  it("names the provider instead of a TypeError or a silent undefined", async () => {
    writeAuth({
      noauth: { type: "oauth", access: "a", refresh: "r", expires: Date.now() + HOUR },
      openai: { type: "api_key", key: "sk-openai" },
    });
    const storage = facade(async () => minted("x"), { apiKey: ["openai"], bare: ["noauth"] });

    const err = await storage.getApiKeyAndHeaders({ provider: "noauth", id: "m" }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(MissingOAuthCapabilityError);
    expect(err).not.toBeInstanceOf(TypeError);
    expect((err as Error).message).toMatch(/missing OAuth capability/);
    expect(storage.getMissingOAuthProviders()).toEqual(["noauth"]);

    // api-key providers keep routing.
    await expect(storage.getApiKeyAndHeaders({ provider: "openai", id: "gpt" })).resolves.toMatchObject({
      apiKey: "sk-openai",
    });
  });

  it("no stored credential → a named 'No credentials' error, never an ambient key", async () => {
    writeAuth({});
    const storage = facade(async () => minted("x"), { apiKey: ["openai"] });
    await expect(storage.getApiKeyAndHeaders({ provider: "openai", id: "gpt" })).rejects.toThrow(/No credentials/);
  });
});
