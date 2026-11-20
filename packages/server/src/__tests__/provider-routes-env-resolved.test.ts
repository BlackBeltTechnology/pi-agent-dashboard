/**
 * `GET /api/providers` — `$NAME` apiKey resolution annotation (`apiKeyResolved`).
 *
 * A custom endpoint's apiKey may be a `$NAME` reference that the SERVER resolves
 * against its own environment. A browser cannot evaluate that, so the redacted
 * payload carries the resolution state; without it a resolved `$NAME` endpoint
 * is indistinguishable from a dead one and the connected list hides a usable
 * endpoint (and withholds it from the Add picker, which offers unconfigured
 * entries only). See change: redesign-providers-settings-page (D1, E8).
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProbeLookupAll } from "../package/provider-probe.js";
import { registerProviderRoutes } from "../routes/provider-routes.js";

const PROVIDERS_PATH = join(homedir(), ".pi", "agent", "providers.json");
const PROVIDERS_DIR = join(homedir(), ".pi", "agent");
const SET_VAR = "OS_REDESIGN_SET_REF";
const UNSET_VAR = "OS_REDESIGN_UNSET_REF";

let backup: string | null = null;
beforeEach(() => {
  try {
    backup = readFileSync(PROVIDERS_PATH, "utf-8");
  } catch {
    backup = null;
  }
  process.env[SET_VAR] = "sk-resolved";
  delete process.env[UNSET_VAR];
});
afterEach(() => {
  try {
    if (backup !== null) writeFileSync(PROVIDERS_PATH, backup);
    else rmSync(PROVIDERS_PATH, { force: true });
  } catch {}
  delete process.env[SET_VAR];
  delete process.env[UNSET_VAR];
});

async function buildApp(port = 8000) {
  const app = Fastify({ logger: false });
  const networkGuard = async () => {};
  mkdirSync(PROVIDERS_DIR, { recursive: true });
  registerProviderRoutes(app, { networkGuard, port });
  await app.ready();
  return app;
}

function seed(providers: Record<string, unknown>): void {
  mkdirSync(PROVIDERS_DIR, { recursive: true });
  writeFileSync(PROVIDERS_PATH, JSON.stringify({ providers }));
}

async function readRedacted(): Promise<Record<string, any>> {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: "/api/providers" });
  const body = res.json() as { providers: Record<string, any> };
  await app.close();
  return body.providers;
}

describe("GET /api/providers — $NAME apiKey resolution annotation", () => {
  it("annotates a SET `$NAME` reference as resolved and passes the ref through verbatim", async () => {
    seed({ proxy: { baseUrl: "https://a.example.com/v1", apiKey: `$${SET_VAR}`, api: "openai-completions" } });
    const providers = await readRedacted();
    expect(providers.proxy.apiKey).toBe(`$${SET_VAR}`);
    expect(providers.proxy.apiKeyResolved).toBe(true);
  });

  it("annotates an UNSET `$NAME` reference as unresolved", async () => {
    seed({ proxy: { baseUrl: "https://a.example.com/v1", apiKey: `$${UNSET_VAR}` } });
    const providers = await readRedacted();
    expect(providers.proxy.apiKey).toBe(`$${UNSET_VAR}`);
    expect(providers.proxy.apiKeyResolved).toBe(false);
  });

  it("annotates an empty variadic `$` reference as unresolved, not as resolved-by-default", async () => {
    seed({ proxy: { baseUrl: "https://a.example.com/v1", apiKey: "$" } });
    const providers = await readRedacted();
    expect(providers.proxy.apiKeyResolved).toBe(false);
  });

  it("omits the annotation for a literal key (which is redacted, not resolvable)", async () => {
    seed({ proxy: { baseUrl: "https://a.example.com/v1", apiKey: "sk-literal" } });
    const providers = await readRedacted();
    expect(providers.proxy.apiKey).toBe("***");
    expect(providers.proxy.apiKeyResolved).toBeUndefined();
  });

  it("omits the annotation for an empty key", async () => {
    seed({ proxy: { baseUrl: "https://a.example.com/v1", apiKey: "" } });
    const providers = await readRedacted();
    expect(providers.proxy.apiKey).toBe("");
    expect(providers.proxy.apiKeyResolved).toBeUndefined();
  });
});

// -- NET-04: `$ENV` keys bind to the saved Base URL (test-plan E97-E100, E115) --
// See change: close-local-listener-and-egress-gaps (design D7).

describe("POST /api/providers/test — `$ENV` secret binding", () => {
  const BOUND = "Environment-variable keys can only be tested with the Base URL saved with them";
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn(async (_u: string, _i: RequestInit) => new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 }));
    globalThis.fetch = fetchSpy as any;
    setProbeLookupAll(async () => [{ address: "93.184.216.34", family: 4 }]);
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    setProbeLookupAll(null);
  });

  async function test(payload: Record<string, unknown>) {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/providers/test", payload: { api: "openai-completions", ...payload } });
    await app.close();
    return res;
  }
  const auth = (): string => (fetchSpy.mock.calls[0][1].headers as Record<string, string>).Authorization;

  it("saved `$NAME` at the same URL probes with the env value; value not in the response (E97)", async () => {
    seed({
      a: { baseUrl: "https://a.example.com/v1", apiKey: `$${SET_VAR}` },
      b: { baseUrl: "https://b.example.com/v1", apiKey: `$${SET_VAR}` },
    });
    const res = await test({ baseUrl: "https://b.example.com/v1", apiKey: `$${SET_VAR}` });
    expect(res.json().ok).toBe(true);
    expect(auth()).toBe("Bearer sk-resolved");
    expect(res.payload).not.toContain("sk-resolved");
  });

  it("`$NAME` saved elsewhere, bound to a literal at that URL, or case-differing is refused (E98)", async () => {
    seed({
      pa: { baseUrl: "https://a.example.com/v1", apiKey: `$${SET_VAR}` },
      pb: { baseUrl: "https://b.example.com/v1", apiKey: "literal" },
    });
    expect((await test({ baseUrl: "https://other.example.com/v1", apiKey: `$${SET_VAR}` })).json()).toEqual({ ok: false, error: BOUND });
    expect((await test({ baseUrl: "https://b.example.com/v1", apiKey: `$${SET_VAR}` })).json()).toEqual({ ok: false, error: BOUND });
    expect((await test({ baseUrl: "https://a.example.com/v1", apiKey: `$${SET_VAR.toLowerCase()}` })).json()).toEqual({ ok: false, error: BOUND });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("unsaved `$NAME` that IS set answers the binding error (no 'save first'), env value never sent (E99)", async () => {
    seed({});
    const body = (await test({ baseUrl: "https://a.example.com/v1", apiKey: `$${SET_VAR}` })).json();
    expect(body).toEqual({ ok: false, error: BOUND });
    expect(body.error).not.toMatch(/save first|please save/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("saved at the same URL but env unset: 'Environment variable X is not set' (E100)", async () => {
    seed({ a: { baseUrl: "https://a.example.com/v1", apiKey: `$${UNSET_VAR}` } });
    const body = (await test({ baseUrl: "https://a.example.com/v1", apiKey: `$${UNSET_VAR}` })).json();
    expect(body).toEqual({ ok: false, error: `Environment variable ${UNSET_VAR} is not set` });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a literal key is probed regardless of what is saved (E91)", async () => {
    seed({});
    expect((await test({ baseUrl: "https://anywhere.example.com/v1", apiKey: "sk-literal" })).json().ok).toBe(true);
    expect(auth()).toBe("Bearer sk-literal");
  });

  it("saved providers with a vetted URL resolve their key exactly as before on save (E115)", async () => {
    seed({});
    const app = await buildApp();
    await app.inject({
      method: "PUT",
      url: "/api/providers",
      payload: {
        providers: {
          lit: { baseUrl: "https://lit.example.com/v1", apiKey: "sk-lit", api: "openai-completions" },
          env: { baseUrl: "https://env.example.com/v1", apiKey: `$${SET_VAR}`, api: "openai-completions" },
        },
      },
    });
    await app.close();
    const sent = fetchSpy.mock.calls.map((c) => [new URL(String(c[0])).hostname, (c[1].headers as Record<string, string>).Authorization]);
    expect(sent).toContainEqual(["lit.example.com", "Bearer sk-lit"]);
    expect(sent).toContainEqual(["env.example.com", "Bearer sk-resolved"]);
  });
});
