/**
 * Tests for `GET /api/file/tree` — the single-source-of-truth tree listing.
 *
 * Fixes editor-pane defect #1: the old `/api/file`(names)+`/api/browse`(dirs,
 * hidden-stripped) merge labelled hidden directories (`.git`, `.pi`) as files.
 * The new endpoint returns `{ entries: {name,isDir}[] }` from a single
 * `readdir(withFileTypes)`, hidden entries INCLUDED, behind the `/api/file`
 * security gate (known-cwd + containment).
 *
 * See change: improve-content-editor (tasks §2.1).
 */

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

async function tree(app: FastifyInstance, cwd: string, p: string) {
  return app.inject({
    method: "GET",
    url: `/api/file/tree?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(p)}`,
  });
}

describe("GET /api/file/tree", () => {
  let app: FastifyInstance;
  let cwd: string;

  beforeEach(async () => {
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "ft-cwd-")));
    await fsp.mkdir(path.join(cwd, ".git"));
    await fsp.mkdir(path.join(cwd, "src"));
    await fsp.writeFile(path.join(cwd, "README.md"), "# hi\n");
    await fsp.writeFile(path.join(cwd, ".gitignore"), "node_modules\n");
    app = makeApp([cwd]);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fsp.rm(cwd, { recursive: true, force: true });
  });

  it("lists hidden directories with isDir:true", async () => {
    const res = await tree(app, cwd, ".");
    expect(res.statusCode).toBe(200);
    const entries = res.json().data.entries as { name: string; isDir: boolean }[];
    const byName = Object.fromEntries(entries.map((e) => [e.name, e.isDir]));
    expect(byName[".git"]).toBe(true);
    expect(byName["src"]).toBe(true);
    expect(byName["README.md"]).toBe(false);
    expect(byName[".gitignore"]).toBe(false);
  });

  it("follows a symlink to a directory (renders as a folder)", async () => {
    await fsp.symlink(path.join(cwd, "src"), path.join(cwd, "src-link"));
    const res = await tree(app, cwd, ".");
    const byName = Object.fromEntries(
      (res.json().data.entries as { name: string; isDir: boolean }[]).map((e) => [e.name, e.isDir]),
    );
    expect(byName["src-link"]).toBe(true);
  });

  it("rejects path traversal with 403", async () => {
    const res = await tree(app, cwd, "../..");
    expect(res.statusCode).toBe(403);
  });

  it("rejects an unknown cwd with 403", async () => {
    const res = await tree(app, "/not/a/session", ".");
    expect(res.statusCode).toBe(403);
  });

  it("requires cwd and path with 400", async () => {
    const res = await app.inject({ method: "GET", url: "/api/file/tree" });
    expect(res.statusCode).toBe(400);
  });
});
