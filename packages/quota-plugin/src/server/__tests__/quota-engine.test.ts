/**
 * The self-contained quota engine: gates, retention, and honest reasons.
 *
 * Replaces the old peer-mocking suite — there is no peer to mock any more, so
 * these drive `computeQuota` through the real fetcher registry with `fetch`
 * intercepted at the network boundary.
 *
 * See change: publish-quota-plugin.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUPPORTED_PROVIDERS } from "../../providers.js";
import { PROVIDER_FETCHERS } from "../quotas/fetchers.js";
import { computeQuota, _resetQuotaRetention } from "../index.js";

const TOKEN = "tok_live_123";
const auth = {
  get: (p: string) => (p === "openai-codex" ? { accountId: "acc_1" } : undefined),
  getApiKey: async () => TOKEN,
};
const noAuth = { get: () => undefined, getApiKey: async () => undefined };

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  vi.clearAllMocks();
  _resetQuotaRetention();
});

/** Reply with a fixed JSON body to every request. */
function respond(body: unknown, status = 200) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

/** A valid Anthropic usage payload. */
const anthropicOk = (pct: number) => ({
  five_hour: { utilization: pct, resets_at: new Date(Date.now() + 3_600_000).toISOString() },
});

const onlyAnthropic = { enabled: true, providers: { anthropic: { enabled: true } } };

describe("registry integrity", () => {
  it("every advertised provider has a fetcher (and vice versa)", () => {
    expect(Object.keys(PROVIDER_FETCHERS).sort()).toEqual([...SUPPORTED_PROVIDERS].sort());
  });

  it("does NOT advertise providers whose contract we cannot honour", () => {
    // opencode-go has no usage API at all (only a cookie-authenticated HTML
    // scrape); deepseek/minimax expose a balance, not a resetting window.
    for (const unsupported of ["opencode-go", "deepseek", "minimax"]) {
      expect(SUPPORTED_PROVIDERS).not.toContain(unsupported);
    }
  });
});

describe("gates", () => {
  it("makes ZERO network calls when the plugin is disabled", async () => {
    const fetchSpy = respond(anthropicOk(10));
    const res = await computeQuota({ enabled: false, providers: { anthropic: { enabled: true } } }, auth);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.providers).toEqual([]);
  });

  it("makes ZERO network calls when the provider is not ticked", async () => {
    const fetchSpy = respond(anthropicOk(10));
    const res = await computeQuota({ enabled: true, providers: { anthropic: { enabled: false } } }, auth);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.providers).toEqual([]);
  });
});

describe("retention across a failed refresh", () => {
  it("keeps the last good snapshot instead of dropping the provider", async () => {
    respond(anthropicOk(42));
    const first = await computeQuota(onlyAnthropic, auth);
    expect(first.providers[0].windows[0].usedPercent).toBe(42);

    // Now the endpoint throttles us.
    respond({ error: { message: "rate limited" } }, 429);
    const second = await computeQuota(onlyAnthropic, auth);

    expect(second.providers.map((p) => p.provider)).toEqual(["anthropic"]);
    expect(second.providers[0].windows[0].usedPercent).toBe(42);
    expect(second.providers[0].stale).toBe(true);
    // Visible → no explanation needed.
    expect(second.unavailable).toBeUndefined();
  });

  it("does not invent a provider that never succeeded", async () => {
    respond({ error: { message: "rate limited" } }, 429);
    const res = await computeQuota(onlyAnthropic, auth);
    expect(res.providers).toEqual([]);
    expect(res.unavailable).toEqual([{ provider: "anthropic", reason: "peer-rejected" }]);
  });

  it("drops retention on opt-out and never resurrects it", async () => {
    respond(anthropicOk(42));
    await computeQuota(onlyAnthropic, auth);

    const off = { enabled: true, providers: { anthropic: { enabled: false } } };
    expect((await computeQuota(off, auth)).providers).toEqual([]);

    respond({ error: { message: "rate limited" } }, 429);
    expect((await computeQuota(onlyAnthropic, auth)).providers).toEqual([]);
  });
});

describe("unavailability reasons", () => {
  it("no-credential when no token resolves — and no call is made", async () => {
    const fetchSpy = respond(anthropicOk(10));
    const res = await computeQuota(onlyAnthropic, noAuth);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.unavailable).toEqual([{ provider: "anthropic", reason: "no-credential" }]);
  });

  it("no-data when the endpoint answers but reports no usable window", async () => {
    respond({});
    const res = await computeQuota(onlyAnthropic, auth);
    expect(res.unavailable).toEqual([{ provider: "anthropic", reason: "no-data" }]);
  });

  it("no-adapter when config names a provider we do not support", async () => {
    const res = await computeQuota({ enabled: true, providers: { "opencode-go": { enabled: true } } }, auth);
    // Not even offered → never reaches the fetch stage.
    expect(res.providers).toEqual([]);
  });

  it("one provider failing never breaks the others", async () => {
    globalThis.fetch = vi.fn(async (url: unknown) =>
      String(url).includes("anthropic")
        ? new Response("nope", { status: 500 })
        : new Response(JSON.stringify({ data: { limit: 100, usage_monthly: 25 } }), { status: 200, headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;

    const res = await computeQuota(
      { enabled: true, providers: { anthropic: { enabled: true }, openrouter: { enabled: true } } },
      auth,
    );
    expect(res.providers.map((p) => p.provider)).toEqual(["openrouter"]);
    expect(res.unavailable).toEqual([{ provider: "anthropic", reason: "peer-rejected" }]);
  });
});
