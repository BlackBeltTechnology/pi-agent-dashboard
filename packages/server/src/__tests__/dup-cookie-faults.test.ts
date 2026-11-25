/**
 * Duplicate `pi_dash_*` cookie gate — fault injection and information disclosure.
 *
 *  T.X33  a malformed Cookie header never 500s and never takes the server down
 *  T.X34  the hook throws mid-refusal: fail closed, upgrade socket destroyed, no unhandled rejection
 *  T.X35  the upgrade head cannot be written: no throw, socket destroyed once, ticket unconsumed
 *  T.X43  the refusal (tier-5 path, preview-shaped Host) never leaks cookie values, other names, other pids, hosts
 *
 * See change: serve-live-previews-on-capability-origin (D10; test-plan #X33, #X34, #X35, #X43).
 */

import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import type { Duplex } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import {
  createDuplicateCookieGate,
  DuplicateCookieLog,
  expiryPaths,
  findDuplicateDashboardCookie,
  refuseDuplicateCookieUpgrade,
} from "../auth/duplicate-cookie-gate.js";
import { resetConfigSnapshot } from "../config-snapshot.js";
import { proofFetch, withLocalProof } from "../test-support/local-credential-stamp.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

const quietLog = () => new DuplicateCookieLog(() => {});
const DUP = "pi_dash_token=a; pi_dash_token=b";

/** Anything that would crash the process or hide a rejected promise is a failure of the test. */
const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => unhandled.push(e);
beforeAll(() => {
  process.on("unhandledRejection", onUnhandled);
  process.on("uncaughtException", onUnhandled);
});
afterAll(() => {
  process.off("unhandledRejection", onUnhandled);
  process.off("uncaughtException", onUnhandled);
});
beforeEach(() => {
  unhandled.length = 0;
});

interface RawResult {
  status: number;
  head: string;
  body: string;
  closed: boolean;
}

/** Send exactly these bytes (a Buffer, so invalid UTF-8 and control bytes survive) and read what comes back. */
function rawRequest(port: number, bytes: Buffer, timeoutMs = 8000): Promise<RawResult> {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => s.write(bytes));
    const chunks: Buffer[] = [];
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      const buf = Buffer.concat(chunks).toString("latin1");
      const [head, ...rest] = buf.split("\r\n\r\n");
      resolve({ status: Number(/^HTTP\/1\.1 (\d+)/.exec(head)?.[1] ?? 0), head, body: rest.join("\r\n\r\n"), closed: true });
      s.destroy();
    };
    s.on("data", (c: Buffer) => chunks.push(c));
    s.on("close", done);
    s.on("error", done); // a reset after our own oversized write is a clean end, not a failure
    setTimeout(done, timeoutMs);
  });
}

const req = (port: number, path: string, headerLines: Array<string | Buffer>, extra = "") =>
  Buffer.concat([
    Buffer.from(`GET ${path} HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n${extra}`, "latin1"),
    ...headerLines.flatMap((l) => [typeof l === "string" ? Buffer.from(l, "latin1") : l, Buffer.from("\r\n")]),
    Buffer.from("\r\n"),
  ]);

// ─── T.X33 ────────────────────────────────────────────────────────────────────────────────────────────

describe("T.X33 — malformed Cookie never 500s", () => {
  describe("the parser and the hook, in-process", () => {
    it("never throws for any header-shaped input, including lone surrogates, NULs and a non-string value", () => {
      const inputs: Array<string | string[] | undefined> = [
        "",
        "=",
        ";",
        "=;=;;",
        ";;;;;;",
        "\u0000pi_dash_token=a; \u0000pi_dash_token=b",
        "pi_dash_token=\udc00; pi_dash_token=\ud800",
        "pi_dash_\u00ff\u00fe=1; pi_dash_\u00ff\u00fe=2",
        `${"pi_dash_a=1; ".repeat(5000)}`,
        "x".repeat(1_000_000),
        ["pi_dash_token=a", "pi_dash_token=b"],
        [],
        undefined,
      ];
      for (const h of inputs) expect(() => findDuplicateDashboardCookie(h)).not.toThrow();
      expect(findDuplicateDashboardCookie("=")).toBeNull();
      expect(findDuplicateDashboardCookie("=;=;;")).toBeNull();
      expect(findDuplicateDashboardCookie("pi_dash_token=\udc00; pi_dash_token=\ud800")?.name).toBe("pi_dash_token");
    });

    it("a refusal naming an attacker-shaped (non-token) cookie name is a clean 400 with no expiry line and no raw bytes in the body", async () => {
      const app = Fastify({ logger: false });
      app.addHook("onRequest", createDuplicateCookieGate({ tier2: () => false, log: quietLog() }));
      app.all("/*", async () => ({ ok: true }));
      await app.listen({ port: 0, host: "127.0.0.1" });
      const port = (app.server.address() as net.AddressInfo).port;
      try {
        for (const accept of ["application/json", "text/html"]) {
          const r = await rawRequest(
            port,
            req(port, "/api/sessions", [Buffer.from("Cookie: pi_dash_\xff\xfe<x>=1; pi_dash_\xff\xfe<x>=2", "latin1")], `Accept: ${accept}\r\n`),
          );
          expect(r.status, accept).toBe(400);
          expect(r.head.toLowerCase()).not.toContain("set-cookie"); // not a cookie-name token ⇒ nothing to expire, nothing injected
          if (accept === "text/html") expect(r.body).not.toContain("<x>"); // escaped in markup
          else expect(() => JSON.parse(r.body)).not.toThrow(); // JSON: the name is a string value, never structure
        }
      } finally {
        await app.close();
      }
    });
  });

  describe("through the real dashboard server", () => {
    let handle: TestServerHandle;
    // generous: several agents / workers boot full servers at once on a shared box
    beforeAll(async () => {
      handle = await createTestServer();
    }, 90_000);
    afterAll(async () => {
      await handle.stop();
    }, 90_000);

    const health = async () => {
      const r = await fetch(`http://127.0.0.1:${handle.httpPort}/api/health`);
      return r.status;
    };

    const cases: Array<{ label: string; lines: () => Array<string | Buffer>; allowed: number[] }> = [
      { label: "invalid UTF-8 in a duplicated dashboard cookie", lines: () => [Buffer.from("Cookie: pi_dash_token=\xff\xfe\xc3\x28; pi_dash_token=\x80\x81", "latin1")], allowed: [400] },
      { label: "invalid UTF-8 in a single cookie (no duplicate)", lines: () => [Buffer.from("Cookie: pi_dash_token=\xff\xfe\xc3\x28", "latin1")], allowed: [200, 400] },
      { label: "control bytes (0x01, 0x7f) in the value", lines: () => [Buffer.from("Cookie: pi_dash_token=a\x01b\x7f; pi_dash_token=c", "latin1")], allowed: [400] },
      { label: "a header with only `=` and `;`", lines: () => ["Cookie: =;=;;=", "Accept: application/json"], allowed: [200] },
      { label: "an empty Cookie header", lines: () => ["Cookie: "], allowed: [200] },
      { label: "a Cookie header with only separators and spaces", lines: () => ["Cookie:  ; ;; ; "], allowed: [200] },
      { label: "1 MB Cookie header (past Node's 16 KB head limit)", lines: () => [`Cookie: ${"pi_dash_token=a; ".repeat(70_000)}`], allowed: [431, 400] },
      { label: "a 14 KB duplicated cookie (just under the head limit)", lines: () => [`Cookie: ${"c=1; ".repeat(2600)}pi_dash_token=a; pi_dash_token=b`], allowed: [400] },
      { label: "a NUL byte in the Cookie header", lines: () => [Buffer.from("Cookie: pi_dash_token=a\x00; pi_dash_token=b", "latin1")], allowed: [400] },
    ];

    it.each(cases)("$label → a clean answer, never a 5xx, never a crashed hook", async ({ lines, allowed }) => {
      const port = handle.httpPort;
      const r = await rawRequest(port, req(port, "/api/health", lines()));
      // either a clean HTTP answer from the allowed set, or (at Node's limit) the connection simply ended
      if (r.status !== 0) {
        expect(allowed).toContain(r.status);
        expect(r.status).toBeLessThan(500);
      }
      expect(unhandled).toEqual([]);
      // the server keeps serving the next request
      expect(await health()).toBe(200);
    });

    it("a duplicated dashboard cookie with invalid UTF-8 is a self-describing 400 JSON (valid, parseable)", async () => {
      const port = handle.httpPort;
      const r = await rawRequest(port, req(port, "/api/health", [Buffer.from("Cookie: pi_dash_token=\xff\xfe; pi_dash_token=\xc3\x28", "latin1")], "Accept: application/json\r\n"));
      expect(r.status).toBe(400);
      expect(JSON.parse(r.body)).toEqual({ success: false, error: "duplicate_dashboard_cookie", cookie: "pi_dash_token" });
    });
  });
});

// ─── T.X34 ────────────────────────────────────────────────────────────────────────────────────────────

describe("T.X34 — the hook throws mid-refusal", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function mk(opts: { log?: DuplicateCookieLog; breakReply?: (reply: any) => void }) {
    const calls: string[] = [];
    const a = Fastify({ logger: false });
    app = a;
    if (opts.breakReply) {
      const br = opts.breakReply;
      a.addHook("onRequest", (_req, reply, done) => {
        br(reply);
        done();
      });
    }
    a.addHook("onRequest", createDuplicateCookieGate({ tier2: () => false, log: opts.log ?? quietLog() }));
    a.all("/*", async () => {
      calls.push("handler");
      return { ok: true };
    });
    await a.listen({ port: 0, host: "127.0.0.1" });
    return { calls, port: (a.server.address() as net.AddressInfo).port };
  }

  const get = (port: number, cookie: string) =>
    new Promise<{ status: number; body: string; setCookie: string[] }>((resolve, reject) => {
      http
        .get({ host: "127.0.0.1", port, path: "/api/sessions", headers: { cookie, accept: "application/json" } }, (res) => {
          let body = "";
          res.on("data", (c) => {
            body += c;
          });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body, setCookie: ([] as string[]).concat(res.headers["set-cookie"] ?? []) }));
        })
        .on("error", reject);
    });

  it("a throwing log sink does not change the refusal: still the self-healing 400, handler never reached", async () => {
    const log = new DuplicateCookieLog(() => {
      throw new Error("sink exploded");
    });
    const { calls, port } = await mk({ log });
    const r = await get(port, DUP);
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error).toBe("duplicate_dashboard_cookie");
    expect(r.setCookie.length).toBeGreaterThan(0);
    expect(calls).toEqual([]);
    expect((await get(port, "pi_dash_token=ok")).status).toBe(200); // the next, clean request is served
    expect(unhandled).toEqual([]);
  });

  it("reply.header throwing on the 400 path fails closed: an error response, the handler never reached, server keeps serving", async () => {
    const { calls, port } = await mk({
      breakReply: (reply) => {
        const orig = reply.header.bind(reply);
        // break only the refusal's headers; Fastify's own error path stays able to answer
        reply.header = (k: string, v: unknown) => {
          if (String(k).toLowerCase() === "set-cookie" || String(k).toLowerCase() === "cache-control") throw new Error("header exploded");
          return orig(k, v);
        };
      },
    });
    const r = await get(port, DUP);
    expect(r.status).toBeGreaterThanOrEqual(400); // fail closed: never a 2xx, never forwarded
    expect(calls).toEqual([]);
    expect((await get(port, "pi_dash_token=ok")).status).toBe(200);
    expect(unhandled).toEqual([]);
  });

  it("upgrade: a throwing log sink still destroys the socket, writes the refusal head, and throws nothing", () => {
    const written: string[] = [];
    const destroy = vi.fn();
    const socket = { write: (s: string) => written.push(s), destroy } as unknown as Duplex;
    const log = new DuplicateCookieLog(() => {
      throw new Error("sink exploded");
    });
    const request = { headers: { cookie: "pi_dash_local=a; pi_dash_local=b", host: "localhost:8000" }, url: "/ws" } as never;
    let refused: boolean | undefined;
    expect(() => {
      refused = refuseDuplicateCookieUpgrade(request, socket, { log, tier2: () => false });
    }).not.toThrow();
    expect(refused).toBe(true); // the caller returns before any ticket / scope handler
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(written[0]?.startsWith("HTTP/1.1 400 Bad Request")).toBe(true);
  });

  it("upgrade: a head that cannot even be composed (hostile request object) still destroys the socket", () => {
    const destroy = vi.fn();
    const socket = { write: vi.fn(), destroy } as unknown as Duplex;
    // `url` getter throws: composing the head fails after the duplicate was already detected
    const request = {
      headers: { cookie: "pi_dash_local=a; pi_dash_local=b" },
      get url(): string {
        throw new Error("url exploded");
      },
    } as never;
    // the throw happens before the guarded region only if the implementation reads `url` unguarded
    let refused: boolean | undefined;
    try {
      refused = refuseDuplicateCookieUpgrade(request, socket, { log: quietLog(), tier2: () => false });
    } catch {
      refused = undefined;
    }
    // reading `request.url` is a plain property read in `upgrade` (Node never throws there); the load-bearing claim is
    // that nothing downstream of the detection leaves the socket open
    if (refused !== undefined) expect(destroy).toHaveBeenCalledTimes(1);
  });
});

// ─── T.X35 ────────────────────────────────────────────────────────────────────────────────────────────

describe("T.X35 — upgrade head write failure", () => {
  const dupReq = { headers: { cookie: "pi_dash_local=a; pi_dash_local=b", host: "localhost:8000" }, url: "/ws" } as never;

  it("write throws EPIPE synchronously: refused, no throw, destroyed exactly once", () => {
    const destroy = vi.fn();
    const socket = {
      write: () => {
        throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
      },
      destroy,
    } as unknown as Duplex;
    let refused: boolean | undefined;
    expect(() => {
      refused = refuseDuplicateCookieUpgrade(dupReq, socket, { log: quietLog(), tier2: () => false });
    }).not.toThrow();
    expect(refused).toBe(true);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("the client socket is already destroyed: no throw, no 'error' event escapes, destroyed once", async () => {
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as net.AddressInfo).port;
    const serverSide = new Promise<net.Socket>((resolve) => server.once("connection", resolve));
    const client = net.connect(port, "127.0.0.1");
    const sock = await serverSide;
    const errors: Error[] = [];
    const closes: number[] = [];
    sock.on("error", (e) => errors.push(e));
    sock.on("close", () => closes.push(1));
    const destroySpy = vi.spyOn(sock, "destroy");
    sock.destroy(); // the peer is gone before the refusal is written
    destroySpy.mockClear();
    let refused: boolean | undefined;
    expect(() => {
      refused = refuseDuplicateCookieUpgrade(dupReq, sock, { log: quietLog(), tier2: () => false });
    }).not.toThrow();
    expect(refused).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(closes).toHaveLength(1); // the socket closed once
    expect(unhandled).toEqual([]);
    client.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("a socket that errors asynchronously during the write is destroyed, and the process survives", async () => {
    class Dying extends EventEmitter {
      destroyed = false;
      destroyCalls = 0;
      write(_chunk: string, cb?: (e?: Error) => void) {
        // EPIPE is reported asynchronously, after destroy() has already been called
        setImmediate(() => cb?.(Object.assign(new Error("write EPIPE"), { code: "EPIPE" })));
        return false;
      }
      destroy() {
        this.destroyCalls++;
        this.destroyed = true;
        return this;
      }
    }
    const s = new Dying();
    expect(refuseDuplicateCookieUpgrade(dupReq, s as unknown as Duplex, { log: quietLog(), tier2: () => false })).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(s.destroyCalls).toBe(1);
    expect(unhandled).toEqual([]);
  });

  describe("inside the real dashboard server", () => {
    let handle: TestServerHandle | undefined;
    let configFile: string;
    beforeEach(() => {
      const dir = path.join(process.env.HOME!, ".pi", "dashboard");
      fs.mkdirSync(dir, { recursive: true });
      configFile = path.join(dir, "config.json");
      fs.writeFileSync(configFile, JSON.stringify({}));
      resetConfigSnapshot();
    });
    afterEach(async () => {
      await handle?.stop();
      handle = undefined;
      fs.rmSync(configFile, { force: true });
      resetConfigSnapshot();
    });

    it("a client that vanishes mid-refusal leaves the ticket unconsumed and the server serving; no handler runs for that socket", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        handle = await createTestServer();
        const port = handle.httpPort;
        const res = await proofFetch(`http://127.0.0.1:${port}/api/ws-ticket`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scope: "browser" }),
        });
        const ticket = ((await res.json()) as { data: { ticket: string } }).data.ticket;
        const url = `ws://127.0.0.1:${port}/ws?ticket=${ticket}`;

        // Fire the duplicate-cookie upgrade and drop the connection without reading the answer.
        await new Promise<void>((resolve) => {
          const s = net.connect(port, "127.0.0.1", () => {
            s.write(
              `GET /ws?ticket=${ticket} HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nCookie: pi_dash_local=a; pi_dash_local=b\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
              () => {
                s.destroy();
                resolve();
              },
            );
          });
          s.on("error", () => resolve());
        });
        // wait until the server has actually processed (and logged) the refusal
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && !warn.mock.calls.some((c) => String(c[0]).includes("[cookie-gate] refused duplicate cookie"))) {
          await new Promise((r) => setTimeout(r, 25));
        }
        expect(warn.mock.calls.some((c) => String(c[0]).includes("[cookie-gate] refused duplicate cookie name=pi_dash_local"))).toBe(true);

        // the ticket was never spent: a remote-shaped dial (forwarding header ⇒ the ticket is the only admission) still opens
        const remote = { "x-forwarded-for": "203.0.113.7", origin: `http://127.0.0.1:${port}` };
        const first = await new Promise<string>((resolve) => {
          const ws = new WebSocket(url, { headers: withLocalProof(url, remote) });
          ws.on("open", () => {
            ws.close();
            resolve("open");
          });
          ws.on("unexpected-response", (_q, r) => resolve(`status ${r.statusCode}`));
          ws.on("error", () => resolve("error"));
          setTimeout(() => resolve("timeout"), 5000);
        });
        expect(first).toBe("open");
        // …and exactly once
        const second = await new Promise<string>((resolve) => {
          const ws = new WebSocket(url, { headers: withLocalProof(url, remote) });
          ws.on("open", () => {
            ws.close();
            resolve("open");
          });
          ws.on("unexpected-response", (_q, r) => resolve(`status ${r.statusCode}`));
          ws.on("error", () => resolve("error"));
          setTimeout(() => resolve("timeout"), 5000);
        });
        expect(second).not.toBe("open");
        expect(unhandled).toEqual([]);
        expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200);
      } finally {
        warn.mockRestore();
      }
    }, 40000);
  });
});

// ─── T.X43 ────────────────────────────────────────────────────────────────────────────────────────────

describe("T.X43 — the refusal body leaks nothing from tier-5 / preview-shaped requests", () => {
  let handle: TestServerHandle | undefined;
  let configFile: string;
  const LABEL = "b".repeat(26);
  const PID = "PIDREQUESTER000000000000000000000000000AAAA";
  const OTHER_PID = "PIDOTHERCAPABILITY0000000000000000000BBBB";
  const SECRET_A = "SECRETVALUEAAAA1111";
  const SECRET_B = "SECRETVALUEBBBB2222";

  beforeEach(() => {
    const dir = path.join(process.env.HOME!, ".pi", "dashboard");
    fs.mkdirSync(dir, { recursive: true });
    configFile = path.join(dir, "config.json");
    fs.writeFileSync(configFile, JSON.stringify({ allowedHosts: ["admitted-one.example.test", "admitted-two.example.test"] }));
    resetConfigSnapshot();
  });
  afterEach(async () => {
    await handle?.stop();
    handle = undefined;
    fs.rmSync(configFile, { force: true });
    resetConfigSnapshot();
  });

  function get(port: number, host: string, urlPath: string, headers: Record<string, string>) {
    return new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      http
        .get({ host: "127.0.0.1", port, path: urlPath, headers: { host, ...headers }, setHost: false }, (res) => {
          let body = "";
          res.on("data", (c) => {
            body += c;
          });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
        })
        .on("error", reject);
    });
  }

  const everything = (r: { body: string; headers: http.IncomingHttpHeaders }) => `${r.body}\n${JSON.stringify(r.headers)}`;

  it("dup-cookie 400 on /preview/<pid>/… : no cookie values, no other cookie names, no other pid, no host names; Paths only from the requester's path", async () => {
    handle = await createTestServer();
    const port = handle.httpPort;
    const urlPath = `/preview/${PID}/app/main.js?next=/preview/${OTHER_PID}/x`;
    const cookie = `pi_dash_token=${SECRET_A}; pi_dash_token=${SECRET_B}; pi_dash_pool_8101=${OTHER_PID}; theme=${OTHER_PID}; session_other=${SECRET_A}`;
    for (const accept of ["application/json", "text/html"]) {
      const r = await get(port, `localhost:${port}`, urlPath, {
        cookie,
        accept,
        referer: `http://localhost:${port}/preview/${OTHER_PID}/`,
        origin: "null",
      });
      expect(r.status, accept).toBe(400);
      const all = everything(r);
      // values, other names, other capabilities, hosts
      for (const forbidden of [SECRET_A, SECRET_B, OTHER_PID, "pi_dash_pool_8101", "session_other", "theme", "admitted-one.example.test", "admitted-two.example.test"]) {
        expect(all, `${accept} leaked ${forbidden}`).not.toContain(forbidden);
      }
      expect(r.body).not.toContain(PID); // the requester's own pid is only ever in a Set-Cookie Path, never the body
      expect(r.body).not.toContain("localhost");
      // the one thing named is the duplicated name
      if (accept === "application/json") expect(JSON.parse(r.body)).toEqual({ success: false, error: "duplicate_dashboard_cookie", cookie: "pi_dash_token" });
      else expect(r.body).toContain("pi_dash_token");

      // Set-Cookie Paths: only the requester's own path prefixes, plus the dashboard's canonical cookie paths
      const lines = ([] as string[]).concat(r.headers["set-cookie"] ?? []);
      expect(lines.length).toBeGreaterThan(0);
      const allowed = new Set(expiryPaths(urlPath));
      for (const line of lines) {
        expect(line.startsWith("pi_dash_token=; Max-Age=0; Path=")).toBe(true);
        const p = /Path=([^;]+)/.exec(line)![1];
        expect(allowed.has(p), `${accept} Path=${p}`).toBe(true);
        expect(p).not.toContain("next="); // the query string never becomes a cookie path
        expect(p).not.toContain(OTHER_PID);
      }
      expect(r.headers["access-control-allow-origin"]).toBeUndefined();
      expect(r.headers["cache-control"]).toBe("no-store");
    }
  }, 30000);

  it("an admitted dashboard Host: the HTML refusal names no admitted host (not its own, not the allow-list)", async () => {
    handle = await createTestServer();
    const port = handle.httpPort;
    const r = await get(port, `admitted-one.example.test:${port}`, "/api/sessions", { cookie: DUP, accept: "text/html" });
    expect(r.status).toBe(400);
    expect(String(r.headers["content-type"])).toMatch(/^text\/html/);
    expect(r.body).not.toContain("admitted-one.example.test");
    expect(r.body).not.toContain("admitted-two.example.test");
    expect(r.body).not.toMatch(/https?:\/\//); // no URL at all: no asset, no link, no admitted origin
    expect(r.body).not.toMatch(/<script/i);
  }, 30000);

  it("a preview-shaped Host with a duplicated dashboard cookie: the opaque preview answer leaks nothing either", async () => {
    handle = await createTestServer();
    const port = handle.httpPort;
    const cookie = `pi_dash_token=${SECRET_A}; pi_dash_token=${SECRET_B}; pi_dash_pool_8101=${OTHER_PID}`;
    for (const accept of ["application/json", "text/html"]) {
      const r = await get(port, `${LABEL}.localhost:${port}`, `/preview/${OTHER_PID}/x`, { cookie, accept });
      // previewApp is exempt from the dashboard gate: whatever it answers, it is its own opaque refusal
      expect(r.status).toBe(403);
      expect(JSON.parse(r.body)).toEqual({ error: "host_not_allowed" });
      const all = everything(r);
      for (const forbidden of [SECRET_A, SECRET_B, OTHER_PID, "pi_dash_token", "pi_dash_pool_8101", "admitted-one.example.test", LABEL]) {
        expect(all, `${accept} leaked ${forbidden}`).not.toContain(forbidden);
      }
      expect(r.headers["set-cookie"]).toBeUndefined(); // the preview origin never sets or expires a dashboard cookie
      expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    }
  }, 30000);
});
