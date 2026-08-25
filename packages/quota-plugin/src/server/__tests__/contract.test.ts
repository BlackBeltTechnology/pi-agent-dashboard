/**
 * The provider contract this plugin now owns: token classification, endpoint
 * shapes, payload parsing, and the secret-scrubbing guarantee.
 *
 * See change: publish-quota-plugin.
 */
import { describe, expect, it, vi } from "vitest";
import { isDirectAnthropicApiKey, PROVIDER_FETCHERS } from "../quotas/fetchers.js";
import { scrub } from "../quotas/http.js";
import { parseAnthropic, parseCodex, parseCopilot, parseKimi, parseOpenRouter, parseZai } from "../quotas/parse.js";

describe("Anthropic token classification (the peer's root-cause bug)", () => {
  it("treats sk-ant-api… as a DIRECT api key (no subscription usage)", () => {
    expect(isDirectAnthropicApiKey("sk-ant-api03-xxxxx")).toBe(true);
  });

  it("treats sk-ant-oat… as an OAUTH token — the peer got this wrong", () => {
    // `@latentminds/pi-quotas` guarded on the bare `sk-ant-` prefix, so the
    // OAuth token `pi /login` issues was misread as an API key and Anthropic
    // silently never reported. This is the regression guard for that.
    expect(isDirectAnthropicApiKey("sk-ant-oat01-xxxxx")).toBe(false);
  });

  it("treats an opaque/JWT token as OAuth", () => {
    expect(isDirectAnthropicApiKey("eyJhbGciOi.payload.sig")).toBe(false);
  });
});

describe("scrub (nothing credential-shaped may reach a log)", () => {
  it("redacts api-key prefixes, JWTs, bearer echoes and URLs", () => {
    const dirty = [
      "key sk-ant-oat01-abcdefghijklmnop failed",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.Xbogus_sig",
      "Authorization: Bearer abcdef1234567890",
      "see https://api.example.com/x?token=abcdef1234567890",
    ].join(" | ");
    const clean = scrub(dirty);
    expect(clean).not.toContain("sk-ant-oat01-abcdefghijklmnop");
    expect(clean).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(clean).not.toContain("abcdef1234567890");
    expect(clean).not.toContain("api.example.com");
  });

  it("bounds the message length", () => {
    expect(scrub("x".repeat(5000)).length).toBeLessThanOrEqual(200);
  });
});

const soon = new Date(Date.now() + 3_600_000).toISOString();

describe("payload parsing", () => {
  it("Anthropic: 5h + 7d utilisation windows", () => {
    const windows = parseAnthropic({
      five_hour: { utilization: 22, resets_at: soon },
      seven_day: { utilization: 69, resets_at: soon },
    });
    expect(windows.map((w) => [w.label, w.usedPercent])).toEqual([
      ["5h", 22],
      ["7d", 69],
    ]);
  });

  it("Anthropic: drops a window with no reset stamp (pace needs it)", () => {
    expect(parseAnthropic({ five_hour: { utilization: 22 } })).toEqual([]);
  });

  it("Anthropic: epoch-zero reset is a sentinel, not a timestamp", () => {
    expect(parseAnthropic({ five_hour: { utilization: 5, resets_at: 0 } })).toEqual([]);
  });

  it("Codex: converts percent-LEFT into percent-USED", () => {
    const windows = parseCodex({
      rate_limit: { primary_window: { percent_left: 80, reset_at: soon, limit_window_seconds: 18000 } },
    });
    expect(windows[0].usedPercent).toBe(20);
    expect(windows[0].label).toBe("5h");
  });

  it("Copilot: entitlement minus remaining, skipping unlimited buckets", () => {
    const windows = parseCopilot({
      quota_reset_date: soon,
      quota_snapshots: {
        premium_interactions: { entitlement: 300, remaining: 240 },
        chat: { unlimited: true, entitlement: 1, remaining: 0 },
      },
    });
    expect(windows).toHaveLength(1);
    expect(windows[0].usedPercent).toBeCloseTo(20);
  });

  it("OpenRouter: only the budgeted window (no permanently-0% tracking rows)", () => {
    const windows = parseOpenRouter({ data: { limit: 200, usage_monthly: 50 } });
    expect(windows).toHaveLength(1);
    expect(windows[0].usedPercent).toBe(25);
    expect(windows[0].isCurrency).toBe(true);
  });

  it("OpenRouter: no budget set → nothing to report", () => {
    expect(parseOpenRouter({ data: { limit: null, usage_monthly: 12 } })).toEqual([]);
  });

  it("Z.ai: token windows by unit code, shortest first", () => {
    const windows = parseZai({
      data: {
        limits: [
          { type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 30, nextResetTime: Date.now() + 86_400_000 },
          { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 10, nextResetTime: Date.now() + 3_600_000 },
        ],
      },
    });
    expect(windows.map((w) => w.label)).toEqual(["5h", "7d"]);
  });

  it("Kimi: weekly allowance plus rolling windows", () => {
    const windows = parseKimi({
      usage: { limit: 100, used: 40, resetTime: soon },
      limits: [{ detail: { limit: 10, used: 1, resetTime: soon }, window: { duration: 1, timeUnit: "TIME_UNIT_HOUR" } }],
    });
    expect(windows.map((w) => w.label)).toEqual(["1h", "Weekly"]);
  });

  it("clamps a nonsense percentage into range", () => {
    expect(parseAnthropic({ five_hour: { utilization: 900, resets_at: soon } })[0].usedPercent).toBe(100);
  });
});

describe("endpoint contract", () => {
  it("each fetcher calls its own provider host with the token in a header", async () => {
    const expected: Record<string, string> = {
      anthropic: "api.anthropic.com",
      "openai-codex": "chatgpt.com",
      "github-copilot": "api.github.com",
      openrouter: "openrouter.ai",
      zai: "api.z.ai",
      "kimi-coding": "api.kimi.com",
      synthetic: "api.synthetic.new",
    };
    const auth = {
      get: (p: string) => (p === "openai-codex" ? { accountId: "a" } : p === "github-copilot" ? { type: "oauth", refresh: "gh_tok" } : undefined),
      getApiKey: async () => "tok_abc",
    };

    for (const [provider, host] of Object.entries(expected)) {
      const seen: string[] = [];
      globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
        seen.push(String(url));
        const headers = (init as { headers?: Record<string, string> }).headers ?? {};
        // The credential must be in a header, never the URL.
        expect(JSON.stringify(headers)).toMatch(/tok_abc|gh_tok/);
        expect(String(url)).not.toContain("tok_abc");
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch;

      await PROVIDER_FETCHERS[provider](auth);
      expect(seen[0]).toContain(host);
    }
  });
});
