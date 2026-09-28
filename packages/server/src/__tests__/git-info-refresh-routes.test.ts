/**
 * `git_info_refresh` fan-out after worktree Push / Open PR (test-plan #E19).
 *
 * Targeting is realpath-normalized containment: the worktree root, a
 * subdirectory and a symlink to the root match; a sibling prefix (`xy`) and
 * the main checkout do not. Push ok → refresh; push failure and Merge (local,
 * no GitHub change) → none.
 *
 * See change: redesign-composer-session-strip (D5).
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeRealpathSync } from "../resolve-path.js";
import { registerGitRoutes } from "../routes/git-routes.js";
import { activeSessionsUnderResolved } from "../session/active-sessions-in-cwd.js";

const git = (cmd: string, cwd: string) => execSync(`git ${cmd}`, { cwd, stdio: ["pipe", "pipe", "pipe"] });

describe("activeSessionsUnderResolved — targeting (#E19)", () => {
  const realpath = (p: string) => (p === "/tmp/wt" ? "/r/.worktrees/x" : p);
  const sessions = [
    { id: "root", cwd: "/r/.worktrees/x", status: "idle" as const },
    { id: "sub", cwd: "/r/.worktrees/x/packages/c", status: "streaming" as const },
    { id: "prefix", cwd: "/r/.worktrees/xy", status: "idle" as const },
    { id: "main", cwd: "/r", status: "idle" as const },
    { id: "link", cwd: "/tmp/wt", status: "idle" as const },
    { id: "ended", cwd: "/r/.worktrees/x", status: "ended" as const },
  ];

  it("matches root, subdir and symlink; not a sibling prefix, the main checkout, or ended sessions", () => {
    expect(activeSessionsUnderResolved("/r/.worktrees/x", sessions, realpath, "linux").sort()).toEqual(["link", "root", "sub"]);
  });

  it("a symlinked worktree root resolves too", () => {
    expect(activeSessionsUnderResolved("/tmp/wt", sessions, realpath, "linux").sort()).toEqual(["link", "root", "sub"]);
  });
});

describe("worktree routes → git_info_refresh (#E19)", () => {
  let app: FastifyInstance;
  let root: string;
  let main: string;
  let wt: string;
  let link: string;
  const sendToSession = vi.fn(() => true);

  beforeEach(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "git-refresh-")));
    const origin = join(root, "origin.git");
    main = join(root, "main");
    wt = join(main, ".worktrees", "x");
    git(`-c init.defaultBranch=main init --bare ${origin}`, root);
    mkdirSync(main);
    git("-c init.defaultBranch=main init", main);
    git("config user.email t@t.com", main);
    git("config user.name T", main);
    writeFileSync(join(main, "README.md"), "init");
    git("add .", main);
    git("commit -m init", main);
    git(`remote add origin ${origin}`, main);
    writeFileSync(join(main, ".git", "info", "exclude"), ".worktrees/\n");
    git(`worktree add -b os/x ${wt}`, main);
    git("config user.email t@t.com", wt);
    git("config user.name T", wt);
    writeFileSync(join(wt, "f.txt"), "x");
    git("add .", wt);
    git("commit -m x", wt);
    mkdirSync(join(wt, "packages", "c"), { recursive: true });
    link = join(root, "wt-link");
    symlinkSync(wt, link);

    const sessions = [
      { id: "root", cwd: wt, status: "idle" },
      { id: "sub", cwd: join(wt, "packages", "c"), status: "idle" },
      { id: "link", cwd: link, status: "idle" },
      { id: "main", cwd: main, status: "idle" },
    ];
    sendToSession.mockClear();
    app = Fastify({ logger: false });
    registerGitRoutes(app, {
      networkGuard: async () => {},
      sessionManager: { listAll: () => sessions } as any,
      sendToSession,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  const targets = () => sendToSession.mock.calls.map((c: any[]) => c[0]).sort();

  it("push ok → refresh {reason:push} to root, subdir and symlink only", async () => {
    const res = await app.inject({ method: "POST", url: "/api/git/worktree/push", payload: { cwd: wt } });
    expect(res.json().success).toBe(true);
    expect(targets()).toEqual(["link", "root", "sub"]);
    expect(sendToSession).toHaveBeenCalledWith("root", { type: "git_info_refresh", reason: "push" });
  });

  it("push failure → no refresh", async () => {
    git("remote remove origin", main);
    const res = await app.inject({ method: "POST", url: "/api/git/worktree/push", payload: { cwd: wt } });
    expect(res.json().success).toBe(false);
    expect(sendToSession).not.toHaveBeenCalled();
  });

  it("merge ok → no refresh (local merge changes no GitHub state)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/git/worktree/merge", payload: { cwd: wt } });
    expect(res.json()).toMatchObject({ success: true });
    expect(sendToSession).not.toHaveBeenCalled();
  });

  it("safeRealpathSync resolves the symlinked session cwd onto the worktree", () => {
    expect(safeRealpathSync(link)).toBe(wt);
  });
});
