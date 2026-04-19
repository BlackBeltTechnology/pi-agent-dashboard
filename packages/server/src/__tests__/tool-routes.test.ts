/**
 * Tests for /api/tools REST routes.
 *
 * Covers: list, get single, rescan (all / one), set override, clear
 * override, unknown-tool 404, bad-body 400, diagnostics text format.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ToolRegistry,
  OverridesStore,
  registerDefaultTools,
  type Strategy,
} from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import { registerToolRoutes, formatDiagnostics } from "../routes/tool-routes.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function noGuard() {
  return async () => { /* allow all */ };
}

function tmpOverridesPath(): string {
  return path.join(
    os.tmpdir(),
    `tool-routes-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
}

/**
 * Build a registry with two fake tools: `pi` (resolves) and `ghost`
 * (never resolves). The `override` strategy honors ctx.overrides so
 * set/clear flows are observable.
 */
function buildRegistry(opts?: { existsPath?: string }): ToolRegistry {
  const overrides = new OverridesStore({ filePath: tmpOverridesPath(), warn: () => {} });
  const r = new ToolRegistry({ overrides, platform: "linux" });

  const piStrategies: Strategy[] = [
    {
      name: "override",
      run: (ctx) => ctx.overrides["pi"]
        ? { ok: true, path: ctx.overrides["pi"] }
        : { ok: false, reason: "no override set" },
    },
    { name: "where", run: () => ({ ok: true, path: opts?.existsPath ?? "/usr/bin/pi" }) },
  ];
  const ghostStrategies: Strategy[] = [
    { name: "override", run: (ctx) => ctx.overrides["ghost"]
      ? { ok: true, path: ctx.overrides["ghost"] }
      : { ok: false, reason: "no override set" } },
    { name: "where", run: () => ({ ok: false, reason: "not found on PATH" }) },
  ];
  r.register({ name: "pi", kind: "binary", strategies: piStrategies });
  r.register({ name: "ghost", kind: "binary", strategies: ghostStrategies });
  return r;
}

function buildServer(registry: ToolRegistry): FastifyInstance {
  const fastify = Fastify();
  registerToolRoutes(fastify, { registry, networkGuard: noGuard() });
  return fastify;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/tools", () => {
  let fastify: FastifyInstance;
  beforeEach(() => { fastify = buildServer(buildRegistry()); });
  afterEach(async () => { await fastify.close(); });

  it("returns all registered tools", async () => {
    const res = await fastify.inject({ method: "GET", url: "/api/tools" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    const names = body.data.tools.map((t: any) => t.name).sort();
    expect(names).toEqual(["ghost", "pi"]);
  });
});

describe("GET /api/tools/:name", () => {
  let fastify: FastifyInstance;
  beforeEach(() => { fastify = buildServer(buildRegistry()); });
  afterEach(async () => { await fastify.close(); });

  it("returns the resolution for a known tool", async () => {
    const res = await fastify.inject({ method: "GET", url: "/api/tools/pi" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.name).toBe("pi");
    expect(body.data.ok).toBe(true);
    expect(body.data.path).toBe("/usr/bin/pi");
  });

  it("404s for an unregistered tool", async () => {
    const res = await fastify.inject({ method: "GET", url: "/api/tools/bogus" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/Unknown tool/);
  });
});

describe("POST /api/tools/rescan", () => {
  it("rescan() without body clears all caches", async () => {
    let calls = 0;
    const overrides = new OverridesStore({ filePath: tmpOverridesPath(), warn: () => {} });
    const r = new ToolRegistry({ overrides, platform: "linux" });
    r.register({
      name: "pi",
      kind: "binary",
      strategies: [{ name: "where", run: () => ({ ok: true, path: `/pi${++calls}` }) }],
    });
    const fastify = buildServer(r);

    await fastify.inject({ method: "GET", url: "/api/tools/pi" });
    expect(r.resolve("pi").path).toBe("/pi1");

    const res = await fastify.inject({ method: "POST", url: "/api/tools/rescan", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.tools[0].path).toBe("/pi2");
    await fastify.close();
  });

  it("rescan({ name }) only clears that tool's cache", async () => {
    let piCalls = 0, ghostCalls = 0;
    const overrides = new OverridesStore({ filePath: tmpOverridesPath(), warn: () => {} });
    const r = new ToolRegistry({ overrides, platform: "linux" });
    r.register({
      name: "pi",
      kind: "binary",
      strategies: [{ name: "where", run: () => ({ ok: true, path: `/pi${++piCalls}` }) }],
    });
    r.register({
      name: "ghost",
      kind: "binary",
      strategies: [{ name: "where", run: () => ({ ok: true, path: `/ghost${++ghostCalls}` }) }],
    });
    const fastify = buildServer(r);

    r.resolve("pi"); r.resolve("ghost");
    await fastify.inject({
      method: "POST", url: "/api/tools/rescan", payload: { name: "pi" },
    });
    expect(r.resolve("pi").path).toBe("/pi2");
    expect(r.resolve("ghost").path).toBe("/ghost1"); // unchanged
    await fastify.close();
  });

  it("404s when rescanning an unknown name", async () => {
    const fastify = buildServer(buildRegistry());
    const res = await fastify.inject({
      method: "POST", url: "/api/tools/rescan", payload: { name: "bogus" },
    });
    expect(res.statusCode).toBe(404);
    await fastify.close();
  });
});

describe("PUT /api/tools/:name (set override)", () => {
  it("sets the override and returns refreshed Resolution", async () => {
    const r = buildRegistry();
    const fastify = buildServer(r);

    const res = await fastify.inject({
      method: "PUT", url: "/api/tools/pi",
      payload: { path: "/custom/pi" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.source).toBe("override");
    expect(body.data.path).toBe("/custom/pi");
    await fastify.close();
  });

  it("400s on missing path body", async () => {
    const fastify = buildServer(buildRegistry());
    const res = await fastify.inject({
      method: "PUT", url: "/api/tools/pi", payload: {},
    });
    expect(res.statusCode).toBe(400);
    await fastify.close();
  });

  it("404s for unknown tool name", async () => {
    const fastify = buildServer(buildRegistry());
    const res = await fastify.inject({
      method: "PUT", url: "/api/tools/bogus", payload: { path: "/x" },
    });
    expect(res.statusCode).toBe(404);
    await fastify.close();
  });
});

describe("DELETE /api/tools/:name (clear override)", () => {
  it("clears the override and returns refreshed Resolution", async () => {
    const r = buildRegistry();
    r.setOverride("pi", "/custom/pi");
    const fastify = buildServer(r);

    const res = await fastify.inject({ method: "DELETE", url: "/api/tools/pi" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.path).toBe("/usr/bin/pi");
    await fastify.close();
  });

  it("404s for unknown tool", async () => {
    const fastify = buildServer(buildRegistry());
    const res = await fastify.inject({ method: "DELETE", url: "/api/tools/bogus" });
    expect(res.statusCode).toBe(404);
    await fastify.close();
  });
});

describe("POST /api/tools/diagnostics", () => {
  it("returns text/plain with per-tool headers and trail lines", async () => {
    const fastify = buildServer(buildRegistry());
    const res = await fastify.inject({ method: "POST", url: "/api/tools/diagnostics" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    const body = res.body;
    // Header line per tool
    expect(body).toMatch(/^\[ok\] +pi /m);
    expect(body).toMatch(/^\[miss\] +ghost /m);
    // Each attempted strategy appears with a leading dash
    expect(body).toMatch(/- where: ok/);
    expect(body).toMatch(/- where: not found on PATH/);
    await fastify.close();
  });

  it("formatDiagnostics is stable for unit testing", () => {
    const text = formatDiagnostics([
      {
        name: "pi", ok: true, path: "/usr/bin/pi", source: "system",
        tried: [{ strategy: "where", result: "ok" }],
        resolvedAt: 0,
      },
    ]);
    expect(text).toMatch(/\[ok\] +pi \(system\) → \/usr\/bin\/pi/);
    expect(text).toMatch(/- where: ok/);
  });
});

describe("integration with default tool definitions", () => {
  it("the standard registry exposes pi, openspec, git, npm etc. via GET /api/tools", async () => {
    const overrides = new OverridesStore({ filePath: tmpOverridesPath(), warn: () => {} });
    const r = new ToolRegistry({ overrides, platform: "linux" });
    registerDefaultTools(r, {
      exists: () => false,
      which: () => null,
      npmRootGlobal: () => "",
    });
    const fastify = buildServer(r);

    const res = await fastify.inject({ method: "GET", url: "/api/tools" });
    expect(res.statusCode).toBe(200);
    const names = res.json().data.tools.map((t: any) => t.name).sort();
    expect(names).toEqual(expect.arrayContaining(["git", "node", "npm", "openspec", "pi", "pi-coding-agent", "zrok"]));
    expect(names).not.toContain("tsx");
    expect(names).not.toContain("pi-dashboard");
    await fastify.close();
  });
});

// Clean up tmp overrides files
afterAll();
function afterAll() {
  try {
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (f.startsWith("tool-routes-test-")) {
        try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch {}
      }
    }
  } catch {}
}
