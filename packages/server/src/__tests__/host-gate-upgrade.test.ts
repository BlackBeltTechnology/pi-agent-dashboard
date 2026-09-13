/**
 * Host-admission gate — WebSocket upgrade wiring (issue #637, design D1).
 *
 * The upgrade handler is the one place a raw-socket observable matters: the
 * host check must run at the very top, ahead of the Origin gate and every
 * auth branch, so a rebinding pair can neither complete an upgrade nor burn a
 * single-use ticket. These boot a REAL server and drive the REAL upgrade
 * handler (the ws-origin-gate.test.ts pattern).
 *
 * Folds test-plan #E17, #E18, #X7 (WS half).
 * See change: add-host-allowlist-admission.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { WsRouteScope } from "../auth/ws-ticket.js";
import { resetConfigSnapshot } from "../config-snapshot.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

const GATE_ENV = "PI_DASHBOARD_HOST_GATE";

let handle: TestServerHandle | undefined;
let configFile: string;
let prevEnv: string | undefined;

beforeEach(() => {
  const dir = path.join(process.env.HOME!, ".pi", "dashboard");
  fs.mkdirSync(dir, { recursive: true });
  configFile = path.join(dir, "config.json");
  fs.writeFileSync(configFile, JSON.stringify({}));
  prevEnv = process.env[GATE_ENV];
  delete process.env[GATE_ENV];
  resetConfigSnapshot();
});

afterEach(async () => {
  if (handle) await handle.stop();
  handle = undefined;
  fs.rmSync(configFile, { force: true });
  if (prevEnv === undefined) delete process.env[GATE_ENV];
  else process.env[GATE_ENV] = prevEnv;
  resetConfigSnapshot();
});

type DialResult =
  | { kind: "open"; first?: string }
  | { kind: "status"; status: number }
  | { kind: "error" };

/** Dial a WS URL and report HOW it ended: 101 (with first frame), a refusal
 * status code, or a transport error. The status is the whole point — a gate
 * that 403s and one that 400s are different bugs. */
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

async function mintTicket(httpPort: number, scope: WsRouteScope): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${httpPort}/api/ws-ticket`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope }),
  });
  const json = (await res.json()) as { success: boolean; data?: { ticket: string } };
  if (!json.success || !json.data?.ticket) {
    throw new Error(`ws-ticket mint failed: HTTP ${res.status}`);
  }
  return json.data.ticket;
}

// ─── #E17 — the rebinding pair is refused before anything else ──────────────

describe("#E17 WS enforce refusal", () => {
  it("403s the rebinding pair, destroys the socket, leaves the ticket unconsumed, logs scope=browser", async () => {
    process.env[GATE_ENV] = "enforce";
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
    handle = await createTestServer();
    try {
      const ticket = await mintTicket(handle.httpPort, "browser");
      const url = `ws://127.0.0.1:${handle.httpPort}/ws?ticket=${ticket}`;

      // Loopback peer, rebinding Origin/Host pair, valid ticket — the exact
      // #637 shape. The Host gate must refuse it before the Origin gate's
      // same-origin-by-Host rule could vouch for the attacker's own name.
      const refused = await dial(url, {
        host: "rebind.example:8000",
        origin: "http://rebind.example:8000",
      });
      expect(isStatus(refused, 403)).toBe(true);

      const lines = errors.filter((l) => l.includes("[host-gate]"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("refused host=rebind.example");
      expect(lines[0]).toContain("scope=browser");

      // The ticket is UNCONSUMED: a remote dial (forwarding header ⇒ not
      // genuine-local, so the ticket is the only admission) still spends it…
      const remote = { "x-forwarded-for": "203.0.113.7" };
      const second = await dial(url, {
        ...remote,
        origin: `http://127.0.0.1:${handle.httpPort}`,
      });
      expect(second.kind).toBe("open");
      // …exactly once.
      const third = await dial(url, { ...remote, origin: `http://127.0.0.1:${handle.httpPort}` });
      expect(third.kind).not.toBe("open");
    } finally {
      spy.mockRestore();
    }
  }, 40000);
});

// ─── #E18 — report mode changes nothing the Origin gates admit today ────────

describe("#E18 WS report mode unchanged", () => {
  it("admits a proxy-name same-origin pair and logs one would-refuse line", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
    handle = await createTestServer();
    try {
      const r = await dial(`ws://127.0.0.1:${handle.httpPort}/ws`, {
        host: "proxy-int.corp:8000",
        origin: "http://proxy-int.corp:8000",
      });
      expect(r.kind).toBe("open");
      const lines = errors.filter((l) => l.includes("[host-gate]"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("would-refuse host=proxy-int.corp");
    } finally {
      spy.mockRestore();
    }
  }, 30000);

  it("admits a mac.local pair with NO host-gate line", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
    handle = await createTestServer();
    try {
      const port = handle.httpPort;
      const r = await dial(`ws://127.0.0.1:${port}/ws`, {
        host: `mac.local:${port}`,
        origin: `http://mac.local:${port}`,
      });
      expect(r.kind).toBe("open");
      expect(errors.filter((l) => l.includes("[host-gate]"))).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  }, 30000);
});

// ─── #X7 — regression: hostname-addressed clients survive enforce ───────────

describe("#X7 WS enforce regression", () => {
  it("an mDNS-hostname same-origin upgrade still completes in enforce mode", async () => {
    process.env[GATE_ENV] = "enforce";
    handle = await createTestServer();
    const port = handle.httpPort;

    const r = await dial(`ws://127.0.0.1:${port}/ws`, {
      host: `mac.local:${port}`,
      origin: `http://mac.local:${port}`,
    });
    expect(r.kind).toBe("open");
    expect(r.kind === "open" && r.first).toContain("sessions_snapshot");
  }, 30000);
});
