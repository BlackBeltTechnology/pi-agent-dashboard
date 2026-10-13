/**
 * Project-override routes (mcp-client-project-overrides test-plan R1–R8):
 *   PUT  /servers/:name/project-override
 *   POST /servers/:name/convert-to-override
 * Body validated before scope; project scope only; known-folder admission;
 * exact restore.
 */

import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { createMcpClientConfigService } from "../../core/service.js";
import type { ConfigIO } from "../../core/types.js";
import { mountMcpClientRoutes } from "../routes.js";

const GLOBAL = "/agent/mcp.json";
const PO = "/api/mcp-client/servers/docs/project-override";

interface H {
  app: FastifyInstance;
  files: Map<string, string>;
  writes: string[];
  reads: string[];
  known: string;
  project: string;
}

async function harness(opts: { guardDeny?: boolean } = {}): Promise<H> {
  const known = realpathSync(mkdtempSync(join(tmpdir(), "mcp-po-")));
  const project = `${known}/.pi/mcp.json`;
  const files = new Map<string, string>([
    [GLOBAL, JSON.stringify({ mcpServers: { docs: { url: "https://docs.example/mcp", headers: { Authorization: "Bearer s" }, exposure: "direct" } } })],
  ]);
  const writes: string[] = [];
  const reads: string[] = [];
  const io: ConfigIO = {
    readFile: (p) => (reads.push(p), files.get(p) ?? null),
    writeFileAtomic: (p, c) => {
      writes.push(p);
      files.set(p, c);
    },
  };
  const runtime = createMcpClientConfigService({
    configIO: io,
    paths: { globalPath: () => GLOBAL, projectPath: (cwd) => `${cwd}/.pi/mcp.json` },
    knownCwds: () => [known],
    isProjectTrusted: () => true,
    scratchCwd: "/tmp/mcp-scratch",
  });
  const app = Fastify();
  mountMcpClientRoutes(app, {
    runtime,
    knownCwds: () => [known],
    networkGuard: async (_req, reply) => {
      if (opts.guardDeny) reply.code(403).send({ error: "guard" });
    },
  });
  await app.ready();
  return { app, files, writes, reads, known, project };
}

const entryOf = (h: H): unknown => JSON.parse(h.files.get(h.project) as string).mcpServers?.docs;

describe("PUT …/project-override", () => {
  let h: H;
  beforeEach(async () => {
    h = await harness();
  });

  it.each([
    ["enabled:'no'", { enabled: "no" }, "enabled"],
    ["exposure:'bogus'", { exposure: "bogus" }, "exposure"],
    ["toolExposure value bogus", { toolExposure: { a: "bogus" } }, "toolExposure"],
    ["toolExposure:'x' with an unknown cwd", { toolExposure: "x", cwd: "/unknown" }, "toolExposure"],
  ])("R1: %s → 400 naming the field, before scope parsing or any IO", async (_l, body, field) => {
    const res = await h.app.inject({ method: "PUT", url: PO, payload: { scope: "project", cwd: h.known, ...body } });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain(field);
    expect(h.reads).toEqual([]);
    expect(h.writes).toEqual([]);
  });

  it("R2: a legacy alias is accepted and written raw", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: PO,
      payload: { scope: "project", cwd: h.known, toolExposure: { a: "codemode-deferred" } },
    });
    expect(res.statusCode).toBe(200);
    expect(entryOf(h)).toEqual({ toolExposure: { a: "codemode-deferred" } });
  });

  it("R3: global scope / no cwd → 400, no write", async () => {
    for (const payload of [{ scope: "global", enabled: false }, { enabled: false }, { scope: "project", enabled: false }]) {
      const res = await h.app.inject({ method: "PUT", url: PO, payload });
      expect(res.statusCode).toBe(400);
    }
    expect(h.writes).toEqual([]);
  });

  it("R4: an unknown folder → 403, no write", async () => {
    const res = await h.app.inject({ method: "PUT", url: PO, payload: { scope: "project", cwd: "/nope", enabled: false } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("not-allowed");
    expect(h.writes).toEqual([]);
  });

  it("R5: response shapes — override, then removed", async () => {
    const a = await h.app.inject({ method: "PUT", url: PO, payload: { scope: "project", cwd: h.known, enabled: false, exposure: "hidden" } });
    expect(a.json()).toEqual({ ok: true, override: { enabled: false, exposure: "hidden" } });
    const b = await h.app.inject({ method: "PUT", url: PO, payload: { scope: "project", cwd: h.known, enabled: null, exposure: null } });
    expect(b.json()).toEqual({ ok: true, removed: true });
  });

  it("a missing global server is refused with no-global-server", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/mcp-client/servers/ghost/project-override",
      payload: { scope: "project", cwd: h.known, enabled: false },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("no-global-server");
    expect(h.writes).toEqual([]);
  });

  it("R8: DELETE then PUT of the raw keys (absent as null) restores the entry exactly", async () => {
    h.files.set(h.project, `${JSON.stringify({ mcpServers: { docs: { enabled: false, toolExposure: { search: "direct" } } } }, null, 2)}\n`);
    const before = h.files.get(h.project);
    const del = await h.app.inject({ method: "DELETE", url: `/api/mcp-client/servers/docs?scope=project&cwd=${encodeURIComponent(h.known)}` });
    const removed = del.json().removed as Record<string, unknown>;
    expect(removed).toEqual({ enabled: false, toolExposure: { search: "direct" } });
    const put = await h.app.inject({
      method: "PUT",
      url: PO,
      payload: { scope: "project", cwd: h.known, enabled: removed.enabled ?? null, exposure: removed.exposure ?? null, toolExposure: removed.toolExposure ?? null },
    });
    expect(put.statusCode).toBe(200);
    expect(entryOf(h)).toEqual({ enabled: false, toolExposure: { search: "direct" } });
    expect(h.files.get(h.project)).toBe(before);
  });
});

describe("POST …/convert-to-override", () => {
  it("R7: a legacy copy converts and returns previous; a non-legacy entry is refused", async () => {
    const h = await harness();
    const legacy = { url: "https://docs.example/mcp", exposure: "direct", enabled: false };
    h.files.set(h.project, JSON.stringify({ mcpServers: { docs: legacy } }));
    const res = await h.app.inject({
      method: "POST",
      url: "/api/mcp-client/servers/docs/convert-to-override",
      payload: { scope: "project", cwd: h.known },
    });
    expect(res.json()).toEqual({ ok: true, previous: legacy });
    expect(entryOf(h)).toEqual({ enabled: false });

    const h2 = await harness();
    const other = { url: "https://other.example/mcp" };
    h2.files.set(h2.project, JSON.stringify({ mcpServers: { docs: other } }));
    const before = h2.files.get(h2.project);
    const refused = await h2.app.inject({
      method: "POST",
      url: "/api/mcp-client/servers/docs/convert-to-override",
      payload: { scope: "project", cwd: h2.known },
    });
    expect(refused.statusCode).toBe(400);
    expect(h2.files.get(h2.project)).toBe(before);
    expect(h2.writes).toEqual([]);
  });

  it("requires project scope", async () => {
    const h = await harness();
    const res = await h.app.inject({ method: "POST", url: "/api/mcp-client/servers/docs/convert-to-override", payload: { scope: "global" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("R6: unauthenticated", () => {
  it("both routes are refused before any file read", async () => {
    const h = await harness({ guardDeny: true });
    h.reads.length = 0;
    const a = await h.app.inject({ method: "PUT", url: PO, payload: { scope: "project", cwd: h.known, enabled: false } });
    const b = await h.app.inject({ method: "POST", url: "/api/mcp-client/servers/docs/convert-to-override", payload: { scope: "project", cwd: h.known } });
    expect(a.statusCode).toBe(403);
    expect(b.statusCode).toBe(403);
    expect(h.reads).toEqual([]);
    expect(h.writes).toEqual([]);
  });
});
