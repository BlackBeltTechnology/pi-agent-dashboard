/**
 * Security tests for absolute / `file://` path containment on `/api/file`.
 * Absolute paths are accepted but MUST resolve under a known session cwd;
 * an absolute path outside every session cwd is rejected exactly as a
 * traversal attempt. See change: unify-file-link-openability.
 */
import { describe, it, expect, afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { registerFileRoutes } from "../routes/file-routes.js";
import { buildGitFixtures, type GitFixtures } from "@blackbelt-technology/pi-dashboard-shared/test-support/git-fixtures.js";

const execFileAsync = promisify(execFile);
async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", cwd, ...args]);
}

function makeApp(cwds: string[], pinned: string[] = []): FastifyInstance {
  const app = Fastify({ logger: false });
  registerFileRoutes(app, {
    sessionManager: { listAll: () => cwds.map((cwd) => ({ cwd })) } as any,
    preferencesStore: { getPinnedDirectories: () => pinned } as any,
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
    expect(body.data).toMatchObject({ type: "file", kind: "text", content: "const x = 1;\n" });
  });

  it("allows a file:// URI resolving inside a known session cwd", async () => {
    const abs = path.join(tmp, "foo.ts");
    const uri = `file://${abs}`;
    const res = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(tmp)}&path=${encodeURIComponent(uri)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ type: "file", kind: "text", content: "const x = 1;\n" });
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

  it("rejects a file:// URI with percent-encoded traversal segments", async () => {
    // `file://` + encoded `../../etc/passwd` — decode + containment must both
    // run so an encoded escape cannot regress silently.
    const encoded = "file://%2e%2e%2f%2e%2e%2fetc%2fpasswd";
    const res = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(tmp)}&path=${encodeURIComponent(encoded)}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "path outside working directory" });
  });

  it("behaves as cwd-only when cwd has no git (parent-tree read rejected)", async () => {
    // No git → layer ② no-ops; a parent-tree file stays rejected.
    const parentFile = path.join(path.dirname(tmp), "sibling.txt");
    const res = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(tmp)}&path=${encodeURIComponent(parentFile)}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "path outside working directory" });
  });
});

describe("GET /api/file — git-root widening (worktree sessions)", () => {
  let app: FastifyInstance;
  let repo: string;
  let worktree: string;

  beforeEach(async () => {
    repo = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "file-wt-")));
    await git(repo, "init", "-q");
    await git(repo, "config", "user.email", "t@t.t");
    await git(repo, "config", "user.name", "t");
    await fsp.writeFile(path.join(repo, "root.txt"), "root-content\n");
    await git(repo, "add", ".");
    await git(repo, "commit", "-q", "-m", "init");
    worktree = path.join(repo, ".worktrees", "wt");
    await git(repo, "worktree", "add", "-q", worktree);
    // Only the worktree is a registered session cwd.
    app = makeApp([worktree]);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fsp.rm(repo, { recursive: true, force: true });
  });

  it("allows a worktree cwd reading a parent-root file (HTTP 200)", async () => {
    const target = path.join(repo, "root.txt");
    const res = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(worktree)}&path=${encodeURIComponent(target)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ type: "file", kind: "text", content: "root-content\n" });
  });

  it("rejects a symlink under the repo root whose real target escapes (HTTP 403)", async () => {
    const outside = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "file-out-")));
    try {
      await fsp.writeFile(path.join(outside, "secret.txt"), "secret\n");
      const link = path.join(repo, "escape");
      await fsp.symlink(outside, link);
      const target = path.join(link, "secret.txt");
      const res = await app.inject({
        method: "GET",
        url: `/api/file?cwd=${encodeURIComponent(worktree)}&path=${encodeURIComponent(target)}`,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ success: false, error: "path outside working directory" });
    } finally {
      await fsp.rm(outside, { recursive: true, force: true });
    }
  });
});

describe("GET /api/file/exists — pinned-dir anchor + strings preserved", () => {
  let app: FastifyInstance;
  let cwd: string;
  let pinned: string;

  beforeEach(async () => {
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "file-ex-cwd-")));
    pinned = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "file-ex-pin-")));
    await fsp.writeFile(path.join(pinned, "here.txt"), "x\n");
    app = makeApp([cwd], [pinned]);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fsp.rm(cwd, { recursive: true, force: true });
    await fsp.rm(pinned, { recursive: true, force: true });
  });

  it("honors a pinned directory (existing file inside it → 200)", async () => {
    const probe = path.join(pinned, "here.txt");
    const res = await app.inject({
      method: "GET",
      url: `/api/file/exists?cwd=${encodeURIComponent(pinned)}&path=${encodeURIComponent(probe)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { exists: true } });
  });

  it("keeps the 'unknown cwd' string for an unregistered cwd", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/file/exists?cwd=${encodeURIComponent("/nope")}&path=${encodeURIComponent("/nope/x")}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "unknown cwd" });
  });

  it("keeps the 'path outside cwd' string for an out-of-anchor probe", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/file/exists?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent("/etc/passwd")}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "path outside cwd" });
  });

  it("rejects a relative probe (resolved against server cwd, not request cwd)", async () => {
    // A relative `path` must not be resolved against the server process cwd —
    // with git-root widening that could leak existence checks under the launch repo.
    const res = await app.inject({
      method: "GET",
      url: `/api/file/exists?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent("here.txt")}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "path outside cwd" });
  });

  // E23 — layer ② is PER ANCHOR, so a pinned directory keeps the widening it
  // already had: its own checkout root becomes reachable even though no session
  // cwd sits there. See change: widen-containment-to-resolved-checkout.
  it("E23: widens through a PINNED dir's checkout root (anchors stay per-site)", async () => {
    const repo = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "file-e23-")));
    try {
      await git(repo, "init", "-q");
      await git(repo, "config", "user.email", "t@t.t");
      await git(repo, "config", "user.name", "t");
      await fsp.writeFile(path.join(repo, "README.md"), "root\n");
      await git(repo, "add", ".");
      await git(repo, "commit", "-q", "-m", "init");
      const pinned = path.join(repo, "packages", "x");
      await fsp.mkdir(pinned, { recursive: true });
      const other = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "file-e23-other-")));

      const pinnedApp = makeApp([other], [pinned]);
      await pinnedApp.ready();
      const res = await pinnedApp.inject({
        method: "GET",
        url: `/api/file/exists?cwd=${encodeURIComponent(pinned)}&path=${encodeURIComponent(path.join(repo, "README.md"))}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true, data: { exists: true } });
      await pinnedApp.close();
      await fsp.rm(other, { recursive: true, force: true });
    } finally {
      await fsp.rm(repo, { recursive: true, force: true });
    }
  });
});

// E24 — the widening this change exists for: a submodule session reaches its OWN
// checkout but never its superproject. See change: widen-containment-to-resolved-checkout.
describe("GET /api/file — submodule session vs superproject (E24)", () => {
  let fx: GitFixtures;
  let app: FastifyInstance;

  beforeAll(() => {
    fx = buildGitFixtures();
  });

  afterAll(async () => {
    await app?.close();
    fx.cleanup();
  });

  it("allows the submodule's own checkout root and 403s the superproject", async () => {
    const cwd = path.join(fx.submodule, "deep");
    await fsp.mkdir(cwd, { recursive: true });
    await fsp.writeFile(path.join(fx.submodule, "README.md"), "sub\n");
    app = makeApp([cwd]);
    await app.ready();

    const allowed = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path.join(fx.submodule, "README.md"))}`,
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().data).toMatchObject({ type: "file", kind: "markdown", content: "sub\n" });

    const denied = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path.join(fx.superproject, ".env"))}`,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ success: false, error: "path outside working directory" });
  });
});

// E26 — the site-specific `~/.pi` anchor is carried over verbatim: read, raw and
// render still admit it while `exists` (which never had it) still refuses.
// See change: widen-containment-to-resolved-checkout.
describe("GET /api/file — `~/.pi` anchor preserved on read/raw/render (E26)", () => {
  let app: FastifyInstance;
  let cwd: string;
  let home: string;
  let savedHome: string | undefined;

  beforeEach(async () => {
    savedHome = process.env.HOME;
    home = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "file-e26-home-")));
    process.env.HOME = home;
    await fsp.mkdir(path.join(home, ".pi"), { recursive: true });
    await fsp.writeFile(path.join(home, ".pi", "note.md"), "# note\n");
    await fsp.writeFile(path.join(home, ".pi", "note.adoc"), "= note\n");
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "file-e26-cwd-")));
    app = makeApp([cwd]);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fsp.rm(cwd, { recursive: true, force: true });
    await fsp.rm(home, { recursive: true, force: true });
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
  });

  it("admits the ~/.pi path on read, raw and render, but not on exists", async () => {
    const target = path.join(home, ".pi", "note.md");
    const q = `cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(target)}`;

    expect((await app.inject({ method: "GET", url: `/api/file?${q}` })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/file/raw?${q}` })).statusCode).toBe(200);

    // `/render` only handles `.adoc`/`.docx`/`.pptx`, and only the `.adoc` path
    // passes the `homePiAnchor()` anchor — so that is the extension that
    // exercises this anchor. Containment is what is under test, not the
    // renderer: a renderer failure is 500, a containment failure is 403.
    const adoc = path.join(home, ".pi", "note.adoc");
    const render = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(adoc)}`,
    });
    expect(render.statusCode).not.toBe(403);

    const exists = await app.inject({ method: "GET", url: `/api/file/exists?${q}` });
    expect(exists.statusCode).toBe(403);
    expect(exists.json()).toEqual({ success: false, error: "path outside cwd" });
  });
});
