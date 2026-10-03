/**
 * Tests for streamer.ts: streamCompletion wraps pi-ai's streamSimple.
 *
 * Uses faux registry + streamSimple mocks — no real pi-ai required.
 *
 * See change: add-dashboard-model-proxy, tasks 6.2 + 6.3.
 */
import { describe, expect, it, vi } from "vitest";
import { callPiAiStreamSimple, streamCompletion } from "../streamer.js";

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
  it("resolves auth first, then streams with the headers and NO apiKey override (E4)", async () => {
    const model = makeModel();
    const registry = makeRegistry("sk-abc", { "x-foo": "bar" });
    const streamSimple = vi.fn().mockReturnValue(fakeStream([{ type: "start" }]));

    await streamCompletion({ model, messages: [{ role: "user", content: "hi" }] }, streamSimple as any, registry);

    expect(registry.getApiKeyAndHeaders).toHaveBeenCalledWith(model);
    expect(streamSimple).toHaveBeenCalledOnce();
    const [, , optionsArg] = streamSimple.mock.calls[0];
    // The runtime applies the provider's own auth path; an OAuth access token
    // passed as an api-key override would be sent as the wrong header.
    // See change: collapse-model-proxy-onto-modelruntime (D5).
    expect(optionsArg).not.toHaveProperty("apiKey");
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

// ── Route adapter (server.ts /v1 wiring) ────────────────────────────────────

describe("callPiAiStreamSimple", () => {
  const routeOpts = (extra: Record<string, unknown> = {}) => ({
    model: makeModel(),
    messages: [{ role: "user", content: "hi" }],
    apiKey: "sk-x",
    headers: { h: "1" },
    ...extra,
  });

  it("maps route `system` onto pi-ai Context.systemPrompt (not `system`)", () => {
    const fn = vi.fn().mockReturnValue("stream");
    callPiAiStreamSimple(fn, routeOpts({ system: "be terse" }));
    const [modelArg, contextArg] = fn.mock.calls[0];
    expect(modelArg).toEqual(makeModel());
    expect(contextArg.systemPrompt).toBe("be terse");
    expect(contextArg).not.toHaveProperty("system");
  });

  it("omits systemPrompt/tools when absent and forwards messages + options", () => {
    const fn = vi.fn().mockReturnValue("stream");
    const opts = routeOpts();
    expect(callPiAiStreamSimple(fn, opts)).toBe("stream");
    const [, contextArg, optionsArg] = fn.mock.calls[0];
    expect(contextArg).toEqual({ messages: opts.messages });
    expect(optionsArg.apiKey).toBe("sk-x");
    expect(optionsArg.headers).toEqual({ h: "1" });
  });

  it("forwards tools on the context", () => {
    const fn = vi.fn().mockReturnValue("stream");
    const tools = [{ name: "t", description: "d", parameters: {} }];
    callPiAiStreamSimple(fn, routeOpts({ tools }));
    expect(fn.mock.calls[0][1].tools).toBe(tools);
  });
});

// ── The real runtime path (test-plan #E4, #E10) ─────────────────────────────

/**
 * Drives the server's REAL single runtime through `registry-singleton`'s
 * `getStreamSimpleFn()` and the route adapter, with the dispatched provider
 * intercepted (nothing reaches the network). Proves what reaches the provider:
 * the dashboard-stored credential (the route's `apiKey` override is dropped),
 * per-model custom headers, tools, and the system prompt as the context's
 * system prompt. See change: collapse-model-proxy-onto-modelruntime (D5).
 */
describe("proxy completion through the real model runtime", () => {
  const fs = require("node:fs") as typeof import("node:fs");
  const os = require("node:os") as typeof import("node:os");
  const path = require("node:path") as typeof import("node:path");
  const authPath = path.join(os.homedir(), ".pi", "agent", "auth.json");

  async function setup(auth: Record<string, unknown>) {
    fs.mkdirSync(path.dirname(authPath), { recursive: true });
    fs.writeFileSync(authPath, JSON.stringify(auth), { mode: 0o600 });
    const singleton = await import("../registry-singleton.js");
    singleton.disposeModelRegistry();
    const registry = await singleton.getModelRegistry();
    const { getServerModelRuntime } = await import("../server-model-runtime.js");
    const { runtime } = await getServerModelRuntime();
    const fn = singleton.getStreamSimpleFn();
    if (!fn) throw new Error("streamSimple not available");
    return { registry, runtime, fn, dispose: singleton.disposeModelRegistry };
  }

  async function drain(events: AsyncIterable<unknown>) {
    for await (const _e of events) {
      // drain
    }
  }

  it("E4: built-in model — tools, system prompt and the stored credential reach the provider; no override", async () => {
    const { registry, runtime, fn, dispose } = await setup({ anthropic: { type: "api_key", key: "sk-ant-stored" } });
    try {
      const { captureProviderStreams } = await import("../../__tests__/helpers/pi-models-fixture.js");
      const captured = await captureProviderStreams(runtime, "anthropic");
      const model = runtime.getModels("anthropic")[0];
      const { headers } = await registry.getApiKeyAndHeaders(model);
      const tools = [{ name: "lookup_weather", description: "d", parameters: { type: "object", properties: {} } }];

      await drain(
        callPiAiStreamSimple(fn, {
          model,
          messages: [{ role: "user", content: "hi", timestamp: 0 }],
          system: "SYSTEM-PROMPT-MARK",
          tools,
          signal: new AbortController().signal,
          apiKey: "sk-ROUTE-OVERRIDE",
          headers,
        } as never),
      );

      expect(captured).toHaveLength(1);
      expect(captured[0].options.apiKey).toBe("sk-ant-stored");
      const context = JSON.stringify(captured[0].context);
      expect(context).toContain("SYSTEM-PROMPT-MARK");
      expect(context).toContain("lookup_weather");
      expect(JSON.stringify(captured[0].options)).not.toContain("sk-ROUTE-OVERRIDE");
    } finally {
      dispose();
    }
  });

  it("E10: a custom model's per-model headers reach the provider", async () => {
    const { registry, runtime, fn, dispose } = await setup({ acme: { type: "api_key", key: "sk-acme" } });
    try {
      const { registerCapturingProvider } = await import("../../__tests__/helpers/pi-models-fixture.js");
      const captured = registerCapturingProvider(runtime, "acme", { apiKey: "sk-acme", modelHeaders: { "X-Org": "a" } });
      const model = { ...runtime.getModels("acme")[0], headers: { "X-Org": "a" } };
      const { headers } = await registry.getApiKeyAndHeaders(model);

      await drain(
        callPiAiStreamSimple(fn, {
          model,
          messages: [{ role: "user", content: "hi", timestamp: 0 }],
          signal: new AbortController().signal,
          apiKey: "unused",
          headers,
        } as never),
      );

      expect(captured).toHaveLength(1);
      expect(captured[0].options.headers).toMatchObject({ "X-Org": "a" });
      expect(captured[0].options.apiKey).toBe("sk-acme");
    } finally {
      dispose();
    }
  });
});
