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

vi.mock("../load-pi-quotas.js", () => ({
  loadPiQuotas: vi.fn(async () => ({
    SUPPORTED_PROVIDERS: SUPPORTED,
    fetchProviderQuotas,
    clearQuotaCache,
  })),
}));
// Second peer source (`usage-bars`). Default: NOT installed, so the pi-quotas
// routing assertions below are unaffected by it.
const fetchClaudeUsage = vi.fn();
vi.mock("../load-usage-bars.js", () => ({
  loadUsageBars: vi.fn(async () => null),
  USAGE_BARS_PACKAGE: "@hk_net/pi-usage-bars",
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
    const res = await computeQuota({ enabled: false, providers: { "openai-codex": { enabled: true } } }, adapter);
    expect(res.providers).toEqual([]);
    expect(fetchProviderQuotas).not.toHaveBeenCalled();
    expect(clearQuotaCache).toHaveBeenCalledWith("openai-codex");
  });

  it("no provider enabled → no fetch", async () => {
    const res = await computeQuota({ enabled: true, providers: {} }, adapter);
    expect(res.providers).toEqual([]);
    expect(fetchProviderQuotas).not.toHaveBeenCalled();
  });

  it("provider gate: fetches enabled provider only, not the disabled one", async () => {
    await computeQuota(
      { enabled: true, providers: { "openai-codex": { enabled: true }, "github-copilot": { enabled: false } } },
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

  // Anthropic is NEVER routed to pi-quotas: its `sk-ant-` guard classifies an
  // OAuth subscription token as a direct API key and returns not_applicable
  // unconditionally. See ../../sources.ts.
  it("never fetches anthropic from pi-quotas, even when enabled", async () => {
    await computeQuota({ enabled: true, providers: onAll }, adapter);
    const fetched = fetchProviderQuotas.mock.calls.map((c) => c[1]);
    expect(fetched).not.toContain("anthropic");
  });

  it("serves anthropic from usage-bars when that peer is installed", async () => {
    const { loadUsageBars } = await import("../load-usage-bars.js");
    fetchClaudeUsage.mockResolvedValue({
      session: 40,
      weekly: 59,
      sessionResetsAt: new Date(Date.now() + 3600_000).toISOString(),
      weeklyResetsAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    vi.mocked(loadUsageBars).mockResolvedValueOnce({
      fetchers: { anthropic: fetchClaudeUsage },
    } as never);

    const res = await computeQuota({ enabled: true, providers: { anthropic: { enabled: true } } }, adapter);
    const anthropic = res.providers.find((p) => p.provider === "anthropic");
    expect(anthropic).toBeDefined();
    expect(anthropic?.windows.map((w) => w.usedPercent)).toEqual([40, 59]);
    // Routed to the other source — pi-quotas was never asked.
    expect(fetchProviderQuotas.mock.calls.map((c) => c[1])).not.toContain("anthropic");
  });

  it("reports per-source availability so the UI can gate checkboxes", async () => {
    const res = await computeQuota({ enabled: true, providers: {} }, adapter);
    expect(res.sources).toEqual([
      { id: "pi-quotas", package: "@latentminds/pi-quotas", installed: true },
      { id: "usage-bars", package: "@hk_net/pi-usage-bars", installed: false },
    ]);
  });

  it("NO peer installed → empty snapshot, no fetch, sources all absent", async () => {
    const { loadPiQuotas } = await import("../load-pi-quotas.js");
    vi.mocked(loadPiQuotas).mockResolvedValueOnce(null);
    const res = await computeQuota({ enabled: true, providers: onAll }, adapter);
    expect(res.providers).toEqual([]);
    expect(fetchProviderQuotas).not.toHaveBeenCalled();
    expect(res.sources?.every((s) => !s.installed)).toBe(true);
  });

  it("omits not_applicable providers with no error surfaced", async () => {
    fetchProviderQuotas.mockImplementation(async (_a: unknown, provider: string) =>
      provider === "openai-codex"
        ? { success: false, error: { message: "api key", kind: "not_applicable" } }
        : okResult(provider),
    );
    const res = await computeQuota({ enabled: true, providers: { "openai-codex": { enabled: true }, zai: { enabled: true } } }, adapter);
    const providers = res.providers.map((p) => p.provider);
    expect(providers).not.toContain("openai-codex");
    expect(providers).toContain("zai");
  });

  it("normalizes windows and always carries windowSeconds", async () => {
    const res = await computeQuota({ enabled: true, providers: { zai: { enabled: true } } }, adapter);
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
    const res = await computeQuota({ enabled: true, providers: { zai: { enabled: true } } }, adapter);
    const windows = res.providers[0].windows;
    expect(windows).toHaveLength(1);
    expect(windows[0].label).toBe("good");
    expect(windows[0].usedPercent).toBe(100);
  });
});
