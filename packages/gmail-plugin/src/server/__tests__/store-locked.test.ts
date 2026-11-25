/**
 * L1 (test-plan F6): a locked host credential store surfaces through the
 * plugin's EXISTING error paths — the account list rejects with the typed
 * error, the legacy lease lane rejects with it, the Google hand-off (add-google-connect
 * D1/D10) fails soft to legacy leasing, the store is called once per action (no retry
 * loop) and nothing is left unhandled. The moved account routes no longer touch the
 * store (D10), so they are not part of this test any more.
 * See change: encrypt-credentials-at-rest (tasks 5.3, 19); add-google-connect.
 */
import type { PluginCredentials } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { capturingLogger } from "../../__tests__/fakes.js";
import { AccountStore } from "../accounts.js";
import registerPlugin from "../index.js";

class StoreLocked extends Error {
  readonly code = "store_locked";
  readonly reason = "key_mismatch";
  constructor() {
    super("Plugin credential store is locked (key_mismatch). Restore the key, or run `pi-dashboard credentials reset`.");
    this.name = "PluginCredentialError";
  }
}

function lockedCredentials() {
  const calls = { n: 0 };
  const reject = async (): Promise<never> => {
    calls.n++;
    throw new StoreLocked();
  };
  const creds: PluginCredentials = {
    get: reject,
    list: reject,
    snapshot: reject,
    set: reject,
    remove: reject,
    update: reject,
  };
  return { creds, calls };
}

const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => unhandled.push(e);

afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
  unhandled.length = 0;
  vi.useRealTimers();
});

describe("F6 — plugin surfaces store_locked", () => {
  it("F6: account list, legacy lease and the first-request hand-off fail once per action; no retry loop, no unhandled rejection", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"] });
    process.on("unhandledRejection", onUnhandled);
    const { creds, calls } = lockedCredentials();

    // Store level: the typed rejection reaches the caller untouched.
    await expect(new AccountStore(creds).list()).rejects.toMatchObject({ code: "store_locked", reason: "key_mismatch" });
    expect(calls.n).toBe(1);

    // Plugin level, Google Connect present: the hand-off reads the locked store once, fails soft, and is not retried.
    const importLegacyGmail = vi.fn(async () => ({ ok: true as const, imported: 0, skipped: 0 }));
    const handlers = new Map<string, (p: unknown, m: unknown) => Promise<unknown>>();
    const logger = capturingLogger();
    const app = Fastify();
    await registerPlugin({
      credentials: creds,
      logger,
      fastify: app,
      networkGuard: async () => {},
      consumeAll: () => [{ provider: "google", value: { importLegacyGmail } }],
      getPluginConfig: () => ({}),
      updatePluginConfig: async () => {},
      registerPiRequestHandler: (type: string, h: (p: unknown, m: unknown) => Promise<unknown>) => handlers.set(type, h),
    } as never);
    try {
      calls.n = 0;
      const state = await app.inject({ method: "GET", url: "/api/plugins/gmail/state" });
      expect(state.statusCode).toBe(200); // a locked store must not crash the settings notice
      expect(importLegacyGmail).not.toHaveBeenCalled();
      expect(logger.warns.some((w) => w.includes("legacy import"))).toBe(true);
      expect(calls.n).toBe(1);

      // The lease lane now leases from the (locked) legacy store: the typed error surfaces, once per request.
      calls.n = 0;
      await expect(handlers.get("gmail/lease")?.({ account: "a@x.com", op: "read" }, {})).rejects.toMatchObject({ code: "store_locked" });
      expect(calls.n).toBe(1);
      calls.n = 0;
      await expect(handlers.get("gmail/accounts")?.({}, {})).rejects.toMatchObject({ code: "store_locked" });
      expect(calls.n).toBe(1);

      calls.n = 0;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls.n).toBe(0); // nothing retries in the background
      await vi.advanceTimersByTimeAsync(0);
      expect(unhandled).toEqual([]);
    } finally {
      vi.useRealTimers();
      await app.close();
    }
  });
});
