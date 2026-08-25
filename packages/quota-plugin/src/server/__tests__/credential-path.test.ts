/**
 * Credentials reach the network ONLY through the host seams, and never leak.
 *
 * The plugin now owns every provider contract, so it is the plugin — not a peer
 * — that holds live tokens. Two invariants matter more than any feature here:
 *  1. tokens are read via `ctx.providerAuth` / `ctx.modelRuntime` (NOT a deep
 *     import into the server package, which does not exist on npm),
 *  2. no token ever appears in a log line, a broadcast, or the HTTP response.
 *
 * See change: publish-quota-plugin.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "oauth-access-SECRET-abc123";

const getCredential = vi.fn((p: string) =>
  p === "openai-codex"
    ? { type: "oauth", access: TOKEN, refresh: "refresh-SECRET", accountId: "acc_1" }
    : undefined,
);
const getApiKeyAndHeaders = vi.fn(async () => ({ apiKey: TOKEN, headers: {} }));
const getModelRegistry = vi.fn(async () => ({ getApiKeyAndHeaders }));

const registerPlugin = (await import("../index.js")).default;
const { _resetQuotaRetention } = await import("../index.js");

/** Fake ServerPluginContext capturing the /api/quota handler, broadcasts and logs. */
function makeCtx(config: Record<string, unknown>) {
  let handler: (() => Promise<unknown>) | null = null;
  const logs: string[] = [];
  const log = (...a: unknown[]) => logs.push(a.map(String).join(" "));
  const ctx = {
    fastify: { server: { listening: false }, get: (_route: string, h: () => Promise<unknown>) => { handler = h; } },
    getPluginConfig: () => config,
    providerAuth: { getCredential },
    modelRuntime: { getModelRegistry },
    broadcastToSubscribers: vi.fn(),
    logger: { info: log, warn: log, error: log },
  };
  return { ctx, run: () => handler?.(), logs, broadcast: ctx.broadcastToSubscribers };
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  _resetQuotaRetention();
  globalThis.fetch = originalFetch;
});

describe("credential resolution via host abstraction", () => {
  const config = { enabled: true, providers: { "openai-codex": { enabled: true } } };

  it("resolves the access token through the host model registry", async () => {
    // Intercept at the network boundary so nothing real is called.
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
      const headers = (init as { headers?: Record<string, string> })?.headers ?? {};
      seen.push({ url: String(url), headers });
      return new Response(JSON.stringify({ rate_limit: {} }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const { ctx, run } = makeCtx(config);
    await registerPlugin(ctx as never);
    await run();

    expect(getModelRegistry).toHaveBeenCalled();
    expect(getApiKeyAndHeaders).toHaveBeenCalledWith({ provider: "openai-codex", headers: {} });
    // The token travelled in a HEADER, never in the URL.
    expect(seen[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(seen[0]?.url).not.toContain(TOKEN);
  });

  it("reads OAuth metadata (Codex account id) from ctx.providerAuth", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ rate_limit: {} }), { status: 200, headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;

    const { ctx, run } = makeCtx(config);
    await registerPlugin(ctx as never);
    await run();

    expect(getCredential).toHaveBeenCalledWith("openai-codex");
  });

  it("degrades to 'no quota' when the host withholds the seams", async () => {
    // A box, not a `let` — TS narrows a closure-assigned local to `never`.
    const box: { h: (() => Promise<unknown>) | null } = { h: null };
    const noSeams = {
      fastify: { server: { listening: false }, get: (_r: string, h: () => Promise<unknown>) => { box.h = h; } },
      getPluginConfig: () => config,
      logger: { info: vi.fn(), warn: vi.fn() },
    };
    await registerPlugin(noSeams as never);
    const snapshot = (await box.h?.()) as { providers: unknown[]; unavailable?: Array<{ reason: string }> };
    expect(snapshot.providers).toEqual([]);
    expect(snapshot.unavailable?.[0]?.reason).toBe("no-credential");
  });

  it("NEVER logs or broadcasts the token, even on failure", async () => {
    globalThis.fetch = vi.fn(async () =>
      // Upstream error bodies can echo the credential back at us.
      new Response(JSON.stringify({ error: { message: `bad token ${TOKEN}` } }), { status: 401 }),
    ) as unknown as typeof fetch;

    const { ctx, run, logs, broadcast } = makeCtx(config);
    await registerPlugin(ctx as never);
    const snapshot = await run();

    const everything = JSON.stringify({ logs, snapshot, calls: broadcast.mock.calls });
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain("refresh-SECRET");
    // It still reported WHY, just without the secret.
    expect(logs.join("\n")).toContain("openai-codex");
  });
});
