/**
 * Security tests for the artifact-root image anchor (layer ③) on
 * `/api/file/raw`. Agent screenshots live in a per-user temp dir outside every
 * session cwd and git root; the raw route serves images from an artifact root
 * as an additional, real-path-contained, image-only anchor. The anchor MUST
 * NOT leak to `/api/file` or `/api/file/render`.
 * See change: serve-agent-artifact-previews.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { registerFileRoutes } from "../routes/file-routes.js";
import { resetArtifactRootsCache } from "../lib/artifact-roots.js";

function makeApp(cwds: string[]): FastifyInstance {
  const app = Fastify({ logger: false });
  registerFileRoutes(app, {
    sessionManager: { listAll: () => cwds.map((cwd) => ({ cwd })) } as any,
    preferencesStore: { getPinnedDirectories: () => [] } as any,
    networkGuard: async () => undefined,
  });
  return app;
}

const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex",
);

describe("GET /api/file/raw — artifact-root image anchor (layer ③)", () => {
  let app: FastifyInstance;
  let cwd: string;
  let artifactRoot: string;
  const prevEnv = process.env.AGENT_BROWSER_SCREENSHOT_DIR;

  beforeEach(async () => {
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "artifact-cwd-")));
    artifactRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "artifact-root-")));
    process.env.AGENT_BROWSER_SCREENSHOT_DIR = artifactRoot;
    resetArtifactRootsCache();
    app = makeApp([cwd]);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    if (prevEnv === undefined) delete process.env.AGENT_BROWSER_SCREENSHOT_DIR;
    else process.env.AGENT_BROWSER_SCREENSHOT_DIR = prevEnv;
    resetArtifactRootsCache();
    await fsp.rm(cwd, { recursive: true, force: true });
    await fsp.rm(artifactRoot, { recursive: true, force: true });
  });

  it("(a) serves an image under the artifact root with an image content-type (200)", async () => {
    const shot = path.join(artifactRoot, "screenshots", "shot.png");
    await fsp.mkdir(path.dirname(shot), { recursive: true });
    await fsp.writeFile(shot, PNG_BYTES);
    const res = await app.inject({
      method: "GET",
      url: `/api/file/raw?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(shot)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
  });

  it("(b) rejects a non-image file under the artifact root (403)", async () => {
    const trace = path.join(artifactRoot, "trace.json");
    await fsp.writeFile(trace, "{}\n");
    const res = await app.inject({
      method: "GET",
      url: `/api/file/raw?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(trace)}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "path outside working directory" });
  });

  it("(c) rejects a symlink whose real target escapes the artifact root (403)", async () => {
    const outside = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "artifact-out-")));
    try {
      await fsp.writeFile(path.join(outside, "secret.png"), PNG_BYTES);
      const link = path.join(artifactRoot, "escape");
      await fsp.symlink(outside, link);
      const target = path.join(link, "secret.png");
      const res = await app.inject({
        method: "GET",
        url: `/api/file/raw?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(target)}`,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ success: false, error: "path outside working directory" });
    } finally {
      await fsp.rm(outside, { recursive: true, force: true });
    }
  });

  it("(c2) rejects a `..` path escaping the artifact root (403)", async () => {
    const target = path.join(artifactRoot, "..", "elsewhere.png");
    const res = await app.inject({
      method: "GET",
      url: `/api/file/raw?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(target)}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "path outside working directory" });
  });

  it("(d) rejects a path outside cwd AND outside the artifact root (403)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/file/raw?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent("/etc/hosts.png")}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "path outside working directory" });
  });

  it("(e) behaves as cwd-only when the artifact root dir is missing", async () => {
    const missing = path.join(os.tmpdir(), `artifact-missing-${Date.now()}`);
    process.env.AGENT_BROWSER_SCREENSHOT_DIR = missing;
    resetArtifactRootsCache();
    // A would-be artifact path under the missing root resolves nowhere known → 403.
    const target = path.join(missing, "shot.png");
    const res = await app.inject({
      method: "GET",
      url: `/api/file/raw?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(target)}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "path outside working directory" });
  });

  it("(f) returns 404 (not 500) for a deleted image inside the artifact root", async () => {
    const shot = path.join(artifactRoot, "screenshots", "gone.png");
    await fsp.mkdir(path.dirname(shot), { recursive: true });
    // Never written → path is inside the root by name but absent on disk.
    const res = await app.inject({
      method: "GET",
      url: `/api/file/raw?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(shot)}`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ success: false, error: "not found" });
  });
});

describe("artifact anchor is NOT shared with /api/file or /api/file/render", () => {
  let app: FastifyInstance;
  let cwd: string;
  let artifactRoot: string;
  const prevEnv = process.env.AGENT_BROWSER_SCREENSHOT_DIR;

  beforeEach(async () => {
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "artifact-cwd2-")));
    artifactRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "artifact-root2-")));
    process.env.AGENT_BROWSER_SCREENSHOT_DIR = artifactRoot;
    resetArtifactRootsCache();
    app = makeApp([cwd]);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    if (prevEnv === undefined) delete process.env.AGENT_BROWSER_SCREENSHOT_DIR;
    else process.env.AGENT_BROWSER_SCREENSHOT_DIR = prevEnv;
    resetArtifactRootsCache();
    await fsp.rm(cwd, { recursive: true, force: true });
    await fsp.rm(artifactRoot, { recursive: true, force: true });
  });

  it("/api/file rejects an image under the artifact root (403)", async () => {
    const shot = path.join(artifactRoot, "shot.png");
    await fsp.writeFile(shot, PNG_BYTES);
    const res = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(shot)}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "path outside working directory" });
  });

  it("/api/file/render rejects an .adoc under the artifact root (403)", async () => {
    const doc = path.join(artifactRoot, "doc.adoc");
    await fsp.writeFile(doc, "= Title\n");
    const res = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(doc)}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "path outside working directory" });
  });
});
