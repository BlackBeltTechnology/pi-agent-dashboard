/**
 * Tests for the file read endpoint logic.
 * Uses lightweight path validation tests since integration tests
 * require a full server (covered by manual testing).
 */

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetAccessGrants } from "../access/access-grants.js";
import { registerFileRoutes } from "../routes/file-routes.js";

/**
 * Extracted path containment check — same logic used in the endpoint.
 */
function isPathContained(cwd: string, relPath: string): boolean {
  const resolved = path.resolve(cwd, relPath);
  return resolved.startsWith(cwd + path.sep) || resolved === cwd;
}

describe("file endpoint path validation", () => {
  it("should allow a simple relative path", () => {
    expect(isPathContained("/project", "readme.md")).toBe(true);
  });

  it("should allow a nested relative path", () => {
    expect(isPathContained("/project", "openspec/changes/foo/proposal.md")).toBe(true);
  });

  it("should allow a subdirectory path", () => {
    expect(isPathContained("/project", "openspec/changes/foo/specs")).toBe(true);
  });

  it("should reject path traversal with ../", () => {
    expect(isPathContained("/project", "../../etc/passwd")).toBe(false);
  });

  it("should reject path traversal that resolves outside cwd", () => {
    expect(isPathContained("/project/sub", "../other/file.md")).toBe(false);
  });

  it("should allow path with ../ that stays inside cwd", () => {
    expect(isPathContained("/project", "a/../b/file.md")).toBe(true);
  });

  it("should reject absolute path outside cwd", () => {
    expect(isPathContained("/project", "/etc/passwd")).toBe(false);
  });

  it("should allow cwd itself", () => {
    expect(isPathContained("/project", ".")).toBe(true);
  });
});

describe("GET /api/file/exists — real-path containment (close-local-listener-and-egress-gaps)", () => {
  let base: string;
  let savedStore: string | undefined;

  beforeEach(async () => {
    base = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "file-exists-link-")));
    savedStore = process.env.PI_ACCESS_GRANTS_STORE;
    process.env.PI_ACCESS_GRANTS_STORE = path.join(base, "grants.json");
    __resetAccessGrants();
  });

  afterEach(async () => {
    __resetAccessGrants();
    if (savedStore === undefined) delete process.env.PI_ACCESS_GRANTS_STORE;
    else process.env.PI_ACCESS_GRANTS_STORE = savedStore;
    await fsp.rm(base, { recursive: true, force: true });
  });

  it("T.16 an in-cwd link to an outside file is refused with the unchanged `path outside cwd` string (pinned dirs empty)", async () => {
    const cwd = path.join(base, "cwd");
    await fsp.mkdir(cwd);
    await fsp.writeFile(path.join(base, "outside.txt"), "secret");
    await fsp.symlink(path.join(base, "outside.txt"), path.join(cwd, "l"));
    const app = Fastify({ logger: false });
    registerFileRoutes(app, {
      sessionManager: { listAll: () => [{ cwd }] } as never,
      preferencesStore: { getPinnedDirectories: () => [] } as never,
      networkGuard: async () => undefined,
    });
    await app.ready();
    try {
      // The endpoint takes an ABSOLUTE probe path (a relative one is refused before containment).
      const res = await app.inject({
        method: "GET",
        url: `/api/file/exists?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path.join(cwd, "l"))}`,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ success: false, error: "path outside cwd" });
      expect(res.json().error).not.toBe("path outside working directory");
      // The in-cwd regular file is still answered normally.
      await fsp.writeFile(path.join(cwd, "here.txt"), "x");
      const ok = await app.inject({
        method: "GET",
        url: `/api/file/exists?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path.join(cwd, "here.txt"))}`,
      });
      expect(ok.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
