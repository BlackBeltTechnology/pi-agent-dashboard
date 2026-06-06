/**
 * Security tests for absolute / `file://` path containment on `/api/file`.
 * Absolute paths are accepted but MUST resolve under a known session cwd;
 * an absolute path outside every session cwd is rejected exactly as a
 * traversal attempt. See change: unify-file-link-openability.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { registerFileRoutes } from "../routes/file-routes.js";

function makeApp(cwds: string[]): FastifyInstance {
  const app = Fastify({ logger: false });
  registerFileRoutes(app, {
    sessionManager: { listAll: () => cwds.map((cwd) => ({ cwd })) } as any,
    preferencesStore: { getPinnedDirectories: () => [] } as any,
    networkGuard: async () => undefined,
  });
  return app;
}

describe("GET /api/file — absolute path containment", () => {
  let app: FastifyInstance;
  let tmp: string;

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "file-abs-"));
    await fsp.writeFile(path.join(tmp, "foo.ts"), "const x = 1;\n", "utf-8");
    app = makeApp([tmp]);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("allows an absolute path resolving inside a known session cwd", async () => {
    const abs = path.join(tmp, "foo.ts");
    const res = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(tmp)}&path=${encodeURIComponent(abs)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ type: "file", content: "const x = 1;\n" });
  });

  it("allows a file:// URI resolving inside a known session cwd", async () => {
    const abs = path.join(tmp, "foo.ts");
    const uri = `file://${abs}`;
    const res = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(tmp)}&path=${encodeURIComponent(uri)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ type: "file", content: "const x = 1;\n" });
  });

  it("rejects an absolute path outside every session cwd (no content)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(tmp)}&path=${encodeURIComponent("/etc/passwd")}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "path outside working directory" });
  });

  it("rejects a file:// URI pointing outside every session cwd", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(tmp)}&path=${encodeURIComponent("file:///etc/passwd")}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "path outside working directory" });
  });
});
