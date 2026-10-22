/**
 * HTTP-level tests for the openspec task list / toggle endpoints.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerOpenSpecRoutes } from "../routes/openspec-routes.js";

const PASSTHRU_GUARD = async () => {};

// Simulates a non-loopback guard that 403s every request.
const DENY_GUARD = async (_req: any, reply: any) => {
  reply.code(403).send({ success: false, error: "forbidden" });
};

function makeDirectoryService(): any {
  return {
    refreshOpenSpec: vi.fn(async () => ({ initialized: true, changes: [] })),
    getOpenSpecData: vi.fn(),
  };
}

describe("openspec tasks REST routes", () => {
  let tmpDir: string;
  let changeName: string;
  let tasksFile: string;
  let fastify: FastifyInstance;

  const initialMd = [
    "## 1. Setup",
    "",
    "- [ ] 1.1 First task",
    "- [x] 1.2 Second task",
    "",
    "## 2. Docs",
    "- [ ] 2.1 Third task",
    "",
  ].join("\n");

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openspec-routes-test-"));
    changeName = "demo-change";
    const dir = path.join(tmpDir, "openspec", "changes", changeName);
    fs.mkdirSync(dir, { recursive: true });
    tasksFile = path.join(dir, "tasks.md");
    fs.writeFileSync(tasksFile, initialMd, "utf-8");
  });

  afterEach(async () => {
    if (fastify) await fastify.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function setup(opts: {
    networkGuard?: any;
    onOpenSpecChanged?: (cwd: string) => void;
  } = {}) {
    fastify = Fastify();
    const directoryService = makeDirectoryService();
    registerOpenSpecRoutes(fastify, {
      sessionManager: { listAll: () => [] } as any,
      preferencesStore: { getPinnedDirectories: () => [tmpDir] } as any,
      directoryService,
      networkGuard: opts.networkGuard ?? PASSTHRU_GUARD,
      onOpenSpecChanged: opts.onOpenSpecChanged,
    });
    await fastify.ready();
    return { directoryService };
  }

  it("GET /api/openspec/tasks → 200 with parsed tasks + groups", async () => {
    await setup();
    const res = await fastify.inject({
      method: "GET",
      url: `/api/openspec/tasks?cwd=${encodeURIComponent(tmpDir)}&change=${changeName}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data.tasks.map((t: any) => t.id)).toEqual(["1.1", "1.2", "2.1"]);
    expect(body.data.groups).toEqual(["1. Setup", "2. Docs"]);
  });

  it("GET /api/openspec/tasks → 400 when required query missing", async () => {
    await setup();
    const res = await fastify.inject({ method: "GET", url: "/api/openspec/tasks" });
    expect(res.statusCode).toBe(400);
  });

  it("GET /api/openspec/tasks → 404 when tasks.md missing", async () => {
    await setup();
    const res = await fastify.inject({
      method: "GET",
      url: `/api/openspec/tasks?cwd=${encodeURIComponent(tmpDir)}&change=does-not-exist`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/openspec/tasks → 403 when network guard denies", async () => {
    await setup({ networkGuard: DENY_GUARD });
    const res = await fastify.inject({
      method: "GET",
      url: `/api/openspec/tasks?cwd=${encodeURIComponent(tmpDir)}&change=${changeName}`,
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST toggle → 200 ticks task, rewrites file, and triggers broadcast", async () => {
    const onOpenSpecChanged = vi.fn();
    const { directoryService } = await setup({ onOpenSpecChanged });
    const res = await fastify.inject({
      method: "POST",
      url: "/api/openspec/tasks/toggle",
      payload: { cwd: tmpDir, change: changeName, id: "1.1", done: true, line: 3 },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.task.done).toBe(true);
    const after = fs.readFileSync(tasksFile, "utf-8");
    expect(after).toContain("- [x] 1.1 First task");
    // Allow the fire-and-forget refresh promise to resolve
    await new Promise((r) => setTimeout(r, 10));
    expect(directoryService.refreshOpenSpec).toHaveBeenCalledWith(tmpDir);
    expect(onOpenSpecChanged).toHaveBeenCalledWith(tmpDir);
  });

  it("POST toggle → 409 on line mismatch (line already in target state)", async () => {
    await setup();
    const res = await fastify.inject({
      method: "POST",
      url: "/api/openspec/tasks/toggle",
      payload: { cwd: tmpDir, change: changeName, id: "1.2", done: true, line: 4 },
    });
    expect(res.statusCode).toBe(409);
    // File untouched
    expect(fs.readFileSync(tasksFile, "utf-8")).toBe(initialMd);
  });

  it("POST toggle → 400 when target line is not a checkbox", async () => {
    await setup();
    const res = await fastify.inject({
      method: "POST",
      url: "/api/openspec/tasks/toggle",
      payload: { cwd: tmpDir, change: changeName, id: "1.1", done: true, line: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST toggle → 400 on malformed body", async () => {
    await setup();
    const res = await fastify.inject({
      method: "POST",
      url: "/api/openspec/tasks/toggle",
      payload: { cwd: tmpDir },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST toggle → 404 when tasks.md missing", async () => {
    await setup();
    const res = await fastify.inject({
      method: "POST",
      url: "/api/openspec/tasks/toggle",
      payload: { cwd: tmpDir, change: "missing", id: "1.1", done: true, line: 3 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST toggle → 403 when network guard denies", async () => {
    await setup({ networkGuard: DENY_GUARD });
    const res = await fastify.inject({
      method: "POST",
      url: "/api/openspec/tasks/toggle",
      payload: { cwd: tmpDir, change: changeName, id: "1.1", done: true, line: 3 },
    });
    expect(res.statusCode).toBe(403);
  });
});
