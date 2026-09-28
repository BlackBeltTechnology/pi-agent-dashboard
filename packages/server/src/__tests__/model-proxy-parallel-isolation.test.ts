/**
 * Parallel-conversation isolation tests for the model proxy (/v1/*).
 *
 * Drives many independent conversations through a REAL listening Fastify
 * server concurrently (fetch over loopback) against an echo fake model, and
 * asserts that nothing leaks between them:
 *  - each upstream call sees only its own system prompt + history
 *  - each response carries only its own content (OpenAI + Anthropic, SSE + JSON)
 *  - multi-turn histories evolve independently
 *  - aborting one client cancels only that conversation (both endpoints)
 *  - an upstream failure mid-stream ends only that stream, cleanly (both endpoints)
 *  - per-key concurrency caps are isolated between keys and fully released
 *
 * The fake model uses a start barrier so streams provably overlap in time
 * (maxInFlight === N), rather than merely being issued "in parallel".
 */

import type { AddressInfo } from "node:net";
import type { ModelProxyConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { generateKey, hashKey } from "../model-proxy/api-key-store.js";
import { createModelProxyAuthGate } from "../model-proxy/auth-gate.js";
import { registerModelProxyRoutes } from "../routes/model-proxy-routes.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MODEL = { id: "echo-1", provider: "fake", contextWindow: 100000, maxTokens: 4096 };
const MODEL_ID = "fake/echo-1";

/** Text of a pi-ai message regardless of string / content-array shape. */
function textOf(msg: any): string {
  if (typeof msg?.content === "string") return msg.content;
  if (Array.isArray(msg?.content)) {
    return msg.content.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("");
  }
  return "";
}

/** Barrier: resolves once `n` parties arrived (or after `timeoutMs`). */
function makeBarrier(n: number, timeoutMs = 2000) {
  let arrived = 0;
  let open!: () => void;
  const opened = new Promise<void>((r) => { open = r; });
  const timer = setTimeout(() => open(), timeoutMs);
  return {
    async arrive() {
      arrived += 1;
      if (arrived >= n) { clearTimeout(timer); open(); }
      await opened;
    },
  };
}

interface EchoCall { opts: any; aborted: boolean; completed: boolean }

/**
 * Echo fake for pi-ai streamSimple. Reply =
 *   `<system>|turns=<userTurnCount>|echo=<lastUserText>`
 * streamed in small chunks with jittered delays so conversations interleave.
 */
function makeEchoModel(opts: { barrier?: { arrive(): Promise<void> }; chunkDelayMs?: number; hold?: Promise<void> } = {}) {
  const calls: EchoCall[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  async function* run(o: any, call: EchoCall): AsyncIterable<any> {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await opts.barrier?.arrive();
      await opts.hold;
      const userMsgs = (o.messages ?? []).filter((m: any) => m.role === "user");
      const reply = `${o.system ?? ""}|turns=${userMsgs.length}|echo=${textOf(userMsgs.at(-1))}`;
      yield { type: "start" };
      for (let i = 0; i < reply.length; i += 3) {
        await sleep(opts.chunkDelayMs ?? Math.floor(Math.random() * 4));
        if (o.signal?.aborted) {
          call.aborted = true;
          const err = new Error("aborted");
          err.name = "AbortError";
          throw err;
        }
        yield { type: "text_delta", delta: reply.slice(i, i + 3) };
      }
      call.completed = true;
      yield {
        type: "done",
        message: { content: [{ type: "text", text: reply }], stopReason: "stop", usage: { input: 1, output: 1 } },
      };
    } finally {
      if (o.signal?.aborted) call.aborted = true;
      inFlight -= 1;
    }
  }

  return {
    calls,
    get maxInFlight() { return maxInFlight; },
    streamSimple: (o: any) => {
      const call: EchoCall = { opts: o, aborted: false, completed: false };
      calls.push(call);
      return run(o, call);
    },
  };
}

function makeRegistry() {
  return {
    getAvailable: async () => [MODEL],
    find: async (p: string, id: string) => (p === MODEL.provider && id === MODEL.id ? MODEL : null),
    firstAvailable: async () => MODEL,
    getApiKeyAndHeaders: async () => ({ apiKey: "sk-upstream", headers: {} }),
  };
}

function makeKey(id: string) {
  const cleartext = generateKey();
  return { cleartext, entry: { id, label: id, createdAt: Date.now(), hash: hashKey(cleartext), scopes: ["all"] as any } };
}

interface Harness { app: FastifyInstance; base: string; keys: string[] }
let current: Harness | undefined;

async function startServer(
  streamSimple: (o: any) => AsyncIterable<any>,
  cfg: { keys?: number; maxConcurrentStreams?: number; perKeyConcurrentStreams?: number; providerCap?: number } = {},
): Promise<Harness> {
  const keys = Array.from({ length: cfg.keys ?? 1 }, (_, i) => makeKey(`key-${i}`));
  const config = {
    enabled: true,
    maxConcurrentStreams: cfg.maxConcurrentStreams ?? 64,
    perKeyConcurrentStreams: cfg.perKeyConcurrentStreams ?? 64,
    perProviderCaps: { [MODEL.provider]: cfg.providerCap ?? 64 },
    logRequests: false,
    apiKeys: keys.map((k) => k.entry),
  } as ModelProxyConfig;

  // forceCloseConnections: after a client abort, undici opens a spare socket
  // that never carries a request; the default idle-only close would wait ~4s
  // for undici's keep-alive timeout on it.
  const app = Fastify({ logger: false, forceCloseConnections: true });
  app.addHook("onRequest", createModelProxyAuthGate({ getConfig: () => config }));
  registerModelProxyRoutes(app, { getConfig: () => config, getRegistry: async () => makeRegistry() as any, streamSimple });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const { port } = app.server.address() as AddressInfo;
  current = { app, base: `http://127.0.0.1:${port}`, keys: keys.map((k) => k.cleartext) };
  return current;
}

afterEach(async () => {
  await current?.app.close();
  current = undefined;
});

type Msg = { role: "system" | "user" | "assistant"; content: string };

function post(h: Harness, path: string, body: unknown, key = h.keys[0], signal?: AbortSignal) {
  return fetch(`${h.base}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

/** Parse an SSE body into its JSON `data:` payloads. */
function sseEvents(raw: string): any[] {
  return raw
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l.trim() !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)));
}

function openAiStreamText(raw: string) {
  const events = sseEvents(raw);
  return {
    text: events.map((e) => e.choices?.[0]?.delta?.content ?? "").join(""),
    ids: new Set(events.map((e) => e.id)),
  };
}

function anthropicStreamText(raw: string) {
  const events = sseEvents(raw);
  return {
    text: events
      .filter((e) => e.type === "content_block_delta")
      .map((e) => e.delta?.text ?? "")
      .join(""),
    ids: new Set(events.filter((e) => e.type === "message_start").map((e) => e.message?.id)),
  };
}

/** Start one streaming conversation on the OpenAI or Anthropic endpoint. */
function postStreaming(
  h: Harness,
  format: "openai" | "anthropic",
  c: { system: string; history: Msg[] },
  signal?: AbortSignal,
) {
  return format === "anthropic"
    ? post(h, "/v1/messages", { model: MODEL_ID, stream: true, max_tokens: 256, system: c.system, messages: c.history }, h.keys[0], signal)
    : post(
        h,
        "/v1/chat/completions",
        { model: MODEL_ID, stream: true, messages: [{ role: "system", content: c.system }, ...c.history] },
        h.keys[0],
        signal,
      );
}

/** Read a streaming body to the end, reporting the accumulated text per chunk. */
async function readBody(res: Response, onChunk: (raw: string) => void): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return raw;
    raw += decoder.decode(value, { stream: true });
    onChunk(raw);
  }
}

/** Conversation fixture with a unique secret woven into system + history. */
function conversation(i: number): { secret: string; system: string; history: Msg[] } {
  const secret = `SECRET-${i}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    secret,
    system: `sys:${secret}`,
    history: [
      { role: "user", content: `hello from ${secret}` },
      { role: "assistant", content: `ack ${secret}` },
      { role: "user", content: `question ${secret}` },
    ],
  };
}

function expectOnlyOwnSecret(haystack: string, own: string, all: string[]) {
  expect(haystack).toContain(own);
  for (const other of all) if (other !== own) expect(haystack).not.toContain(other);
}

// ── Tests ──────────────────────────────────────────────────────────────────

const N = 12;

describe("model proxy — parallel conversation isolation", () => {
  it("OpenAI non-streaming: N overlapping conversations each see and receive only their own context", async () => {
    const model = makeEchoModel({ barrier: makeBarrier(N) });
    const h = await startServer(model.streamSimple);
    const convs = Array.from({ length: N }, (_, i) => conversation(i));
    const secrets = convs.map((c) => c.secret);

    const results = await Promise.all(
      convs.map(async (c) => {
        const res = await post(h, "/v1/chat/completions", {
          model: MODEL_ID,
          stream: false,
          messages: [{ role: "system", content: c.system }, ...c.history],
        });
        return { c, status: res.status, body: await res.json() };
      }),
    );

    expect(model.maxInFlight).toBe(N); // truly concurrent, not serialized
    expect(model.calls).toHaveLength(N);

    for (const { c, status, body } of results) {
      expect(status).toBe(200);
      const text = body.choices[0].message.content;
      expect(text).toBe(`sys:${c.secret}|turns=2|echo=question ${c.secret}`);
      expectOnlyOwnSecret(text, c.secret, secrets);
    }

    // Upstream side: every call carried exactly one conversation's context.
    const seen = new Set<string>();
    for (const call of model.calls) {
      const upstream = JSON.stringify({ system: call.opts.system, messages: call.opts.messages });
      const owner = secrets.find((s) => upstream.includes(s));
      expect(owner).toBeDefined();
      expectOnlyOwnSecret(upstream, owner!, secrets);
      seen.add(owner!);
    }
    expect(seen.size).toBe(N);
  });

  it("mixed OpenAI + Anthropic SSE streams interleave without cross-talk", async () => {
    const model = makeEchoModel({ barrier: makeBarrier(N) });
    const h = await startServer(model.streamSimple);
    const convs = Array.from({ length: N }, (_, i) => conversation(i));
    const secrets = convs.map((c) => c.secret);

    const results = await Promise.all(
      convs.map(async (c, i) => {
        const anthropic = i % 2 === 1;
        const res = anthropic
          ? await post(h, "/v1/messages", { model: MODEL_ID, stream: true, max_tokens: 256, system: c.system, messages: c.history })
          : await post(h, "/v1/chat/completions", {
              model: MODEL_ID,
              stream: true,
              messages: [{ role: "system", content: c.system }, ...c.history],
            });
        const raw = await res.text();
        return { c, anthropic, status: res.status, parsed: anthropic ? anthropicStreamText(raw) : openAiStreamText(raw) };
      }),
    );

    expect(model.maxInFlight).toBe(N);
    const allIds = new Set<string>();
    for (const { c, status, parsed } of results) {
      expect(status).toBe(200);
      expect(parsed.text).toBe(`sys:${c.secret}|turns=2|echo=question ${c.secret}`);
      expectOnlyOwnSecret(parsed.text, c.secret, secrets);
      expect(parsed.ids.size).toBe(1); // one message id per response…
      const [id] = parsed.ids;
      expect(allIds.has(id)).toBe(false); // …and never shared with another response
      allIds.add(id);
    }
  });

  it("multi-turn: parallel conversations evolve independent histories across turns", async () => {
    const TURNS = 4;
    const model = makeEchoModel();
    const h = await startServer(model.streamSimple);
    const convs = Array.from({ length: N }, (_, i) => ({ ...conversation(i), msgs: [] as Msg[] }));
    const secrets = convs.map((c) => c.secret);

    await Promise.all(
      convs.map(async (c) => {
        c.msgs.push({ role: "system", content: c.system });
        for (let t = 1; t <= TURNS; t++) {
          c.msgs.push({ role: "user", content: `turn ${t} of ${c.secret}` });
          const res = await post(h, "/v1/chat/completions", { model: MODEL_ID, stream: true, messages: c.msgs });
          expect(res.status).toBe(200);
          const { text } = openAiStreamText(await res.text());
          expect(text).toBe(`sys:${c.secret}|turns=${t}|echo=turn ${t} of ${c.secret}`);
          expectOnlyOwnSecret(text, c.secret, secrets);
          c.msgs.push({ role: "assistant", content: text });
        }
      }),
    );

    expect(model.calls).toHaveLength(N * TURNS);
    for (const call of model.calls) {
      const upstream = JSON.stringify(call.opts.messages);
      const owner = secrets.find((s) => upstream.includes(s))!;
      expectOnlyOwnSecret(upstream, owner, secrets);
      // History is monotonic per conversation: k user turns ⇒ k-1 assistant turns.
      const users = call.opts.messages.filter((m: any) => m.role === "user").length;
      const assistants = call.opts.messages.filter((m: any) => m.role === "assistant").length;
      expect(assistants).toBe(users - 1);
    }
  });

  it.each(["openai", "anthropic"] as const)("%s: aborting one client cancels only that conversation", async (format) => {
    const model = makeEchoModel({ barrier: makeBarrier(3), chunkDelayMs: 15 });
    const h = await startServer(model.streamSimple);
    const convs = [0, 1, 2].map(conversation);
    const victim = new AbortController();

    const deltaMarker = format === "anthropic" ? "text_delta" : "content";
    const run = async (c: ReturnType<typeof conversation>, signal?: AbortSignal) => {
      const res = await postStreaming(h, format, c, signal);
      // Victim aborts right after its first delta arrives.
      return readBody(res, (raw) => {
        if (signal && raw.includes(deltaMarker)) victim.abort();
      });
    };

    const [victimResult, ...survivors] = await Promise.allSettled([
      run(convs[0], victim.signal),
      run(convs[1]),
      run(convs[2]),
    ]);

    expect(victimResult.status).toBe("rejected");
    for (const [i, r] of survivors.entries()) {
      expect(r.status).toBe("fulfilled");
      const c = convs[i + 1];
      const parse = format === "anthropic" ? anthropicStreamText : openAiStreamText;
      expect(parse((r as PromiseFulfilledResult<string>).value).text)
        .toBe(`sys:${c.secret}|turns=2|echo=question ${c.secret}`);
    }

    // Server-side: give the close event a moment to propagate.
    await sleep(100);
    const byOwner = (s: string) => model.calls.find((call) => call.opts.system === `sys:${s}`)!;
    expect(byOwner(convs[0].secret).aborted).toBe(true);
    expect(byOwner(convs[0].secret).completed).toBe(false);
    for (const c of convs.slice(1)) {
      expect(byOwner(c.secret).aborted).toBe(false);
      expect(byOwner(c.secret).completed).toBe(true);
    }
  });

  it.each(["openai", "anthropic"] as const)(
    "%s: an upstream failure mid-stream ends that stream cleanly and leaves the others intact",
    async (format) => {
      const echo = makeEchoModel({ barrier: makeBarrier(2) }); // the 2 healthy streams overlap
      // Conversation whose system prompt contains FAIL throws after its first delta.
      const streamSimple = (o: any) =>
        String(o.system).includes("FAIL")
          ? (async function* () {
              yield { type: "start" };
              yield { type: "text_delta", delta: "partial" };
              throw new Error("upstream exploded");
            })()
          : echo.streamSimple(o);
      const h = await startServer(streamSimple);
      const failing = { ...conversation(0), system: "sys:FAIL" };
      const healthy = [1, 2].map(conversation);

      const [failed, ...ok] = await Promise.all(
        [failing, ...healthy].map(async (c) => {
          const res = await postStreaming(h, format, c, AbortSignal.timeout(3000));
          return { status: res.status, raw: await res.text() };
        }),
      );

      // Failing stream terminates (no client hang) with the same shape as an upstream error event.
      expect(failed.status).toBe(200);
      if (format === "anthropic") {
        expect(failed.raw).toContain("event: error");
        expect(failed.raw).toContain("upstream exploded");
      } else {
        expect(failed.raw).toContain("data: [DONE]");
      }
      const parse = format === "anthropic" ? anthropicStreamText : openAiStreamText;
      for (const [i, r] of ok.entries()) {
        const c = healthy[i];
        expect(r.status).toBe(200);
        expect(parse(r.raw).text).toBe(`sys:${c.secret}|turns=2|echo=question ${c.secret}`);
      }
    },
  );

  it("per-key concurrency caps are isolated between keys and fully released", async () => {
    let releaseHold!: () => void;
    const hold = new Promise<void>((r) => { releaseHold = r; });
    const model = makeEchoModel({ hold });
    const h = await startServer(model.streamSimple, { keys: 2, perKeyConcurrentStreams: 2 });
    const [keyA, keyB] = h.keys;
    const body = (c: ReturnType<typeof conversation>) => ({
      model: MODEL_ID,
      stream: false,
      messages: [{ role: "system", content: c.system }, ...c.history],
    });

    // Saturate key A with 2 held streams.
    const heldA = [0, 1].map((i) => post(h, "/v1/chat/completions", body(conversation(i)), keyA));
    while (model.calls.length < 2) await sleep(5);

    // Key A is full; key B is unaffected.
    const overA = await post(h, "/v1/chat/completions", body(conversation(2)), keyA);
    expect(overA.status).toBe(429);
    expect((await overA.json()).code).toBe("KEY_FULL");
    expect(overA.headers.get("retry-after")).toBeTruthy();

    const cB = conversation(3);
    const pendingB = post(h, "/v1/chat/completions", body(cB), keyB);

    releaseHold();
    const doneA = await Promise.all(heldA);
    for (const r of doneA) expect(r.status).toBe(200);
    const resB = await pendingB;
    expect(resB.status).toBe(200);
    expect((await resB.json()).choices[0].message.content).toContain(cB.secret);

    // Slots were released: key A can run 2 concurrent streams again.
    const again = await Promise.all(
      [4, 5].map((i) => post(h, "/v1/chat/completions", body(conversation(i)), keyA)),
    );
    for (const r of again) expect(r.status).toBe(200);
  });
});
