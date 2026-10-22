/**
 * Core cwd admission on the package and canvas-types routes: a supplied `cwd` is admitted through the
 * shared guard (pinned / workspace folders and worktrees of known repos pass), an unknown or malformed
 * cwd is refused with 403 `cwd_unknown` BEFORE any wrapper / settings access, an undecidable admission
 * answers the shared 503, and an absent cwd keeps today's fallback.
 * See change: core-file-cwd-admission (test-plan E3, E6, E7, E12, E13, X1).
 */
import fs from "node:fs";
import path from "node:path";
import { isAdmissionLive } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import * as canvasSettings from "../canvas/canvas-settings.js";
import { registerCanvasTypesRoutes } from "../routes/canvas-types-routes.js";
import { registerPackageRoutes } from "../routes/package-routes.js";
import {
  addLinkedWorktree,
  captureAdmissions,
  cleanupAdmissionDirs,
  failingRunner,
  makeGitRepo,
  tmpDir,
} from "./helpers/admission-test-kit.js";

vi.mock("../package/npm-search-proxy.js", () => ({
  searchPackages: vi.fn(),
  fetchReadme: vi.fn(),
  fetchPackageMeta: vi.fn(async () => null),
  PackageNotFoundError: class extends Error {},
}));

const REFUSAL = {
  success: false,
  code: "cwd_unknown",
  error: "cwd not allowed",
  reason: "cwd is not a known session or pinned directory.",
  hint: "Pin this directory to allow it, or open a session rooted in it.",
};
const UNAVAILABLE = {
  success: false,
  code: "cwd-admission-unavailable",
  error: "cwd-admission-unavailable",
  message: "cwd admission could not be decided right now",
  retryAfterMs: 1000,
};

function makeWrapper() {
  return {
    run: vi.fn().mockResolvedValue("op-1"),
    move: vi.fn().mockResolvedValue("move-1"),
    reset: vi.fn().mockResolvedValue("reset-1"),
    listInstalled: vi.fn().mockResolvedValue([]),
    checkUpdates: vi.fn().mockResolvedValue([]),
    isBusy: vi.fn().mockReturnValue(false),
  } as any;
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  vi.restoreAllMocks();
});
afterAll(() => cleanupAdmissionDirs());

type Admission = NonNullable<Parameters<typeof registerPackageRoutes>[1]["routeAdmission"]>;

async function boot(routeAdmission: Admission) {
  const wrapper = makeWrapper();
  const app = Fastify({ logger: false });
  registerPackageRoutes(app, { packageManagerWrapper: wrapper, routeAdmission });
  registerCanvasTypesRoutes(app, { networkGuard: async () => undefined, routeAdmission });
  await app.ready();
  apps.push(app);
  return { app, wrapper };
}

const post = (app: FastifyInstance, url: string, payload: object) => app.inject({ method: "POST", url, payload });
const q = encodeURIComponent;

describe("package routes — cwd admission", () => {
  it("E12: an unknown cwd is refused 403 cwd_unknown on every package route; the wrapper is never touched", async () => {
    const pinned = tmpDir("pc-k-");
    const U = tmpDir("pc-u-");
    const { app, wrapper } = await boot({ knownCwds: () => [pinned] });
    const cases: Array<[string, () => ReturnType<typeof post>]> = [
      ["install", () => post(app, "/api/packages/install", { source: "npm:x", scope: "local", cwd: U })],
      ["remove", () => post(app, "/api/packages/remove", { source: "npm:x", scope: "local", cwd: U })],
      ["update", () => post(app, "/api/packages/update", { scope: "local", cwd: U })],
      ["installed", () => app.inject({ method: "GET", url: `/api/packages/installed?scope=local&cwd=${q(U)}` })],
      ["check-updates", () => post(app, "/api/packages/check-updates", { cwd: U })],
      ["reset-to-npm", () => post(app, "/api/packages/reset-to-npm", { source: "npm:x", scope: "local", cwd: U })],
      ["move (to)", () => post(app, "/api/packages/move", { entry: "npm:x", fromScope: "global", toScope: "local", toCwd: U })],
      [
        "move (from known, to unknown)",
        () => post(app, "/api/packages/move", { entry: "npm:x", fromScope: "local", fromCwd: pinned, toScope: "local", toCwd: U }),
      ],
    ];
    for (const [name, call] of cases) {
      const res = await call();
      expect({ name, status: res.statusCode, body: res.json() }).toEqual({ name, status: 403, body: REFUSAL });
    }
    for (const fn of [wrapper.run, wrapper.move, wrapper.reset, wrapper.listInstalled, wrapper.checkUpdates]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("E3 / E12: a pinned folder and a worktree of a pinned repo are admitted and the wrapper gets the guarded cwd", async () => {
    const P = tmpDir("pc-p-");
    const repo = makeGitRepo();
    const W = addLinkedWorktree(repo, "pc-e12");
    const { app, wrapper } = await boot({ knownCwds: () => [P, repo] });
    for (const cwd of [P, W]) {
      const res = await post(app, "/api/packages/install", { source: "npm:x", scope: "local", cwd });
      expect([cwd, res.statusCode]).toEqual([cwd, 202]);
      expect(wrapper.run).toHaveBeenLastCalledWith({ action: "install", source: "npm:x", scope: "local", cwd });
    }
    const mv = await post(app, "/api/packages/move", { entry: "npm:x", fromScope: "local", fromCwd: P, toScope: "global" });
    expect(mv.statusCode).toBe(202);
    expect(wrapper.move).toHaveBeenLastCalledWith({ entry: "npm:x", fromScope: "local", fromCwd: P, toScope: "global", toCwd: undefined });
  });

  it("E6 / E12: a local scope without a string cwd is 400 invalid_request and admission is never reached", async () => {
    const cap = captureAdmissions();
    const { app, wrapper } = await boot({ knownCwds: () => [] });
    const missing = await post(app, "/api/packages/move", { entry: "npm:x", fromScope: "global", toScope: "local" });
    expect([missing.statusCode, missing.json().code]).toEqual([400, "invalid_request"]);
    const array = await post(app, "/api/packages/move", { entry: "npm:x", fromScope: "global", toScope: "local", toCwd: ["x"] });
    expect([array.statusCode, array.json().code]).toEqual([400, "invalid_request"]);
    const reset = await post(app, "/api/packages/reset-to-npm", { source: "npm:x", scope: "local" });
    expect([reset.statusCode, reset.json().code]).toEqual([400, "invalid_request"]);
    expect(cap.calls).toEqual([]);
    expect(wrapper.move).not.toHaveBeenCalled();
    cap.restore();
  });

  it("E6: a non-absolute or non-string cwd never reaches the wrapper", async () => {
    const cap = captureAdmissions();
    const { app, wrapper } = await boot({ knownCwds: () => [] });
    for (const cwd of [".", "src", ["/tmp"], { a: 1 }, 42]) {
      const res = await post(app, "/api/packages/install", { source: "npm:x", scope: "local", cwd });
      expect({ cwd, status: res.statusCode, code: res.json().code }).toEqual({ cwd, status: 403, code: "cwd_unknown" });
    }
    expect(cap.calls).toEqual([]);
    expect(wrapper.run).not.toHaveBeenCalled();
    cap.restore();
  });

  it("E7: an absent cwd keeps today's fallback (the wrapper gets undefined) with no admission", async () => {
    const cap = captureAdmissions();
    const { app, wrapper } = await boot({ knownCwds: () => [] });
    expect((await app.inject({ method: "GET", url: "/api/packages/installed" })).statusCode).toBe(200);
    expect(wrapper.listInstalled).toHaveBeenCalledWith("global", undefined);
    expect((await post(app, "/api/packages/install", { source: "npm:x", scope: "global", cwd: "" })).statusCode).toBe(202);
    expect(wrapper.run).toHaveBeenLastCalledWith({ action: "install", source: "npm:x", scope: "global", cwd: undefined });
    expect(cap.calls).toEqual([]);
    cap.restore();
  });

  it("X1: an undecidable admission answers the shared 503 + Retry-After; move with a refused side answers 403 first", async () => {
    const repo = makeGitRepo();
    const W = addLinkedWorktree(repo, "pc-x1");
    const U = tmpDir("pc-u-");
    const { app, wrapper } = await boot({ knownCwds: () => [repo], admitOptions: { runner: failingRunner } });
    const res = await post(app, "/api/packages/install", { source: "npm:x", scope: "local", cwd: W });
    expect([res.statusCode, res.headers["retry-after"], res.json()]).toEqual([503, "1", UNAVAILABLE]);
    // U is not a direct match either, so its derivation also fails: both sides undecidable → 503.
    const both = await post(app, "/api/packages/move", { entry: "npm:x", fromScope: "local", fromCwd: W, toScope: "local", toCwd: U });
    expect(both.statusCode).toBe(503);
    expect(wrapper.run).not.toHaveBeenCalled();
    expect(wrapper.move).not.toHaveBeenCalled();
  });

  it("E12(g): a refused side beats an undecidable side", async () => {
    const repo = makeGitRepo();
    const W = addLinkedWorktree(repo, "pc-e12g");
    // A path that does not exist is refused without spawning git; `W` needs a derivation that fails.
    const gone = path.join(tmpDir("pc-gone-"), "missing");
    const { app, wrapper } = await boot({ knownCwds: () => [repo], admitOptions: { runner: failingRunner } });
    const res = await post(app, "/api/packages/move", { entry: "npm:x", fromScope: "local", fromCwd: gone, toScope: "local", toCwd: W });
    expect([res.statusCode, res.json()]).toEqual([403, REFUSAL]);
    expect(wrapper.move).not.toHaveBeenCalled();
  });
});

describe("token release (test-plan E20)", () => {
  it("every token minted for a package, move or canvas request is released once the response is done", async () => {
    const P = tmpDir("tr-p-");
    const U = tmpDir("tr-u-");
    const cap = captureAdmissions();
    const { app } = await boot({ knownCwds: () => [P] });
    await post(app, "/api/packages/install", { source: "npm:x", scope: "local", cwd: P });
    await post(app, "/api/packages/install", { source: "npm:x", scope: "local", cwd: U });
    await post(app, "/api/packages/move", { entry: "npm:x", fromScope: "local", fromCwd: P, toScope: "local", toCwd: P });
    await app.inject({ method: "GET", url: `/api/canvas-types?cwd=${q(P)}` });
    await new Promise((r) => setImmediate(r));
    expect(cap.tokens.length).toBeGreaterThanOrEqual(4);
    expect(cap.tokens.filter((t) => isAdmissionLive(t))).toEqual([]);
    cap.restore();
  });
});

describe("canvas-types routes — cwd admission", () => {
  it("E13: GET / PATCH refuse an unknown cwd without touching its settings file; a validation 400 wins; a pinned folder is written", async () => {
    const P = tmpDir("cv-p-");
    const U = tmpDir("cv-u-");
    const { app } = await boot({ knownCwds: () => [P] });
    const read = vi.spyOn(canvasSettings, "readCanvasTypesScopes");
    const write = vi.spyOn(canvasSettings, "writeCanvasTypesScope");

    const getU = await app.inject({ method: "GET", url: `/api/canvas-types?cwd=${q(U)}` });
    expect([getU.statusCode, getU.json()]).toEqual([403, REFUSAL]);
    const patchU = await app.inject({ method: "PATCH", url: "/api/canvas-types", payload: { scope: "project", cwd: U, canvasTypes: { code: true } } });
    expect([patchU.statusCode, patchU.json()]).toEqual([403, REFUSAL]);
    expect(fs.existsSync(path.join(U, ".pi", "settings.json"))).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();

    const cap = captureAdmissions();
    const invalid = await app.inject({ method: "PATCH", url: "/api/canvas-types", payload: { scope: "project", cwd: U } });
    expect(invalid.statusCode).toBe(400);
    expect(cap.calls).toEqual([]);
    cap.restore();

    const patchP = await app.inject({ method: "PATCH", url: "/api/canvas-types", payload: { scope: "project", cwd: P, canvasTypes: { code: true } } });
    expect(patchP.statusCode).toBe(200);
    expect(fs.existsSync(path.join(P, ".pi", "settings.json"))).toBe(true);
  });

  it("E6 / E7: a non-string cwd is refused; an absent cwd reads the constant empty project scope", async () => {
    const { app } = await boot({ knownCwds: () => [] });
    const read = vi.spyOn(canvasSettings, "readCanvasTypesScopes");
    const arr = await app.inject({ method: "GET", url: `/api/canvas-types?cwd=${q("/a")}&cwd=${q("/b")}` });
    expect([arr.statusCode, arr.json().code]).toEqual([403, "cwd_unknown"]);
    const absent = await app.inject({ method: "GET", url: "/api/canvas-types?cwd=" });
    expect(absent.statusCode).toBe(200);
    expect(read).toHaveBeenLastCalledWith("");
  });

  it("X1: an undecidable admission answers the shared 503 with Retry-After and writes nothing", async () => {
    const repo = makeGitRepo();
    const W = addLinkedWorktree(repo, "cv-x1");
    const { app } = await boot({ knownCwds: () => [repo], admitOptions: { runner: failingRunner } });
    const res = await app.inject({ method: "PATCH", url: "/api/canvas-types", payload: { scope: "project", cwd: W, canvasTypes: { code: true } } });
    expect([res.statusCode, res.headers["retry-after"], res.json()]).toEqual([503, "1", UNAVAILABLE]);
    expect(fs.existsSync(path.join(W, ".pi", "settings.json"))).toBe(false);
  });
});
