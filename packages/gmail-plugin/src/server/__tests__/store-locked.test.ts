/**
 * L1 (test-plan F6): a locked host credential store surfaces through the
 * plugin's EXISTING error paths — the account list rejects with the typed
 * error, the REST routes answer an error (not a crash), the store is called
 * once per user action (no retry loop) and nothing is left unhandled.
 * See change: encrypt-credentials-at-rest (tasks 5.3, 19).
 */
import type { PluginCredentials } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { capturingLogger, TEST_ENDPOINTS } from "../../__tests__/fakes.js";
import { AccountStore } from "../accounts.js";
import { mountGmailRoutes } from "../routes.js";

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
  it("F6: accounts list and account add return the error once per action; no retry loop, no unhandled rejection", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"] });
    process.on("unhandledRejection", onUnhandled);
    const { creds, calls } = lockedCredentials();
    const store = new AccountStore(creds);

    // Store level: the typed rejection reaches the caller untouched.
    await expect(store.list()).rejects.toMatchObject({ code: "store_locked", reason: "key_mismatch" });
    expect(calls.n).toBe(1);

    // REST level: the existing error path answers an error response, one store call per request.
    const app = Fastify();
    await mountGmailRoutes(app, {
      store,
      oauth: { startFlow: vi.fn(async () => ({ flowId: "f" })) },
      endpoints: TEST_ENDPOINTS,
      networkGuard: async () => {},
      logger: capturingLogger(),
    });
    try {
      calls.n = 0;
      const list = await app.inject({ method: "GET", url: "/api/plugins/gmail/state" });
      expect(list.statusCode).toBeGreaterThanOrEqual(400);
      expect(list.body).toContain("key_mismatch");
      expect(calls.n).toBe(1);

      calls.n = 0;
      const add = await app.inject({ method: "POST", url: "/api/plugins/gmail/accounts", payload: { tier: "readonly" } });
      expect(add.statusCode).toBeGreaterThanOrEqual(400);
      expect(add.body).toContain("key_mismatch");
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
