import { beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "oauth-access-SECRET-abc123";

const SUPPORTED = ["anthropic", "openai-codex", "github-copilot", "openrouter", "synthetic", "zai", "opencode-go", "kimi-coding"];

const fetchProviderQuotas = vi.fn();
const clearQuotaCache = vi.fn();
const readAuthJson = vi.fn(() => ({ "openai-codex": { type: "oauth", access: TOKEN, refresh: "refresh-SECRET", accountId: "acc_1" } }));
const getApiKeyAndHeaders = vi.fn(async () => ({ apiKey: TOKEN, headers: {} }));
const getModelRegistry = vi.fn(async () => ({ getApiKeyAndHeaders }));

vi.mock("../load-pi-quotas.js", () => ({
  loadPiQuotas: vi.fn(async () => ({
    SUPPORTED_PROVIDERS: SUPPORTED,
    fetchProviderQuotas,
    clearQuotaCache,
  })),
}));
vi.mock("@blackbelt-technology/pi-dashboard-server/src/auth/provider-auth-storage.js", () => ({ readAuthJson }));
vi.mock("@blackbelt-technology/pi-dashboard-server/src/model-proxy/registry-singleton.js", () => ({ getModelRegistry }));

const registerPlugin = (await import("../index.js")).default;

/** Fake ServerPluginContext capturing the /api/quota handler, broadcasts and logs. */
function makeCtx(config: Record<string, unknown>) {
  let handler: (() => Promise<unknown>) | null = null;
  const logs: string[] = [];
  const log = (...a: unknown[]) => logs.push(a.map(String).join(" "));
  const ctx = {
    fastify: { server: { listening: false }, get: (_route: string, h: () => Promise<unknown>) => { handler = h; } },
    getPluginConfig: () => config,
    broadcastToSubscribers: vi.fn(),
    logger: { info: log, warn: log, error: log },
  };
  return { ctx, run: () => handler?.(), logs, broadcast: ctx.broadcastToSubscribers };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchProviderQuotas.mockImplementation(async (auth: { get: (p: string) => unknown; getApiKey: (p: string) => Promise<string | undefined> }, provider: string) => {
    // Exercise the adapter exactly as the lib would.
    auth.get(provider);
    await auth.getApiKey(provider);
    return {
      success: true as const,
      data: { provider, windows: [{ provider, label: "5h", usedPercent: 10, resetsAt: new Date(Date.now() + 3600_000), windowSeconds: 3600, usedValue: 1, limitValue: 10 }] },
    };
  });
});

describe("credential resolution via host abstraction", () => {
  const config = { enabled: true, providers: { "openai-codex": { enabled: true } } };

  it("resolves creds through readAuthJson + registry.getApiKeyAndHeaders (never a file path)", async () => {
    const { ctx, run } = makeCtx(config);
    await registerPlugin(ctx as never);
    await run();
    expect(readAuthJson).toHaveBeenCalled();
    expect(getModelRegistry).toHaveBeenCalled();
    expect(getApiKeyAndHeaders).toHaveBeenCalledWith({ provider: "openai-codex", headers: {} });
  });

  it("token never appears in /api/quota output", async () => {
    const { ctx, run } = makeCtx(config);
    await registerPlugin(ctx as never);
    const res = await run();
    expect(JSON.stringify(res)).not.toContain(TOKEN);
    expect(JSON.stringify(res)).not.toContain("refresh-SECRET");
  });

  it("token never appears in any log line", async () => {
    fetchProviderQuotas.mockImplementation(async () => ({ success: false, error: { message: `boom ${TOKEN}`, kind: "http" } }));
    const { ctx, run, logs } = makeCtx(config);
    await registerPlugin(ctx as never);
    await run();
    expect(logs.join("\n")).not.toContain(TOKEN);
  });

  it("token never appears in the broadcast payload", async () => {
    const { ctx, run, broadcast } = makeCtx(config);
    await registerPlugin(ctx as never);
    await run();
    expect(broadcast).toHaveBeenCalled();
    expect(JSON.stringify(broadcast.mock.calls)).not.toContain(TOKEN);
  });
});
