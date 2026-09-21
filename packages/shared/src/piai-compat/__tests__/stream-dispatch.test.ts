/**
 * Factory-branch stream dispatch (design D3/D4).
 *
 * Covers test-plan #E6 (api-first beats provider-first), #E7 (undispatchable
 * reported with no credential material), #X5 (OAuth-only provider streams),
 * #X6 (transcript preserved, getAuth never invoked), #X8 (caller credentials
 * win), #X9 (abort propagates), #X10 (result stays async-iterable) and #X14
 * (context keys not reinterpreted).
 *
 * Two review cycles inverted this dispatch decision twice, so each property
 * below is pinned by its own assertion rather than inferred from a happy path.
 *
 * See change: adopt-piai-factory-api-registry.
 */
import { describe, expect, it, vi } from "vitest";
import { adaptPiAi } from "../index.js";
import { FIXTURE_PATH, makeFactoryFixture } from "../../test-support/piai-factory-fixture.js";

async function drain(stream: AsyncIterable<any>): Promise<any[]> {
  const out: any[] = [];
  for await (const ev of stream) out.push(ev);
  return out;
}

describe("factory streamSimple — dispatch", () => {
  // test-plan #E6 — the misroute regression. A CUSTOM model authored under a
  // BUILT-IN provider name must route by its own `model.api`, because
  // `createProvider`'s single-api form ignores `model.api` entirely.
  it("dispatches api-first, not provider-first", async () => {
    const fx = makeFactoryFixture({
      providers: ["anthropic"],
      models: [{ provider: "anthropic", id: "claude-opus-5", api: "anthropic-messages" }],
    });
    const { module } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);

    const custom = { provider: "anthropic", id: "my-model", api: "openai-completions" };
    await drain(module.streamSimple(custom, { messages: [] }));

    expect(fx.dispatches).toHaveLength(1);
    expect(fx.dispatches[0].via).toBe("api:openai-completions");
    expect(fx.dispatches[0].via).not.toBe("provider:anthropic");
  });

  it("falls back to the owning built-in provider when the api is unmapped", async () => {
    const fx = makeFactoryFixture({ providers: ["anthropic"] });
    const { module } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);

    await drain(module.streamSimple({ provider: "anthropic", id: "x", api: "future-api" }, { messages: [] }));
    expect(fx.dispatches[0].via).toBe("provider:anthropic");
  });

  // test-plan #E7 — diagnosable AND credential-free.
  it("throws naming the api and the model, leaking no credential material", async () => {
    const fx = makeFactoryFixture({ providers: ["anthropic"] });
    const { module } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);

    const model = { provider: "unknown-provider", id: "mystery", api: "nope-api" };
    let thrown: Error | null = null;
    try {
      module.streamSimple(model, { messages: [] }, { apiKey: "SECRET", headers: { "x-k": "SECRET" } });
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).toBeTruthy();
    expect(thrown!.message).toContain("nope-api");
    expect(thrown!.message).toContain("mystery");
    expect(thrown!.message).toContain("unknown-provider");
    expect(thrown!.message).not.toContain("SECRET");
  });

  // test-plan #X5 — the reproduced cycle-2 defect. An OAuth-only provider has
  // no `provider.auth.apiKey`, so `Models.streamSimple` → applyAuth → getAuth
  // returns undefined and throws "Provider is not configured". Dispatching
  // below the auth layer means the empty credential store is irrelevant.
  it("streams an OAuth-only provider with a caller-supplied key", async () => {
    const fx = makeFactoryFixture();
    const { module } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);

    const model = { provider: "openai-codex", id: "gpt-6-astra", api: "openai-codex-responses" };
    const events = await drain(module.streamSimple(model, { messages: [] }, { apiKey: "caller-key" }));

    expect(events.length).toBeGreaterThan(0);
    expect(fx.dispatches[0].via).toBe("api:openai-codex-responses");
    expect(fx.getAuthCalls).toBe(0);
  });
});

describe("factory streamSimple — transcript", () => {
  // test-plan #X6
  it("folds systemPrompt and tools into the transcript and never calls getAuth", async () => {
    const fx = makeFactoryFixture();
    const { module } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);

    const model = { provider: "anthropic", id: "claude-opus-5", api: "anthropic-messages" };
    await drain(
      module.streamSimple(
        model,
        { messages: [{ role: "user", content: "hi" }], systemPrompt: "BE BRIEF", tools: [{ name: "grep" }] },
        {},
      ),
    );

    const ctx = fx.dispatches[0].context;
    expect(ctx.messages[0].role).toBe("system");
    expect(JSON.stringify(ctx.messages[0])).toContain("BE BRIEF");
    expect(ctx.messages[0].toolsAdded).toHaveLength(1);
    expect(fx.getAuthCalls).toBe(0);
  });

  // test-plan #X14 — the seam normalizes, it does not REMAP. A prompt under a
  // key normalizeContext does not read must stay exactly where the caller put
  // it (repairing that is explicitly a Non-Goal of this change).
  it("does not reinterpret context keys normalizeContext ignores", async () => {
    const fx = makeFactoryFixture();
    const { module } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);

    const model = { provider: "anthropic", id: "claude-opus-5", api: "anthropic-messages" };
    await drain(module.streamSimple(model, { messages: [{ role: "user" }], system: "UNREAD" }, {}));

    const ctx = fx.dispatches[0].context;
    expect(JSON.stringify(ctx)).not.toContain("UNREAD");
    expect(ctx.messages[0].role).toBe("user");
  });

  it("resolves normalizeContext from the derived subpath when the root omits it", async () => {
    const fx = makeFactoryFixture({ normalizeOnSubpathOnly: true });
    const { module } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);

    await drain(
      module.streamSimple(
        { provider: "anthropic", id: "claude-opus-5", api: "anthropic-messages" },
        { messages: [], systemPrompt: "SP" },
        {},
      ),
    );
    expect(JSON.stringify(fx.dispatches[0].context)).toContain("SP");
  });
});

describe("factory streamSimple — options", () => {
  // test-plan #X8
  it("sends the caller's apiKey and headers, not the runtime store's", async () => {
    const fx = makeFactoryFixture();
    const { module } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);

    await drain(
      module.streamSimple(
        { provider: "anthropic", id: "claude-opus-5", api: "anthropic-messages" },
        { messages: [] },
        { apiKey: "caller-key", headers: { "x-caller": "yes" } },
      ),
    );

    expect(fx.dispatches[0].options.apiKey).toBe("caller-key");
    expect(fx.dispatches[0].options.headers).toEqual({ "x-caller": "yes" });
    expect(fx.getAuthCalls).toBe(0);
  });

  // test-plan #X9
  it("forwards the abort signal and every other caller option", async () => {
    const fx = makeFactoryFixture();
    const { module } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);
    const controller = new AbortController();

    await drain(
      module.streamSimple(
        { provider: "anthropic", id: "claude-opus-5", api: "anthropic-messages" },
        { messages: [] },
        { signal: controller.signal, maxTokens: 64, env: { A: "1" } },
      ),
    );

    const options = fx.dispatches[0].options;
    expect(options.signal).toBe(controller.signal);
    expect(options.maxTokens).toBe(64);
    expect(options.env).toEqual({ A: "1" });
  });

  // test-plan #X10
  it("returns a value that is async-iterable", async () => {
    const fx = makeFactoryFixture();
    const { module } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);
    const stream = module.streamSimple(
      { provider: "anthropic", id: "claude-opus-5", api: "anthropic-messages" },
      { messages: [] },
    );
    expect(typeof (stream as any)[Symbol.asyncIterator]).toBe("function");
    expect(await drain(stream)).toHaveLength(2);
  });
});

describe("factory streamSimple — baseUrl placeholders (task 1.11 regression)", () => {
  const cfModel = {
    provider: "cloudflare-ai-gateway",
    id: "gw",
    api: "openai-completions",
    baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat",
  };

  it("substitutes from the caller's env, as 0.75.5's api implementations did", async () => {
    const fx = makeFactoryFixture();
    const { module } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);

    await drain(
      module.streamSimple(cfModel, { messages: [] }, {
        env: { CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_GATEWAY_ID: "gwid" },
      }),
    );
    expect(fx.dispatches[0].model.baseUrl).toBe(
      "https://gateway.ai.cloudflare.com/v1/acct/gwid/compat",
    );
    // The caller's model object is never mutated.
    expect(cfModel.baseUrl).toContain("{CLOUDFLARE_ACCOUNT_ID}");
  });

  it("falls back to process.env, which is exactly what 0.75.5 read", async () => {
    const fx = makeFactoryFixture();
    const { module } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "from-process");
    vi.stubEnv("CLOUDFLARE_GATEWAY_ID", "gw-process");

    await drain(module.streamSimple(cfModel, { messages: [] }, {}));
    expect(fx.dispatches[0].model.baseUrl).toBe(
      "https://gateway.ai.cloudflare.com/v1/from-process/gw-process/compat",
    );
    vi.unstubAllEnvs();
  });

  it("passes a placeholder-free model through by identity", async () => {
    const fx = makeFactoryFixture();
    const { module } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);
    const model = { provider: "anthropic", id: "claude-opus-5", api: "anthropic-messages", baseUrl: "https://api.anthropic.com" };

    await drain(module.streamSimple(model, { messages: [] }, {}));
    expect(fx.dispatches[0].model).toBe(model);
  });
});

describe("factory adaptation — construction failures are diagnosable", () => {
  it("errors naming the path when providers/all.js is absent", async () => {
    const fx = makeFactoryFixture();
    const exists = fx.deps.exists;
    fx.deps.exists = (p: string) => (p.includes("all.js") ? false : exists(p));
    await expect(adaptPiAi(fx.module, FIXTURE_PATH, fx.deps)).rejects.toThrow(/all\.js/);
  });

  it("errors when normalizeContext cannot be located anywhere", async () => {
    const fx = makeFactoryFixture({ normalizeOnSubpathOnly: true });
    const exists = fx.deps.exists;
    fx.deps.exists = (p: string) => (p.includes("transcript") ? false : exists(p));
    await expect(adaptPiAi(fx.module, FIXTURE_PATH, fx.deps)).rejects.toThrow(/normalizeContext/);
  });
});
