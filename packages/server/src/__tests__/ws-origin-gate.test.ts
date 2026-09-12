/**
 * The WebSocket upgrade Origin gate (issue #625, design D1/D3/D5).
 *
 * A hostile page could open `ws://127.0.0.1:8000/ws` from any site, receive the
 * `sessions_snapshot` broadcast and drive `create_terminal`. Browsers cannot
 * omit or forge `Origin` on a handshake, so one check at the listener — ahead
 * of every other admission branch — closes the first hop of the whole chain.
 *
 * These boot a REAL server and drive the REAL upgrade handler (the
 * `ws-upgrade-routing.test.ts` pattern), because the thing under test is the
 * ordering inside that handler, which a unit test cannot observe.
 *
 * Folds test-plan #E4–#E9, #E18, #X1, #X2, #F4.
 * See change: fix-ws-origin-cswsh.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { resetConfigSnapshot } from "../config-snapshot.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

const ATTACKER = "http://attacker.example";

let handle: TestServerHandle | undefined;

afterEach(async () => {
  if (handle) await handle.stop();
  handle = undefined;
});

type DialResult =
  | { kind: "open"; first?: string }
  | { kind: "status"; status: number }
  | { kind: "error" };

/**
 * Dial a WS URL and report HOW it ended: 101 (with the first frame, so the
 * `sessions_snapshot` assertion is possible), the refusal status code, or a
 * transport error. The status is the whole point — a gate that 403s and one
 * that 400s are different bugs.
 */
function dial(url: string, headers: Record<string, string> = {}): Promise<DialResult> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    let settled = false;
    const done = (r: DialResult) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* best-effort */
      }
      resolve(r);
    };
    ws.on("open", () => {
      // Give the gateway a beat to push its first frame, then report.
      const timer = setTimeout(() => done({ kind: "open" }), 1500);
      ws.on("message", (data) => {
        clearTimeout(timer);
        done({ kind: "open", first: String(data) });
      });
    });
    ws.on("unexpected-response", (_req, res) => done({ kind: "status", status: res.statusCode ?? 0 }));
    ws.on("error", () => done({ kind: "error" }));
    setTimeout(() => done({ kind: "error" }), 5000);
  });
}

const isStatus = (r: DialResult, code: number) => r.kind === "status" && r.status === code;

/**
 * Hand-write the upgrade request on a raw socket and return the status line.
 *
 * The `ws` client refuses to SEND a control character in a header value, so it
 * cannot express the hostile input #X1 is about. An attacker is under no such
 * constraint — this is the shape that actually arrives.
 */
function rawUpgrade(port: number, origin: string): Promise<string> {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1", () => {
      sock.write(
        `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${Buffer.from("0123456789abcdef").toString("base64")}\r\n` +
          `Sec-WebSocket-Version: 13\r\nOrigin: ${origin}\r\n\r\n`,
      );
    });
    let buf = "";
    sock.on("data", (c) => {
      buf += c.toString();
      if (buf.includes("\r\n")) {
        sock.destroy();
        resolve(buf.split("\r\n")[0]);
      }
    });
    sock.on("error", () => resolve(""));
    sock.on("close", () => resolve(buf.split("\r\n")[0] ?? ""));
    setTimeout(() => {
      sock.destroy();
      resolve(buf.split("\r\n")[0] ?? "");
    }, 5000);
  });
}

/** Create a terminal over an already-trusted socket and return its id. */
function createTerminal(httpPort: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/ws`);
    const fail = setTimeout(() => reject(new Error("create_terminal timed out")), 10000);
    ws.on("open", () => ws.send(JSON.stringify({ type: "create_terminal", cwd: process.cwd() })));
    ws.on("message", (data) => {
      let msg: { type?: string; terminal?: { id?: string }; id?: string };
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      const id = msg.terminal?.id ?? msg.id;
      if (msg.type === "terminal_added" && id) {
        clearTimeout(fail);
        ws.close();
        resolve(id);
      }
    });
    ws.on("error", (e) => {
      clearTimeout(fail);
      reject(e);
    });
  });
}

/** Register a live-server entry pointing at a local upstream port. */
async function startLiveEntry(httpPort: number, upstreamPort: number): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${httpPort}/api/live-server/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ host: "127.0.0.1", port: upstreamPort, label: "test" }),
  });
  const json = (await res.json()) as { data?: { id?: string } };
  if (!json.data?.id) throw new Error(`live-server/start failed: HTTP ${res.status}`);
  return json.data.id;
}

// ─── #E4 — the gate runs first, on every path ───────────────────────────────
describe("#E4 an untrusted Origin is refused on every WS path", () => {
  it("403s /ws, /ws/terminal/*, /live/*, /ws/bridge and an unrouted path", async () => {
    handle = await createTestServer();
    const base = `ws://127.0.0.1:${handle.httpPort}`;

    for (const p of ["/ws", "/ws/terminal/term-x", "/live/abcd1234", "/ws/bridge", "/ws/nope"]) {
      const r = await dial(`${base}${p}`, { origin: ATTACKER });
      expect(isStatus(r, 403), `${p} → ${JSON.stringify(r)}`).toBe(true);
    }
  }, 30000);

  it("403s /ws/bridge rather than its usual 400 — the gate runs BEFORE routing", async () => {
    handle = await createTestServer();

    const gated = await dial(`ws://127.0.0.1:${handle.httpPort}/ws/bridge`, { origin: ATTACKER });
    const ungated = await dial(`ws://127.0.0.1:${handle.httpPort}/ws/bridge`);

    expect(isStatus(gated, 403)).toBe(true);
    expect(isStatus(ungated, 400)).toBe(true);
  }, 30000);
});

// ─── #E5 — header-less and loopback clients keep working ────────────────────
describe("#E5 legitimate local clients are unaffected", () => {
  it("admits a dial with NO Origin header (every non-browser client)", async () => {
    handle = await createTestServer();
    const r = await dial(`ws://127.0.0.1:${handle.httpPort}/ws`);
    expect(r.kind).toBe("open");
    expect(r.kind === "open" && r.first).toContain("sessions_snapshot");
  }, 30000);

  it("admits a loopback Origin", async () => {
    handle = await createTestServer();
    const r = await dial(`ws://127.0.0.1:${handle.httpPort}/ws`, {
      origin: `http://127.0.0.1:${handle.httpPort}`,
    });
    expect(r.kind).toBe("open");
    expect(r.kind === "open" && r.first).toContain("sessions_snapshot");
  }, 30000);
});

// ─── #E6 — hostname-addressed same-origin (mDNS, plain LAN) ─────────────────
describe("#E6 a hostname-addressed same-origin page is admitted", () => {
  it("admits Origin http://mac.local:<port> when Host is mac.local:<port>", async () => {
    handle = await createTestServer();
    const r = await dial(`ws://127.0.0.1:${handle.httpPort}/ws`, {
      host: `mac.local:${handle.httpPort}`,
      origin: `http://mac.local:${handle.httpPort}`,
    });
    expect(r.kind).toBe("open");
  }, 30000);

  it("refuses the same hostname Origin when the Host does NOT match", async () => {
    handle = await createTestServer();
    const r = await dial(`ws://127.0.0.1:${handle.httpPort}/ws`, {
      host: `other.local:${handle.httpPort}`,
      origin: `http://mac.local:${handle.httpPort}`,
    });
    expect(isStatus(r, 403)).toBe(true);
  }, 30000);
});

// ─── #E7 — `Origin: null` is admitted for `live` ONLY ───────────────────────
describe("#E7 the opaque `Origin: null`", () => {
  it("403s on /ws and /ws/terminal, but never on /live/*", async () => {
    handle = await createTestServer();
    const base = `ws://127.0.0.1:${handle.httpPort}`;

    expect(isStatus(await dial(`${base}/ws`, { origin: "null" }), 403)).toBe(true);
    expect(isStatus(await dial(`${base}/ws/terminal/term-x`, { origin: "null" }), 403)).toBe(true);

    // No live entry exists, so the proxy destroys the socket — but the GATE
    // must never be what refuses it.
    const live = await dial(`${base}/live/abcd1234`, { origin: "null" });
    expect(isStatus(live, 403)).toBe(false);
  }, 30000);
});

// ─── #E8 — an attacker cannot attach to an existing terminal ────────────────
describe("#E8 terminal hijack", () => {
  it("403s the attacker dial and leaves the terminal unattached", async () => {
    handle = await createTestServer();
    const id = await createTerminal(handle.httpPort);

    const r = await dial(`ws://127.0.0.1:${handle.httpPort}/ws/terminal/${id}`, { origin: ATTACKER });
    expect(isStatus(r, 403)).toBe(true);

    // The terminal is untouched: a TRUSTED dial still attaches and gets output.
    const ok = await dial(`ws://127.0.0.1:${handle.httpPort}/ws/terminal/${id}`);
    expect(ok.kind).toBe("open");
  }, 40000);
});

// ─── #E9 — a refused dial must not burn the ticket ──────────────────────────
describe("#E9 an untrusted Origin does not consume a ticket", () => {
  it("403s the attacker dial, then the SAME ticket still opens from loopback", async () => {
    handle = await createTestServer();
    const res = await fetch(`http://127.0.0.1:${handle.httpPort}/api/ws-ticket`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "browser" }),
    });
    const ticket = ((await res.json()) as { data: { ticket: string } }).data.ticket;
    const url = `ws://127.0.0.1:${handle.httpPort}/ws?ticket=${ticket}`;
    const REMOTE = { "x-forwarded-for": "203.0.113.7" };

    const refused = await dial(url, { ...REMOTE, origin: ATTACKER });
    expect(isStatus(refused, 403)).toBe(true);

    const second = await dial(url, { ...REMOTE, origin: `http://127.0.0.1:${handle.httpPort}` });
    expect(second.kind).toBe("open");

    // …and exactly once: the third dial finds the ticket spent.
    const third = await dial(url, { ...REMOTE, origin: `http://127.0.0.1:${handle.httpPort}` });
    expect(third.kind).not.toBe("open");
  }, 40000);
});

// ─── #E18 — the allow-list is read LIVE ─────────────────────────────────────
describe("#E18 cors.allowedOrigins applies without a restart", () => {
  let configFile: string;

  beforeEach(() => {
    const dir = path.join(process.env.HOME!, ".pi", "dashboard");
    fs.mkdirSync(dir, { recursive: true });
    configFile = path.join(dir, "config.json");
    fs.writeFileSync(configFile, JSON.stringify({ cors: { allowedOrigins: [] } }));
    resetConfigSnapshot();
  });

  afterEach(() => {
    fs.rmSync(configFile, { force: true });
    resetConfigSnapshot();
  });

  it("403s an origin, then admits it once config names it", async () => {
    handle = await createTestServer();
    const url = `ws://127.0.0.1:${handle.httpPort}/ws`;

    expect(isStatus(await dial(url, { origin: "https://dash.example" }), 403)).toBe(true);

    fs.writeFileSync(configFile, JSON.stringify({ cors: { allowedOrigins: ["https://dash.example"] } }));

    const after = await dial(url, { origin: "https://dash.example" });
    expect(after.kind).toBe("open");
  }, 30000);
});

// ─── #X1 / #X2 — hostile and malformed Origin values ────────────────────────
describe("#X1 the rejection log is not attacker-writable", () => {
  it("logs one sanitized single line per refusal", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
    handle = await createTestServer();
    try {
      const url = `ws://127.0.0.1:${handle.httpPort}/ws`;
      // A control character never reaches the gate at all: Node's HTTP parser
      // refuses the request line-first, with 400. Asserted so the guarantee is
      // pinned where it actually lives rather than assumed.
      const hostile = "http://a.example\u001b[31m[fake] line";
      expect(await rawUpgrade(handle.httpPort, hostile)).toContain("400");
      expect(errors.filter((l) => l.includes("[ws-gate]"))).toHaveLength(0);

      // What CAN arrive is an over-long value, and it must not blow up the log.
      expect(isStatus(await dial(url, { origin: `http://${"a".repeat(600)}.example` }), 403)).toBe(true);

      const lines = errors.filter((l) => l.includes("[ws-gate]"));
      expect(lines).toHaveLength(1);
      for (const line of lines) {
        expect(line.split("\n")).toHaveLength(1);
        // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting absence is the point.
        expect(/[\u0000-\u001f\u007f]/.test(line)).toBe(false);
        const origin = /origin=(\S*)/.exec(line)?.[1] ?? "";
        expect(origin.length).toBeLessThanOrEqual(256);
      }
    } finally {
      spy.mockRestore();
    }
  }, 30000);
});

describe("#X2 malformed Origin values", () => {
  it("403s each one and leaves the server serving", async () => {
    handle = await createTestServer();
    const url = `ws://127.0.0.1:${handle.httpPort}/ws`;

    for (const origin of ["not a url", "http://", `http://localhost:${1}, http://evil.example`]) {
      const r = await dial(url, { origin });
      expect(isStatus(r, 403), `${origin} → ${JSON.stringify(r)}`).toBe(true);
    }

    const good = await dial(url);
    expect(good.kind).toBe("open");
  }, 30000);
});

// ─── #F4 — live preview keeps working through the proxy ─────────────────────
describe("#F4 the sandboxed live-preview iframe still reaches its dev server", () => {
  it("proxies an `Origin: null` /live/<id> dial and strips the header upstream", async () => {
    const seen: Array<string | undefined> = [];
    const upstream = await new Promise<WebSocketServer>((resolve) => {
      const wss: WebSocketServer = new WebSocketServer({ port: 0, host: "127.0.0.1" }, () =>
        resolve(wss),
      );
    });
    upstream.on("connection", (_ws, req) => {
      seen.push(req.headers.origin);
    });
    const upstreamPort = (upstream.address() as { port: number }).port;

    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
    handle = await createTestServer();
    try {
      const id = await startLiveEntry(handle.httpPort, upstreamPort);
      const r = await dial(`ws://127.0.0.1:${handle.httpPort}/live/${id}/`, { origin: "null" });

      expect(r.kind).toBe("open");
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBeUndefined();
      expect(errors.filter((l) => l.includes("[ws-gate]"))).toHaveLength(0);
    } finally {
      spy.mockRestore();
      upstream.close();
    }
  }, 30000);
});
