/**
 * Test helper: a loopback `/v1/systemone` fake with scripted replies, plus an
 * off-machine interceptor that records requests to non-loopback hosts without
 * touching the network. Listen-on-0 glue follows
 * packages/server/src/__tests__/model-proxy-second-port.test.ts.
 * See change: add-system-one-registry.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";

type Reply =
  | { kind: "answer"; body: unknown; delayMs?: number; status?: number }
  | { kind: "delay"; ms: number; body?: unknown }
  | { kind: "destroy" }
  | { kind: "redirect"; location: string }
  | { kind: "status"; status: number; body?: unknown };

export interface FakeBackend {
  url: string;
  port: number;
  /** TCP connections accepted so far. */
  connections: number;
  /** Parsed JSON bodies received, in order. */
  requests: Array<{ path: string; headers: IncomingMessage["headers"]; body: any }>;
  /** Push replies; the last one repeats when the queue drains. */
  script(...replies: Reply[]): void;
  /** Build the answer for each request from its body (overrides the script). */
  respondWith(fn: (body: any) => unknown): void;
  close(): Promise<void>;
}

/** A well-formed TypeSafe answer covering every question in `body.questions`. */
export function autoAnswer(body: any, model = "fake-1"): unknown {
  const answers: Record<string, unknown> = {};
  for (const [id, q] of Object.entries<any>(body?.questions ?? {})) {
    if (q.type === "choice") {
      const keys = Object.keys(q.criteria);
      const p = Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 1 : 0]));
      answers[id] = { choice: keys[0], probabilities: p, confidence: 1 };
    } else if (q.type === "score") {
      answers[id] = { score: 0, probabilities: q.criteria.map((_: unknown, i: number) => (i === 0 ? 1 : 0)), confidence: 1 };
    } else {
      answers[id] = { noul: 0.7 };
    }
  }
  return { model, answers };
}

export async function startFakeBackend(path = "/v1/systemone"): Promise<FakeBackend> {
  const queue: Reply[] = [];
  let last: Reply | null = null;
  let fn: ((body: any) => unknown) | null = null;
  const sockets = new Set<Socket>();
  const state = { connections: 0, requests: [] as FakeBackend["requests"] };

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body: any = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
      } catch {
        body = null;
      }
      state.requests.push({ path: req.url ?? "", headers: req.headers, body });
      const reply: Reply = fn
        ? { kind: "answer", body: fn(body) }
        : (queue.shift() ?? last ?? { kind: "answer", body: autoAnswer(body) });
      if (!fn) last = reply;
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      switch (reply.kind) {
        case "answer":
          if (reply.delayMs) setTimeout(() => send(reply.status ?? 200, reply.body), reply.delayMs);
          else send(reply.status ?? 200, reply.body);
          return;
        case "delay":
          setTimeout(() => send(200, reply.body ?? autoAnswer(body)), reply.ms);
          return;
        case "destroy":
          res.writeHead(200, { "content-type": "application/json" });
          res.write('{"model":"fake-1","answ');
          setTimeout(() => req.socket.destroy(), 5);
          return;
        case "redirect":
          res.writeHead(302, { location: reply.location });
          res.end();
          return;
        case "status":
          send(reply.status, reply.body ?? { error: "x" });
      }
    });
  });
  server.on("connection", (s: Socket) => {
    state.connections++;
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}${path}`,
    port,
    get connections() {
      return state.connections;
    },
    get requests() {
      return state.requests;
    },
    script(...replies: Reply[]) {
      queue.push(...replies);
    },
    respondWith(f) {
      fn = f;
    },
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i;

export interface Interceptor {
  /** Requests that targeted a non-loopback host (never sent). */
  offMachine: Array<{ url: string; headers: Record<string, string> }>;
  restore(): void;
}

/**
 * Replace `globalThis.fetch` so non-loopback targets are recorded and fail
 * with a network error instead of reaching the network. Loopback requests go
 * through the real fetch.
 */
export function interceptOffMachine(): Interceptor {
  const real = globalThis.fetch;
  const offMachine: Interceptor["offMachine"] = [];
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (!LOOPBACK.test(url.hostname)) {
      offMachine.push({ url: url.href, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
      throw new TypeError("fetch failed (intercepted off-machine request)");
    }
    return real(input, init);
  }) as typeof fetch;
  return {
    offMachine,
    restore() {
      globalThis.fetch = real;
    },
  };
}
