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
import { _resetQuotaRetention, clampRetry, computeQuota } from "../index.js";
import { classifyHttpFailure, PROVIDER_FETCHERS } from "../quotas/fetchers.js";

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

// ── add-quota-refresh-and-retry ──────────────────────────────────────────────

/** A fetch mock that returns a scripted sequence of Responses, one per call. */
function respondSequence(steps: Array<{ body: unknown; status?: number }>) {
  let i = 0;
  const fn = vi.fn(async () => {
    const step = steps[Math.min(i, steps.length - 1)];
    i++;
    return new Response(JSON.stringify(step.body), {
      status: step.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

const retryOn = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  maxAttempts: 2,
  baseDelayMs: 100,
  maxDelayMs: 60_000,
  ...over,
});

/** Run computeQuota to completion while draining the fake-timer backoff sleeps. */
async function runWithTimers<T>(work: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return work;
}

describe("transient retry (E1, E6, E7)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("E1: retries a transient 429 then succeeds — live, exactly 2 invocations", async () => {
    const fetchSpy = respondSequence([
      { body: { error: { message: "rate limited" } }, status: 429 },
      { body: anthropicOk(42) },
    ]);
    const res = await runWithTimers(
      computeQuota({ ...onlyAnthropic, retry: retryOn() }, auth),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(res.providers.map((p) => p.provider)).toEqual(["anthropic"]);
    expect(res.providers[0].stale).toBeUndefined();
    expect(res.unavailable).toBeUndefined();
  });

  it("E6: maxAttempts=0 disables retry — exactly 1 attempt on a network failure", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("boom");
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const res = await runWithTimers(
      computeQuota({ ...onlyAnthropic, retry: retryOn({ maxAttempts: 0 }) }, auth),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.unavailable).toEqual([{ provider: "anthropic", reason: "peer-rejected" }]);
  });

  it("E7: retry defaults off — no retry key means exactly 1 attempt", async () => {
    const fetchSpy = respondSequence([{ body: { error: { message: "rate limited" } }, status: 429 }]);
    const res = await runWithTimers(computeQuota(onlyAnthropic, auth));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.unavailable).toEqual([{ provider: "anthropic", reason: "peer-rejected" }]);
  });
});

describe("terminal failures are not retried (E2, E4)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("E2: no-credential is terminal — zero network calls, reason surfaced", async () => {
    const fetchSpy = respondSequence([{ body: anthropicOk(10) }]);
    const res = await runWithTimers(computeQuota({ ...onlyAnthropic, retry: retryOn() }, noAuth));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.unavailable).toEqual([{ provider: "anthropic", reason: "no-credential" }]);
  });

  it("E4: a parseable-but-empty 200 is terminal no-data — zero retries", async () => {
    const fetchSpy = respondSequence([{ body: {} }]); // 200, no usable window
    const res = await runWithTimers(computeQuota({ ...onlyAnthropic, retry: retryOn() }, auth));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.unavailable).toEqual([{ provider: "anthropic", reason: "no-data" }]);
  });
});

describe("HTTP status classification BVA (E3)", () => {
  it("429/500/503 are transient; 400/401/403/404 are terminal", () => {
    for (const status of [429, 500, 503]) {
      expect(classifyHttpFailure({ ok: false, kind: "http", status, message: "x" }).transient).toBe(true);
    }
    for (const status of [400, 401, 403, 404]) {
      expect(classifyHttpFailure({ ok: false, kind: "http", status, message: "x" }).transient).toBe(false);
    }
    // timeout / network are transient regardless of status.
    expect(classifyHttpFailure({ ok: false, kind: "timeout", message: "x" }).transient).toBe(true);
    expect(classifyHttpFailure({ ok: false, kind: "network", message: "x" }).transient).toBe(true);
  });
});

describe("bounded finite schedule (E5, P1)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("E5: keeps failing transiently — 6 attempts, capped backoff schedule", async () => {
    const fetchSpy = respondSequence([{ body: { error: { message: "rate limited" } }, status: 503 }]);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const res = await runWithTimers(
      computeQuota(
        { ...onlyAnthropic, retry: retryOn({ maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 60_000 }) },
        auth,
      ),
    );
    // initial attempt + 5 retries = 6 fetcher invocations.
    expect(fetchSpy).toHaveBeenCalledTimes(6);
    // 5 sleeps: 100, 200, 400, 800, 1600 (each min(100·2^n, 60000)).
    const backoffDelays = setTimeoutSpy.mock.calls.map((c) => c[1]).filter((d) => d != null);
    expect(backoffDelays).toEqual([100, 200, 400, 800, 1600]);
    expect(res.unavailable).toEqual([{ provider: "anthropic", reason: "peer-rejected" }]);
  });

  it("P1: a healthy provider is not delayed by another's retries", async () => {
    // Anthropic fails every attempt (503); OpenRouter succeeds on its single call.
    globalThis.fetch = vi.fn(async (url: unknown) =>
      String(url).includes("anthropic")
        ? new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 503 })
        : new Response(JSON.stringify({ data: { limit: 100, usage_monthly: 25 } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
    ) as unknown as typeof fetch;
    const res = await runWithTimers(
      computeQuota(
        {
          enabled: true,
          providers: { anthropic: { enabled: true }, openrouter: { enabled: true } },
          retry: retryOn({ maxAttempts: 5 }),
        },
        auth,
      ),
    );
    expect(res.providers.map((p) => p.provider)).toEqual(["openrouter"]);
    expect(res.unavailable).toEqual([{ provider: "anthropic", reason: "peer-rejected" }]);
  });
});

describe("config clamp + gates (E8, E9)", () => {
  it("E8: a malformed persisted retry config is clamped to safe bounds", () => {
    const clamped = clampRetry({ enabled: true, maxAttempts: 99, baseDelayMs: -5, maxDelayMs: 9e15 });
    expect(clamped).toEqual({ enabled: true, maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 60_000 });
    // NaN / non-finite fall back to the safe default, never a raw timer value.
    // NaN / ±Infinity are non-finite → each field takes its safe DEFAULT, not a bound.
    const nan = clampRetry({ enabled: true, maxAttempts: Number.NaN, baseDelayMs: Infinity, maxDelayMs: -Infinity });
    expect(nan.maxAttempts).toBe(3);
    expect(nan.baseDelayMs).toBe(1_000);
    expect(nan.maxDelayMs).toBe(60_000);
  });

  it("E9: a disabled provider is never fetched or retried even with retry on", async () => {
    const fetchSpy = respondSequence([{ body: anthropicOk(10) }]);
    const res = await computeQuota(
      { enabled: true, providers: { anthropic: { enabled: false } }, retry: retryOn() },
      auth,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.providers).toEqual([]);
  });
});

describe("no token leaks across retried attempts (X2)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("X2: a token-shaped 429 body never reaches the response or the log", async () => {
    const SECRET = "sk-ant-oat01-SECRETTOKENvalue0123456789abcdef";
    respondSequence([{ body: { error: { message: `leaked ${SECRET}` } }, status: 429 }]);
    const warnings: string[] = [];
    const logger = { warn: (m: string) => warnings.push(m) } as never;
    const res = await runWithTimers(
      computeQuota({ ...onlyAnthropic, retry: retryOn({ maxAttempts: 2 }) }, auth, logger),
    );
    const serialized = JSON.stringify(res) + warnings.join("\n");
    expect(serialized).not.toContain("SECRETTOKEN");
    expect(res.unavailable).toEqual([{ provider: "anthropic", reason: "peer-rejected" }]);
  });
});
