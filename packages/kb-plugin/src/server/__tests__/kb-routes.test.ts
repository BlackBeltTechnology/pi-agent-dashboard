// @vitest-environment node
//
// The `node` environment is REQUIRED, not cosmetic: this suite reaches
// `packages/kb`'s sqlite store, and vite's client (jsdom) environment refuses
// to bundle the `node:sqlite` builtin — the file then collects 0 tests and the
// transform error surfaces as a bare run failure. The package's default
// environment is jsdom for its React client tests.
// See change: move-slot-actions-to-menu (this suite was collected by no vitest
// project before and therefore never ran).
/**
 * kb-plugin REST route tests — stats / reindex / config over a real Fastify
 * instance with a temp folder fixture. Covers tasks 1.1–1.5, 4.1–4.4.
 * See change: add-kb-folder-slot.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  buildGitFixtures,
  type GitFixtures,
  restoreEnv,
} from "@blackbelt-technology/pi-dashboard-shared/test-support/git-fixtures.js";
import {
  cleanupGitShims,
  makeGitShim,
  useGitPath,
} from "@blackbelt-technology/pi-dashboard-shared/test-support/git-shim.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { KbJobRegistry } from "../job-registry.js";
import { isAllowedCwd, mountKbRoutes } from "../kb-routes.js";

const cleanup: string[] = [];
afterEach(() => {
  for (const r of cleanup.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** The nine git states, built once — the guard tests read them, never mutate
 *  them (except E19, which uses its own throwaway repo). */
let gitFx: GitFixtures;
const savedGitEnv = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };
beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_SYSTEM = "/dev/null";
  gitFx = buildGitFixtures();
});
afterAll(() => {
  gitFx.cleanup();
  cleanupGitShims();
  restoreEnv("GIT_CONFIG_GLOBAL", savedGitEnv.global);
  restoreEnv("GIT_CONFIG_SYSTEM", savedGitEnv.system);
});

/** A temp folder with a docs/ tree + a knowledge_base.json pointing at it. */
function makeFolder(opts: { withConfig?: boolean; extraConfig?: Record<string, unknown> } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "kb-plugin-"));
  cleanup.push(root);
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "a.md"), "# Alpha\n\nSome alpha content about widgets.\n");
  writeFileSync(join(root, "docs", "b.md"), "# Beta\n\nSome beta content about gadgets.\n");
  if (opts.withConfig !== false) {
    mkdirSync(join(root, ".pi", "dashboard"), { recursive: true });
    writeFileSync(
      join(root, ".pi", "dashboard", "knowledge_base.json"),
      JSON.stringify({ sources: [{ kind: "filesystem", ref: "docs" }], ...opts.extraConfig }, null, 2),
    );
  }
  return root;
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", ["-c", "user.email=t@t.com", "-c", "user.name=T", ...args], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** A real git repo (canonicalized main path) plus one linked worktree. */
function makeRepoWithWorktree(): { main: string; worktree: string } {
  const main = realpathSync(mkdtempSync(join(tmpdir(), "kb-main-")));
  cleanup.push(main);
  git(main, ["-c", "init.defaultBranch=main", "init"]);
  git(main, ["commit", "--allow-empty", "-m", "init"]);
  const worktree = join(realpathSync(tmpdir()), `kb-wt-${process.pid}-${Math.random().toString(36).slice(2)}`);
  cleanup.push(worktree);
  git(main, ["worktree", "add", "-b", "wt", worktree]);
  return { main, worktree };
}

function buildApp(knownCwds: string[]): { app: FastifyInstance; registry: KbJobRegistry } {
  const app = Fastify();
  const registry = new KbJobRegistry();
  mountKbRoutes(app, { knownCwds: () => knownCwds, registry });
  return { app, registry };
}

/** Poll GET /stats until `pred` holds (reindex is now non-blocking / 202). */
async function pollStats(
  app: FastifyInstance,
  cwd: string,
  pred: (b: { indexing: boolean; chunks: number; jobStatus: string; lastError?: string }) => boolean,
  tries = 60,
): Promise<{ indexing: boolean; chunks: number; jobStatus: string; lastError?: string }> {
  for (let i = 0; i < tries; i++) {
    const s = await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${encodeURIComponent(cwd)}` });
    const body = s.json();
    if (pred(body)) return body;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("stats never settled");
}

describe("GET /api/kb/stats", () => {
  it("reports empty (indexed:false) for an un-indexed folder", async () => {
    const cwd = makeFolder();
    const { app } = buildApp([cwd]);
    const res = await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${encodeURIComponent(cwd)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.chunks).toBe(0);
    expect(body.indexed).toBe(false);
    expect(body.jobStatus).toBe("idle");
    await app.close();
  });

  it("returns counts after a reindex settles (indexed:true)", async () => {
    const cwd = makeFolder();
    const { app } = buildApp([cwd]);
    await app.inject({ method: "POST", url: `/api/kb/reindex?cwd=${encodeURIComponent(cwd)}` });
    // Reindex is non-blocking (202) — poll until the walk settles.
    const settled = await pollStats(app, cwd, (b) => b.indexing === false && b.chunks > 0);
    expect(settled.chunks).toBeGreaterThan(0);
    await app.close();
  });

  it("rejects an unknown cwd with 403 and opens no store", async () => {
    const known = makeFolder();
    const other = makeFolder();
    const { app } = buildApp([known]);
    const res = await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${encodeURIComponent(other)}` });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  // Fix 1: pins are stored realpath-canonicalized while a session cwd / raw
  // query string may reach the same folder via a symlink; both sides of the
  // guard must canonicalize or the match spuriously fails. See change:
  // fix-kb-worktree-cwd-guard.
  it("admits a known cwd reached through a symlinked alias", async () => {
    const real = realpathSync(makeFolder());
    const alias = join(realpathSync(tmpdir()), `kb-alias-${process.pid}-${Math.random().toString(36).slice(2)}`);
    symlinkSync(real, alias);
    cleanup.push(alias);
    const { app } = buildApp([real]); // known = canonical path
    const res = await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${encodeURIComponent(alias)}` }); // reached via symlink
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  // Fix 2b: a git worktree whose MAIN repo is a known folder is admitted, even
  // with no live session / pin covering the worktree itself (the session-less
  // worktree case from the kb-folder-slot spec).
  it("admits a worktree whose main repo is a known folder", async () => {
    const { main, worktree } = makeRepoWithWorktree();
    const { app } = buildApp([main]); // only the MAIN repo is known
    const res = await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${encodeURIComponent(worktree)}` });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  // A git-internal path is never a legitimate KB root. The `.git`-segment check
  // therefore runs BEFORE the direct known-folder match, so a stray pinned or
  // session cwd of `<repo>/.git` cannot admit itself.
  it("403s a `.git` cwd even when it is itself in the known-folder set", async () => {
    const { main } = makeRepoWithWorktree();
    const gitDir = join(main, ".git");
    const { app } = buildApp([gitDir]); // the git dir IS known — still rejected
    const res = await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${encodeURIComponent(gitDir)}` });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  // `<repo>/.git/..` is NOT a traversal: it denotes `<repo>` itself, which is
  // the known folder. Both the guard and `hasGitPathSegment` normalize, so the
  // segment test sees `<repo>` and the request is admitted — nothing under
  // `.git` is ever served. Pinned so a future "reject the raw string too"
  // change has to justify breaking a legitimate spelling of a known folder.
  it("admits a known folder spelled with a `.git/..` round trip", async () => {
    const known = makeFolder();
    const { app } = buildApp([known]);
    // NOT `join()` — it collapses `..` before the request is ever made.
    const via = `${known}/.git/..`;
    const res = await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${encodeURIComponent(via)}` });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("still 403s a worktree whose main repo is NOT a known folder", async () => {
    const { worktree } = makeRepoWithWorktree(); // main repo left out of known
    const { app } = buildApp([makeFolder()]);
    const res = await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${encodeURIComponent(worktree)}` });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  // ---- checkout-root resolution as the admission anchor -------------------
  // See change: add-git-checkout-root-resolver.

  // E20 — the deliberately permissive breadth of the rule is PRESERVED by the
  // conversion: any descendant of a known repo still resolves to that repo.
  it("E20: admits an ordinary subdirectory of a known repo", async () => {
    const { app } = buildApp([gitFx.normal]);
    const res = await app.inject({
      method: "GET",
      url: `/api/kb/stats?cwd=${encodeURIComponent(gitFx.normalSubdir)}`,
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  // E21 — a submodule is an independent project; it must not inherit its
  // superproject's trust. The superseded derivation produced a
  // `<super>/.git/modules/…` parent, which was denied for the wrong reason.
  it("E21: a submodule does not inherit admission from its superproject", async () => {
    const denied = buildApp([gitFx.superproject]);
    const res = await denied.app.inject({
      method: "GET",
      url: `/api/kb/stats?cwd=${encodeURIComponent(gitFx.submodule)}`,
    });
    expect(res.statusCode).toBe(403);
    await denied.app.close();

    // … and adding the submodule itself as a known folder admits it.
    const allowed = buildApp([gitFx.superproject, gitFx.submodule]);
    const ok = await allowed.app.inject({
      method: "GET",
      url: `/api/kb/stats?cwd=${encodeURIComponent(gitFx.submodule)}`,
    });
    expect(ok.statusCode).toBe(200);
    await allowed.app.close();
  });

  it("admits a worktree of a KNOWN submodule via the submodule checkout", async () => {
    const { app } = buildApp([gitFx.submodule]);
    const res = await app.inject({
      method: "GET",
      url: `/api/kb/stats?cwd=${encodeURIComponent(gitFx.submoduleWorktree)}`,
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  // E22 — a worktree of a bare hub is a linked worktree with NO main checkout.
  // The superseded derivation named the hub's parent directory instead.
  it("E22: a worktree of a bare hub is rejected when not independently known", async () => {
    const { app } = buildApp([dirname(gitFx.bare)]); // the hub's PARENT is known
    const res = await app.inject({
      method: "GET",
      url: `/api/kb/stats?cwd=${encodeURIComponent(gitFx.bareWorktree)}`,
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  // The `--separate-git-dir` over-admission this change closes: the parent of
  // the git dir is a REAL, unrelated directory that may itself be known.
  it("does not admit a --separate-git-dir cwd via the directory holding its git dir", async () => {
    const { app } = buildApp([dirname(gitFx.separateGitDirGitDir)]);
    const res = await app.inject({
      method: "GET",
      url: `/api/kb/stats?cwd=${encodeURIComponent(gitFx.separateGitDir)}`,
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  // E19 — the resolver returns a user-controlled `core.worktree` verbatim, so
  // an AUTHORIZATION consumer must reject it rather than match it.
  it("E19: an implausible resolved main checkout is not used as a trust anchor", async () => {
    const { main, worktree } = makeRepoWithWorktree();
    // Point the repo-local core.worktree at a path inside the git dir, which
    // sits under the known folder `main`. The directory must exist: `git config
    // core.worktree` validates the path at WRITE time (it does not validate it
    // afterwards, which is why the resolver still cannot trust the value).
    const bogus = join(main, ".git", "modules", "x");
    mkdirSync(bogus, { recursive: true });
    git(main, ["--git-dir", join(main, ".git"), "config", "--local", "core.worktree", bogus]);
    const { app } = buildApp([main]);
    const res = await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${encodeURIComponent(worktree)}` });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  // ---- repository BINDING of the resolved main checkout -------------------
  // See change: widen-containment-to-resolved-checkout.

  // A repository-local `core.worktree` is user-controlled and returned VERBATIM
  // by the resolver, so an unknown cwd could name an unrelated KNOWN folder to
  // admit itself. Binding re-resolves the candidate and requires the same common
  // dir, which closes it.
  it("E27: a core.worktree naming an unrelated KNOWN repo does not admit the cwd", async () => {
    const knownRepo = makeRepoWithWorktree().main; // ordinary checkout of a DIFFERENT repo
    const repoA = realpathSync(mkdtempSync(join(tmpdir(), "kb-e27-a-")));
    cleanup.push(repoA);
    git(repoA, ["-c", "init.defaultBranch=main", "init"]);
    git(repoA, ["commit", "--allow-empty", "-m", "init"]);
    const wtA = join(tmpdir(), `kb-e27-wt-${process.pid}-${Math.random().toString(36).slice(2)}`);
    cleanup.push(wtA);
    git(repoA, ["worktree", "add", "-b", "e27", wtA]);
    git(repoA, ["config", "--local", "core.worktree", knownRepo]);

    const { app } = buildApp([knownRepo]); // the worktree itself is NOT known
    const res = await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${encodeURIComponent(wtA)}` });
    expect(res.statusCode).toBe(403);
    // …and no store was opened under the rejected cwd.
    expect(existsSync(join(wtA, ".pi", "dashboard", "kb", "index.db"))).toBe(false);
    await app.close();
  });

  // The honest setups must keep working: binding is a rejection of impostors,
  // not a narrowing of the documented positive cases. (E19 above still 403s.)
  it("E28: honest positives stay admitted", async () => {
    const byWorktree = buildApp([gitFx.normal]);
    expect(
      (
        await byWorktree.app.inject({
          method: "GET",
          url: `/api/kb/stats?cwd=${encodeURIComponent(gitFx.worktree)}`,
        })
      ).statusCode,
    ).toBe(200);
    await byWorktree.app.close();

    const bySubmoduleWorktree = buildApp([gitFx.submodule]);
    expect(
      (
        await bySubmoduleWorktree.app.inject({
          method: "GET",
          url: `/api/kb/stats?cwd=${encodeURIComponent(gitFx.submoduleWorktree)}`,
        })
      ).statusCode,
    ).toBe(200);
    await bySubmoduleWorktree.app.close();

    const bySubdir = buildApp([gitFx.normal]);
    expect(
      (
        await bySubdir.app.inject({
          method: "GET",
          url: `/api/kb/stats?cwd=${encodeURIComponent(gitFx.normalSubdir)}`,
        })
      ).statusCode,
    ).toBe(200);
    await bySubdir.app.close();
  });

  // P1 — the guard resolves synchronously on a request path, so a pathological
  // git must not block past the documented 2 s ceiling. The shim sleeps LONGER
  // than the 200 ms per-probe budget and then EXECUTES the real git: the probes
  // time out, so the guard REJECTS. Executing the real git matters — a shim that
  // merely slept and exited non-zero would be rejected under ANY budget, so the
  // test could not detect the regression. A budget raised to 400 ms (the
  // superseded value) or 2 s would let the probes succeed and ADMIT the
  // worktree, failing the assertion below.
  it.skipIf(process.platform === "win32")("P1: a pathological git is bounded and rejected, never admitted", async () => {
    const { main, worktree } = makeRepoWithWorktree();
    // Control: with a healthy git the worktree is admitted via its main repo.
    expect(isAllowedCwd(worktree, () => [main])).toBe(true);

    // Resolve the REAL git before the shim shadows it on PATH.
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const restore = useGitPath(makeGitShim(`sleep 0.3\nexec "${realGit}" "$@"`));
    try {
      const started = Date.now();
      const allowed = isAllowedCwd(worktree, () => [main]);
      const elapsed = Date.now() - started;
      expect(allowed).toBe(false);
      expect(elapsed).toBeLessThan(2_500);
    } finally {
      restore();
    }
  });

  // E29 — the premise for rejecting an unbound main checkout, MEASURED rather
  // than assumed: an admitted cwd's project config may name sources and a
  // database path OUTSIDE the cwd, so admission is authority over the cwd's
  // subtree only on paper. The cwd here has NO docs/ of its own, so a non-zero
  // chunk count can only come from the outside source.
  it("E29: an admitted cwd reaches OUTSIDE its own subtree (measured, not assumed)", async () => {
    const cwd = makeFolder();
    const outside = mkdtempSync(join(tmpdir(), "kb-e29-outside-"));
    cleanup.push(outside);
    mkdirSync(join(outside, "src"), { recursive: true });
    writeFileSync(join(outside, "src", "far.md"), "# Far\n\nzebrafinch content reachable from outside.\n");
    rmSync(join(cwd, "docs"), { recursive: true, force: true });
    writeFileSync(
      join(cwd, ".pi", "dashboard", "knowledge_base.json"),
      JSON.stringify(
        { sources: [{ kind: "filesystem", ref: join(outside, "src") }], dbPath: join(outside, "kb.db") },
        null,
        2,
      ),
    );

    const { app } = buildApp([cwd]);
    const res = await app.inject({ method: "POST", url: `/api/kb/reindex?cwd=${encodeURIComponent(cwd)}` });
    expect(res.statusCode).toBe(202);
    // The only source is the OUTSIDE directory, so chunks > 0 proves it was read.
    const settled = await pollStats(app, cwd, (b) => b.indexing === false && b.chunks > 0);
    expect(settled.chunks).toBeGreaterThan(0);
    // …and the database was written outside the cwd too.
    expect(existsSync(join(outside, "kb.db"))).toBe(true);
    await app.close();
  });

  it("400 when cwd missing", async () => {
    const { app } = buildApp(["/proj"]);
    const res = await app.inject({ method: "GET", url: `/api/kb/stats` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("counts drifted source files from dox-staleness.json (source drift only)", async () => {
    const cwd = makeFolder();
    // A tracked source file whose acked sha will not match its current content.
    writeFileSync(join(cwd, "src.ts"), "export const x = 1;\n");
    const staleDir = join(cwd, ".pi", "dashboard", "kb");
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(join(staleDir, "dox-staleness.json"), JSON.stringify({ "src.ts": "deadbeef-not-the-real-sha" }));
    const { app } = buildApp([cwd]);
    const res = await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${encodeURIComponent(cwd)}` });
    expect(res.json().staleCount).toBe(1);
    await app.close();
  });

  it("does not flag an acknowledged (matching-sha) source file", async () => {
    const cwd = makeFolder();
    writeFileSync(join(cwd, "src.ts"), "export const x = 1;\n");
    const sha = createHash("sha256").update(readFileSync(join(cwd, "src.ts"))).digest("hex");
    const staleDir = join(cwd, ".pi", "dashboard", "kb");
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(join(staleDir, "dox-staleness.json"), JSON.stringify({ "src.ts": sha }));
    const { app } = buildApp([cwd]);
    const res = await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${encodeURIComponent(cwd)}` });
    expect(res.json().staleCount).toBe(0);
    await app.close();
  });

  it("reads the v2 sidecar ({version, files} with stat baselines) — drifted file still counts (add-kb-trust-verdicts-and-search-guard)", async () => {
    const cwd = makeFolder();
    writeFileSync(join(cwd, "src.ts"), "export const changed = 2;\n");
    const staleDir = join(cwd, ".pi", "dashboard", "kb");
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(
      join(staleDir, "dox-staleness.json"),
      JSON.stringify({ version: 2, files: { "src.ts": { sha256: "deadbeef-not-the-real-sha", size: 20, mtimeMs: 1000 } } }),
    );
    const { app } = buildApp([cwd]);
    const res = await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${encodeURIComponent(cwd)}` });
    expect(res.json().staleCount).toBe(1); // a v2 sidecar must never silently read as zero drift
    await app.close();
  });

  it("a future sidecar version reads as empty, not as false positives", async () => {
    const cwd = makeFolder();
    writeFileSync(join(cwd, "src.ts"), "export const x = 1;\n");
    const staleDir = join(cwd, ".pi", "dashboard", "kb");
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(
      join(staleDir, "dox-staleness.json"),
      JSON.stringify({ version: 3, files: { "src.ts": { sha256: "whatever", size: 1, mtimeMs: 2 } } }),
    );
    const { app } = buildApp([cwd]);
    const res = await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${encodeURIComponent(cwd)}` });
    expect(res.json().staleCount).toBe(0);
    await app.close();
  });
});

describe("POST /api/kb/reindex", () => {
  it("starts non-blocking (202 status:running) and indexes → chunks > 0", async () => {
    // task 1.1: fresh POST returns 202 immediately; poll /stats until settled.
    const cwd = makeFolder();
    const { app } = buildApp([cwd]);
    const res = await app.inject({ method: "POST", url: `/api/kb/reindex?cwd=${encodeURIComponent(cwd)}` });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("running");
    expect(res.json().jobId).toBeTruthy();
    const settled = await pollStats(app, cwd, (b) => b.indexing === false && b.chunks > 0);
    expect(settled.jobStatus).toBe("idle");
    await app.close();
  });

  it("is incremental — a second reindex adds no new chunks (asserted via /stats)", async () => {
    // task 1.4: incremental checked via /stats, not the (now absent) body `changed`.
    const cwd = makeFolder();
    const { app } = buildApp([cwd]);
    await app.inject({ method: "POST", url: `/api/kb/reindex?cwd=${encodeURIComponent(cwd)}` });
    const first = await pollStats(app, cwd, (b) => b.indexing === false && b.chunks > 0);
    await app.inject({ method: "POST", url: `/api/kb/reindex?cwd=${encodeURIComponent(cwd)}` });
    const second = await pollStats(app, cwd, (b) => b.indexing === false);
    expect(second.chunks).toBe(first.chunks);
    await app.close();
  });

  it("a failing walk still responds 202; /stats then reports jobStatus:error", async () => {
    // task 1.2: a source ref pointing at a FILE makes indexSource's walk throw.
    const cwd = makeFolder({ withConfig: false });
    writeFileSync(join(cwd, "notadir.md"), "# x\n");
    mkdirSync(join(cwd, ".pi", "dashboard"), { recursive: true });
    writeFileSync(
      join(cwd, ".pi", "dashboard", "knowledge_base.json"),
      JSON.stringify({ sources: [{ kind: "filesystem", ref: "notadir.md" }] }),
    );
    const { app } = buildApp([cwd]);
    const res = await app.inject({ method: "POST", url: `/api/kb/reindex?cwd=${encodeURIComponent(cwd)}` });
    expect(res.statusCode).toBe(202);
    const settled = await pollStats(app, cwd, (b) => b.indexing === false && b.jobStatus === "error");
    expect(settled.jobStatus).toBe("error");
    expect(settled.lastError).toBeTruthy();
    await app.close();
  });

  it("rejects an unknown cwd", async () => {
    const known = makeFolder();
    const other = makeFolder();
    const { app } = buildApp([known]);
    const res = await app.inject({ method: "POST", url: `/api/kb/reindex?cwd=${encodeURIComponent(other)}` });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("does not block the event loop: /stats observes indexing:true during a large walk", async () => {
    // Regression for the synchronous-walk bug: indexSource now yields + commits
    // per batch, so a concurrent /stats read is served (never 500/locked) AND
    // observes indexing:true before the walk settles. See change: fix-kb-index-feedback.
    const cwd = makeFolder({ withConfig: false });
    mkdirSync(join(cwd, "big"), { recursive: true });
    for (let i = 0; i < 300; i++) {
      writeFileSync(join(cwd, "big", `f${i}.md`), `# Doc ${i}\n\nBody text number ${i} with enough words to survive the tiny-chunk merge threshold here and there.\n`);
    }
    mkdirSync(join(cwd, ".pi", "dashboard"), { recursive: true });
    writeFileSync(
      join(cwd, ".pi", "dashboard", "knowledge_base.json"),
      JSON.stringify({ sources: [{ kind: "filesystem", ref: "big" }] }),
    );
    const { app } = buildApp([cwd]);
    const res = await app.inject({ method: "POST", url: `/api/kb/reindex?cwd=${encodeURIComponent(cwd)}` });
    expect(res.statusCode).toBe(202);

    let sawIndexing = false;
    let settledChunks = 0;
    for (let i = 0; i < 400; i++) {
      const s = await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${encodeURIComponent(cwd)}` });
      expect(s.statusCode).toBe(200); // served mid-walk, never SQLITE_BUSY/500
      const b = s.json();
      if (b.indexing) sawIndexing = true;
      if (!b.indexing && b.chunks > 0) { settledChunks = b.chunks; break; }
      // Yield a macrotask so the walk's setImmediate batch-continuation runs
      // (a tight await-inject loop is all microtasks and would starve it — real
      // /stats polls are 1000ms timers, which never starve it).
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(sawIndexing).toBe(true);
    expect(settledChunks).toBeGreaterThan(0);
    await app.close();
  });
});

describe("GET /api/kb/config", () => {
  it("reports origin=project when a project file exists", async () => {
    const cwd = makeFolder();
    const { app } = buildApp([cwd]);
    const res = await app.inject({ method: "GET", url: `/api/kb/config?cwd=${encodeURIComponent(cwd)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.origin).toBe("project");
    expect(body.config.sources[0].ref).toBe("docs");
    await app.close();
  });

  it("reports a fallback origin when no project file exists", async () => {
    const cwd = makeFolder({ withConfig: false });
    const { app } = buildApp([cwd]);
    const res = await app.inject({ method: "GET", url: `/api/kb/config?cwd=${encodeURIComponent(cwd)}` });
    expect(["global", "defaults"]).toContain(res.json().origin);
    await app.close();
  });
});

describe("PUT /api/kb/config", () => {
  it("persists a valid write and reports origin=project", async () => {
    const cwd = makeFolder();
    const { app } = buildApp([cwd]);
    const res = await app.inject({
      method: "PUT",
      url: `/api/kb/config?cwd=${encodeURIComponent(cwd)}`,
      payload: { sources: [{ kind: "filesystem", ref: "openspec" }] },
    });
    expect(res.statusCode).toBe(200);
    const onDisk = JSON.parse(readFileSync(join(cwd, ".pi", "dashboard", "knowledge_base.json"), "utf8"));
    expect(onDisk.sources[0].ref).toBe("openspec");
    await app.close();
  });

  it("rejects an invalid source with 400 and writes nothing new", async () => {
    const cwd = makeFolder();
    const before = readFileSync(join(cwd, ".pi", "dashboard", "knowledge_base.json"), "utf8");
    const { app } = buildApp([cwd]);
    const res = await app.inject({
      method: "PUT",
      url: `/api/kb/config?cwd=${encodeURIComponent(cwd)}`,
      payload: { sources: [{ kind: "wormhole", ref: "x" }] },
    });
    expect(res.statusCode).toBe(400);
    expect(readFileSync(join(cwd, ".pi", "dashboard", "knowledge_base.json"), "utf8")).toBe(before);
    await app.close();
  });

  it("preserves untouched fields (custom ranking) across a sources edit", async () => {
    const cwd = makeFolder({ extraConfig: { ranking: { fieldWeights: { headingPath: 99, heading: 2, body: 1 }, proximityBoost: false, diversity: { enabled: false, lambda: 0.5 } } } });
    const { app } = buildApp([cwd]);
    await app.inject({
      method: "PUT",
      url: `/api/kb/config?cwd=${encodeURIComponent(cwd)}`,
      payload: { sources: [{ kind: "filesystem", ref: "docs" }] },
    });
    const onDisk = JSON.parse(readFileSync(join(cwd, ".pi", "dashboard", "knowledge_base.json"), "utf8"));
    expect(onDisk.ranking.fieldWeights.headingPath).toBe(99);
    await app.close();
  });

  it("bootstraps a missing project file (origin !== project)", async () => {
    const cwd = makeFolder({ withConfig: false });
    const path = join(cwd, ".pi", "dashboard", "knowledge_base.json");
    expect(existsSync(path)).toBe(false);
    const { app } = buildApp([cwd]);
    const res = await app.inject({
      method: "PUT",
      url: `/api/kb/config?cwd=${encodeURIComponent(cwd)}`,
      payload: { sources: [{ kind: "filesystem", ref: "docs" }] },
    });
    expect(res.statusCode).toBe(200);
    expect(existsSync(path)).toBe(true);
    expect(res.json().origin).toBe("project");
    await app.close();
  });

  it("reflects new sources in the count after a reindex kick", async () => {
    const cwd = makeFolder({ withConfig: false });
    const { app } = buildApp([cwd]);
    await app.inject({
      method: "PUT",
      url: `/api/kb/config?cwd=${encodeURIComponent(cwd)}`,
      payload: { sources: [{ kind: "filesystem", ref: "docs" }], reindex: true },
    });
    // The reindex kick is fire-and-forget; poll stats until it settles.
    let chunks = 0;
    for (let i = 0; i < 20 && chunks === 0; i++) {
      const s = await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${encodeURIComponent(cwd)}` });
      chunks = s.json().chunks;
      if (chunks === 0) await new Promise((r) => setTimeout(r, 25));
    }
    expect(chunks).toBeGreaterThan(0);
    await app.close();
  });
});
