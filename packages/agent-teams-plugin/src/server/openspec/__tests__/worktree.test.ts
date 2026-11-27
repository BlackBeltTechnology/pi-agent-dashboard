/**
 * `ensureWorktree` (task 3.3; tests 8.11 #X4, 8.12 #D5, 8.13 #S4, 8.14 #S13): every git-route fault maps to
 * its exact code, a crash leftover is reused or cleaned up once (real git), no untrusted value reaches an
 * argv, and a path that is not `<repo>/.worktrees/os-<change>` (by realpath) is never used.
 * See change: add-agent-teams-openspec.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GitRunner } from "../git.js";
import type { OpenspecApi } from "../profiles.js";
import { ensureWorktree } from "../worktree.js";
import { tmp } from "./env.js";
import { git, type InjectResponse, makeRepo, realGitInject, scriptedInject } from "./git-env.js";

const withInject = (inject: OpenspecApi["inject"]): Pick<OpenspecApi, "inject"> => ({ inject });
const ok = (data: unknown): InjectResponse => ({ status: 200, json: { success: true, data } });
const err = (status: number, code?: string, extra: Record<string, unknown> = {}): InjectResponse => ({ status, json: { success: false, ...(code ? { code } : {}), ...extra } });

/** A route answering success with the explicit path it was given. */
const created = (req: { url: string; payload?: unknown }): InjectResponse => {
  if (req.url !== "/api/git/worktree") return ok({ ran: false });
  const target = (req.payload as { path: string }).path;
  fs.mkdirSync(target, { recursive: true });
  return ok({ path: target, branch: "x" });
};

describe("each git fault is a typed failure (8.11 #X4)", () => {
  const faults: Array<[string, (req: { url: string; payload?: unknown }, n: number) => InjectResponse | Promise<InjectResponse>, string]> = [
    ["git_failed (500)", (r) => (r.url === "/api/git/worktree" ? err(500, "git_failed") : ok({})), "git_failed"],
    ["409 branch_in_use", (r) => (r.url === "/api/git/worktree" ? err(409, "branch_in_use") : ok({})), "branch_in_use"],
    ["409 branch_exists", (r) => (r.url === "/api/git/worktree" ? err(409, "branch_exists") : ok({})), "branch_exists"],
    ["not a repo (400)", (r) => (r.url === "/api/git/worktree" ? err(400, "not_a_repo") : ok({})), "not_a_repo"],
    ["a 500 without a code", (r) => (r.url === "/api/git/worktree" ? { status: 500, json: { success: false } } : ok({})), "git_failed"],
    ["a 500 with a hostile code", (r) => (r.url === "/api/git/worktree" ? err(500, "Bad Code\n--x") : ok({})), "git_failed"],
    ["malformed JSON", (r) => (r.url === "/api/git/worktree" ? { status: 200, json: undefined } : ok({})), "worktree_path_unexpected"],
    ["HTTP 200 with success:false", (r) => (r.url === "/api/git/worktree" ? { status: 200, json: { success: false, code: "git_failed" } } : ok({})), "git_failed"],
    ["403 network_not_allowed", (r) => (r.url === "/api/git/worktree" ? { status: 403, json: { success: false, error: "network_not_allowed" } } : ok({})), "network_not_allowed"],
    ["403 local_proof_required (strict requireLocalProof default)", (r) => (r.url === "/api/git/worktree" ? { status: 403, json: { success: false, error: "network_not_allowed", reason: "local_proof_required" } } : ok({})), "local_proof_required"],
    ["transport failure", () => ({ status: 0, json: undefined, failure: "transport" as const }), "inject_failed"],
    ["init_untrusted", (r) => (r.url === "/api/git/worktree/init" ? err(200, "init_untrusted", { data: { hash: "h" } }) : created(r)), "init_untrusted"],
    ["init failed (500)", (r) => (r.url === "/api/git/worktree/init" ? err(500, "init_failed") : created(r)), "init_failed"],
  ];

  it.each(faults)("%s → %s, nothing else is called after a failed create", async (_name, answer, code) => {
    const repo = makeRepo();
    const { inject, log } = scriptedInject(answer);
    const res = await ensureWorktree(withInject(inject), { repo, change: "fix-x", base: "develop" });
    expect(res).toMatchObject({ ok: false, code });
    if (code !== "init_untrusted" && code !== "init_failed" && code !== "worktree_path_unexpected") expect(log.calls.map((c) => c.url)).toEqual(["/api/git/worktree"]);
  });

  it("path_exists: orphan-cleanup is called exactly once, then the create is retried once (ok)", async () => {
    const repo = makeRepo();
    let creates = 0;
    const { inject, log } = scriptedInject((r) => {
      if (r.url === "/api/git/worktree") return ++creates === 1 ? err(409, "path_exists") : created(r);
      return ok({});
    });
    const res = await ensureWorktree(withInject(inject), { repo, change: "fix-x", base: "develop" });
    expect(res).toMatchObject({ ok: true, path: path.join(repo, ".worktrees", "os-fix-x") });
    expect(log.calls.map((c) => c.url)).toEqual(["/api/git/worktree", "/api/git/worktree/orphan-cleanup", "/api/git/worktree", "/api/git/worktree/init"]);
    expect((log.calls[1]?.payload as { path: string }).path).toBe(path.join(repo, ".worktrees", "os-fix-x"));
  });

  it("path_exists after the cleanup → path_exists, never a second cleanup", async () => {
    const repo = makeRepo();
    const { inject, log } = scriptedInject((r) => (r.url === "/api/git/worktree" ? err(409, "path_exists") : ok({})));
    expect(await ensureWorktree(withInject(inject), { repo, change: "fix-x", base: "develop" })).toMatchObject({ ok: false, code: "path_exists" });
    expect(log.calls.filter((c) => c.url.endsWith("orphan-cleanup"))).toHaveLength(1);
    expect(log.calls.filter((c) => c.url === "/api/git/worktree")).toHaveLength(2);
  });

  it("a refused cleanup is the failure, with no second create", async () => {
    const repo = makeRepo();
    const { inject, log } = scriptedInject((r) => (r.url === "/api/git/worktree" ? err(409, "path_exists") : err(409, "not_orphan")));
    expect(await ensureWorktree(withInject(inject), { repo, change: "fix-x", base: "develop" })).toMatchObject({ ok: false, code: "not_orphan" });
    expect(log.calls.filter((c) => c.url === "/api/git/worktree")).toHaveLength(1);
  });

  it("a hanging route: aborting the signal settles with `aborted`; a late success is ignored", async () => {
    const repo = makeRepo();
    const ac = new AbortController();
    let release: (r: InjectResponse) => void = () => {};
    const { inject } = scriptedInject(
      () =>
        new Promise<InjectResponse>((resolve) => {
          release = resolve;
        }),
    );
    const pending = ensureWorktree(withInject(inject), { repo, change: "fix-x", base: "develop", signal: ac.signal });
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    expect(await pending).toMatchObject({ ok: false, code: "aborted" });
    release(ok({ path: path.join(repo, ".worktrees", "os-fix-x") })); // late success: nothing consumes it
  });

  it("an already aborted signal makes no route call", async () => {
    const repo = makeRepo();
    const ac = new AbortController();
    ac.abort();
    const { inject, log } = scriptedInject((r) => created(r));
    expect(await ensureWorktree(withInject(inject), { repo, change: "fix-x", base: "develop", signal: ac.signal })).toMatchObject({ ok: false, code: "aborted" });
    expect(log.calls).toEqual([]);
  });

  it("no inject (host without fastify) is a typed failure, not a throw", async () => {
    expect(await ensureWorktree({}, { repo: makeRepo(), change: "fix-x", base: "develop" })).toMatchObject({ ok: false, code: "inject_unavailable" });
  });
});

describe("real git: create, checkout, reuse, crash leftovers (8.12 #D5)", () => {
  it("forks os/<change> from the base at <repo>/.worktrees/os-<change> and runs init", async () => {
    const repo = makeRepo();
    const { inject, log } = realGitInject(repo);
    const res = await ensureWorktree(withInject(inject), { repo, change: "fix-x", base: "develop" });
    expect(res).toEqual({ ok: true, path: path.join(repo, ".worktrees", "os-fix-x"), branch: "os/fix-x" });
    expect(git(repo, "rev-parse", "--abbrev-ref", "os/fix-x")).toBe("os/fix-x");
    expect(log.calls.map((c) => c.url)).toEqual(["/api/git/worktree", "/api/git/worktree/init"]);
    expect(log.calls[0]?.payload).toMatchObject({ cwd: repo, base: "develop", newBranch: "os/fix-x", path: path.join(repo, ".worktrees", "os-fix-x") });
  });

  it("an existing local branch is checked out, not forked", async () => {
    const repo = makeRepo();
    git(repo, "branch", "os/fix-x");
    const { inject, log } = realGitInject(repo);
    expect(await ensureWorktree(withInject(inject), { repo, change: "fix-x", base: "develop" })).toMatchObject({ ok: true });
    expect(log.calls[0]?.payload).toMatchObject({ base: "os/fix-x" });
    expect(log.calls[0]?.payload).not.toHaveProperty("newBranch");
  });

  it("an origin-only branch is checked out through origin/<branch>", async () => {
    const origin = makeRepo("at-os-origin-");
    git(origin, "branch", "os/fix-x");
    const repo = tmp("at-os-clone-");
    git(repo, "clone", "-q", origin, ".");
    const { inject, log } = realGitInject(repo);
    expect(await ensureWorktree(withInject(inject), { repo, change: "fix-x", base: "develop" })).toMatchObject({ ok: true });
    expect(log.calls[0]?.payload).toMatchObject({ base: "origin/os/fix-x" });
  });

  it("forks from origin/<base> when the base has no local branch", async () => {
    const origin = makeRepo("at-os-origin-");
    const repo = tmp("at-os-clone2-");
    git(repo, "clone", "-q", origin, ".");
    git(repo, "checkout", "-q", "-b", "other");
    git(repo, "branch", "-D", "develop");
    const { inject, log } = realGitInject(repo);
    expect(await ensureWorktree(withInject(inject), { repo, change: "fix-x", base: "develop" })).toMatchObject({ ok: true });
    expect(log.calls[0]?.payload).toMatchObject({ base: "origin/develop", newBranch: "os/fix-x" });
  });

  it("crash after the worktree, before the spawn: the relaunch reuses it (no refork, no create call)", async () => {
    const repo = makeRepo();
    const first = realGitInject(repo);
    expect(await ensureWorktree(withInject(first.inject), { repo, change: "fix-x", base: "develop" })).toMatchObject({ ok: true });
    const second = realGitInject(repo);
    const res = await ensureWorktree(withInject(second.inject), { repo, change: "fix-x", base: "develop" });
    expect(res).toMatchObject({ ok: true, path: path.join(repo, ".worktrees", "os-fix-x") });
    expect(second.log.calls.map((c) => c.url)).toEqual(["/api/git/worktree/init"]);
  });

  it("a registered worktree on another branch is refused (never reused)", async () => {
    const repo = makeRepo();
    const first = realGitInject(repo);
    await ensureWorktree(withInject(first.inject), { repo, change: "fix-x", base: "develop" });
    git(path.join(repo, ".worktrees", "os-fix-x"), "checkout", "-q", "-b", "elsewhere");
    expect(await ensureWorktree(withInject(realGitInject(repo).inject), { repo, change: "fix-x", base: "develop" })).toMatchObject({ ok: false, code: "worktree_branch_mismatch" });
  });

  it("a half-created directory without .git is cleaned up by ONE orphan-cleanup retry", async () => {
    const repo = makeRepo();
    const half = path.join(repo, ".worktrees", "os-fix-x");
    fs.mkdirSync(half, { recursive: true });
    fs.writeFileSync(path.join(half, "junk"), "x");
    const { inject, log } = realGitInject(repo);
    const res = await ensureWorktree(withInject(inject), { repo, change: "fix-x", base: "develop" });
    expect(res).toMatchObject({ ok: true, path: half });
    expect(log.calls.map((c) => c.url)).toEqual(["/api/git/worktree", "/api/git/worktree/orphan-cleanup", "/api/git/worktree", "/api/git/worktree/init"]);
    expect(fs.existsSync(path.join(half, ".git"))).toBe(true);
  });
});

describe("git argument injection (8.13 #S4)", () => {
  const evil = ["--upload-pack=x", "-x", "a..b", "x y", "@{-1}", "HEAD", "x.lock", "x/", "a\nb", "A", "a--b", "", "../x", "x/../y"];

  it.each(evil)("change %j is refused before any git or route call", async (change) => {
    const repo = makeRepo();
    const calls: string[] = [];
    const git: GitRunner = async (_c, args) => (calls.push(args.join(" ")), { ok: true, stdout: "", stderr: "" });
    const { inject, log } = scriptedInject(() => ok({}));
    const res = await ensureWorktree(withInject(inject), { repo, change, base: "develop" }, { git });
    expect(res).toMatchObject({ ok: false, code: "invalid_args" });
    expect(calls).toEqual([]);
    expect(log.calls).toEqual([]);
  });

  const badBases = ["--upload-pack=x", "-x", "a..b", "x y", "@{-1}", "x.lock", "x/", "a\nb", ""];
  it.each(badBases)("base %j is invalid_config before any git or route call", async (base) => {
    const repo = makeRepo();
    const calls: string[] = [];
    const git: GitRunner = async (_c, args) => (calls.push(args.join(" ")), { ok: true, stdout: "", stderr: "" });
    const { inject, log } = scriptedInject(() => ok({}));
    expect(await ensureWorktree(withInject(inject), { repo, change: "fix-x", base }, { git })).toMatchObject({ ok: false, code: "invalid_config" });
    expect(calls).toEqual([]);
    expect(log.calls).toEqual([]);
  });

  it("a relative or control-character repo is refused", async () => {
    const { inject, log } = scriptedInject(() => ok({}));
    for (const repo of ["rel/path", "/tmp/a\nb"]) expect(await ensureWorktree(withInject(inject), { repo, change: "fix-x", base: "develop" })).toMatchObject({ ok: false, code: "invalid_args" });
    expect(log.calls).toEqual([]);
  });

  it("with valid input every argv element starting with - is a literal flag, refs sit behind --, and the path is explicit", async () => {
    const repo = makeRepo();
    const seen: string[][] = [];
    const recording: GitRunner = async (cwd, args, opts) => {
      seen.push([...args]);
      const { runGit } = await import("../git.js");
      return runGit(cwd, args, opts);
    };
    const { inject, log } = scriptedInject((r) => created(r));
    await ensureWorktree(withInject(inject), { repo, change: "fix-x", base: "develop" }, { git: recording });
    const literalFlags = new Set(["--porcelain", "--short", "-q", "--verify", "--quiet", "--no-tags", "--"]);
    for (const argv of seen) for (const el of argv) if (el.startsWith("-")) expect(literalFlags.has(el), el).toBe(true);
    const fetch = seen.find((a) => a[0] === "fetch");
    expect(fetch).toEqual(["fetch", "--no-tags", "--", "origin", "os/fix-x"]);
    expect((log.calls[0]?.payload as { path: string }).path).toBe(path.join(repo, ".worktrees", "os-fix-x"));
    for (const c of log.calls) for (const v of Object.values((c.payload ?? {}) as Record<string, string>)) expect(v.startsWith("-")).toBe(false);
  });
});

describe("path escape (8.14 #S13)", () => {
  it("a symlinked .worktrees is refused before any route call", async () => {
    const repo = makeRepo();
    const other = tmp("at-os-elsewhere-");
    fs.symlinkSync(other, path.join(repo, ".worktrees"));
    const { inject, log } = scriptedInject((r) => created(r));
    expect(await ensureWorktree(withInject(inject), { repo, change: "x", base: "develop" })).toMatchObject({ ok: false, code: "worktree_path_unexpected" });
    expect(log.calls).toEqual([]);
  });

  it("a symlinked worktree path is refused", async () => {
    const repo = makeRepo();
    fs.mkdirSync(path.join(repo, ".worktrees"));
    fs.symlinkSync(tmp("at-os-elsewhere-"), path.join(repo, ".worktrees", "os-x"));
    const { inject, log } = scriptedInject((r) => created(r));
    expect(await ensureWorktree(withInject(inject), { repo, change: "x", base: "develop" })).toMatchObject({ ok: false, code: "worktree_path_unexpected" });
    expect(log.calls).toEqual([]);
  });

  const returned: Array<[string, (repo: string) => string]> = [
    ["another basename (os-x-evil)", (repo) => path.join(repo, ".worktrees", "os-x-evil")],
    ["the lead cwd itself", (repo) => repo],
    ["a path outside .worktrees", () => os.tmpdir()],
    ["a path through .. segments", (repo) => path.join(repo, ".worktrees", "..", "os-x")],
    ["a relative path", () => "os-x"],
  ];
  it.each(returned)("the route returns %s → worktree_path_unexpected, no init call", async (_n, pick) => {
    const repo = makeRepo();
    fs.mkdirSync(path.join(repo, ".worktrees", "os-x-evil"), { recursive: true });
    const { inject, log } = scriptedInject((r) => (r.url === "/api/git/worktree" ? ok({ path: pick(repo), branch: "os/x" }) : ok({})));
    expect(await ensureWorktree(withInject(inject), { repo, change: "x", base: "develop" })).toMatchObject({ ok: false, code: "worktree_path_unexpected" });
    expect(log.calls.some((c) => c.url.endsWith("/init"))).toBe(false);
  });

  it("a returned path that is a symlink escaping .worktrees is refused (realpath on both sides)", async () => {
    const repo = makeRepo();
    const elsewhere = tmp("at-os-elsewhere-");
    fs.mkdirSync(path.join(repo, ".worktrees"));
    const { inject } = scriptedInject((r) => {
      if (r.url !== "/api/git/worktree") return ok({});
      fs.symlinkSync(elsewhere, path.join(repo, ".worktrees", "os-x"));
      return ok({ path: path.join(repo, ".worktrees", "os-x") });
    });
    expect(await ensureWorktree(withInject(inject), { repo, change: "x", base: "develop" })).toMatchObject({ ok: false, code: "worktree_path_unexpected" });
  });

  it("a repo reached through a symlink resolves to the real path (compared by realpath)", async () => {
    const repo = makeRepo();
    const link = path.join(tmp("at-os-link-"), "repo-link");
    fs.symlinkSync(repo, link);
    const { inject } = realGitInject(repo);
    expect(await ensureWorktree(withInject(inject), { repo: link, change: "x", base: "develop" })).toMatchObject({ ok: true, path: path.join(repo, ".worktrees", "os-x") });
  });
});
