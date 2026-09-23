import type { Socket } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Hold, Resolution } from "../grant-coordinator.js";
import { awaitHold } from "../hold-request.js";

/**
 * Transport for a held request, against a REAL HTTP server (change:
 * add-access-grant-dialog, task 6.3; test-plan #P1, #X1).
 *
 * `connectionTimeout` is shortened to 150 ms so "the hold outlives the
 * connection timeout" is proven in well under a second. The mechanism is the one
 * that matters at the production 10 s.
 */

const CONNECTION_TIMEOUT_MS = 150;
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function heldFor(ms: number, resolution: Resolution): Hold {
  return {
    held: true,
    result: new Promise((r) => setTimeout(() => r(resolution), ms)),
    abort: vi.fn(),
  };
}

async function start(route: (hold: Hold) => void, makeHold: () => Hold) {
  app = Fastify({ connectionTimeout: CONNECTION_TIMEOUT_MS });
  const seen: { socket?: Socket; before?: number; hold?: Hold } = {};
  app.post("/held", async (request, reply) => {
    const hold = makeHold();
    route(hold);
    seen.socket = request.raw.socket;
    seen.before = request.raw.socket.timeout;
    seen.hold = hold;
    const r = await awaitHold(request, reply, hold);
    return r;
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}/held`, seen };
}

const post = (url: string, signal?: AbortSignal) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal });

describe("6.3 a held request survives the connection timeout", () => {
  it("#P1 is answered after 3x the connection timeout, with the verdict", async () => {
    const { url } = await start(() => {}, () => heldFor(CONNECTION_TIMEOUT_MS * 3, { kind: "allow", verdict: "allow-once", subject: "/x" }));
    const res = await post(url);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: "allow", verdict: "allow-once", subject: "/x" });
  });

  it("restores the socket's prior timeout once the response flushes", async () => {
    const { url, seen } = await start(() => {}, () => heldFor(50, { kind: "deny", reason: "denied" }));
    await (await post(url)).json();
    await new Promise((r) => setTimeout(r, 20));
    expect(seen.before).toBeGreaterThan(0);
    expect(seen.socket?.timeout).toBe(seen.before);
  });

  it("does not abort an ordinary, finished request", async () => {
    const { url, seen } = await start(() => {}, () => heldFor(50, { kind: "deny", reason: "denied" }));
    await (await post(url)).json();
    await new Promise((r) => setTimeout(r, 20));
    expect(seen.hold?.abort).not.toHaveBeenCalled();
  });
});

describe("#X1 a client abort releases the hold", () => {
  it("calls abort when the client goes away mid-hold", async () => {
    let captured: Hold | undefined;
    const { url } = await start(
      (h) => {
        captured = h;
      },
      () => {
        let resolve!: (r: Resolution) => void;
        const hold: Hold = {
          held: true,
          result: new Promise((r) => {
            resolve = r;
          }),
          abort: vi.fn(() => resolve({ kind: "deny", reason: "aborted" })),
        };
        return hold;
      },
    );
    const ac = new AbortController();
    const pending = post(url, ac.signal).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 80));
    ac.abort();
    await pending;
    await new Promise((r) => setTimeout(r, 80));
    expect(captured?.abort).toHaveBeenCalledTimes(1);
  });
});

describe("an unheld denial passes straight through", () => {
  it("returns the result without touching the socket timeout", async () => {
    const socket = { timeout: 1234, setTimeout: vi.fn(), destroyed: false };
    const r = await awaitHold(
      { raw: { socket } } as never,
      { raw: { once: vi.fn(), removeListener: vi.fn() } } as never,
      { held: false, result: Promise.resolve({ kind: "deny", reason: "report-mode" }), abort: vi.fn() },
    );
    expect(r).toEqual({ kind: "deny", reason: "report-mode" });
    expect(socket.setTimeout).not.toHaveBeenCalled();
  });
});
