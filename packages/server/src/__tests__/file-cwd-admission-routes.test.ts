/**
 * Core cwd admission on the file-family routes: pinned folders, workspace folders and worktrees of
 * known repositories are admitted; unknown / sibling-worktree / malformed cwds are refused with the
 * route's own status + `error` plus `code: "cwd_unknown"`; an undecidable admission answers the
 * shared 503; containment still applies; tokens are released.
 * See change: core-file-cwd-admission (test-plan E1–E11, X1, X2, X7, E20, P6).
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { isAdmissionLive } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import type { GitProbeRunner } from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import * as containment from "../access/containment-gate.js";
import { gateFilePath, registerFileRoutes } from "../routes/file-routes.js";
import { registerGrepRoutes } from "../routes/grep-routes.js";
import {
  addLinkedWorktree,
  captureAdmissions,
  cleanupAdmissionDirs,
  failingRunner,
  makeGitRepo,
  realpathFailingFor,
  tmpDir,
} from "./helpers/admission-test-kit.js";

// The in-process grep fallback is deterministic; a host `rg` binary is not part of this contract.
vi.mock("../ripgrep-detection.js", () => ({ detectRipgrep: () => null }));

interface Setup {
  sessions?: string[];
  pinned?: string[];
  workspaces?: string[][];
  admitOptions?: NonNullable<Parameters<typeof registerFileRoutes>[1]["routeAdmission"]>["admitOptions"];
  /** System-open spawn spy (the opener command is never really run). */
  systemOpenRun?: (cmd: string, args: string[]) => void;
}

const apps: FastifyInstance[] = [];
async function boot(o: Setup = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const sessionManager = { listAll: () => (o.sessions ?? []).map((cwd) => ({ cwd })) } as never;
  const preferencesStore = {
    getPinnedDirectories: () => o.pinned ?? [],
    getWorkspaces: () => (o.workspaces ?? []).map((folders) => ({ folders })),
  } as never;
  const routeAdmission = {
    knownCwds: () => [...(o.sessions ?? []), ...(o.pinned ?? []), ...(o.workspaces ?? []).flat()],
    ...(o.admitOptions ? { admitOptions: o.admitOptions } : {}),
  };
  registerFileRoutes(app, {
    sessionManager,
    preferencesStore,
    networkGuard: async () => undefined,
    routeAdmission,
    ...(o.systemOpenRun ? { systemOpen: { capable: () => true, run: o.systemOpenRun, platform: "darwin" as const } } : {}),
  });
  registerGrepRoutes(app, { sessionManager, networkGuard: async () => undefined, routeAdmission });
  await app.ready();
  apps.push(app);
  return app;
}

afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  vi.restoreAllMocks();
});
afterAll(() => cleanupAdmissionDirs());

const q = encodeURIComponent;
const get = (app: FastifyInstance, url: string) => app.inject({ method: "GET", url });
const post = (app: FastifyInstance, url: string, payload: object) => app.inject({ method: "POST", url, payload });

/** A non-git dir with the fixture files every route family needs. */
/** A git runner that counts its calls and fails every probe. */
function countingRunner(): { runner: GitProbeRunner; calls: () => number } {
  let n = 0;
  return { runner: (recipe, input, ctx) => (n++, failingRunner(recipe, input, ctx)), calls: () => n };
}

function makeFolder(prefix = "fca-p-"): string {
  const dir = tmpDir(prefix);
  fs.writeFileSync(path.join(dir, "a.txt"), "hello world\n");
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# agents\n");
  fs.writeFileSync(path.join(dir, "doc.adoc"), "= Title\n\nbody\n");
  fs.writeFileSync(path.join(dir, "img.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return dir;
}

/** Every file-family read route for `cwd`, returning the response status + body. */
function readRoutes(app: FastifyInstance, cwd: string) {
  const c = q(cwd);
  return {
    file: () => get(app, `/api/file?cwd=${c}&path=a.txt`),
    digest: () => get(app, `/api/file/digest?cwd=${c}&path=a.txt`),
    tree: () => get(app, `/api/file/tree?cwd=${c}&path=.`),
    exists: () => get(app, `/api/file/exists?cwd=${c}&path=${q(path.join(cwd, "a.txt"))}`),
    raw: () => get(app, `/api/file/raw?cwd=${c}&path=img.png`),
    render: () => get(app, `/api/file/render?cwd=${c}&path=doc.adoc`),
    mdCandidates: () => get(app, `/api/file/md-candidates?cwd=${c}`),
    mdRead: () => get(app, `/api/file/md-read?cwd=${c}&path=AGENTS.md`),
    mention: () => post(app, "/api/file/resolve-mention", { cwd, mention: "a.txt" }),
    grep: () => get(app, `/api/grep?cwd=${c}&q=hello`),
    write: async () => {
      const mtime = fs.statSync(path.join(cwd, "AGENTS.md")).mtimeMs;
      return post(app, "/api/file/write", { cwd, path: "AGENTS.md", content: "# edited\n", mtime });
    },
  } as const;
}

describe("file routes — core cwd admission", () => {
  it("E1: a pinned folder with no session is admitted on every file route, with no git spawn", async () => {
    const P = makeFolder();
    const counted = countingRunner();
    const app = await boot({ pinned: [P], admitOptions: { runner: counted.runner } });
    for (const [name, call] of Object.entries(readRoutes(app, P))) {
      const res = await call();
      expect({ name, status: res.statusCode }).toEqual({ name, status: 200 });
    }
    expect(fs.readFileSync(path.join(P, "AGENTS.md"), "utf8")).toBe("# edited\n");
    expect(counted.calls()).toBe(0);
  });

  it("E2: a sessionless linked worktree of a pinned repository is previewable", async () => {
    const repo = makeGitRepo();
    const W = addLinkedWorktree(repo, "fca-e2");
    fs.writeFileSync(path.join(W, "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.mkdirSync(path.join(W, "src"));
    fs.writeFileSync(path.join(W, "src", "x.ts"), "export {};\n");
    const app = await boot({ pinned: [repo] });
    const raw = await get(app, `/api/file/raw?cwd=${q(W)}&path=shot.png`);
    expect(raw.statusCode).toBe(200);
    expect(raw.headers["content-type"]).toBe("image/png");
    const tree = await get(app, `/api/file/tree?cwd=${q(W)}&path=src`);
    expect(tree.statusCode).toBe(200);
    expect(tree.json().data.entries.map((e: { name: string }) => e.name)).toEqual(["x.ts"]);
  });

  it("E3: a workspace-only folder is admitted", async () => {
    const WS = makeFolder("fca-ws-");
    const app = await boot({ workspaces: [[WS]] });
    expect((await get(app, `/api/file?cwd=${q(WS)}&path=a.txt`)).statusCode).toBe(200);
  });

  it("E4: an unknown cwd keeps each route's status + error and adds code cwd_unknown; nothing is read or written", async () => {
    const U = makeFolder("fca-u-");
    const known = makeFolder("fca-k-");
    const statSpy = vi.spyOn(fsp, "stat");
    const app = await boot({ pinned: [known] });
    const expected: Record<string, string> = { exists: "unknown cwd" };
    for (const [name, call] of Object.entries(readRoutes(app, U))) {
      const res = await call();
      const body = res.json();
      expect({ name, status: res.statusCode, error: body.error, code: body.code }).toEqual({
        name,
        status: 403,
        error: expected[name] ?? "unknown session path",
        code: "cwd_unknown",
      });
    }
    expect(fs.readFileSync(path.join(U, "AGENTS.md"), "utf8")).toBe("# agents\n");
    expect(statSpy.mock.calls.filter(([p]) => String(p).startsWith(U))).toEqual([]);
  });

  it("E5: sibling worktree, main checkout of a known worktree and a child repo of a pinned non-repo are refused", async () => {
    const repo = makeGitRepo();
    const W1 = addLinkedWorktree(repo, "fca-e5-a");
    const W2 = addLinkedWorktree(repo, "fca-e5-b");
    const P = makeFolder("fca-pn-");
    const child = path.join(P, "r");
    fs.mkdirSync(child);
    fs.writeFileSync(path.join(child, "a.txt"), "x");
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["init", "-q"], { cwd: child });
    const app = await boot({ sessions: [W1], pinned: [P] });
    for (const cwd of [W2, repo, child]) {
      const res = await get(app, `/api/file?cwd=${q(cwd)}&path=a.txt`);
      expect({ cwd, status: res.statusCode, body: res.json() }).toMatchObject({
        status: 403,
        body: { error: "unknown session path", code: "cwd_unknown" },
      });
    }
  });

  it("E6: a non-absolute or non-string cwd is refused before admission and never selects a global scope", async () => {
    const P = makeFolder();
    const cap = captureAdmissions();
    const app = await boot({ pinned: [P] });
    for (const cwd of [".", "src"]) {
      const tree = await get(app, `/api/file/tree?cwd=${q(cwd)}&path=.`);
      expect([tree.statusCode, tree.json().code]).toEqual([403, "cwd_unknown"]);
    }
    const arr = await get(app, `/api/file/tree?cwd=${q(P)}&cwd=${q(P)}&path=.`);
    expect([arr.statusCode, arr.json().code]).toEqual([403, "cwd_unknown"]);
    for (const cwd of [".", "src", ["/tmp"], {}, 42]) {
      const res = await post(app, "/api/file/write", { cwd, path: path.join(P, "AGENTS.md"), content: "x", mtime: 1 });
      expect({ cwd, status: res.statusCode, code: res.json().code }).toEqual({ cwd, status: 403, code: "cwd_unknown" });
    }
    expect(cap.calls).toEqual([]);
    expect(fs.readFileSync(path.join(P, "AGENTS.md"), "utf8")).toBe("# agents\n");
    cap.restore();
  });

  it("E7: an absent cwd keeps the global scope on the md routes without admission", async () => {
    const cap = captureAdmissions();
    const app = await boot({});
    const res = await get(app, "/api/file/md-candidates");
    expect(res.statusCode).toBe(200);
    expect((await get(app, "/api/file/md-candidates?cwd=")).statusCode).toBe(200);
    expect((await get(app, `/api/file/md-read?path=${q("relative.md")}`)).json().error).toBe(
      "global scope requires an absolute path",
    );
    expect(cap.calls).toEqual([]);
    cap.restore();
  });

  it("E8: containment still applies after admission", async () => {
    const P = makeFolder();
    const app = await boot({ pinned: [P] });
    const res = await get(app, `/api/file?cwd=${q(P)}&path=${q("../../etc/passwd")}`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("path outside working directory");
  });

  it("E9: a symlinked cwd accepts the request and the canonical spelling; ../ still escapes nowhere", async () => {
    const R = makeFolder("fca-real-");
    fs.writeFileSync(path.join(path.dirname(R), `${path.basename(R)}-outside.txt`), "secret");
    const L = path.join(tmpDir("fca-link-"), "L");
    fs.symlinkSync(R, L);
    const app = await boot({ pinned: [L] });
    const paths = ["a.txt", path.join(L, "a.txt"), path.join(R, "a.txt")];
    for (const p of paths) {
      expect({ p, status: (await get(app, `/api/file?cwd=${q(L)}&path=${q(p)}`)).statusCode }).toEqual({ p, status: 200 });
      expect({ p, status: (await get(app, `/api/file/raw?cwd=${q(L)}&path=${q(p)}`)).statusCode }).toEqual({ p, status: 200 });
      expect({ p, status: (await get(app, `/api/file/exists?cwd=${q(L)}&path=${q(path.resolve(L, p))}`)).statusCode }).toEqual({
        p,
        status: 200,
      });
    }
    const outside = `../${path.basename(R)}-outside.txt`;
    const refused = await get(app, `/api/file?cwd=${q(L)}&path=${q(outside)}`);
    expect([refused.statusCode, refused.json().error]).toEqual([403, "path outside working directory"]);
    const grep = await get(app, `/api/grep?cwd=${q(L)}&q=hello`);
    expect(JSON.stringify(grep.json())).toContain("a.txt");
    const mention = await post(app, "/api/file/resolve-mention", { cwd: L, mention: path.join(R, "a.txt") });
    expect(mention.json().data.resolved).toBe(path.join(R, "a.txt"));
  });

  it("E10: resolve-mention ⊆ open — a mention resolved under the canonical cwd opens", async () => {
    const R = makeFolder("fca-real-");
    fs.writeFileSync(path.join(R, "b.ts"), "export {};\n");
    const L = path.join(tmpDir("fca-link-"), "L");
    fs.symlinkSync(R, L);
    const app = await boot({ pinned: [L] });
    const m = await post(app, "/api/file/resolve-mention", { cwd: L, mention: path.join(R, "b.ts") });
    const resolved = m.json().data.resolved as string;
    expect(resolved).toBe(path.join(R, "b.ts"));
    expect((await get(app, `/api/file?cwd=${q(L)}&path=${q(resolved)}`)).statusCode).toBe(200);
  });

  it("E11: the exists prompt follows admission (no prompt for a relative cwd or an admitted one)", async () => {
    const P = makeFolder();
    const app = await boot({ pinned: [P] });
    const relative = await get(app, `/api/file/exists?cwd=.&path=${q(path.join(P, "a.txt"))}`);
    expect([relative.statusCode, relative.json().error, relative.json().code]).toEqual([403, "unknown cwd", "cwd_unknown"]);
    expect((await get(app, `/api/file/exists?cwd=${q(P)}&path=${q(path.join(P, "a.txt"))}`)).statusCode).toBe(200);
  });

  it("P6: a session cwd (direct match) spawns no git", async () => {
    const K = makeGitRepo();
    fs.writeFileSync(path.join(K, "a.txt"), "x");
    const counted = countingRunner();
    const app = await boot({ sessions: [K], admitOptions: { runner: counted.runner } });
    expect((await get(app, `/api/file?cwd=${q(K)}&path=a.txt`)).statusCode).toBe(200);
    expect(counted.calls()).toBe(0);
  });

  it("E20: every minted token is released once the response is done", async () => {
    const P = makeFolder();
    const U = makeFolder("fca-u-");
    const cap = captureAdmissions();
    const app = await boot({ pinned: [P] });
    for (const cwd of [P, U]) for (const call of Object.values(readRoutes(app, cwd))) await call();
    // `close` fires after the injected response ends; give the event loop one turn.
    await new Promise((r) => setImmediate(r));
    expect(cap.tokens.length).toBeGreaterThan(0);
    expect(cap.tokens.filter((t) => isAdmissionLive(t))).toEqual([]);
    cap.restore();
  });
});

describe("file routes — undecidable admission answers the shared 503", () => {
  const BODY = {
    success: false,
    code: "cwd-admission-unavailable",
    error: "cwd-admission-unavailable",
    message: "cwd admission could not be decided right now",
    retryAfterMs: 1000,
  };

  it("X1: every file route answers 503 + Retry-After and does no operation", async () => {
    const repo = makeGitRepo();
    const W = addLinkedWorktree(repo, "fca-x1");
    fs.writeFileSync(path.join(W, "a.txt"), "hello");
    fs.writeFileSync(path.join(W, "AGENTS.md"), "# agents\n");
    fs.writeFileSync(path.join(W, "doc.adoc"), "= T\n");
    fs.writeFileSync(path.join(W, "img.png"), "x");
    const statSpy = vi.spyOn(fsp, "stat");
    const app = await boot({ pinned: [repo], admitOptions: { runner: failingRunner } });
    for (const [name, call] of Object.entries(readRoutes(app, W))) {
      const res = await call();
      expect({ name, status: res.statusCode, retry: res.headers["retry-after"], body: res.json() }).toEqual({
        name,
        status: 503,
        retry: "1",
        body: BODY,
      });
    }
    expect(statSpy.mock.calls.filter(([p]) => String(p).startsWith(W))).toEqual([]);
    expect(fs.readFileSync(path.join(W, "a.txt"), "utf8")).toBe("hello");
  });

  it("X2: an unreadable known entry makes an unknown cwd 503 while a direct match is still admitted", async () => {
    const P = makeFolder();
    const bad = makeFolder("fca-bad-");
    const U = makeFolder("fca-u-");
    const app = await boot({ pinned: [bad, P], admitOptions: { realpath: realpathFailingFor(bad) } });
    expect((await get(app, `/api/file?cwd=${q(U)}&path=a.txt`)).statusCode).toBe(503);
    expect((await get(app, `/api/file?cwd=${q(P)}&path=a.txt`)).statusCode).toBe(200);
  });

  it("X7: a regular file as cwd is refused, not 503", async () => {
    const K = makeFolder();
    const app = await boot({ pinned: [K] });
    const res = await get(app, `/api/file?cwd=${q(path.join(K, "a.txt"))}&path=x`);
    expect([res.statusCode, res.json().code]).toEqual([403, "cwd_unknown"]);
  });

  it("the exists route answers 503 and never prompts", async () => {
    const repo = makeGitRepo();
    const W = addLinkedWorktree(repo, "fca-x6");
    fs.writeFileSync(path.join(W, "a.txt"), "x");
    const app = await boot({ pinned: [repo], admitOptions: { runner: failingRunner } });
    const res = await get(app, `/api/file/exists?cwd=${q(W)}&path=${q(path.join(W, "a.txt"))}`);
    expect([res.statusCode, res.json()]).toEqual([503, BODY]);
  });
});

describe("live-preview gate (gateFilePath, quiet) — per-asset admission (test-plan X3 / X4)", () => {
  it("X4: unpinning the folder refuses the next asset, served or not", async () => {
    const P = makeFolder();
    let known = [P];
    const routeAdmission = { knownCwds: () => known };
    const first = await gateFilePath(P, "a.txt", routeAdmission, { allowGrant: true, quiet: true });
    expect("code" in first).toBe(false);
    known = [];
    for (const rel of ["a.txt", "img.png"]) {
      const gate = await gateFilePath(P, rel, routeAdmission, { allowGrant: true, quiet: true });
      expect(gate).toMatchObject({ code: 403, error: "unknown session path", wire: { code: "cwd_unknown" } });
    }
  });

  it("X3: an undecidable per-asset check is a refused asset that records no denial and asks nobody", async () => {
    const repo = makeGitRepo();
    const W = addLinkedWorktree(repo, "fca-x3");
    fs.writeFileSync(path.join(W, "a.txt"), "x");
    const evaluate = vi.spyOn(containment, "evaluateContainment");
    const gate = await gateFilePath(W, "a.txt", { knownCwds: () => [repo], admitOptions: { runner: failingRunner } }, {
      allowGrant: true,
      quiet: true,
    });
    expect(gate).toMatchObject({ code: 503, wire: { code: "cwd-admission-unavailable" } });
    expect(evaluate).not.toHaveBeenCalled();
  });
});

describe("open-in-system / reveal — cwd admission (test-plan E21, E4, X1)", () => {
  const LOOPBACK = { origin: "http://localhost:8000" };
  const open = (app: FastifyInstance, url: string, cwd: string) =>
    app.inject({ method: "POST", url, headers: LOOPBACK, payload: { cwd, path: "a.txt" } });

  it("E21: a pinned folder with no session spawns the opener once with the resolved path", async () => {
    const P = makeFolder();
    const run = vi.fn();
    const app = await boot({ pinned: [P], systemOpenRun: run });
    const res = await open(app, "/api/open-in-system", P);
    expect([res.statusCode, res.json().data]).toEqual([200, { spawned: true }]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(run.mock.calls[0])).toContain(path.join(P, "a.txt"));
  });

  it("an unknown cwd is refused with code cwd_unknown and nothing is spawned; an undecidable one answers 503", async () => {
    const U = makeFolder("fca-u-");
    const run = vi.fn();
    const refusedApp = await boot({ pinned: [], systemOpenRun: run });
    for (const url of ["/api/open-in-system", "/api/reveal-in-file-manager"]) {
      const res = await open(refusedApp, url, U);
      expect([res.statusCode, res.json().error, res.json().code]).toEqual([403, "unknown session path", "cwd_unknown"]);
    }
    const repo = makeGitRepo();
    const W = addLinkedWorktree(repo, "fca-sysopen");
    fs.writeFileSync(path.join(W, "a.txt"), "x");
    const failingApp = await boot({ pinned: [repo], systemOpenRun: run, admitOptions: { runner: failingRunner } });
    const res = await open(failingApp, "/api/open-in-system", W);
    expect([res.statusCode, res.headers["retry-after"]]).toEqual([503, "1"]);
    expect(run).not.toHaveBeenCalled();
  });
});
