/**
 * B20 — every outbound git error string is redacted AFTER mapping and against the operation's root.
 * Route-level scenarios SE14–SE17 and SX9 (test-plan).
 *
 * See change: harden-git-terminal-plugin-boundaries.
 */

import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gitOps from "../git-worktree/git-operations.js";
import * as worktreeInit from "../git-worktree/worktree-init.js";
import { hookDefHash } from "../git-worktree/worktree-init.js";
import * as initErrors from "../git-worktree/worktree-init-errors.js";
import { registerGitRoutes } from "../routes/git-routes.js";

const KNOWN: string[] = [];
const known = <T extends string>(p: T): T => {
  KNOWN.push(p);
  return p;
};

function git(cmd: string, cwd: string): string {
  return execSync(`git ${cmd}`, { cwd, stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" });
}

function makeRepo(): string {
  const dir = known(realpathSync(mkdtempSync(join(tmpdir(), "git-redact-"))));
  git("-c init.defaultBranch=main init", dir);
  git("config user.email test@test.com", dir);
  git("config user.name Test", dir);
  writeFileSync(join(dir, "README.md"), "init");
  git("add .", dir);
  git("commit -m init", dir);
  return dir;
}

const CANARY = `/home/u/.ssh/canary https://u:p@h/x ghp_${"aB3".repeat(12)}`;

/** True iff the serialized payload still carries any part of the canary. */
function leaks(payload: unknown): string[] {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  const found: string[] = [];
  if (text.includes(".ssh/canary")) found.push(".ssh/canary");
  if (text.includes("u:p@")) found.push("u:p@");
  if (/ghp_[A-Za-z0-9]/.test(text)) found.push("ghp_<token>");
  return found;
}

let app: FastifyInstance;
let repo: string;
let sent: Array<{ via: "send" | "sendCwd"; msg: any }>;
beforeEach(async () => {
  sent = [];
  const worktreeInitRegistry = {
    startRun: vi.fn(),
    progressRun: vi.fn(),
    finishRun: vi.fn(),
    getActiveRuns: () => [],
    send: (_id: string, msg: any) => sent.push({ via: "send", msg }),
    sendCwd: (_cwd: string, msg: any) => sent.push({ via: "sendCwd", msg }),
  };
  app = Fastify({ logger: false });
  registerGitRoutes(app, { networkGuard: async () => {}, knownCwds: () => KNOWN, worktreeInitRegistry: worktreeInitRegistry as any });
  await app.ready();
  repo = makeRepo();
});
afterEach(async () => {
  vi.restoreAllMocks();
  rmSync(repo, { recursive: true, force: true });
  await app.close();
});

const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, payload: payload as any });
const get = (url: string) => app.inject({ method: "GET", url });

/** A linked worktree known to admission (a removable checkout). */
function linkedWorktree(): string {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "git-redact-wt-")));
  const wt = join(parent, "wt");
  git(`worktree add -b redact-${Date.now()} '${wt}'`, repo);
  return known(realpathSync(wt));
}

describe("SE14 — hook output stays readable", () => {
  it("a commit hook's diagnostics (no paths / secrets) come back byte-for-byte", async () => {
    const text = "husky - pre-commit hook exited with code 1 (error)\nlint: 3 problems\n✖ unicode ok";
    const hook = join(repo, ".git", "hooks", "pre-commit");
    mkdirSync(join(repo, ".git", "hooks"), { recursive: true });
    writeFileSync(hook, `#!/bin/sh\nprintf '%s' '${text}' 1>&2\nexit 1\n`);
    chmodSync(hook, 0o755);
    writeFileSync(join(repo, "a.txt"), "a");
    const res = await post("/api/git/commit", { cwd: repo, message: "m", files: ["a.txt"] });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe("commit-failed");
    expect(body.error).toBe(text);
  });
});

describe("SE15 — worktree init failure: hint and stderr redacted after mapping, in REST and WS", () => {
  const hookDef = { gate: "test ! -d node_modules", run: { type: "script" as const, command: ":" } };
  const outside = (name: string) => join(`${repo}-sibling`, name);

  function initRepo(): void {
    mkdirSync(join(repo, ".pi"), { recursive: true });
    writeFileSync(join(repo, ".pi", "settings.json"), JSON.stringify({ worktreeInit: hookDef }));
  }

  it.each([
    ["path-only", () => `error writing ${outside("x.ts")}`, "<path>"],
    ["credential-only", () => "clone https://u:p@h/x failed", "https://h/x"],
    ["neither", () => "plain failure output", "plain failure output"],
  ] as const)("stderr %s × hint with/without an absolute path", async (_label, mkStderr, redactedFragment) => {
    initRepo();
    const rawStderr = mkStderr();
    for (const hintHasPath of [true, false]) {
      sent.length = 0;
      vi.restoreAllMocks();
      vi.spyOn(worktreeInit, "runInitHook").mockResolvedValue({ ok: false, code: "init_failed", stderr: rawStderr } as any);
      const rawHint = hintHasPath ? `Check ${join(repo, "node_modules")} and ${outside("y.ts")}` : "Install dependencies first";
      const mapper = vi.spyOn(initErrors, "mapInitStderrToHint").mockReturnValue(rawHint);
      const res = await post("/api/git/worktree/init", { cwd: repo, confirmHash: hookDefHash(hookDef) });
      expect(res.statusCode).toBe(500);
      const body = res.json();
      // The mapper sees the RAW text.
      expect(mapper).toHaveBeenCalledWith(rawStderr);
      // REST and WS carry the same redacted text.
      const ws = sent.find((s) => s.msg.type === "worktree_init_failed")?.msg;
      expect(ws).toBeTruthy();
      expect(body.stderr).toBe(ws.stderr);
      expect(body.error).toBe(ws.message);
      expect(body.stderr).toContain(redactedFragment);
      expect(body.stderr).not.toContain("u:p@");
      expect(body.stderr).not.toContain(`${repo}-sibling`);
      if (hintHasPath) {
        expect(body.error).toBe(`Check node_modules and <path>`);
      } else {
        expect(body.error).toBe("Install dependencies first");
      }
      if (_label === "neither") expect(body.stderr).toBe(rawStderr);
    }
  });
});

describe("SE16 — redaction root is the operation's own checkout, captured at operation time", () => {
  it("worktree op failure: stderr names <worktree>/x.ts → x.ts (not absolute, not proj-wt/x.ts)", async () => {
    const wt = linkedWorktree();
    vi.spyOn(gitOps, "removeWorktree").mockReturnValue({ ok: false, code: "git_failed", stderr: `fatal: ${wt}/x.ts is locked` } as any);
    const res = await post("/api/git/worktree/remove", { cwd: wt });
    expect(res.json().stderr).toBe("fatal: x.ts is locked");
  });

  it("variant: worktree directory removed during the operation → still x.ts", async () => {
    const wt = linkedWorktree();
    vi.spyOn(gitOps, "removeWorktree").mockImplementation((() => {
      rmSync(wt, { recursive: true, force: true });
      return { ok: false, code: "git_failed", stderr: `fatal: ${wt}/x.ts is locked` };
    }) as any);
    const res = await post("/api/git/worktree/remove", { cwd: wt });
    expect(existsSync(wt)).toBe(false);
    expect(res.json().stderr).toBe("fatal: x.ts is locked");
  });

  it("a sibling path that merely shares the root prefix is not relativized", async () => {
    const wt = linkedWorktree();
    vi.spyOn(gitOps, "removeWorktree").mockReturnValue({ ok: false, code: "git_failed", stderr: `see ${wt}-other/x.ts` } as any);
    const res = await post("/api/git/worktree/remove", { cwd: wt });
    expect(res.json().stderr).toBe("see <path>");
  });
});

describe("SE17 — canary in every failure branch never reaches a response", () => {
  const canaryErr = () => new Error(`boom ${CANARY}`);
  const ghOk = () => vi.spyOn(getDefaultRegistry(), "resolve").mockReturnValue({ ok: true, path: "/usr/bin/gh" } as any);

  type Case = {
    name: string;
    run: () => Promise<{ statusCode: number; json: () => any }>;
    code: string;
    status?: number;
  };
  const cases = (): Case[] => [
    {
      name: "branches (err.message)",
      run: async () => (vi.spyOn(gitOps, "listBranches").mockImplementation(() => { throw canaryErr(); }), get(`/api/git/branches?cwd=${encodeURIComponent(repo)}`)),
      code: "list_branches_failed",
    },
    {
      name: "checkout (err.message)",
      run: async () => (vi.spyOn(gitOps, "checkoutBranch").mockImplementation(() => { throw canaryErr(); }), post("/api/git/checkout", { cwd: repo, branch: "main" })),
      code: "checkout_failed",
    },
    {
      name: "init (err.message)",
      run: async () => (vi.spyOn(gitOps, "gitInit").mockImplementation(() => { throw canaryErr(); }), post("/api/git/init", { cwd: repo })),
      code: "git_init_failed",
    },
    {
      name: "changed-files (err.message)",
      run: async () => (vi.spyOn(gitOps, "getChangedFiles").mockRejectedValue(canaryErr()), get(`/api/git/changed-files?cwd=${encodeURIComponent(repo)}`)),
      code: "git_failed",
    },
    {
      name: "commit (GitCommitError.message)",
      run: async () => (vi.spyOn(gitOps, "commitFiles").mockRejectedValue(new gitOps.GitCommitError("commit-failed", `hook said ${CANARY}`)), post("/api/git/commit", { cwd: repo, message: "m", files: ["a"] })),
      code: "commit-failed",
    },
    {
      name: "commit (generic err.message)",
      run: async () => (vi.spyOn(gitOps, "commitFiles").mockRejectedValue(canaryErr()), post("/api/git/commit", { cwd: repo, message: "m", files: ["a"] })),
      code: "commit-failed",
    },
    {
      name: "head (err.message)",
      run: async () => (vi.spyOn(gitOps, "readHead").mockImplementation(() => { throw canaryErr(); }), get(`/api/git/head?cwd=${encodeURIComponent(repo)}`)),
      code: "git_failed",
    },
    {
      name: "worktrees (err.message)",
      run: async () => (vi.spyOn(gitOps, "listWorktrees").mockImplementation(() => { throw canaryErr(); }), get(`/api/git/worktrees?cwd=${encodeURIComponent(repo)}`)),
      code: "git_failed",
    },
    {
      name: "stash-pop (err.message)",
      run: async () => (vi.spyOn(gitOps, "stashPop").mockImplementation(() => { throw canaryErr(); }), post("/api/git/stash-pop", { cwd: repo })),
      code: "stash_pop_failed",
    },
    {
      name: "worktree create (result.message + stderr)",
      run: async () => (vi.spyOn(gitOps, "addWorktree").mockReturnValue({ ok: false, error: "git_failed", message: `m ${CANARY}`, stderr: `s ${CANARY}` }), post("/api/git/worktree", { cwd: repo, base: "main", newBranch: "feat/x" })),
      code: "git_failed",
    },
    {
      name: "orphan-cleanup (result.message)",
      run: async () => (vi.spyOn(gitOps, "orphanCleanup").mockReturnValue({ ok: false, error: "fs_failed", message: `m ${CANARY}` }), post("/api/git/worktree/orphan-cleanup", { cwd: repo, path: join(repo, "o") })),
      code: "fs_failed",
    },
    {
      name: "from-pr (result.message + stderr)",
      run: async () => (vi.spyOn(gitOps, "addWorktreeFromPr").mockReturnValue({ ok: false, error: "git_failed", message: `m ${CANARY}`, stderr: `s ${CANARY}` }), post("/api/git/worktree/from-pr", { cwd: repo, prNumber: 3 })),
      code: "git_failed",
    },
    {
      name: "remove (stderr)",
      run: async () => {
        const wt = linkedWorktree();
        vi.spyOn(gitOps, "removeWorktree").mockReturnValue({ ok: false, code: "git_failed", stderr: `s ${CANARY}` } as any);
        return post("/api/git/worktree/remove", { cwd: wt });
      },
      code: "git_failed",
    },
    {
      name: "remove-batch (stderr)",
      run: async () => {
        const wt = linkedWorktree();
        vi.spyOn(gitOps, "removeWorktree").mockReturnValue({ ok: false, code: "git_failed", stderr: `s ${CANARY}` } as any);
        return post("/api/git/worktree/remove-batch", { items: [{ cwd: wt }] });
      },
      code: "git_failed",
    },
    {
      name: "merge (stderr)",
      run: async () => (vi.spyOn(gitOps, "mergeWorktree").mockReturnValue({ ok: false, code: "git_failed", stderr: `s ${CANARY}` } as any), post("/api/git/worktree/merge", { cwd: repo })),
      code: "git_failed",
    },
    {
      name: "push (stderr)",
      run: async () => (vi.spyOn(gitOps, "pushBranch").mockReturnValue({ ok: false, code: "git_failed", stderr: `s ${CANARY}` } as any), post("/api/git/worktree/push", { cwd: repo })),
      code: "git_failed",
    },
    {
      name: "pr (stderr)",
      run: async () => {
        ghOk();
        vi.spyOn(gitOps, "createPullRequest").mockReturnValue({ ok: false, code: "git_failed", stderr: `s ${CANARY}` } as any);
        return post("/api/git/worktree/pr", { cwd: repo });
      },
      code: "git_failed",
    },
    {
      name: "pull-requests (stderr)",
      run: async () => {
        ghOk();
        vi.spyOn(gitOps, "listPullRequests").mockReturnValue({ ok: false, code: "git_failed", stderr: `s ${CANARY}` } as any);
        return get(`/api/git/pull-requests?cwd=${encodeURIComponent(repo)}`);
      },
      code: "git_failed",
    },
    {
      name: "diff-stat (stderr)",
      run: async () => (vi.spyOn(gitOps, "worktreeDiffStat").mockReturnValue({ ok: false, code: "git_failed", stderr: `s ${CANARY}` } as any), get(`/api/git/worktree/diff-stat?cwd=${encodeURIComponent(repo)}`)),
      code: "git_failed",
    },
  ];

  for (const name of cases().map((c) => c.name)) {
    it(name, async () => {
      const c = cases().find((x) => x.name === name)!;
      const res = await c.run();
      const body = res.json();
      const row = body?.data?.results?.[0] ?? body;
      expect(row.code).toBe(c.code);
      expect(leaks(body)).toEqual([]);
    });
  }
});

describe("SX9 — redaction in the route error path never throws and keeps status + code", () => {
  it.each([
    ["thrown string", "fatal: /home/u/x", "fatal: <path>"],
    ["undefined", undefined, "checkout failed"],
    ["null", null, "checkout failed"],
    ["Error without message", new Error(""), "checkout failed"],
    ["10-char string", "0123456789", "0123456789"],
    ["non-UTF8 bytes", "bad \uFFFD\uFFFE bytes", "bad \uFFFD\uFFFE bytes"],
  ])("checkout throwing %s → 200 envelope, code checkout_failed, redacted text", async (_label, thrown, expected) => {
    vi.spyOn(gitOps, "checkoutBranch").mockImplementation(() => { throw thrown; });
    const res = await post("/api/git/checkout", { cwd: repo, branch: "main" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: false, code: "checkout_failed", error: expected });
  });
});
