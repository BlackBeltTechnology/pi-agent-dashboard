/**
 * REST surface over pi's MCP config (migrate-mcp-to-pi-builtin test-plan E29
 * + route contract): status codes, network-guard shielding, name validation,
 * known-folder admission — all before any file IO.
 */

import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { createMcpClientConfigService } from "../../core/service.js";
import type { ConfigIO, PiMcpListRunner } from "../../core/types.js";
import { mountMcpClientRoutes } from "../routes.js";

const GLOBAL = "/agent/mcp.json";

interface Harness {
  app: FastifyInstance;
  io: ConfigIO & { files: Map<string, string>; writes: string[]; reads: string[] };
  known: string;
  guardCalls: () => number;
  runnerCalls: string[];
}

function makeIO(initial: Record<string, string>): Harness["io"] {
  const files = new Map(Object.entries(initial));
  const writes: string[] = [];
  const reads: string[] = [];
  return {
    files,
    writes,
    reads,
    readFile: (p) => {
      reads.push(p);
      return files.get(p) ?? null;
    },
    writeFileAtomic: (p, content) => {
      writes.push(p);
      files.set(p, content);
    },
  };
}

async function harness(opts: { guard?: "allow" | "deny" } = {}): Promise<Harness> {
  const io = makeIO({ [GLOBAL]: JSON.stringify({ mcpServers: { a: { command: "a" } } }) });
  const known = realpathSync(mkdtempSync(join(tmpdir(), "mcp-route-")));
  const runnerCalls: string[] = [];
  const runner: PiMcpListRunner = async (cwd) => {
    runnerCalls.push(cwd);
    return { stdout: JSON.stringify({ servers: [{ name: "a", state: "connected", tools: ["x"] }], errors: [] }), code: 0 };
  };
  const runtime = createMcpClientConfigService({
    configIO: io,
    paths: { globalPath: () => GLOBAL, projectPath: (cwd) => `${cwd}/.pi/mcp.json` },
    knownCwds: () => [known],
    isProjectTrusted: () => true,
    scratchCwd: "/tmp/mcp-scratch",
    runner,
  });
  const app = Fastify();
  const state = { guardCalls: 0 };
  mountMcpClientRoutes(app, {
    runtime,
    knownCwds: () => [known],
    networkGuard: async (_req, reply) => {
      state.guardCalls += 1;
      if (opts.guard === "deny") reply.code(403).send({ error: "guard" });
    },
  });
  await app.ready();
  return { app, io, known, guardCalls: () => state.guardCalls, runnerCalls };
}

const ROUTES: Array<[string, string, unknown]> = [
  ["GET", "/api/mcp-client/effective", undefined],
  ["GET", "/api/mcp-client/live", undefined],
  ["GET", "/api/mcp-client/schema", undefined],
  ["PUT", "/api/mcp-client/servers/a", { scope: "global", entry: { command: "x" } }],
  ["DELETE", "/api/mcp-client/servers/a?scope=global", undefined],
  ["PUT", "/api/mcp-client/servers/a/enabled", { scope: "global", enabled: false }],
  ["POST", "/api/mcp-client/servers/a/convert", { scope: "global" }],
];

describe("mcp-client routes", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
  });

  it("GET /effective returns the Pi-global view", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/mcp-client/effective" });
    expect(res.statusCode).toBe(200);
    expect(res.json().servers.map((s: { name: string }) => s.name)).toEqual(["a"]);
  });

  it("GET /live returns pi's state", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/mcp-client/live" });
    expect(res.json()).toMatchObject({ ok: true, servers: { a: { state: "connected", tools: 1 } } });
  });

  it("GET /live is cached per cwd; ?fresh=1 reruns pi mcp list", async () => {
    await h.app.inject({ method: "GET", url: "/api/mcp-client/live" });
    await h.app.inject({ method: "GET", url: "/api/mcp-client/live" });
    expect(h.runnerCalls).toHaveLength(1);
    await h.app.inject({ method: "GET", url: "/api/mcp-client/live?fresh=1" });
    expect(h.runnerCalls).toHaveLength(2);
  });

  it("PUT /servers/:name saves the whole entry", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/mcp-client/servers/b",
      payload: { scope: "global", entry: { command: "/bin/b", exposure: "direct" } },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(h.io.files.get(GLOBAL) as string).mcpServers.b).toEqual({ command: "/bin/b", exposure: "direct" });
  });

  it("PUT with create:true onto an existing name is 409 name-collision, no write", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/mcp-client/servers/a",
      payload: { scope: "global", entry: { command: "/bin/other" }, create: true },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("name-collision");
    expect(h.io.writes).toHaveLength(0);
  });

  it("PUT a schema-invalid entry is 400 with no write", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/mcp-client/servers/b",
      payload: { scope: "global", entry: { command: 5 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields).toContain("command");
    expect(h.io.writes).toHaveLength(0);
  });

  it("PUT an entry pi rejects is 400 invalid-entry", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/mcp-client/servers/b",
      payload: { scope: "global", entry: { url: "ftp://x" } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid-entry");
  });

  it("DELETE returns the removed raw entry", async () => {
    const res = await h.app.inject({ method: "DELETE", url: "/api/mcp-client/servers/a?scope=global" });
    expect(res.statusCode).toBe(200);
    expect(res.json().removed).toEqual({ command: "a" });
  });

  it("PUT /enabled writes enabled:false", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/mcp-client/servers/a/enabled",
      payload: { scope: "global", enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(h.io.files.get(GLOBAL) as string).mcpServers.a).toEqual({ command: "a", enabled: false });
  });

  it("GET /effective rejects a repeated (array) cwd query with 400 and no read", async () => {
    h.io.reads.length = 0;
    const res = await h.app.inject({ method: "GET", url: "/api/mcp-client/effective?cwd=%2Fa&cwd=%2Fb" });
    expect(res.statusCode).toBe(400);
    expect(h.io.reads).toHaveLength(0);
  });

  it("an unknown project cwd is 403 with the additive remedy and no IO on every scoped route", async () => {
    const cases: Array<[string, string, unknown]> = [
      ["GET", "/api/mcp-client/effective?cwd=%2Fnope", undefined],
      ["GET", "/api/mcp-client/live?cwd=%2Fnope", undefined],
      ["PUT", "/api/mcp-client/servers/b", { scope: "project", cwd: "/nope", entry: { command: "x" } }],
      ["DELETE", "/api/mcp-client/servers/b?scope=project&cwd=%2Fnope", undefined],
      ["PUT", "/api/mcp-client/servers/b/enabled", { scope: "project", cwd: "/nope", enabled: true }],
      ["POST", "/api/mcp-client/servers/b/convert", { scope: "project", cwd: "/nope" }],
    ];
    for (const [method, url, payload] of cases) {
      h.io.reads.length = 0;
      const res = await h.app.inject({ method: method as "GET", url, ...(payload ? { payload: payload as object } : {}) });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      const body = res.json();
      expect(body.error).toBe("not-allowed");
      expect(body.message).toBe("cwd not allowed: /nope");
      expect(typeof body.reason).toBe("string");
      expect(typeof body.hint).toBe("string");
      expect(h.io.reads).toHaveLength(0);
    }
    expect(h.io.writes).toHaveLength(0);
    expect(h.runnerCalls).toHaveLength(0);
  });
});

describe("E29 — route security: refused before any file IO", () => {
  it("every route is shielded by the network guard", async () => {
    const denied = await harness({ guard: "deny" });
    denied.io.reads.length = 0;
    for (const [method, url, payload] of ROUTES) {
      const res = await denied.app.inject({ method: method as "GET", url, ...(payload ? { payload: payload as object } : {}) });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    expect(denied.io.reads).toHaveLength(0);
    expect(denied.io.writes).toHaveLength(0);
    expect(denied.runnerCalls).toHaveLength(0);
    expect(denied.guardCalls()).toBe(ROUTES.length);
  });

  it("a path name `..` (or any invalid name) is refused by name validation", async () => {
    const h = await harness();
    h.io.reads.length = 0;
    for (const url of ["/api/mcp-client/servers/..", "/api/mcp-client/servers/%2E%2E", "/api/mcp-client/servers/a%20b", "/api/mcp-client/servers/__proto__"]) {
      for (const [method, suffix, payload] of [
        ["PUT", "", { scope: "global", entry: { command: "x" } }],
        ["DELETE", "?scope=global", undefined],
        ["PUT", "/enabled", { scope: "global", enabled: true }],
        ["POST", "/convert", { scope: "global" }],
      ] as const) {
        const target = suffix.startsWith("?") ? `${url}${suffix}` : `${url}${suffix}`;
        const res = await h.app.inject({ method, url: target, ...(payload ? { payload } : {}) });
        expect([400, 404], `${method} ${target}`).toContain(res.statusCode);
      }
    }
    expect(h.io.reads).toHaveLength(0);
    expect(h.io.writes).toHaveLength(0);
  });
});
