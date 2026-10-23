/**
 * The strict default on a REAL loopback listener: a bare-loopback peer (what a
 * container's host-gateway relay looks like) is refused on every strict-gated
 * surface; a caller that proves local possession is not; the opt-out restores
 * the old loopback allowance.
 *
 * Real listener, because the thing under test is the peer address + headers the
 * listener sees (a relayed container arrives as `127.0.0.1` with a loopback Host).
 * The docker e2e harness is NATed and so cannot prove this.
 *
 * See change: close-container-loopback-impersonation
 * (test-plan #E2–#E6, #E24; design D1).
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { resetConfigSnapshot } from "../config-snapshot.js";
import { proofFetch, proofHeaders } from "../test-support/local-credential-stamp.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

let handle: TestServerHandle | undefined;
let dash: string;
let errors: string[];
let warns: string[];

const base = () => `http://127.0.0.1:${handle!.httpPort}`;
const devicesFile = () => path.join(dash, "paired-devices.json");
const readDevices = () => (fs.existsSync(devicesFile()) ? fs.readFileSync(devicesFile(), "utf-8") : "<absent>");
const json = { "content-type": "application/json" };

function writeConfig(c: Record<string, unknown>) {
  fs.mkdirSync(dash, { recursive: true });
  fs.writeFileSync(path.join(dash, "config.json"), JSON.stringify(c), { mode: 0o600 });
  resetConfigSnapshot();
}

beforeEach(() => {
  dash = path.join(process.env.HOME!, ".pi", "dashboard");
  errors = [];
  warns = [];
  vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => void warns.push(a.map(String).join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a.map(String).join(" ")));
  writeConfig({ auth: { secret: "SECRET-VALUE-must-not-leak-0123456789" } });
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (handle) await handle.stop();
  handle = undefined;
  fs.rmSync(path.join(dash, "config.json"), { force: true });
  resetConfigSnapshot();
});

/** The four strict-gated requests of test-plan E2/E3. */
const requests = (post: (url: string, init?: RequestInit) => Promise<Response>) => ({
  mintDevice: () => post(`${base()}/api/paired-devices`, { method: "POST", headers: json, body: JSON.stringify({ label: "container" }) }),
  wsTicket: () => post(`${base()}/api/ws-ticket`, { method: "POST", headers: json, body: JSON.stringify({ scope: "bridge" }) }),
  listDevices: () => post(`${base()}/api/paired-devices`),
  config: () => post(`${base()}/api/config`),
});

describe("E2 — default: a bare-loopback peer with a spoofed loopback Host is refused", () => {
  it("refuses device mint, bridge ticket, device list and config read; nothing is written or issued", async () => {
    handle = await createTestServer();
    const before = readDevices();
    const r = requests((u, i) => fetch(u, i)); // bare: no proof, Host 127.0.0.1:<port>

    for (const [name, call] of Object.entries(r)) {
      const res = await call();
      expect([401, 403], `${name} → ${res.status}`).toContain(res.status);
      const text = await res.text();
      expect(text, name).not.toContain("SECRET-VALUE");
      expect(text, name).not.toMatch(/"token"\s*:\s*"[^"]{20,}/);
      expect(text, name).not.toMatch(/"ticket"\s*:/);
      if (res.status === 403) expect(JSON.parse(text).reason, name).toBe("local_proof_required");
    }
    expect(readDevices()).toBe(before);
    // …and the refusals are visible to the operator, one bounded line per (route, reason).
    const refused = warns.filter((l) => l.startsWith("[local-proof] refused "));
    expect(refused.length).toBeGreaterThanOrEqual(3);
    expect(refused.every((l) => !/[\r\n]/.test(l) && l.includes("peer=127.0.0.1") && l.includes("host=127.0.0.1:"))).toBe(true);
    expect(refused.some((l) => l.includes("method=POST") && l.includes("route=/api/paired-devices"))).toBe(true);
  });
});

describe("E3 — default: a caller that proves local possession keeps working", () => {
  it("device token, bridge ticket, list and config (secrets redacted) are all admitted", async () => {
    handle = await createTestServer();
    const r = requests(proofFetch);

    const mint = await r.mintDevice();
    expect(mint.status).toBe(200);
    expect(((await mint.json()) as { data: { token: string } }).data.token).toBeTruthy();

    const ticket = await r.wsTicket();
    expect(ticket.status).toBe(200);
    expect(((await ticket.json()) as { data: { ticket: string } }).data.ticket).toBeTruthy();

    expect((await r.listDevices()).status).toBe(200);

    const cfg = await r.config();
    expect(cfg.status).toBe(200);
    const body = await cfg.text();
    expect(body).not.toContain("SECRET-VALUE");
  });
});

describe("E4 — default: observe-tier reads stay open to bare loopback; operate does not", () => {
  it("GET /api/sessions 200, POST /api/restart 403", async () => {
    handle = await createTestServer();
    expect((await fetch(`${base()}/api/sessions`)).status).toBe(200);
    const restart = await fetch(`${base()}/api/restart`, { method: "POST" });
    expect(restart.status).toBe(403);
    expect(((await restart.json()) as { reason?: string }).reason).toBe("local_proof_required");
  });
});

describe("E5 — opt-out: requireLocalProof false restores the bare-loopback allowance", () => {
  it("POST /api/paired-devices mints a token with no proof", async () => {
    // Explicit, commented opt-out: this scenario IS the rollback path.
    writeConfig({ requireLocalProof: false });
    handle = await createTestServer();
    const res = await fetch(`${base()}/api/paired-devices`, { method: "POST", headers: json, body: JSON.stringify({ label: "rollback" }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { token: string } }).data.token).toBeTruthy();
  });
});

describe("E24 — default: /mcp is refused without a bearer; observe REST is not", () => {
  it("POST /mcp without a bearer is refused while GET /api/sessions is 200", async () => {
    handle = await createTestServer();
    const mcp = await fetch(`${base()}/mcp`, { method: "POST", headers: { ...json, accept: "application/json, text/event-stream" }, body: "{}" });
    expect([401, 403, 404]).toContain(mcp.status);
    expect(mcp.status).not.toBe(200);
    expect((await fetch(`${base()}/api/sessions`)).status).toBe(200);
  });
});

describe("E6 — default: a loopback /ws upgrade needs proof", () => {
  /** Dial and report 101 or the refusal status. */
  function dial(url: string, headers: Record<string, string>): Promise<{ kind: "open" } | { kind: "status"; status: number } | { kind: "error" }> {
    return new Promise((resolve) => {
      const ws = new WebSocket(url, { headers });
      const done = (r: { kind: "open" } | { kind: "status"; status: number } | { kind: "error" }) => {
        try {
          ws.close();
        } catch {
          /* best-effort */
        }
        resolve(r);
      };
      ws.on("open", () => done({ kind: "open" }));
      ws.on("unexpected-response", (_q, res) => done({ kind: "status", status: res.statusCode ?? 0 }));
      ws.on("error", () => done({ kind: "error" }));
      setTimeout(() => done({ kind: "error" }), 5000);
    });
  }

  it("without proof: 403 and one `[ws-upgrade]` line with reason=local_proof_required; with the proof cookie: 101", async () => {
    handle = await createTestServer();
    const origin = `http://localhost:${handle.httpPort}`;
    const wsUrl = `ws://127.0.0.1:${handle.httpPort}/ws`;

    const refused = await dial(wsUrl, { origin });
    expect(refused).toEqual({ kind: "status", status: 403 });
    const lines = errors.filter((l) => l.startsWith("[ws-upgrade]"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("reason=local_proof_required");

    // Real bootstrap: mint a one-time code with a proof, redeem it, keep the cookie.
    const code = ((await (await proofFetch(`${base()}/api/local-proof`, { method: "POST" })).json()) as { data: { code: string } }).data.code;
    const redeem = await fetch(`${base()}/auth/local-proof?code=${code}`, { redirect: "manual" });
    const cookie = redeem.headers.getSetCookie().find((c) => c.startsWith("pi_dash_local="))!.split(";")[0]!;
    expect(cookie).toBeTruthy();

    expect(await dial(wsUrl, { origin, cookie })).toEqual({ kind: "open" });
    // …and the proof header path is equally good.
    expect(await dial(wsUrl, { origin, ...proofHeaders(`http://127.0.0.1:${handle.httpPort}/ws`) })).toEqual({ kind: "open" });
  }, 40000);
});


describe("D8 wiring on the REAL server: the per-request caller reaches the file routes", () => {
  it("a session outside $HOME cannot read the token or config through the ~/.pi anchor unless the caller proves; ~/.pi/agent stays readable", async () => {
    const cwd = fs.realpathSync(fs.mkdtempSync(path.join(process.env.HOME!, "..", "state-wiring-")));
    fs.mkdirSync(path.join(dash, "local"), { recursive: true });
    fs.writeFileSync(path.join(dash, "local", "marker-secret"), "LOCAL-SECRET-MARKER");
    fs.writeFileSync(path.join(dash, "config.json"), JSON.stringify({ auth: { secret: "CONFIG-SECRET-MARKER" } }), { mode: 0o600 });
    fs.mkdirSync(path.join(process.env.HOME!, ".pi", "agent"), { recursive: true });
    fs.writeFileSync(path.join(process.env.HOME!, ".pi", "agent", "x.md"), "# agent\n");
    resetConfigSnapshot();
    handle = await createTestServer();

    // A real session whose cwd is `cwd`, registered over the (loopback-grace) bridge gateway.
    const bridge = new WebSocket(`ws://127.0.0.1:${handle.piPort}`);
    await new Promise<void>((res, rej) => {
      bridge.on("open", () => res());
      bridge.on("error", rej);
    });
    bridge.send(JSON.stringify({ type: "session_register", sessionId: "state-wiring", cwd, source: "cli" }));
    bridge.send(JSON.stringify({ type: "replay_complete", sessionId: "state-wiring" }));
    await new Promise((r) => setTimeout(r, 300));

    const read = (abs: string, how: "bare" | "proof") => {
      const url = `${base()}/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(abs)}`;
      return how === "proof" ? proofFetch(url) : fetch(url);
    };
    const token = path.join(dash, "local", "marker-secret");
    const config = path.join(dash, "config.json");
    const agent = path.join(process.env.HOME!, ".pi", "agent", "x.md");

    try {
      for (const how of ["bare", "proof"] as const) {
        const t = await read(token, how);
        expect(t.status, `${how} local/**`).toBe(403);
        expect(await t.text()).not.toContain("LOCAL-SECRET-MARKER");
      }
      const bareCfg = await read(config, "bare");
      expect(bareCfg.status).toBe(403);
      expect(await bareCfg.text()).not.toContain("CONFIG-SECRET-MARKER");
      const proofCfg = await read(config, "proof");
      expect(proofCfg.status).toBe(200);
      expect(await proofCfg.text()).toContain("CONFIG-SECRET-MARKER");
      expect((await read(agent, "bare")).status).toBe(200);
    } finally {
      bridge.close();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }, 40000);
});
