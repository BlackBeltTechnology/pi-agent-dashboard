/**
 * Radius MCP follow-up: plan rules, evaluation order, GET/POST responses,
 * reload counting, route tiers, secrets. test-plan #E12–#E18, #E21, #X3–#X5.
 *
 * Runs the REAL mcp-client config service over a temp agent dir, so the
 * pi-shape writer's behaviour (preserve other keys, `-`/`_` collision,
 * unparseable refusal) is exercised, not mocked.
 *
 * See change: add-radius-provider-login (D5, D6).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createMcpClientConfigService,
  createRealConfigIO,
} from "@blackbelt-technology/pi-dashboard-mcp-client-plugin/core";
import { ROUTE_TIERS } from "@blackbelt-technology/pi-dashboard-shared/route-tiers.js";
import Fastify from "fastify";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { oauthRegistryReady, setOAuthRegistryRuntimeSource } from "../auth/provider-auth-registry.js";
import {
  configureRadiusMcp,
  countReloads,
  planRadiusMcp,
  RADIUS_MCP_CODES,
  RADIUS_MCP_URL,
  type RadiusMcpDeps,
  readRadiusMcpStatus,
} from "../auth/radius-mcp.js";
import { _resetRadiusOverrideCacheForTests, setAgentDirSource } from "../auth/radius-override.js";
import { getServerModelRuntime } from "../model-proxy/server-model-runtime.js";
import { registerProviderAuthRoutes } from "../routes/provider-auth-routes.js";

let dir: string;
let prevAgentDir: string | undefined;
const mcpFile = () => path.join(dir, "mcp.json");
const writeMcp = (servers: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  fs.writeFileSync(mcpFile(), JSON.stringify({ ...extra, mcpServers: servers }, null, 2));
const readMcp = () => JSON.parse(fs.readFileSync(mcpFile(), "utf8")) as { mcpServers: Record<string, any> };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "radius-mcp-"));
  prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  setAgentDirSource(() => dir);
  _resetRadiusOverrideCacheForTests();
});
afterEach(() => {
  if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
  setAgentDirSource(undefined);
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const realService = () =>
  createMcpClientConfigService({ configIO: createRealConfigIO(), knownCwds: () => [] });

function deps(over: Partial<RadiusMcpDeps> = {}): RadiusMcpDeps & { reloadCalls: number } {
  const state = { reloadCalls: 0 };
  const d: RadiusMcpDeps = {
    runtimeAvailable: () => true,
    hasRadiusCredential: () => true,
    isOverridden: () => false,
    service: realService,
    reload: async () => {
      state.reloadCalls += 1;
      return 2;
    },
    ...over,
  };
  Object.defineProperty(d, "reloadCalls", { get: () => state.reloadCalls });
  return d as RadiusMcpDeps & { reloadCalls: number };
}

describe("planRadiusMcp (E12)", () => {
  const s = (name: string, entry: Record<string, unknown>) => ({ name, entry });
  it("(a) none → new radius entry", () => {
    expect(planRadiusMcp([])).toMatchObject({
      configured: false,
      name: "radius",
      entry: { url: RADIUS_MCP_URL, auth: { provider: "radius" } },
    });
  });
  it("(b) URL match with trailing slash: gains auth, loses oauth, keeps exposure", () => {
    const plan = planRadiusMcp([
      s("gw", { url: "https://radius.pi.dev/mcp/", oauth: { clientId: "x" }, exposure: "codemode" }),
    ]);
    expect(plan.name).toBe("gw");
    expect(plan.entry).toEqual({
      url: "https://radius.pi.dev/mcp/",
      exposure: "codemode",
      auth: { provider: "radius" },
    });
  });
  it("(c) unrelated radius stdio → radius-mcp", () => {
    expect(planRadiusMcp([s("radius", { command: "x" })]).name).toBe("radius-mcp");
  });
  it("(d) already configured", () => {
    const plan = planRadiusMcp([s("r", { url: RADIUS_MCP_URL, auth: { provider: "radius" } })]);
    expect(plan).toMatchObject({ configured: true, name: "r" });
    expect(plan.entry).toBeUndefined();
  });
  it("(e) other auth provider → repointed", () => {
    const plan = planRadiusMcp([s("gw", { url: RADIUS_MCP_URL, auth: { provider: "other" } })]);
    expect(plan.configured).toBe(false);
    expect(plan.entry?.auth).toEqual({ provider: "radius" });
  });
});

describe("POST evaluation order (E13)", () => {
  it("1. runtime unavailable → 503, even with everything else wrong", async () => {
    const d = deps({ runtimeAvailable: () => false, hasRadiusCredential: () => false });
    const r = await configureRadiusMcp(d);
    expect(r.status).toBe(503);
    expect(r.body.code).toBe(RADIUS_MCP_CODES.runtimeUnavailable);
  });
  it("2. no credential → 409, also when already configured; bytes untouched", async () => {
    writeMcp({ r: { url: RADIUS_MCP_URL, auth: { provider: "radius" } } });
    const before = fs.readFileSync(mcpFile(), "utf8");
    const d = deps({ hasRadiusCredential: () => false });
    const r = await configureRadiusMcp(d);
    expect(r).toMatchObject({ status: 409, body: { code: RADIUS_MCP_CODES.noCredential } });
    expect(fs.readFileSync(mcpFile(), "utf8")).toBe(before);
    expect(d.reloadCalls).toBe(0);
  });
  it("3. override → 409 overridden", async () => {
    const d = deps({ isOverridden: () => true });
    const r = await configureRadiusMcp(d);
    expect(r).toMatchObject({ status: 409, body: { code: RADIUS_MCP_CODES.overridden } });
    expect(fs.existsSync(mcpFile())).toBe(false);
  });
  it("4. unparseable → 409 write_refused/unparseable; bytes identical", async () => {
    fs.writeFileSync(mcpFile(), "{ not json");
    const d = deps();
    const r = await configureRadiusMcp(d);
    expect(r).toMatchObject({
      status: 409,
      body: { code: RADIUS_MCP_CODES.writeRefused, vars: { reason: "unparseable" } },
    });
    expect(fs.readFileSync(mcpFile(), "utf8")).toBe("{ not json");
    expect(d.reloadCalls).toBe(0);
  });
  it("5. already configured → written:false, no reload", async () => {
    writeMcp({ r: { url: RADIUS_MCP_URL, auth: { provider: "radius" } } });
    const before = fs.readFileSync(mcpFile(), "utf8");
    const d = deps();
    const r = await configureRadiusMcp(d);
    expect(r).toMatchObject({ status: 200, body: { configured: true, written: false } });
    expect(fs.readFileSync(mcpFile(), "utf8")).toBe(before);
    expect(d.reloadCalls).toBe(0);
  });
});

describe("GET responses (E14)", () => {
  it("runtime unavailable → 503", () => {
    expect(readRadiusMcpStatus(deps({ runtimeAvailable: () => false }))).toMatchObject({
      status: 503,
      body: { code: RADIUS_MCP_CODES.runtimeUnavailable },
    });
  });
  it("file absent → configured:false, name radius, absolute path", () => {
    const r = readRadiusMcpStatus(deps());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ configured: false, name: "radius", path: mcpFile() });
    expect(path.isAbsolute(String(r.body.path))).toBe(true);
  });
  it("unparseable → 409 unparseable", () => {
    fs.writeFileSync(mcpFile(), "nope");
    expect(readRadiusMcpStatus(deps())).toMatchObject({
      status: 409,
      body: { code: RADIUS_MCP_CODES.writeRefused, vars: { reason: "unparseable" } },
    });
  });
  it("name radius taken → radius-mcp", () => {
    writeMcp({ radius: { command: "x" } });
    expect(readRadiusMcpStatus(deps()).body.name).toBe("radius-mcp");
  });
});

describe("successful write (E15, E21)", () => {
  it("fresh install: writes the entry, preserves other keys, reloads once", async () => {
    writeMcp({ other: { command: "x" } }, { settings: { toolPrefix: "p" } });
    const d = deps();
    const r = await configureRadiusMcp(d);
    expect(r).toMatchObject({ status: 200, body: { configured: true, written: true, name: "radius", reloaded: 2 } });
    const file = readMcp();
    expect(file.mcpServers.radius).toEqual({ url: RADIUS_MCP_URL, auth: { provider: "radius" } });
    expect(file.mcpServers.other).toEqual({ command: "x" });
    expect((file as any).settings).toEqual({ toolPrefix: "p" });
    expect(d.reloadCalls).toBe(1);
  });
  it("upgrades an existing URL entry in place (no new entry)", async () => {
    writeMcp({ gw: { url: "https://radius.pi.dev/mcp/", oauth: { clientId: "x" }, exposure: "codemode" } });
    await configureRadiusMcp(deps());
    const { mcpServers } = readMcp();
    expect(Object.keys(mcpServers)).toEqual(["gw"]);
    expect(mcpServers.gw).toEqual({
      url: "https://radius.pi.dev/mcp/",
      exposure: "codemode",
      auth: { provider: "radius" },
    });
  });
  it("name taken by another server → radius-mcp, other untouched", async () => {
    writeMcp({ radius: { command: "x" } });
    await configureRadiusMcp(deps());
    const { mcpServers } = readMcp();
    expect(mcpServers.radius).toEqual({ command: "x" });
    expect(mcpServers["radius-mcp"]).toEqual({ url: RADIUS_MCP_URL, auth: { provider: "radius" } });
  });
});

describe("writer refusal surfaced (E16)", () => {
  it("name-collision → 409 write_refused with reason, no reload", async () => {
    const d = deps({
      service: () => ({
        ...realService(),
        saveServer: () => ({
          ok: false as const,
          refusal: { code: "name-collision" as const, message: "collides" },
        }),
      }),
    });
    const r = await configureRadiusMcp(d);
    expect(r).toMatchObject({
      status: 409,
      body: { code: RADIUS_MCP_CODES.writeRefused, vars: { reason: "name-collision" } },
    });
    expect(d.reloadCalls).toBe(0);
    expect(fs.existsSync(mcpFile())).toBe(false);
  });
});

describe("RADIUS_MCP_URL drift (E17)", () => {
  it("equals pi's own constant", async () => {
    let d = path.dirname(new URL(import.meta.url).pathname);
    let found: string | undefined;
    for (let i = 0; i < 10 && !found; i += 1) {
      const p = path.join(d, "node_modules/@earendil-works/pi-coding-agent/dist/core/radius.js");
      if (fs.existsSync(p)) found = p;
      d = path.dirname(d);
    }
    expect(found, "pi-coding-agent resolvable").toBeTruthy();
    const mod = (await import(/* @vite-ignore */ found as string)) as { RADIUS_MCP_URL: string };
    expect(RADIUS_MCP_URL).toBe(mod.RADIUS_MCP_URL);
  });
});

describe("route tiers (E18)", () => {
  it("both verbs are operate tier", () => {
    const rows = ROUTE_TIERS.filter((r) => r.path === "/api/provider-auth/radius/mcp");
    expect(rows.map((r) => `${r.method}:${r.tier}`).sort()).toEqual(["GET:operate", "POST:operate"]);
  });
});

describe("countReloads (E15, X4)", () => {
  it("counts only respawn|forwarded", async () => {
    const outcomes: Record<string, string> = { a: "forwarded", b: "respawn", c: "refused" };
    expect(await countReloads(["a", "b", "c"], async (s) => outcomes[s])).toBe(2);
  });
  it("a rejecting dispatch is not counted, logged by id, never unhandled", async () => {
    const log = vi.fn();
    const n = await countReloads(
      ["a", "bad"],
      async (s) => {
        if (s === "bad") throw new Error("boom");
        return "respawn";
      },
      log,
    );
    expect(n).toBe(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("bad");
  });
});

describe("via the routes (X3, X5, E21)", () => {
  beforeAll(async () => {
    setOAuthRegistryRuntimeSource(getServerModelRuntime);
    await oauthRegistryReady();
  });
  const gw = { getConnectedSessionIds: () => [], sendToSession: () => {}, broadcast: () => {} };

  it("X3: no radiusMcp wiring → both verbs 503; other routes still answer", async () => {
    const app = Fastify();
    registerProviderAuthRoutes(app, { piGateway: gw as never, browserGateway: {} as never });
    await app.ready();
    for (const method of ["GET", "POST"] as const) {
      const res = await app.inject({ method, url: "/api/provider-auth/radius/mcp" });
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.payload).code).toBe(RADIUS_MCP_CODES.runtimeUnavailable);
    }
    expect((await app.inject({ method: "GET", url: "/api/provider-auth/handlers" })).statusCode).toBe(200);
    await app.close();
  });

  it("X5: no credential material in any log line", async () => {
    const spies = (["log", "error", "warn", "info"] as const).map((k) => vi.spyOn(console, k));
    const authPath = path.join(os.homedir(), ".pi", "agent", "auth.json");
    fs.mkdirSync(path.dirname(authPath), { recursive: true });
    const prev = fs.existsSync(authPath) ? fs.readFileSync(authPath, "utf8") : null;
    fs.writeFileSync(
      authPath,
      JSON.stringify({ radius: { type: "oauth", access: "tok-SECRET-123", refresh: "r", expires: Date.now() + 3.6e6 } }),
    );
    try {
      const app = Fastify({ logger: false });
      registerProviderAuthRoutes(app, {
        piGateway: gw as never,
        browserGateway: {} as never,
        radiusMcp: { service: realService, reload: async () => 1 },
      });
      await app.ready();
      fs.writeFileSync(mcpFile(), "{ bad");
      await app.inject({ method: "POST", url: "/api/provider-auth/radius/mcp", payload: { x: "tok-SECRET-123" } });
      fs.rmSync(mcpFile());
      const ok = await app.inject({ method: "POST", url: "/api/provider-auth/radius/mcp" });
      expect(ok.statusCode).toBe(200);
      expect(JSON.parse(ok.payload)).toMatchObject({ written: true, reloaded: 1 });
      const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.join(" "))).join("\n");
      expect(logged).not.toContain("tok-SECRET-123");
      await app.close();
    } finally {
      if (prev !== null) fs.writeFileSync(authPath, prev);
      else fs.rmSync(authPath, { force: true });
    }
  });
});
