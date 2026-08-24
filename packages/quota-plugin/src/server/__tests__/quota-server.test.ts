import { beforeEach, describe, expect, it, vi } from "vitest";

const SUPPORTED = [
  "anthropic",
  "openai-codex",
  "github-copilot",
  "openrouter",
  "synthetic",
  "zai",
  "opencode-go",
  "kimi-coding",
];

const fetchProviderQuotas = vi.fn();
const clearQuotaCache = vi.fn();

vi.mock("@latentminds/pi-quotas/src/lib/quotas.js", () => ({
  SUPPORTED_PROVIDERS: SUPPORTED,
  fetchProviderQuotas,
  clearQuotaCache,
}));
// Module-level host imports are unused by computeQuota but must not load real fs/pi-ai.
vi.mock("@blackbelt-technology/pi-dashboard-server/src/auth/provider-auth-storage.js", () => ({
  readAuthJson: vi.fn(() => ({})),
}));
vi.mock("@blackbelt-technology/pi-dashboard-server/src/model-proxy/registry-singleton.js", () => ({
  getModelRegistry: vi.fn(async () => ({ getApiKeyAndHeaders: vi.fn(async () => ({ apiKey: "k", headers: {} })) })),
}));

const { computeQuota } = await import("../index.js");

const adapter = { get: vi.fn(() => ({})), getApiKey: vi.fn(async () => "token") };

function okResult(provider: string, windowSeconds = 5 * 3600) {
  return {
    success: true as const,
    data: {
      provider,
      windows: [
        { provider, label: "5h", usedPercent: 42, resetsAt: new Date(Date.now() + 3600_000), windowSeconds, usedValue: 42, limitValue: 100 },
      ],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchProviderQuotas.mockImplementation(async (_a: unknown, provider: string) => okResult(provider));
});

describe("computeQuota gate", () => {
  it("plugin disabled → no fetch, all caches cleared", async () => {
    const res = await computeQuota({ enabled: false, acknowledgedToS: true, providers: { "openai-codex": { enabled: true } } }, adapter);
    expect(res.providers).toEqual([]);
    expect(fetchProviderQuotas).not.toHaveBeenCalled();
    expect(clearQuotaCache).toHaveBeenCalledWith("openai-codex");
  });

  it("ToS un-acked → no fetch", async () => {
    const res = await computeQuota({ enabled: true, acknowledgedToS: false, providers: { "openai-codex": { enabled: true } } }, adapter);
    expect(res.providers).toEqual([]);
    expect(fetchProviderQuotas).not.toHaveBeenCalled();
  });

  it("provider gate: fetches enabled provider only, not the disabled one", async () => {
    await computeQuota(
      { enabled: true, acknowledgedToS: true, providers: { "openai-codex": { enabled: true }, "github-copilot": { enabled: false } } },
      adapter,
    );
    const fetched = fetchProviderQuotas.mock.calls.map((c) => c[1]);
    expect(fetched).toContain("openai-codex");
    expect(fetched).not.toContain("github-copilot");
    expect(clearQuotaCache).toHaveBeenCalledWith("github-copilot");
  });

  it("empty config never auto-enables anything", async () => {
    const res = await computeQuota({}, adapter);
    expect(res.providers).toEqual([]);
    expect(fetchProviderQuotas).not.toHaveBeenCalled();
  });
});

describe("computeQuota fetch behaviour", () => {
  const onAll: Record<string, { enabled: boolean }> = Object.fromEntries(SUPPORTED.map((p) => [p, { enabled: true }]));

  it("excludes anthropic even when enabled", async () => {
    await computeQuota({ enabled: true, acknowledgedToS: true, providers: onAll }, adapter);
    const fetched = fetchProviderQuotas.mock.calls.map((c) => c[1]);
    expect(fetched).not.toContain("anthropic");
    expect(clearQuotaCache).toHaveBeenCalledWith("anthropic");
  });

  it("omits not_applicable providers with no error surfaced", async () => {
    fetchProviderQuotas.mockImplementation(async (_a: unknown, provider: string) =>
      provider === "openai-codex"
        ? { success: false, error: { message: "api key", kind: "not_applicable" } }
        : okResult(provider),
    );
    const res = await computeQuota({ enabled: true, acknowledgedToS: true, providers: { "openai-codex": { enabled: true }, zai: { enabled: true } } }, adapter);
    const providers = res.providers.map((p) => p.provider);
    expect(providers).not.toContain("openai-codex");
    expect(providers).toContain("zai");
  });

  it("normalizes windows and always carries windowSeconds", async () => {
    const res = await computeQuota({ enabled: true, acknowledgedToS: true, providers: { zai: { enabled: true } } }, adapter);
    const win = res.providers[0].windows[0];
    expect(win.windowSeconds).toBe(5 * 3600);
    expect(typeof win.resetsAt).toBe("string");
    expect(win.usedPercent).toBe(42);
  });

  it("clamps usedPercent into 0..100 and drops windows without a valid windowSeconds", async () => {
    fetchProviderQuotas.mockImplementation(async (_a: unknown, provider: string) => ({
      success: true as const,
      data: {
        provider,
        windows: [
          { provider, label: "bad", usedPercent: 150, resetsAt: new Date(Date.now() + 3600_000), windowSeconds: 0, usedValue: 1, limitValue: 1 },
          { provider, label: "good", usedPercent: 150, resetsAt: new Date(Date.now() + 3600_000), windowSeconds: 3600, usedValue: 1, limitValue: 1 },
        ],
      },
    }));
    const res = await computeQuota({ enabled: true, acknowledgedToS: true, providers: { zai: { enabled: true } } }, adapter);
    const windows = res.providers[0].windows;
    expect(windows).toHaveLength(1);
    expect(windows[0].label).toBe("good");
    expect(windows[0].usedPercent).toBe(100);
  });
});
