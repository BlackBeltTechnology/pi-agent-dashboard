/**
 * `/api/pi-resource-file` also serves the EXACT flow definition files a live
 * session reported in its `flows_list` (extension-registered flow dirs such as
 * `<plugin>/packages/engine/flows/<ns>/<name>/flow.yaml` sit outside the
 * `.pi` / `node_modules` allow-list). Nothing else is widened: a sibling file,
 * a non-YAML path, or a path from an unregistered session stays 403.
 * See change: attach-flow-before-run.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionFlowSourceRegistry } from "../pi/session-flow-source-registry.js";
import { registerOpenSpecRoutes } from "../routes/openspec-routes.js";

describe("session flow-source registry", () => {
  afterEach(() => sessionFlowSourceRegistry.clearForTests());

  it("allows exactly the reported absolute YAML sources, per session", () => {
    sessionFlowSourceRegistry.retain("S1", [
      { name: "x:a", description: "", taskRequired: false, source: "/plug/flows/x/a/flow.yaml" },
      { name: "x:b", description: "", taskRequired: false, source: "relative/flow.yaml" },
      { name: "x:c", description: "", taskRequired: false, source: "/plug/flows/x/c/secret.txt" },
      { name: "x:d", description: "", taskRequired: false },
    ]);
    expect(sessionFlowSourceRegistry.has("/plug/flows/x/a/flow.yaml")).toBe(true);
    expect(sessionFlowSourceRegistry.has("/plug/flows/x/a/../a/flow.yaml")).toBe(true);
    expect(sessionFlowSourceRegistry.has("/plug/flows/x/a/other.yaml")).toBe(false);
    expect(sessionFlowSourceRegistry.has("relative/flow.yaml")).toBe(false);
    expect(sessionFlowSourceRegistry.has("/plug/flows/x/c/secret.txt")).toBe(false);
  });

  it("a new list replaces the old one; remove drops the session", () => {
    sessionFlowSourceRegistry.retain("S1", [{ name: "a", description: "", taskRequired: false, source: "/p/a/flow.yaml" }]);
    sessionFlowSourceRegistry.retain("S2", [{ name: "b", description: "", taskRequired: false, source: "/p/b/flow.yaml" }]);
    sessionFlowSourceRegistry.retain("S1", [{ name: "c", description: "", taskRequired: false, source: "/p/c/flow.yaml" }]);
    expect(sessionFlowSourceRegistry.has("/p/a/flow.yaml")).toBe(false);
    expect(sessionFlowSourceRegistry.has("/p/c/flow.yaml")).toBe(true);
    sessionFlowSourceRegistry.remove("S2");
    expect(sessionFlowSourceRegistry.has("/p/b/flow.yaml")).toBe(false);
  });
});

describe("GET /api/pi-resource-file — reported flow sources", () => {
  let tmp: string;
  let flowFile: string;
  let sibling: string;
  let fastify: FastifyInstance;

  beforeEach(async () => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "flow-src-")));
    const dir = path.join(tmp, "plugin", "packages", "engine", "flows", "ns", "demo");
    fs.mkdirSync(dir, { recursive: true });
    flowFile = path.join(dir, "flow.yaml");
    sibling = path.join(dir, "handler.ts");
    fs.writeFileSync(flowFile, "name: demo\n");
    fs.writeFileSync(sibling, "secret\n");
    fastify = Fastify();
    registerOpenSpecRoutes(fastify, {
      sessionManager: { listAll: () => [] } as never,
      preferencesStore: { getPinnedDirectories: () => [] } as never,
      directoryService: { refreshOpenSpec: vi.fn(), getOpenSpecData: vi.fn() } as never,
      networkGuard: async () => {},
    });
    await fastify.ready();
  });

  afterEach(async () => {
    sessionFlowSourceRegistry.clearForTests();
    await fastify.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const get = (p: string) => fastify.inject({ method: "GET", url: `/api/pi-resource-file?path=${encodeURIComponent(p)}` });

  it("403 before any session reports it", async () => {
    expect((await get(flowFile)).statusCode).toBe(403);
  });

  it("200 with content once a session reports it; siblings stay 403", async () => {
    sessionFlowSourceRegistry.retain("S1", [{ name: "ns:demo", description: "", taskRequired: false, source: flowFile }]);
    const ok = await get(flowFile);
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.payload).data.content).toBe("name: demo\n");
    expect((await get(sibling)).statusCode).toBe(403);
  });

  it("a symlinked spelling of a reported source is served; a symlink to a sibling is not", async () => {
    sessionFlowSourceRegistry.retain("S1", [{ name: "ns:demo", description: "", taskRequired: false, source: flowFile }]);
    const linkToFlow = path.join(tmp, "alias.yaml");
    const linkToSibling = path.join(tmp, "evil.yaml");
    fs.symlinkSync(flowFile, linkToFlow);
    fs.symlinkSync(sibling, linkToSibling);
    expect((await get(linkToFlow)).statusCode).toBe(200);
    expect((await get(linkToSibling)).statusCode).toBe(403);
    expect((await get(path.join(path.dirname(flowFile), "..", "demo", "flow.yaml"))).statusCode).toBe(200);
  });

  it("403 again after the reporting session unregisters", async () => {
    sessionFlowSourceRegistry.retain("S1", [{ name: "ns:demo", description: "", taskRequired: false, source: flowFile }]);
    sessionFlowSourceRegistry.remove("S1");
    expect((await get(flowFile)).statusCode).toBe(403);
  });
});
