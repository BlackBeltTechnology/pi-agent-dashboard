import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildProbeRequest,
  listProviderModels,
  normalizeBaseUrl,
  type ProbeInput,
  probeProvider,
  resolveProbeApiKey,
  setProbeLookupAll,
  validateProbeBaseUrl,
} from "../package/provider-probe.js";
import { startStalledUpstream } from "./stalled-upstream.js";

// Fixture hosts (api.example.com ...) do not resolve; give the egress vet a public answer.
beforeEach(() => setProbeLookupAll(async () => [{ address: "93.184.216.34", family: 4 }]));
afterEach(() => setProbeLookupAll(null));

describe("buildProbeRequest", () => {
  it("a query/fragment on the Base URL never swallows the endpoint suffix", () => {
    const req = buildProbeRequest({ baseUrl: "https://h/v1?x=1#f", apiKey: "k", api: "openai-completions" });
    expect(req.url).toBe("https://h/v1/models");
    expect(buildProbeRequest({ baseUrl: "https://h?x=1", apiKey: "k", api: "anthropic-messages" }).url).toBe("https://h/v1/models");
  });

  it("openai-completions: GET {baseUrl}/models with Authorization: Bearer", () => {
    const req = buildProbeRequest({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-abc",
      api: "openai-completions",
    });
    expect(req.url).toBe("https://api.example.com/v1/models");
    expect(req.headers.Authorization).toBe("Bearer sk-abc");
  });

  it("openai-completions: handles trailing slash on baseUrl", () => {
    const req = buildProbeRequest({
      baseUrl: "https://api.example.com/v1/",
      apiKey: "sk-abc",
      api: "openai-completions",
    });
    expect(req.url).toBe("https://api.example.com/v1/models");
  });

  it("openai-responses: same shape as openai-completions", () => {
    const req = buildProbeRequest({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-abc",
      api: "openai-responses",
    });
    expect(req.url).toBe("https://api.example.com/v1/models");
    expect(req.headers.Authorization).toBe("Bearer sk-abc");
  });

  it("anthropic-messages: x-api-key + anthropic-version, no Authorization", () => {
    const req = buildProbeRequest({
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-123",
      api: "anthropic-messages",
    });
    expect(req.url).toBe("https://api.anthropic.com/v1/models");
    expect(req.headers["x-api-key"]).toBe("sk-ant-123");
    expect(req.headers["anthropic-version"]).toBe("2023-06-01");
    expect(req.headers.Authorization).toBeUndefined();
  });

  it("google-generative-ai: key query param, no Authorization", () => {
    const req = buildProbeRequest({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "AIza abc+def",
      api: "google-generative-ai",
    });
    // apiKey must be URL-encoded
    expect(req.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models?key=AIza%20abc%2Bdef",
    );
    expect(req.headers.Authorization).toBeUndefined();
  });

  it("throws on unknown api type", () => {
    expect(() =>
      buildProbeRequest({
        baseUrl: "https://x",
        apiKey: "k",
        api: "unknown-api" as any,
      }),
    ).toThrow(/unsupported api/i);
  });
});

describe("resolveProbeApiKey", () => {
  const ORIGINAL_ENV = { ...process.env };
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("literal key passes through", () => {
    const result = resolveProbeApiKey({ apiKey: "sk-abc", readProviders: () => ({}) });
    expect(result).toEqual({ ok: true, key: "sk-abc" });
  });

  it("$ENV_VAR: reads from process.env when set", () => {
    process.env.MY_LLM_KEY = "resolved-value";
    const result = resolveProbeApiKey({ apiKey: "$MY_LLM_KEY", readProviders: () => ({}) });
    expect(result).toEqual({ ok: true, key: "resolved-value" });
  });

  it("$ENV_VAR: returns error when env var is missing", () => {
    delete process.env.NONEXISTENT_VAR;
    const result = resolveProbeApiKey({ apiKey: "$NONEXISTENT_VAR", readProviders: () => ({}) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/NONEXISTENT_VAR/);
  });

  it("REDACTED (***): resolves via provider name from readProviders", () => {
    const result = resolveProbeApiKey({
      apiKey: "***",
      name: "my-provider",
      readProviders: () => ({
        "my-provider": { baseUrl: "u", apiKey: "stored-key", api: "openai-completions" },
      }),
    });
    expect(result).toEqual({ ok: true, key: "stored-key" });
  });

  it("REDACTED + stored key is $ENV_VAR: follows env-var resolution", () => {
    process.env.STORED_ENV = "env-value";
    const result = resolveProbeApiKey({
      apiKey: "***",
      name: "my-provider",
      readProviders: () => ({
        "my-provider": { baseUrl: "u", apiKey: "$STORED_ENV", api: "openai-completions" },
      }),
    });
    expect(result).toEqual({ ok: true, key: "env-value" });
  });

  it("REDACTED without name: returns error", () => {
    const result = resolveProbeApiKey({ apiKey: "***", readProviders: () => ({}) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no.*provider/i);
  });

  it("REDACTED with unknown name: returns error", () => {
    const result = resolveProbeApiKey({
      apiKey: "***",
      name: "missing",
      readProviders: () => ({}),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/missing/);
  });

  it("empty key: returns error", () => {
    const result = resolveProbeApiKey({ apiKey: "", readProviders: () => ({}) });
    expect(result.ok).toBe(false);
  });
});

describe("probeProvider", () => {
  const baseInput: ProbeInput = {
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-abc",
    api: "openai-completions",
  };

  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
    globalThis.fetch = vi.fn(impl) as any;
  }

  it("2xx with data array returns ok + modelCount + sample (capped at 5)", async () => {
    const ids = ["m1", "m2", "m3", "m4", "m5", "m6", "m7"];
    mockFetch(async () =>
      new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 }),
    );
    const result = await probeProvider(baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.modelCount).toBe(7);
      expect(result.sample).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    }
  });

  it("2xx with unexpected body shape: ok with modelCount=0", async () => {
    mockFetch(async () => new Response(JSON.stringify({ weird: true }), { status: 200 }));
    const result = await probeProvider(baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.modelCount).toBe(0);
      expect(result.sample).toEqual([]);
    }
  });

  it("401 returns ok=false with status + error", async () => {
    mockFetch(async () =>
      new Response("Invalid API key", { status: 401, statusText: "Unauthorized" }),
    );
    const result = await probeProvider(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error).toMatch(/Invalid API key|Unauthorized|401/);
    }
  });

  it("500 returns ok=false with status", async () => {
    mockFetch(async () => new Response("boom", { status: 500 }));
    const result = await probeProvider(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(500);
  });

  it("body excerpt is truncated to 500 chars", async () => {
    const long = "x".repeat(2000);
    mockFetch(async () => new Response(long, { status: 400 }));
    const result = await probeProvider(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error) expect(result.error.length).toBeLessThanOrEqual(500);
  });

  it("network error: ok=false with error, no status", async () => {
    mockFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    const result = await probeProvider(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/ECONNREFUSED/);
      expect(result.status).toBeUndefined();
    }
  });

  it("timeout aborts the request and returns error", async () => {
    mockFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const result = await probeProvider({ ...baseInput, timeoutMs: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeDefined();
  });

  it("response never echoes the apiKey", async () => {
    mockFetch(async () =>
      new Response(`echoed sk-abc in body`, { status: 401 }),
    );
    const result = await probeProvider({ ...baseInput, apiKey: "sk-abc" });
    // even though upstream echoes the key, our result error should not leak it
    if (!result.ok && result.error) {
      expect(result.error).not.toContain("sk-abc");
    }
  });

  // The probe error is CACHED into ProviderHealth, and the spec requires the
  // cached value to carry no credential material at all — not merely "not the
  // key we sent". An upstream or an intermediary proxy routinely echoes a
  // DIFFERENT secret than the one submitted, so the sanitization has to happen
  // at ingestion rather than by trusting the upstream.
  // See change: redesign-providers-settings-page (CodeRabbit PR #709).
  describe("error sanitization: a credential OTHER than the submitted key", () => {
    async function errorFor(upstreamBody: string): Promise<string> {
      mockFetch(async () => new Response(upstreamBody, { status: 502 }));
      const result = await probeProvider({ ...baseInput, apiKey: "sk-submitted" });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      return result.error ?? "";
    }

    it("strips an echoed Authorization: Bearer token", async () => {
      const err = await errorFor("upstream rejected Authorization: Bearer abcdef0123456789XYZ");
      expect(err).not.toContain("abcdef0123456789XYZ");
      expect(err).toContain("[REDACTED]");
      // The mechanism stays visible — a fully-scrubbed error is undiagnosable.
      expect(err).toContain("Bearer");
    });

    it("strips a labelled api_key / access_token value", async () => {
      const err = await errorFor('{"error":{"api_key":"other-secret-value-1234"}}');
      expect(err).not.toContain("other-secret-value-1234");
      expect(err).toContain("[REDACTED]");

      const err2 = await errorFor("access_token=zzzzzzzzzzzzzzzz9999");
      expect(err2).not.toContain("zzzzzzzzzzzzzzzz9999");
    });

    it("strips a vendor-prefixed key belonging to a DIFFERENT provider", async () => {
      const err = await errorFor("proxy forwarded sk-livekeyfromanotheraccount123 upstream");
      expect(err).not.toContain("sk-livekeyfromanotheraccount123");
      expect(err).toContain("[REDACTED]");
    });

    it("leaves an ordinary error message intact (no over-redaction)", async () => {
      const msg = "Bad gateway: upstream model gpt-4o-mini is not available in region eu-west-1";
      expect(await errorFor(msg)).toBe(msg);
    });
  });

  it("anthropic-messages uses x-api-key header (not Authorization)", async () => {
    let capturedInit: RequestInit | undefined;
    mockFetch(async (_url, init) => {
      capturedInit = init;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    await probeProvider({
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-x",
      api: "anthropic-messages",
    });
    const headers = capturedInit!.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-x");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers.Authorization).toBeUndefined();
  });

  it("google-generative-ai uses ?key= query param (no Authorization)", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    mockFetch(async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    await probeProvider({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "AIzaTest",
      api: "google-generative-ai",
    });
    expect(capturedUrl).toContain("?key=AIzaTest");
    const headers = (capturedInit!.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});

describe("probeProvider against a stalled upstream (real fixture, P1/task 4.6)", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // Distinct from the refused-connection case above (a mocked fetch that throws
  // ECONNREFUSED): here a REAL listener accepts the TCP connection and never
  // responds, so the probe only ends via its abort ceiling. See task 4.6 of
  // redesign-providers-settings-page.
  it("stalled upstream: probe waits out timeoutMs, then returns ok:false with no status", async () => {
    const stalled = await startStalledUpstream();
    try {
      const t0 = Date.now();
      const result = await probeProvider({
        baseUrl: stalled.url,
        apiKey: "sk-x",
        api: "openai-completions",
        timeoutMs: 400,
      });
      const elapsed = Date.now() - t0;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // No HTTP status: the request never got a response.
        expect(result.status).toBeUndefined();
        expect(result.error).toBeTruthy();
      }
      // It WAITED (stalled), not refused fast — and it was bounded by timeoutMs.
      expect(elapsed).toBeGreaterThanOrEqual(350);
      expect(elapsed).toBeLessThan(5_000);
    } finally {
      await stalled.close();
    }
  });
});

// Real HTTP servers: a provider that redirects must never get the credential
// forwarded to the redirect target. See change: triage-codeql-alert-debt (design D3 #19).
describe("probeProvider redirect handling (real servers)", () => {
  const servers: Server[] = [];
  const listen = async (handler: (req: IncomingMessage) => { status: number; headers?: Record<string, string>; body?: string }) => {
    const seen: IncomingMessage[] = [];
    const server = createServer((req, res) => {
      seen.push(req);
      const r = handler(req);
      res.writeHead(r.status, { "content-type": "application/json", ...r.headers });
      res.end(r.body ?? "");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
  };
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
  });

  it("302 to another host: target gets zero requests; probe is ok:false naming the redirect (probeProvider + listProviderModels)", async () => {
    const b = await listen(() => ({ status: 200, body: JSON.stringify({ data: [{ id: "leak" }] }) }));
    const a = await listen(() => ({ status: 302, headers: { location: `${b.url}/models` } }));
    const input: ProbeInput = { baseUrl: a.url, apiKey: "SECRET", api: "anthropic-messages" };

    const result = await probeProvider(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBeUndefined();
      expect(result.error).toMatch(/redirect/i);
      expect(result.error).not.toContain("SECRET");
    }
    expect(await listProviderModels(input)).toEqual([]);
    expect(a.seen.length).toBe(2);
    expect(b.seen.length).toBe(0);
  });

  // Regression guard (green before and after the fix): a plain 200 keeps working.
  it("200 with a models list: ok:true with those models", async () => {
    const a = await listen(() => ({ status: 200, body: JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] }) }));
    const result = await probeProvider({ baseUrl: a.url, apiKey: "sk-abc", api: "openai-completions" });
    expect(result).toEqual({ ok: true, status: 200, modelCount: 2, sample: ["m1", "m2"] });
    expect((await listProviderModels({ baseUrl: a.url, apiKey: "sk-abc", api: "openai-completions" })).map((m) => m.id)).toEqual(["m1", "m2"]);
  });
});

// -- NET-04: Base URL normalisation + secret binding (test-plan E94, E97-E99, E102, E103) --
// See change: close-local-listener-and-egress-gaps (design D7).

describe("normalizeBaseUrl / validateProbeBaseUrl", () => {
  it("equates case, default port, one trailing slash, query and fragment", () => {
    const saved = normalizeBaseUrl("https://api.example.com/v1");
    for (const v of [
      "HTTPS://API.Example.com/v1",
      "https://api.example.com:443/v1",
      "https://api.example.com/v1/",
      "https://api.example.com/v1?x=1",
      "https://api.example.com/v1#f",
    ]) {
      expect(normalizeBaseUrl(v), v).toBe(saved);
    }
    expect(normalizeBaseUrl("http://h:80/v1")).toBe(normalizeBaseUrl("http://h/v1"));
  });

  it("keeps userinfo, a second slash, a trailing-dot host, path case, port, scheme", () => {
    const saved = normalizeBaseUrl("https://h/v1");
    for (const v of [
      "https://u:p@h/v1",
      "https://h/v1//",
      "https://h./v1",
      "https://h/V1",
      "https://h:8443/v1",
      "http://h/v1",
      "https://h/v1/models",
      "https://h2/v1",
      "https://h.evil.net/v1",
    ]) {
      expect(normalizeBaseUrl(v), v).not.toBe(saved);
    }
  });

  it("returns null for a non-URL; validate refuses without a request", () => {
    expect(normalizeBaseUrl("not a url")).toBeNull();
    expect(validateProbeBaseUrl("not a url")).toEqual({ ok: false, error: "Base URL is not a valid URL" });
    expect(validateProbeBaseUrl("/v1")).toEqual({ ok: false, error: "Base URL is not a valid URL" });
    expect(validateProbeBaseUrl("ftp://h/")).toEqual({ ok: false, error: "Base URL must use http or https" });
    expect(validateProbeBaseUrl("file:///etc")).toEqual({ ok: false, error: "Base URL must use http or https" });
    expect(validateProbeBaseUrl("https://h/v1").ok).toBe(true);
  });
});

describe("resolveProbeApiKey — requestBaseUrl secret binding", () => {
  const CHANGED = "Re-enter the API key to test a changed Base URL";
  const BOUND = "Environment-variable keys can only be tested with the Base URL saved with them";
  const saved = {
    p: { baseUrl: "https://api.example.com/v1", apiKey: "sk-saved" },
    e1: { baseUrl: "https://one.example/v1", apiKey: "$BIND_KEY" },
    e2: { baseUrl: "https://two.example/v1", apiKey: "$BIND_KEY" },
    lit: { baseUrl: "https://lit.example/v1", apiKey: "literal" },
  };
  const readProviders = () => saved;
  beforeEach(() => {
    process.env.BIND_KEY = "env-secret";
  });
  afterEach(() => {
    delete process.env.BIND_KEY;
  });

  it("*** with the same / normalised-equal Base URL resolves the saved key", () => {
    for (const requestBaseUrl of ["https://api.example.com/v1", "HTTPS://API.Example.com/v1/", "https://api.example.com:443/v1?x=1"]) {
      expect(resolveProbeApiKey({ apiKey: "***", name: "p", readProviders, requestBaseUrl }), requestBaseUrl).toEqual({
        ok: true,
        key: "sk-saved",
      });
    }
  });

  it("*** with a changed / unparseable Base URL is refused", () => {
    for (const requestBaseUrl of ["https://evil.example/v1", "https://api.example.com/v1/models", "https://u:p@api.example.com/v1", "not a url"]) {
      expect(resolveProbeApiKey({ apiKey: "***", name: "p", readProviders, requestBaseUrl }), requestBaseUrl).toEqual({
        ok: false,
        error: CHANGED,
      });
    }
  });

  it("*** with no requestBaseUrl keeps today's behaviour (saved-provider probes)", () => {
    expect(resolveProbeApiKey({ apiKey: "***", name: "p", readProviders })).toEqual({ ok: true, key: "sk-saved" });
  });

  it("$NAME resolves only for a saved provider holding that ref at the same URL (any-of)", () => {
    expect(resolveProbeApiKey({ apiKey: "$BIND_KEY", readProviders, requestBaseUrl: "https://one.example/v1/" })).toEqual({ ok: true, key: "env-secret" });
    expect(resolveProbeApiKey({ apiKey: "$BIND_KEY", readProviders, requestBaseUrl: "https://two.example/v1" })).toEqual({ ok: true, key: "env-secret" });
  });

  it("$NAME bound elsewhere / unsaved / case-differing is refused, env value or not (E98, E99)", () => {
    expect(resolveProbeApiKey({ apiKey: "$BIND_KEY", readProviders, requestBaseUrl: "https://three.example/v1" })).toEqual({ ok: false, error: BOUND });
    // Pb saved with a LITERAL at the URL does not bind the env ref
    expect(resolveProbeApiKey({ apiKey: "$BIND_KEY", readProviders, requestBaseUrl: "https://lit.example/v1" })).toEqual({ ok: false, error: BOUND });
    process.env.my_key = "x";
    expect(resolveProbeApiKey({ apiKey: "$my_key", readProviders, requestBaseUrl: "https://one.example/v1" })).toEqual({ ok: false, error: BOUND });
    delete process.env.my_key;
    const r = resolveProbeApiKey({ apiKey: "$ANY_UNSET", readProviders, requestBaseUrl: "https://x.example/v1" });
    expect(r).toEqual({ ok: false, error: BOUND });
    expect((r as { error: string }).error).not.toMatch(/save first|please save/i);
  });

  it("binding is checked before the env lookup: an unsaved unset $X answers the binding error", () => {
    delete process.env.BIND_KEY;
    expect(resolveProbeApiKey({ apiKey: "$BIND_KEY", readProviders, requestBaseUrl: "https://three.example/v1" })).toEqual({ ok: false, error: BOUND });
    expect(resolveProbeApiKey({ apiKey: "$BIND_KEY", readProviders, requestBaseUrl: "https://one.example/v1" })).toEqual({
      ok: false,
      error: "Environment variable BIND_KEY is not set",
    });
  });

  it("a literal key is untouched by the binding", () => {
    expect(resolveProbeApiKey({ apiKey: "sk-typed", readProviders, requestBaseUrl: "https://anywhere.example/v1" })).toEqual({ ok: true, key: "sk-typed" });
  });
});

// -- NET-04: the 8 s budget boundary (test-plan X31) ------------------------

describe("probeProvider 8 s budget boundary (fake timers)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = realFetch;
  });

  it.each([
    [7999, true],
    [8000, false],
    [8001, false],
  ])("upstream answering at %i ms -> ok=%s, no status on failure, no timer left", async (delay, ok) => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve(new Response(JSON.stringify({ data: [{ id: "m" }] }), { status: 200 })), delay);
          init.signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("aborted"));
          });
        }),
    ) as any;
    const p = probeProvider({ baseUrl: "https://api.example.com/v1", apiKey: "k", api: "openai-completions" });
    await vi.advanceTimersByTimeAsync(delay);
    const r = await p;
    expect(r.ok).toBe(ok);
    if (!r.ok) expect("status" in r).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

// -- NET-04 / probe contract rows (test-plan E131-E134, E136, E137, X32) --
// See change: close-local-listener-and-egress-gaps.

describe("probeProvider response contract (mocked upstream)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const mockFetch = (impl: (url: string, init: RequestInit) => Promise<Response>) => {
    globalThis.fetch = vi.fn(impl) as any;
  };
  const base = { baseUrl: "https://api.example.com/v1", api: "openai-completions" as const };

  it("model count / sample: 0, 1, 2, 5, 6 ids and a missing `data` (E131)", async () => {
    for (const n of [0, 1, 2, 5, 6]) {
      const ids = Array.from({ length: n }, (_, i) => `m${i}`);
      mockFetch(async () => new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 }));
      expect(await probeProvider({ ...base, apiKey: "k" }), `n=${n}`).toEqual({
        ok: true,
        status: 200,
        modelCount: n,
        sample: ids.slice(0, Math.min(n, 5)),
      });
    }
    mockFetch(async () => new Response(JSON.stringify({}), { status: 200 }));
    expect(await probeProvider({ ...base, apiKey: "k" })).toEqual({ ok: true, status: 200, modelCount: 0, sample: [] });
  });

  it("google key `a b&c+d/é` is encodeURIComponent-ed, no Authorization, and never appears in an error (E133)", async () => {
    const key = "a b&c+d/é";
    let seen: { url: string; headers: Record<string, string> } | undefined;
    mockFetch(async (url, init) => {
      seen = { url, headers: (init.headers ?? {}) as Record<string, string> };
      return new Response(`bad key ${key} / ${encodeURIComponent(key)}`, { status: 400 });
    });
    const r = await probeProvider({ baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: key, api: "google-generative-ai" });
    expect(seen!.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
    expect(seen!.headers.Authorization).toBeUndefined();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).not.toContain(key);
      // a thrown fetch error that embeds the request URL must not carry the key either
    }
    mockFetch(async (url) => {
      throw new Error(`request to ${url} failed, key ${key}`);
    });
    const t = await probeProvider({ baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: key, api: "google-generative-ai" });
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.error).not.toContain(key);
  });

  it("upstream error bodies of 0 / 499 / 500 / 501 chars: capped at 500, status kept (E134)", async () => {
    for (const status of [401, 404, 500]) {
      for (const len of [0, 499, 500, 501]) {
        mockFetch(async () => new Response("x".repeat(len), { status }));
        const r = await probeProvider({ ...base, apiKey: "k" });
        expect(r.ok, `${status}/${len}`).toBe(false);
        if (!r.ok) {
          expect(r.status).toBe(status);
          expect(r.error!.length).toBeLessThanOrEqual(500);
          if (len === 499 || len === 500) expect(r.error).toBe("x".repeat(len));
          if (len === 501) expect(r.error).toHaveLength(500);
        }
      }
    }
  });

  it("literal key, Bearer string and an env-resolved value never reach the response, on success and failure (E137)", async () => {
    const literal = "sk-literalkey000000000000";
    const bearer = "Bearer tokenvalue0123456789";
    const envValue = "resolved-env-secret-value";
    const echo = `${literal} Authorization: ${bearer} ${envValue}`;
    // upstream error body echoes all three
    mockFetch(async () => new Response(echo, { status: 502 }));
    const bodyFail = await probeProvider({ ...base, apiKey: literal });
    expect(JSON.stringify(bodyFail)).not.toContain(literal);
    expect(JSON.stringify(bodyFail)).not.toContain("tokenvalue0123456789");
    // the env-resolved value is the key actually sent (resolveProbeApiKey output)
    const failEnv = await probeProvider({ ...base, apiKey: envValue });
    expect(JSON.stringify(failEnv)).not.toContain(envValue);
    // fetch error message embeds the key
    mockFetch(async () => {
      throw new Error(`socket hang up ${literal} ${bearer}`);
    });
    const thrown = await probeProvider({ ...base, apiKey: literal });
    expect(JSON.stringify(thrown)).not.toContain(literal);
    expect(JSON.stringify(thrown)).not.toContain("tokenvalue0123456789");
    // success path: a model id that equals the key is not part of the response contract's secret set,
    // but the response carries only {ok,status,modelCount,sample}
    mockFetch(async () => new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 }));
    const ok = await probeProvider({ ...base, apiKey: literal });
    expect(Object.keys(ok).sort()).toEqual(["modelCount", "ok", "sample", "status"]);
    expect(JSON.stringify(ok)).not.toContain(literal);
  });
});

describe("probeProvider redirect matrix and body stall (real loopback servers)", () => {
  const servers: Server[] = [];
  const listen = async (handler: (req: IncomingMessage, res: import("node:http").ServerResponse) => void) => {
    let seen = 0;
    const server = createServer((req, res) => {
      seen++;
      handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen: () => seen };
  };
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((s) => {
        s.closeAllConnections?.();
        return new Promise((resolve) => s.close(resolve));
      }),
    );
  });

  const apis = ["openai-completions", "anthropic-messages", "google-generative-ai"] as const;
  const locations = ["other-host", "same-host-other-path", "relative", "absent", "metadata"] as const;

  it.each(apis)("%s: every 3xx x Location variant is ok:false/redirect, no status, target gets 0 requests (E136)", async (api) => {
    for (const status of [301, 302, 303, 307, 308]) {
      for (const loc of locations) {
        const target = await listen((_req, res) => res.writeHead(200).end("{}"));
        const origin = await listen((req, res) => {
          const location =
            loc === "other-host" ? `${target.url}/models`
            : loc === "same-host-other-path" ? `http://${req.headers.host}/elsewhere`
            : loc === "relative" ? "/elsewhere"
            : loc === "metadata" ? "http://169.254.169.254/"
            : undefined;
          res.writeHead(status, location ? { location } : {}).end();
        });
        const r = await probeProvider({ baseUrl: origin.url, apiKey: "SECRET", api });
        const tag = `${api} ${status} ${loc}`;
        expect(r.ok, tag).toBe(false);
        if (!r.ok) {
          expect(r.error, tag).toMatch(/redirect/i);
          expect("status" in r, tag).toBe(false);
          expect(r.error, tag).not.toContain("SECRET");
        }
        expect(target.seen(), tag).toBe(0);
        expect(origin.seen(), tag).toBe(1);
      }
    }
  }, 60_000);

  it.each([
    ["200 body stall", 200],
    ["500 body stall", 500],
  ])("%s: aborted at the budget, not hung; ok:false, no status (X32)", async (_name, status) => {
    const origin = await listen((_req, res) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.write('{"data":[');
      // never end
    });
    const t0 = Date.now();
    const r = await probeProvider({ baseUrl: origin.url, apiKey: "k", api: "openai-completions", timeoutMs: 400 });
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(r.ok).toBe(false);
    expect("status" in r).toBe(false);
  }, 10_000);
});
