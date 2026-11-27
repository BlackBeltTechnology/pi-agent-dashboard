/**
 * Real-git fixtures of the OpenSpec tests: isolated config (no global / system git config, fixed identity),
 * a tmp repository with a `develop` branch, and an inject that EXECUTES the three git routes with real git
 * (the same `git worktree add` shapes as `packages/server/src/git-worktree/git-operations.ts`) so the
 * worktree flow is exercised end to end without the server package.
 * See change: add-agent-teams-openspec.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { InjectFn, InjectRequest } from "../inject.js";
import { tmp } from "./env.js";

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
  GIT_TERMINAL_PROMPT: "0",
};

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** A repo whose only branch is `branch` (default `develop`), with one commit. Returns its real path. */
export function makeRepo(prefix = "at-os-git-", branch = "develop"): string {
  const repo = tmp(prefix);
  git(repo, "init", "-q", "-b", branch);
  fs.writeFileSync(path.join(repo, "README.md"), "x\n");
  git(repo, "add", "README.md");
  git(repo, "commit", "-q", "-m", "init");
  return repo;
}

export interface RouteLog {
  calls: InjectRequest[];
}

/** A route answer in the flat shape the tests write; `failure: "transport"` makes the inject reject. */
export interface InjectResponse {
  status: number;
  json: unknown;
  failure?: "aborted" | "transport";
}

const toInject =
  (handle: (req: InjectRequest) => InjectResponse | Promise<InjectResponse>): InjectFn =>
  async (req) => {
    const res = await handle(req);
    if (res.failure === "transport") throw new Error("transport");
    return { statusCode: res.status, body: res.json };
  };

/** An inject executing the git routes against real git. `faults` may answer a call instead. */
export function realGitInject(repo: string, faults?: (req: InjectRequest, n: number) => InjectResponse | undefined): { inject: InjectFn; log: RouteLog } {
  const log: RouteLog = { calls: [] };
  const handle = async (req: InjectRequest): Promise<InjectResponse> => {
    log.calls.push(req);
    const fault = faults?.(req, log.calls.length);
    if (fault) return fault;
    const body = (req.payload ?? {}) as { cwd?: string; base?: string; newBranch?: string; path?: string };
    if (req.url === "/api/git/worktree") {
      const target = body.path as string;
      if (fs.existsSync(target) && fs.readdirSync(target).length > 0) return { status: 409, json: { success: false, code: "path_exists" } };
      const args = ["worktree", "add"];
      if (body.newBranch) args.push("-b", body.newBranch, target, body.base as string);
      else args.push(target, body.base?.startsWith("origin/") ? body.base.slice("origin/".length) : (body.base as string));
      try {
        git(body.cwd as string, ...args);
      } catch (err) {
        return { status: 500, json: { success: false, code: "git_failed", error: String((err as Error).message).slice(0, 80) } };
      }
      return { status: 200, json: { success: true, data: { path: target, branch: body.newBranch ?? body.base } } };
    }
    if (req.url === "/api/git/worktree/orphan-cleanup") {
      const registered = git(body.cwd as string, "worktree", "list", "--porcelain");
      if (registered.split("\n").some((l) => l === `worktree ${body.path}`)) return { status: 409, json: { success: false, code: "not_orphan" } };
      fs.rmSync(body.path as string, { recursive: true, force: true });
      return { status: 200, json: { success: true } };
    }
    if (req.url === "/api/git/worktree/init") return { status: 200, json: { success: true, data: { ran: false, skippedReason: "no_hook" } } };
    return { status: 404, json: { success: false } };
  };
  return { inject: toInject(handle), log };
}

/** An inject answering from a function, recording calls. */
export function scriptedInject(answer: (req: InjectRequest, n: number) => InjectResponse | Promise<InjectResponse>): { inject: InjectFn; log: RouteLog } {
  const log: RouteLog = { calls: [] };
  return {
    log,
    inject: toInject(async (req) => {
      log.calls.push(req);
      return answer(req, log.calls.length);
    }),
  };
}

/** `git init` (branch `develop`, one commit) inside an existing directory. */
export function initRepoAt(dir: string): string {
  git(dir, "init", "-q", "-b", "develop");
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  git(dir, "add", "README.md");
  git(dir, "commit", "-q", "-m", "init");
  return fs.realpathSync(dir);
}

export interface GroupFixture {
  /** Default: one group `g` named `G`. */
  groups?: Array<{ id: string; name: string }>;
  /** change → group id. */
  assignments: Record<string, string>;
  changeOrder?: Record<string, string[]>;
  /** Active change directories → their `dependencies.yaml` text (`undefined` = no file). */
  changes: Record<string, string | undefined>;
  /** Archived change directory names (`YYYY-MM-DD-<change>`). */
  archive?: string[];
}

/** `openspec/groups/groups.json` + change directories (+ `dependencies.yaml`) under `repo`. */
export function writeGroupFiles(repo: string, fx: GroupFixture): void {
  const groups = fx.groups ?? [{ id: "g", name: "G" }];
  fs.mkdirSync(path.join(repo, "openspec", "groups"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "openspec", "groups", "groups.json"),
    JSON.stringify({ schemaVersion: 1, groups: groups.map((g, i) => ({ ...g, order: i })), assignments: fx.assignments, ...(fx.changeOrder ? { changeOrder: fx.changeOrder } : {}) }),
  );
  for (const [change, deps] of Object.entries(fx.changes)) {
    const dir = path.join(repo, "openspec", "changes", change);
    fs.mkdirSync(dir, { recursive: true });
    if (deps !== undefined) fs.writeFileSync(path.join(dir, "dependencies.yaml"), deps);
  }
  for (const a of fx.archive ?? []) fs.mkdirSync(path.join(repo, "openspec", "changes", "archive", a), { recursive: true });
}

/** `blocked_by: [..]` YAML. */
export const blockedBy = (...names: string[]): string => `blocked_by:\n${names.map((n) => `  - ${n}`).join("\n")}\n`;
