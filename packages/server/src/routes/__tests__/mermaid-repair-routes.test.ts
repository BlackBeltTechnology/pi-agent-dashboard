/**
 * POST /api/mermaid/repair — contract tests (test-plan #E7–#E14, #X1–#X7).
 * See change: add-mermaid-ai-repair.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import type { MermaidRepairConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerMermaidRepairRoutes } from "../mermaid-repair-routes.js";

const MODEL = "anthropic/m";
const BAD = { code: "graph TD\nA-->", error: "Parse error on line 2" };

function cfg(over: Partial<MermaidRepairConfig> = {}): MermaidRepairConfig {
  return { enabled: true, model: MODEL, maxChars: 20000, timeoutMs: 30000, ...over };
}

const textStream = (...deltas: string[]) =>
  (async function* () {
    for (const d of deltas) yield { type: "text_delta", delta: d };
    yield { type: "done", message: {} };
  })();

interface Harness {
  app: FastifyInstance;
  stream: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
  logs: string[];
  setConfig: (c: MermaidRepairConfig) => void;
}

function build(opts: { guard?: (req: any, reply: any) => Promise<void> } = {}): Harness {
  const app = Fastify();
  const logs: string[] = [];
  let config = cfg();
  const stream = vi.fn((_model: unknown, _ctx: unknown, _opts: unknown) => textStream("graph TD\nA-->B"));
  const find = vi.fn(async (provider: string, id: string) => ({ provider, id }));
  const registry = {
    find,
    getApiKeyAndHeaders: vi.fn(async () => ({ apiKey: "sk-SECRET", headers: { "x-h": "1" } })),
  };
  registerMermaidRepairRoutes(app, {
    networkGuard: opts.guard ?? (async () => {}),
    getConfig: () => config,
    getRegistry: async () => registry,
    getStreamSimple: () => stream as any,
    log: (l) => logs.push(l),
  });
  return { app, stream, find, logs, setConfig: (c) => (config = c) };
}

let h: Harness;
beforeEach(() => {
  h = build();
});
afterEach(async () => {
  vi.useRealTimers();
  await h.app.close();
});

const post = (payload: unknown, remoteAddress?: string) =>
  h.app.inject({ method: "POST", url: "/api/mermaid/repair", payload: payload as any, ...(remoteAddress ? { remoteAddress } : {}) });

describe("extraction", () => {
  it("E7 fenced block wins over surrounding prose", async () => {
    h.stream.mockReturnValue(textStream("Here:\n```mermaid\ngraph TD\nA-->B\n```\nthanks"));
    const res = await post(BAD);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { code: "graph TD\nA-->B", model: MODEL } });
  });

  it("E8 bare text trimmed, leading mermaid line removed", async () => {
    h.stream.mockReturnValue(textStream("  mermaid\ngraph TD\nA-->B  "));
    expect((await post(BAD)).json().data.code).toBe("graph TD\nA-->B");
  });

  it("E9 non-text events ignored", async () => {
    h.stream.mockReturnValue(
      (async function* () {
        yield { type: "thinking_delta", delta: "x" };
        yield { type: "toolcall_delta", delta: "{}" };
        yield { type: "text_delta", delta: "graph TD\n" };
        yield { type: "text_delta", delta: "A-->B" };
        yield { type: "done", message: {} };
      })(),
    );
    expect((await post(BAD)).json().data.code).toBe("graph TD\nA-->B");
  });
});

describe("extraction fallback", () => {
  it("E9b a stream with only a final done message still yields the diagram", async () => {
    h.stream.mockReturnValue(
      (async function* () {
        yield { type: "done", message: { content: [{ type: "thinking", text: "x" }, { type: "text", text: "graph TD\nA-->B" }] } };
      })(),
    );
    expect((await post(BAD)).json().data.code).toBe("graph TD\nA-->B");
  });
});

describe("validation", () => {
  it("E10 input caps at the boundary", async () => {
    h.setConfig(cfg({ maxChars: 1000 }));
    expect((await post({ code: "a".repeat(1000), error: "e".repeat(2000) })).statusCode).toBe(200);
    expect(h.stream).toHaveBeenCalledTimes(1);
    for (const body of [
      { code: "a".repeat(1001), error: "e" },
      { code: "a", error: "e".repeat(2001) },
    ]) {
      const res = await post(body);
      expect(res.statusCode).toBe(413);
      expect(res.json()).toMatchObject({ success: false, code: "too_large" });
    }
    expect(h.stream).toHaveBeenCalledTimes(1);
  });

  it("E11 malformed body → 400 bad_request", async () => {
    for (const body of [{}, { code: "" , error: "e"}, { code: "x", error: 5 }]) {
      const res = await post(body);
      expect(res.statusCode).toBe(400);
      const j = res.json();
      expect(j).toMatchObject({ success: false, code: "bad_request" });
      expect(typeof j.error).toBe("string");
    }
    expect(h.stream).not.toHaveBeenCalled();
  });

  it("E12 disabled → 404", async () => {
    h.setConfig(cfg({ enabled: false }));
    const res = await post(BAD);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("disabled");
    expect(h.stream).not.toHaveBeenCalled();
  });
});

describe("model call", () => {
  it("E13 output budget + no apiKey override", async () => {
    h.setConfig(cfg({ maxChars: 50000 }));
    await post(BAD);
    h.setConfig(cfg({ maxChars: 3000 }));
    await post(BAD);
    const [, , o1] = h.stream.mock.calls[0];
    const [, , o2] = h.stream.mock.calls[1];
    expect(o1).toMatchObject({ temperature: 0, maxTokens: 8192 });
    expect(o2).toMatchObject({ temperature: 0, maxTokens: 1000 });
    expect("apiKey" in (o1 as object)).toBe(false);
  });

  it("E14 prompt carries code and error verbatim", async () => {
    await post(BAD);
    const [model, ctx] = h.stream.mock.calls[0] as [any, any, any];
    expect(model).toMatchObject({ provider: "anthropic", id: "m" });
    expect(ctx.systemPrompt).toMatch(/only/i);
    expect(ctx.messages).toHaveLength(1);
    const content = JSON.stringify(ctx.messages[0].content);
    expect(content).toContain("Parse error on line 2");
    expect(content).toContain("graph TD\\nA-->");
  });

  it("E6b model ids containing ':' pass verbatim", async () => {
    h.setConfig(cfg({ model: "openrouter/x:free" }));
    await post(BAD);
    expect(h.find).toHaveBeenCalledWith("openrouter", "x:free");
  });
});

describe("failures", () => {
  it("X1 second request while first pending → 429 busy; slot released after", async () => {
    let release!: () => void;
    h.stream.mockReturnValueOnce(
      (async function* () {
        await new Promise<void>((r) => (release = r));
        yield { type: "text_delta", delta: "graph TD\nA-->B" };
      })(),
    );
    const first = post(BAD);
    await vi.waitFor(() => expect(h.stream).toHaveBeenCalledTimes(1));
    const second = await post(BAD);
    expect(second.statusCode).toBe(429);
    expect(second.json().code).toBe("busy");
    expect(h.stream).toHaveBeenCalledTimes(1);
    release();
    expect((await first).statusCode).toBe(200);
    expect((await post(BAD)).statusCode).toBe(200);
    expect(h.stream).toHaveBeenCalledTimes(2);
  });

  it("X3 timeout → 504 with log outcome=timeout", async () => {
    vi.useFakeTimers();
    h.setConfig(cfg({ timeoutMs: 5000 }));
    h.stream.mockImplementation((_m: unknown, _c: unknown, o: any) =>
      (async function* () {
        await new Promise((_r, rej) => o.signal.addEventListener("abort", () => rej(new Error("aborted"))));
      })(),
    );
    const p = post(BAD);
    await vi.advanceTimersByTimeAsync(5000);
    const res = await p;
    expect(res.statusCode).toBe(504);
    expect(res.json().code).toBe("timeout");
    expect(h.logs.join("\n")).toMatch(/\[mermaid-repair\] outcome=timeout model=anthropic\/m ms=\d+ chars=\d+/);
  });

  it("X4 provider throw and unknown model → 502 provider_error, no secrets", async () => {
    h.stream.mockImplementation(() => {
      throw new Error("401");
    });
    const res = await post(BAD);
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe("provider_error");
    expect(res.body).not.toMatch(/apiKey|sk-SECRET|headers/);

    h.stream.mockClear();
    h.find.mockResolvedValueOnce(null);
    const res2 = await post(BAD);
    expect(res2.statusCode).toBe(502);
    expect(res2.json().code).toBe("provider_error");
    expect(h.stream).not.toHaveBeenCalled();
  });

  it("X5 unparseable output → 502, no data", async () => {
    h.setConfig(cfg({ maxChars: 1000 }));
    for (const out of ["", "```mermaid\n```", "a".repeat(1001)]) {
      h.stream.mockReturnValueOnce(textStream(out));
      const res = await post(BAD);
      expect(res.statusCode).toBe(502);
      const j = res.json();
      expect(j.code).toBe("unparseable");
      expect(j.data).toBeUndefined();
    }
  });

  it("X6 network guard rejects before any model call", async () => {
    const g = build({
      guard: async (_req, reply) => {
        reply.code(403).send({ success: false, error: "no" });
      },
    });
    const res = await g.app.inject({ method: "POST", url: "/api/mermaid/repair", payload: BAD, remoteAddress: "203.0.113.5" });
    expect(res.statusCode).toBe(403);
    expect(g.stream).not.toHaveBeenCalled();
    await g.app.close();
  });

  it("X7 logs outcome/model/ms/chars and never content", async () => {
    h.setConfig(cfg({ timeoutMs: 5000 }));
    const payload = { code: "graph TD\nSENTINEL_SRC_9f3-->", error: "SENTINEL_ERR_2c4" };
    h.stream.mockReturnValueOnce(textStream("graph TD\nSENTINEL_OUT_7a1-->B"));
    await post(payload);
    h.stream.mockImplementationOnce(() => {
      throw new Error("SENTINEL_OUT_7a1 provider said");
    });
    await post(payload);
    const all = h.logs.join("\n");
    expect(h.logs.filter((l) => l.startsWith("[mermaid-repair]"))).toHaveLength(2);
    expect(all).toMatch(/outcome=ok model=anthropic\/m ms=\d+ chars=\d+/);
    expect(all).not.toMatch(/SENTINEL/);
  });
});

describe("X2 client disconnect", () => {
  it("aborts the model call, frees the slot, logs aborted", async () => {
    const real = build();
    let sawAbort = false;
    real.stream.mockImplementationOnce((_m: unknown, _c: unknown, o: any) =>
      (async function* () {
        await new Promise<void>((resolve) =>
          o.signal.addEventListener("abort", () => {
            sawAbort = true;
            resolve();
          }),
        );
        yield { type: "text_delta", delta: "late" };
      })(),
    );
    await real.app.listen({ port: 0, host: "127.0.0.1" });
    const port = (real.app.server.address() as AddressInfo).port;
    const body = JSON.stringify(BAD);
    const req = http.request({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/api/mermaid/repair",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    });
    req.on("error", () => {});
    req.end(body);
    await vi.waitFor(() => expect(real.stream).toHaveBeenCalledTimes(1));
    req.destroy();
    await vi.waitFor(() => expect(sawAbort).toBe(true));
    await vi.waitFor(() => expect(real.logs.join("\n")).toMatch(/outcome=aborted/));
    const next = await real.app.inject({ method: "POST", url: "/api/mermaid/repair", payload: BAD });
    expect(next.statusCode).toBe(200);
    await real.app.close();
  });
});
