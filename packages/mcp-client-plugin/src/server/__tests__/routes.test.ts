/**
 * REST surface (change extract-mcp-client-plugin, task 4.2): status codes,
 * network-guard shielding, name validation, and patch shape.
 */

import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { AdapterTimeoutError } from "../../core/adapter-worker.js";
import { createMcpClientConfigService, type McpClientRuntime } from "../../core/service.js";
import type { AdapterPort, ConfigIO } from "../../core/types.js";
import { mountMcpClientRoutes } from "../routes.js";

const GLOBAL = "/agent/mcp.json";

interface Harness {
  app: FastifyInstance;
  io: ConfigIO & { files: Map<string, string>; writes: string[]; reads: string[] };
  known: string[];
  guardCalls: () => number;
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
      return files.has(p) ? (files.get(p) as string) : null;
    },
    writeFileAtomic: (p, content) => {
      writes.push(p);
      files.set(p, content);
    },
  };
}

function makePort(overrides: Partial<AdapterPort> = {}): AdapterPort {
  return {
    loadMcpConfig: () => Promise.resolve({ mcpServers: { a: { command: "a" } } }),
    getServerProvenance: () => Promise.resolve(new Map()),
    getConfigDiscoveryPaths: () => [],
    getPiGlobalConfigPath: () => GLOBAL,
    getProjectPiConfigPath: (cwd) => `${cwd}/.pi/mcp.json`,
    ...overrides,
  };
}

async function harness(opts: { io?: Harness["io"]; port?: AdapterPort; guard?: "allow" | "deny" } = {}): Promise<Harness> {
  const io = opts.io ?? makeIO({ [GLOBAL]: JSON.stringify({ mcpServers: { a: { command: "a" } } }) });
  const known = [realpathSync(mkdtempSync(join(tmpdir(), "mcp-route-"))), "/known"];
  const runtime: McpClientRuntime = createMcpClientConfigService({
    configIO: io,
    adapter: opts.port ?? makePort(),
    knownCwds: () => known,
    scratchCwd: "/tmp/mcp-scratch",
  });
  const app = Fastify();
  const state = { guardCalls: 0 };
  mountMcpClientRoutes(app, {
    runtime,
    knownCwds: () => known,
    networkGuard: async (_req, reply) => {
      state.guardCalls += 1;
      if (opts.guard === "deny") reply.code(403).send({ error: "guard" });
    },
    getTimeoutMs: () => 1000,
  });
  await app.ready();
  return { app, io, known, guardCalls: () => state.guardCalls };
}

describe("mcp-client routes", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
  });

  it("GET /effective returns servers + adapter verdict", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/mcp-client/effective" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.servers.map((s: { name: string }) => s.name)).toEqual(["a"]);
    expect(body.adapter).toBeDefined();
  });

  it("GET /effective?cwd=<unknown> is 403 with no project read", async () => {
    h.io.reads.length = 0;
    const res = await h.app.inject({ method: "GET", url: "/api/mcp-client/effective?cwd=%2Fnope" });
    expect(res.statusCode).toBe(403);
    expect(h.io.reads.some((p) => p.startsWith("/nope"))).toBe(false);
  });

  it("GET /schema returns the published schema", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/mcp-client/schema" });
    expect(res.statusCode).toBe(200);
    expect(res.json().$defs.ServerEntry.properties.command["x-transport"]).toBe("command");
  });

  it("GET /adapter returns the verdict", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/mcp-client/adapter" });
    expect(res.statusCode).toBe(200);
    expect(res.json().kind).toBe("absent");
  });

  it("PUT /servers/:name writes the patch", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/mcp-client/servers/b",
      payload: { scope: "global", set: { command: "/bin/b" } },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(h.io.files.get(GLOBAL) as string).mcpServers.b).toEqual({ command: "/bin/b" });
  });

  it("E27: PUT whose resulting entry has no transport is 400 naming every transport field, no write", async () => {
    h.io.writes.length = 0;
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/mcp-client/servers/no-transport",
      payload: { scope: "global", set: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("missing-transport");
    expect(res.json().fields).toEqual(["command", "url", "socket"]);
    expect(h.io.writes).toHaveLength(0);
  });

  it("E27: PUT whose resulting entry has no transport is 200 when a lower source defines the server", async () => {
    const lower = await harness({
      port: makePort({
        loadMcpConfig: () =>
          Promise.resolve({ mcpServers: { a: { command: "a" }, inherited: { url: "https://u" } } }),
        getServerProvenance: () =>
          Promise.resolve(
            new Map([["inherited", { kind: "import", path: "/shared/mcp.json", importKind: "file" }]]),
          ),
      }),
    });
    const res = await lower.app.inject({
      method: "PUT",
      url: "/api/mcp-client/servers/inherited",
      payload: { scope: "global", set: {} },
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /effective rejects a repeated (array) cwd query with 400 and no read", async () => {
    h.io.reads.length = 0;
    const res = await h.app.inject({ method: "GET", url: "/api/mcp-client/effective?cwd=%2Fa&cwd=%2Fb" });
    expect(res.statusCode).toBe(400);
    expect(h.io.reads).toHaveLength(0);
  });

  it("PUT rejects a whole-entry body with no `set`", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/mcp-client/servers/b",
      payload: { scope: "global", command: "/bin/b" },
    });
    expect(res.statusCode).toBe(400);
    expect(h.io.writes).toHaveLength(0);
  });

  it("PUT rejects an invalid server name with no IO", async () => {
    h.io.writes.length = 0;
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/mcp-client/servers/a%2Fb",
      payload: { scope: "global", set: { command: "x" } },
    });
    expect([400, 404]).toContain(res.statusCode);
    expect(h.io.writes).toHaveLength(0);
  });

  it("PUT project scope with an unknown cwd is 403", async () => {
    h.io.reads.length = 0;
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/mcp-client/servers/b",
      payload: { scope: "project", cwd: "/nope", set: { command: "x" } },
    });
    expect(res.statusCode).toBe(403);
    expect(h.io.writes).toHaveLength(0);
    expect(h.io.reads.some((p) => p.startsWith("/nope"))).toBe(false);
  });

  it("DELETE returns the removed raw entry", async () => {
    const res = await h.app.inject({ method: "DELETE", url: "/api/mcp-client/servers/a?scope=global" });
    expect(res.statusCode).toBe(200);
    expect(res.json().removed).toEqual({ command: "a" });
  });

  it("PUT /settings patches the global settings object", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/mcp-client/settings",
      payload: { set: { toolPrefix: "mcp" } },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(h.io.files.get(GLOBAL) as string).settings).toEqual({ toolPrefix: "mcp" });
  });

  it("PUT /servers/:name/disabled writes disabled:true", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/mcp-client/servers/a/disabled",
      payload: { scope: "global", disabled: true },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(h.io.files.get(GLOBAL) as string).mcpServers.a).toEqual({ command: "a", disabled: true });
  });

  it("shields every route with the network guard and performs no IO on refusal", async () => {
    const denied = await harness({ guard: "deny" });
    denied.io.reads.length = 0;
    denied.io.writes.length = 0;
    for (const [method, url, payload] of [
      ["GET", "/api/mcp-client/effective", undefined],
      ["GET", "/api/mcp-client/schema", undefined],
      ["PUT", "/api/mcp-client/servers/a", { scope: "global", set: { command: "x" } }],
    ] as const) {
      const res = await denied.app.inject({ method, url, ...(payload ? { payload } : {}) });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    expect(denied.io.reads).toHaveLength(0);
    expect(denied.io.writes).toHaveLength(0);
    expect(denied.guardCalls()).toBeGreaterThanOrEqual(3);
  });

  it("maps an adapter timeout to 504 with the timeout value", async () => {
    const timeoutHarness = await harness({
      port: makePort({ loadMcpConfig: () => Promise.reject(new AdapterTimeoutError(1000)) }),
    });
    const res = await timeoutHarness.app.inject({ method: "GET", url: "/api/mcp-client/effective" });
    expect(res.statusCode).toBe(504);
    expect(res.json()).toEqual({ error: "adapter-timeout", timeoutMs: 1000 });
  });
});
