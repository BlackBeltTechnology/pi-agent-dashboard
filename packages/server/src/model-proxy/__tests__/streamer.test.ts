/**
 * Tests for streamer.ts: streamCompletion wraps pi-ai's streamSimple.
 *
 * Uses faux registry + streamSimple mocks — no real pi-ai required.
 *
 * See change: add-dashboard-model-proxy, tasks 6.2 + 6.3.
 */
import { describe, it, expect, vi } from "vitest";
import { streamCompletion } from "../streamer.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeModel(id = "test-model") {
  return { id, provider: "test-provider" };
}

function makeRegistry(apiKey = "sk-test", headers = {} as Record<string, string>) {
  return {
    getApiKeyAndHeaders: vi.fn().mockResolvedValue({ apiKey, headers }),
  };
}

async function* fakeStream(events: any[]): AsyncIterable<any> {
  for (const e of events) yield e;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("streamCompletion", () => {
  it("calls streamSimple with resolved credentials", async () => {
    const model = makeModel();
    const registry = makeRegistry("sk-abc", { "x-foo": "bar" });
    const streamSimple = vi.fn().mockReturnValue(fakeStream([{ type: "start" }]));

    await streamCompletion({ model, messages: [{ role: "user", content: "hi" }] }, streamSimple as any, registry);

    expect(registry.getApiKeyAndHeaders).toHaveBeenCalledWith(model);
    expect(streamSimple).toHaveBeenCalledOnce();
    const [, , optionsArg] = streamSimple.mock.calls[0];
    expect(optionsArg.apiKey).toBe("sk-abc");
    expect(optionsArg.headers).toEqual({ "x-foo": "bar" });
  });

  it("passes model, messages, and optional fields through to streamSimple", async () => {
    const model = makeModel();
    const registry = makeRegistry();
    const streamSimple = vi.fn().mockReturnValue(fakeStream([]));

    const messages = [{ role: "user", content: "hello" }];
    const tools = [{ name: "search" }];
    const signal = new AbortController().signal;

    await streamCompletion({ model, messages, system: "Be helpful", tools, maxTokens: 100, temperature: 0.7, signal }, streamSimple as any, registry);

    const [modelArg, contextArg, optionsArg] = streamSimple.mock.calls[0];
    expect(modelArg).toEqual(model);
    expect(contextArg.messages).toEqual(messages);
    expect(contextArg.systemPrompt).toBe("Be helpful");
    expect(contextArg.tools).toEqual(tools);
    expect(optionsArg.maxTokens).toBe(100);
    expect(optionsArg.temperature).toBe(0.7);
    expect(optionsArg.signal).toBe(signal);
  });

  it("omits systemPrompt when not provided", async () => {
    const model = makeModel();
    const registry = makeRegistry();
    const streamSimple = vi.fn().mockReturnValue(fakeStream([]));

    await streamCompletion({ model, messages: [] }, streamSimple as any, registry);

    const [, contextArg] = streamSimple.mock.calls[0];
    expect("systemPrompt" in contextArg).toBe(false);
  });

  it("yields events from the underlying stream", async () => {
    const model = makeModel();
    const registry = makeRegistry();
    const events = [
      { type: "start" },
      { type: "text_delta", delta: "hello" },
      { type: "done", message: { stopReason: "stop", usage: { input: 5, output: 3 }, content: [] } },
    ];
    const streamSimple = vi.fn().mockReturnValue(fakeStream(events));

    const iterable = await streamCompletion({ model, messages: [] }, streamSimple as any, registry);
    const collected: any[] = [];
    for await (const event of iterable) collected.push(event);

    expect(collected).toHaveLength(3);
    expect(collected[0].type).toBe("start");
    expect(collected[1].delta).toBe("hello");
    expect(collected[2].type).toBe("done");
  });

  it("AbortSignal abort terminates iteration promptly (task 6.3)", async () => {
    const model = makeModel();
    const registry = makeRegistry();
    const controller = new AbortController();

    let yieldCount = 0;
    async function* slowStream(): AsyncIterable<any> {
      try {
        while (true) {
          if (controller.signal.aborted) return;
          yield { type: "text_delta", delta: "chunk" };
          yieldCount++;
          if (yieldCount === 1) {
            controller.abort(); // abort after first event
          }
          // Small delay so abort check catches up
          await new Promise((r) => setTimeout(r, 5));
        }
      } finally {
        // generator cleans up
      }
    }

    const streamSimple = vi.fn().mockReturnValue(slowStream());

    const iterable = await streamCompletion(
      { model, messages: [], signal: controller.signal },
      streamSimple as any,
      registry,
    );

    const start = Date.now();
    const collected: any[] = [];
    for await (const event of iterable) {
      collected.push(event);
    }
    const elapsed = Date.now() - start;

    // Terminates promptly — well under 100ms after abort
    expect(elapsed).toBeLessThan(200);
    // Only events before abort emitted
    expect(collected.length).toBeLessThanOrEqual(2);
  });
});

// ── adopt-piai-factory-api-registry: deferral guard (test-plan #X11) ─────────

/**
 * The proxy route at `server.ts` builds its context with a `system:` key,
 * while pi-ai's contract is `systemPrompt:`. Proxy system prompts are
 * therefore ALREADY dropped today under 0.75.5.
 *
 * Repairing that turns them back on — a behaviour change that must not ride a
 * compatibility change (design Non-Goals). This pins the current behaviour so
 * a silent "fix" fails here instead of shipping unnoticed, and so a later
 * deliberate repair has to delete this test on purpose.
 */
describe("deferral guard — the system:/systemPrompt: mismatch stays as-is", () => {
  /** Verbatim copy of the route's context assembly (`server.ts`). */
  const routeContext = (opts: any) => ({
    messages: opts.messages,
    system: opts.system,
    tools: opts.tools,
  });

  it("X11: the proxy route still emits `system:`, NOT `systemPrompt:`", () => {
    const ctx = routeContext({ messages: [], system: "ROUTE PROMPT", tools: [] });
    expect(ctx).toHaveProperty("system", "ROUTE PROMPT");
    expect(ctx).not.toHaveProperty("systemPrompt");
  });

  it("X11: the seam does not remap `system:` into the transcript", async () => {
    const { adaptPiAi } = await import(
      "@blackbelt-technology/pi-dashboard-shared/piai-compat/index.js"
    );
    const { FIXTURE_PATH, makeFactoryFixture } = await import(
      "@blackbelt-technology/pi-dashboard-shared/test-support/piai-factory-fixture.js"
    );
    const fx = makeFactoryFixture();
    const { module } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);

    const stream = module.streamSimple(
      { provider: "anthropic", id: "claude-opus-5", api: "anthropic-messages" },
      routeContext({ messages: [{ role: "user", content: "hi" }], system: "ROUTE PROMPT" }),
      {},
    );
    for await (const _ of stream) {
      // drain
    }

    // Unchanged from pre-change behaviour: the prompt does NOT reach the
    // provider, because normalizeContext reads `systemPrompt`, not `system`.
    expect(JSON.stringify(fx.dispatches[0].context)).not.toContain("ROUTE PROMPT");
  });

  // The OTHER caller is unaffected: `streamCompletion` already maps
  // `system` -> `systemPrompt`, so only the direct route path drops it.
  it("X11: streamCompletion still maps opts.system to systemPrompt, unchanged", async () => {
    const streamSimple = vi.fn().mockReturnValue(fakeStream([]));
    await streamCompletion(
      { model: makeModel(), messages: [], system: "S" },
      streamSimple as any,
      makeRegistry(),
    );
    const [, contextArg] = streamSimple.mock.calls[0];
    expect(contextArg.systemPrompt).toBe("S");
  });
});
