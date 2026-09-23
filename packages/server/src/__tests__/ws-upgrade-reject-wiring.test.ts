/**
 * WS upgrade rejection logging — wiring into the REAL upgrade handler
 * (test-plan #E16–#E19). Only the otherwise-silent branches (bridge-scope
 * 400, auth 401, no-auth 403) emit a `[ws-upgrade]` line; rejections already
 * logged by `[host-gate]` / `[ws-gate]` are not double-logged.
 *
 * See change: harden-ios-safari-memory-and-ws-diagnostics (design D4).
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { resetConfigSnapshot } from "../config-snapshot.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

const GATE_ENV = "PI_DASHBOARD_HOST_GATE";

let handle: TestServerHandle | undefined;
let configFile: string;
let prevEnv: string | undefined;
let errors: string[];
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  const dir = path.join(process.env.HOME!, ".pi", "dashboard");
  fs.mkdirSync(dir, { recursive: true });
  configFile = path.join(dir, "config.json");
  fs.writeFileSync(configFile, JSON.stringify({}));
  prevEnv = process.env[GATE_ENV];
  delete process.env[GATE_ENV];
  resetConfigSnapshot();
  errors = [];
  spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map((a) => String(a)).join(" "));
  });
});

afterEach(async () => {
  spy.mockRestore();
  if (handle) await handle.stop();
  handle = undefined;
  fs.rmSync(configFile, { force: true });
  if (prevEnv === undefined) delete process.env[GATE_ENV];
  else process.env[GATE_ENV] = prevEnv;
  resetConfigSnapshot();
});

type DialResult = { kind: "open" } | { kind: "status"; status: number } | { kind: "error" };

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
    ws.on("open", () => done({ kind: "open" }));
    ws.on("unexpected-response", (_req, res) => done({ kind: "status", status: res.statusCode ?? 0 }));
    ws.on("error", () => done({ kind: "error" }));
    setTimeout(() => done({ kind: "error" }), 5000);
  });
}

async function mintTicket(httpPort: number): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${httpPort}/api/ws-ticket`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope: "browser" }),
  });
  const json = (await res.json()) as { success: boolean; data?: { ticket: string } };
  if (!json.success || !json.data?.ticket) throw new Error(`ws-ticket mint failed: HTTP ${res.status}`);
  return json.data.ticket;
}

const wsUpgradeLines = () => errors.filter((l) => l.includes("[ws-upgrade]"));

describe("#E16 forwarded /ws rejected 403 (no auth secret)", () => {
  it("logs one [ws-upgrade] line naming the header, never its value", async () => {
    handle = await createTestServer();
    const r = await dial(`ws://127.0.0.1:${handle.httpPort}/ws`, {
      "x-forwarded-for": "203.0.113.9",
      origin: `http://127.0.0.1:${handle.httpPort}`,
    });
    expect(r).toEqual({ kind: "status", status: 403 });
    const lines = wsUpgradeLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[ws-upgrade] rejected status=403 scope=browser");
    expect(lines[0]).toContain("fwd=x-forwarded-for");
    expect(lines[0]).toContain("ticket=absent");
    expect(lines[0]).not.toContain("203.0.113.9");
  }, 30000);
});

describe("#E17 auth-secret 401", () => {
  it("logs one [ws-upgrade] status=401 line", async () => {
    handle = await createTestServer({ authConfig: { secret: "test-secret-abc", providers: {} } });
    const r = await dial(`ws://127.0.0.1:${handle.httpPort}/ws`, {
      "x-forwarded-for": "203.0.113.9",
      origin: `http://127.0.0.1:${handle.httpPort}`,
    });
    expect(r).toEqual({ kind: "status", status: 401 });
    const lines = wsUpgradeLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[ws-upgrade] rejected status=401 scope=browser");
  }, 30000);
});

describe("#E18 bridge scope on the dashboard port", () => {
  it("400s, logs ticket=present without the value, and leaves the ticket consumable", async () => {
    handle = await createTestServer();
    const ticket = await mintTicket(handle.httpPort);
    const r = await dial(`ws://127.0.0.1:${handle.httpPort}/ws/bridge?ticket=${ticket}`);
    expect(r).toEqual({ kind: "status", status: 400 });
    const lines = wsUpgradeLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("status=400 scope=bridge");
    expect(lines[0]).toContain("ticket=present");
    expect(lines[0]).not.toContain(ticket);

    // Unconsumed: a remote dial (forwarding header ⇒ the ticket is the only
    // admission) still spends it.
    const reuse = await dial(`ws://127.0.0.1:${handle.httpPort}/ws?ticket=${ticket}`, {
      "x-forwarded-for": "203.0.113.7",
      origin: `http://127.0.0.1:${handle.httpPort}`,
    });
    expect(reuse.kind).toBe("open");
  }, 30000);
});

describe("#E19 already-logged rejections are not double-logged", () => {
  it("host-gate and ws-gate refusals emit their own line and no [ws-upgrade] line", async () => {
    process.env[GATE_ENV] = "enforce";
    handle = await createTestServer();
    const hostRefused = await dial(`ws://127.0.0.1:${handle.httpPort}/ws`, {
      host: "rebind.example:8000",
      origin: "http://rebind.example:8000",
    });
    expect(hostRefused).toEqual({ kind: "status", status: 403 });
    expect(errors.filter((l) => l.includes("[host-gate]"))).toHaveLength(1);

    const originRefused = await dial(`ws://127.0.0.1:${handle.httpPort}/ws`, {
      origin: "https://evil.example",
    });
    expect(originRefused).toEqual({ kind: "status", status: 403 });
    expect(errors.filter((l) => l.includes("[ws-gate]"))).toHaveLength(1);

    expect(wsUpgradeLines()).toEqual([]);
  }, 30000);
});
