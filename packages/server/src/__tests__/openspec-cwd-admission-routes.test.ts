/**
 * Core cwd admission on the openspec routes: ungated sites refuse an unknown cwd, gated write sites
 * keep exact membership, the global config dir is refused through symlinks, indeterminate → 503,
 * request path segments are single portable segments, tokens are released.
 * See change: core-cwd-admission (test-plan E7–E12, E20, X7, X8).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isAdmissionLive } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as archiveLib from "../openspec/openspec-archive.js";
import * as tasksLib from "../openspec/openspec-tasks.js";
import * as wfSchema from "../openspec/workflow-schema.js";
import { registerOpenSpecRoutes } from "../routes/openspec-routes.js";
import {
  captureAdmissions,
  cleanupAdmissionDirs,
  failingRunner,
  makeGitRepo,
  tmpDir,
} from "./helpers/admission-test-kit.js";

const cli = vi.hoisted(() => ({
  configListAsync: vi.fn(),
  configListOrAsync: vi.fn(),
  configProfile: vi.fn(),
  update: vi.fn(),
  initAsync: vi.fn(),
  initHelpAsync: vi.fn(),
}));
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/openspec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/platform/openspec.js")>();
  return { ...actual, ...cli };
});

const PASS = async () => {};
const REFUSAL = {
  success: false,
  code: "cwd_unknown",
  error: "cwd not allowed",
  reason: "cwd is not a known session or pinned directory.",
  hint: "Pin this directory to allow it, or open a session rooted in it.",
};

interface Setup {
  pinned?: string[];
  sessions?: string[];
  config?: { enabled?: boolean; optOutDirectories?: string[] };
  admitOptions?: Parameters<typeof registerOpenSpecRoutes>[1]["admitOptions"];
  onOpenSpecChanged?: (cwd: string) => void;
}

describe("openspec routes — core cwd admission", () => {
  let app: FastifyInstance;
  const prefs = { setOpenSpecUpdateSignature: vi.fn() };
  const directoryService = {
    refreshOpenSpec: vi.fn(async () => ({ initialized: true, changes: [], readiness: { state: "READY" } })),
    refreshPiResources: vi.fn(async () => ({ local: {}, global: {}, packages: [] })),
    getPiResources: vi.fn(() => undefined),
    getOpenSpecData: vi.fn(),
    getOpenSpecPollMode: vi.fn(() => "all"),
    invalidateOpenSpecSignatureCache: vi.fn(),
  };

  async function boot(o: Setup = {}): Promise<void> {
    app = Fastify({ logger: false });
    registerOpenSpecRoutes(app, {
      sessionManager: { listAll: () => (o.sessions ?? []).map((cwd, i) => ({ id: `s${i}`, cwd })) } as never,
      preferencesStore: {
        getPinnedDirectories: () => o.pinned ?? [],
        setOpenSpecUpdateSignature: prefs.setOpenSpecUpdateSignature,
        getOpenSpecUpdateSignature: () => undefined,
      } as never,
      directoryService: directoryService as never,
      networkGuard: PASS,
      getOpenSpecConfig: () => ({
        enabled: o.config?.enabled ?? true,
        optOutDirectories: o.config?.optOutDirectories ?? [],
        workflowSchema: { defaultForNewProjects: false },
      }),
      ...(o.admitOptions ? { admitOptions: o.admitOptions } : {}),
      ...(o.onOpenSpecChanged ? { onOpenSpecChanged: o.onOpenSpecChanged } : {}),
    });
    await app.ready();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    cli.configListAsync.mockResolvedValue({ ok: true, value: { profile: "core", workflows: ["propose"] } });
    cli.configListOrAsync.mockResolvedValue({ profile: "core", workflows: ["propose"] });
    cli.configProfile.mockReturnValue({ ok: true, value: "" });
    cli.update.mockReturnValue({ ok: true, value: "" });
    cli.initAsync.mockResolvedValue({ ok: true, value: "out" });
    cli.initHelpAsync.mockResolvedValue({ ok: true, value: "--tools" });
  });
  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });
  afterAll(() => cleanupAdmissionDirs());

  const get = (url: string) => app.inject({ method: "GET", url });
  const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload });
  const q = encodeURIComponent;

  /** Every lib / CLI the 8 ungated sites would reach. */
  function libSpies() {
    return [
      vi.spyOn(tasksLib, "readTasks"),
      vi.spyOn(tasksLib, "toggleTask"),
      vi.spyOn(archiveLib, "scanOpenSpecArchive"),
      cli.configListAsync,
      cli.configProfile,
      cli.update,
      directoryService.refreshPiResources,
      directoryService.getPiResources,
    ];
  }

  it("E7: the 8 ungated sites refuse an unknown cwd with 403 cwd_unknown and call no lib", async () => {
    const unknown = tmpDir("os-u-");
    const spies = libSpies();
    await boot({ pinned: [] });
    const sites: Array<[string, () => ReturnType<typeof get>]> = [
      ["openspec-archive", () => get(`/api/openspec-archive?cwd=${q(unknown)}`)],
      ["pi-resources/commands", () => get(`/api/pi-resources/commands?cwd=${q(unknown)}`)],
      ["tasks", () => get(`/api/openspec/tasks?cwd=${q(unknown)}&change=x`)],
      ["tasks/toggle", () => post("/api/openspec/tasks/toggle", { cwd: unknown, change: "x", id: "1.1", done: true, line: 1 })],
      ["config GET", () => get(`/api/openspec/config?cwd=${q(unknown)}`)],
      ["config POST", () => post("/api/openspec/config", { profile: "core", cwd: unknown })],
      ["update", () => post("/api/openspec/update", { cwd: unknown })],
      ["pi-resources", () => get(`/api/pi-resources?cwd=${q(unknown)}`)],
    ];
    expect(sites).toHaveLength(8);
    for (const [name, call] of sites) {
      const res = await call();
      expect({ name, status: res.statusCode, body: res.json() }).toEqual({ name, status: 403, body: REFUSAL });
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  describe("E8: gated write sites keep exact membership and their existing bodies", () => {
    it("(a) unknown dir", async () => {
      const unknown = tmpDir("os-u-");
      const runAction = vi.spyOn(wfSchema, "runWorkflowSchemaAction");
      await boot({});
      const ws = await post("/api/openspec/workflow-schema", { cwd: unknown, action: "enable" });
      expect([ws.statusCode, ws.json().code]).toEqual([400, "untracked"]);
      const dg = await get(`/api/openspec/dependencies?cwd=${q(unknown)}&change=foo`);
      expect([dg.statusCode, dg.json().reason]).toEqual([403, "cwd-not-tracked"]);
      const dp = await app.inject({
        method: "PUT",
        url: "/api/openspec/dependencies",
        payload: { cwd: unknown, change: "foo", blockedBy: [], notBlockedBy: [], related: [], expected: null },
      });
      expect([dp.statusCode, dp.json().reason]).toEqual([403, "cwd-not-tracked"]);
      const init = await post("/api/openspec/init", { cwd: unknown });
      expect(init.statusCode).toBe(400);
      expect(init.json().error).toBe("cwd is not a known session or pinned directory");
      expect(runAction).not.toHaveBeenCalled();
      expect(cli.initAsync).not.toHaveBeenCalled();
    });

    it("(b) a worktree of a pinned repo is NOT widened on init", async () => {
      const repo = makeGitRepo();
      const wt = path.join(tmpDir("os-wt-"), "wt");
      const { execFileSync } = await import("node:child_process");
      execFileSync("git", ["worktree", "add", "-b", "e8b", wt], { cwd: repo, stdio: "ignore" });
      await boot({ pinned: [repo] });
      const res = await post("/api/openspec/init", { cwd: fs.realpathSync(wt) });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("cwd is not a known session or pinned directory");
      expect(cli.initAsync).not.toHaveBeenCalled();
    });

    it("(c) a subdirectory of an opted-out repo stays 403 cwd-not-tracked", async () => {
      const repo = makeGitRepo({ openspec: true });
      const sub = path.join(repo, "sub");
      fs.mkdirSync(sub);
      await boot({ pinned: [repo], config: { optOutDirectories: [repo] } });
      const res = await get(`/api/openspec/dependencies?cwd=${q(sub)}&change=foo`);
      expect([res.statusCode, res.json().reason]).toEqual([403, "cwd-not-tracked"]);
    });

    it("(d) a pinned symlink to an opted-out dir stays refused as opted_out", async () => {
      const repo = makeGitRepo({ openspec: true });
      const link = path.join(tmpDir("os-link-"), "L");
      fs.symlinkSync(repo, link);
      const runAction = vi.spyOn(wfSchema, "runWorkflowSchemaAction");
      await boot({ pinned: [link], config: { optOutDirectories: [repo] } });
      const res = await post("/api/openspec/workflow-schema", { cwd: link, action: "enable" });
      expect([res.statusCode, res.json().code]).toEqual([400, "opted_out"]);
      expect(runAction).not.toHaveBeenCalled();
    });
  });

  describe("E9: the global OpenSpec config dir is refused", () => {
    function globalParent(): string {
      const parent = path.join(os.homedir(), ".config");
      fs.mkdirSync(path.join(parent, "openspec"), { recursive: true });
      return parent;
    }
    it("(a) pinned HOME/.config on toggle → 403 cwd_unknown, nothing written", async () => {
      const parent = globalParent();
      const toggle = vi.spyOn(tasksLib, "toggleTask");
      await boot({ pinned: [parent] });
      const res = await post("/api/openspec/tasks/toggle", { cwd: parent, change: "x", id: "1.1", done: true, line: 1 });
      expect([res.statusCode, res.json().code]).toEqual([403, "cwd_unknown"]);
      expect(toggle).not.toHaveBeenCalled();
      expect(fs.readdirSync(path.join(parent, "openspec"))).toEqual([]);
    });
    it("(b) a pinned symlink to it on tasks → 403 cwd_unknown", async () => {
      const parent = globalParent();
      const link = path.join(tmpDir("os-gl-"), "L");
      fs.symlinkSync(parent, link);
      const read = vi.spyOn(tasksLib, "readTasks");
      await boot({ pinned: [link] });
      const res = await get(`/api/openspec/tasks?cwd=${q(link)}&change=x`);
      expect([res.statusCode, res.json().code]).toEqual([403, "cwd_unknown"]);
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe("E10: unfiltered set, fallbacks, shape checks first", () => {
    it("(a) a pinned dir without openspec/ is admitted: the normal no-openspec result", async () => {
      const pinned = tmpDir("os-noos-");
      await boot({ pinned: [pinned] });
      const res = await get(`/api/openspec/tasks?cwd=${q(pinned)}&change=x`);
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("tasks.md not found");
    });
    it("(b) no cwd keeps the server-chosen fallback (first known OpenSpec project)", async () => {
      const project = tmpDir("os-proj-");
      fs.mkdirSync(path.join(project, "openspec"));
      const cap = captureAdmissions();
      await boot({ pinned: [project] });
      const res = await get("/api/openspec/config");
      expect(res.statusCode).toBe(200);
      expect(cli.configListAsync).toHaveBeenCalledWith({ cwd: project });
      expect(cap.calls).toEqual([]);
      cap.restore();
    });
    it("(c) update {all:true} iterates only OpenSpec projects and admits nothing", async () => {
      const withRoot = tmpDir("os-with-");
      fs.mkdirSync(path.join(withRoot, "openspec"));
      const without = tmpDir("os-without-");
      const cap = captureAdmissions();
      await boot({ pinned: [withRoot, without] });
      const res = await post("/api/openspec/update", { all: true });
      expect(res.statusCode).toBe(200);
      expect(cli.update.mock.calls.map(([o]) => (o as { cwd: string }).cwd)).toEqual([withRoot]);
      expect(cap.calls).toEqual([]);
      cap.restore();
    });
    it("(d) a relative cwd on pi-resources/commands is the existing 400, never admitted", async () => {
      const cap = captureAdmissions();
      await boot({});
      const res = await get("/api/pi-resources/commands?cwd=foo");
      expect(res.statusCode).toBe(400);
      expect(cap.calls).toEqual([]);
      cap.restore();
    });
  });

  it("E20: a subdirectory of a known repo without its own openspec/ is admitted (never 403)", async () => {
    const repo = makeGitRepo();
    const src = path.join(repo, "src");
    fs.mkdirSync(src);
    await boot({ sessions: [repo] });
    const res = await get(`/api/openspec/tasks?cwd=${q(src)}&change=x`);
    expect(res.statusCode).toBe(404);
  });

  it("E11: change names are single portable segments; invalid ones never reach the lib", async () => {
    const pinned = tmpDir("os-seg-");
    const read = vi.spyOn(tasksLib, "readTasks");
    await boot({ pinned: [pinned] });
    const invalid = ["", ".", "..", "../../outside", "a/b", "aux", "name.", "x".repeat(256)];
    for (const change of invalid) {
      const res = await get(`/api/openspec/tasks?cwd=${q(pinned)}&change=${q(change)}`);
      expect({ change: change.slice(0, 20), status: res.statusCode, code: res.json().code }).toEqual({
        change: change.slice(0, 20),
        status: 400,
        code: "invalid_name",
      });
    }
    const toggle = await post("/api/openspec/tasks/toggle", { cwd: pinned, change: "a/b", id: "1", done: true, line: 1 });
    expect([toggle.statusCode, toggle.json().code]).toEqual([400, "invalid_name"]);
    expect(read).not.toHaveBeenCalled();
    for (const change of ["valid-name", "x".repeat(255)]) {
      const res = await get(`/api/openspec/tasks?cwd=${q(pinned)}&change=${q(change)}`);
      expect(res.statusCode).toBe(404); // reached the lib: tasks.md simply absent
    }
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("E12: openspec signatures, refresh and broadcast keep the RAW (symlink) cwd", async () => {
    const repo = makeGitRepo({ openspec: true });
    fs.mkdirSync(path.join(repo, "openspec", "changes", "demo"), { recursive: true });
    fs.writeFileSync(path.join(repo, "openspec", "changes", "demo", "tasks.md"), "- [ ] 1.1 a\n");
    const link = path.join(tmpDir("os-raw-"), "L");
    fs.symlinkSync(repo, link);
    const onOpenSpecChanged = vi.fn();
    await boot({ pinned: [link], onOpenSpecChanged });
    const upd = await post("/api/openspec/update", { cwd: link });
    expect(upd.statusCode).toBe(200);
    expect(prefs.setOpenSpecUpdateSignature).toHaveBeenCalledWith(link, expect.any(String));
    const tog = await post("/api/openspec/tasks/toggle", { cwd: link, change: "demo", id: "1.1", done: true, line: 1 });
    expect(tog.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(directoryService.refreshOpenSpec).toHaveBeenCalledWith(link);
    expect(onOpenSpecChanged).toHaveBeenCalledWith(link);
  });

  it("X7: an indeterminate admission is a 503 with the shared body and no lib call", async () => {
    const unknown = tmpDir("os-x7-");
    const read = vi.spyOn(tasksLib, "readTasks");
    await boot({ admitOptions: { runner: failingRunner } });
    const res = await get(`/api/openspec/tasks?cwd=${q(unknown)}&change=x`);
    expect(res.statusCode).toBe(503);
    expect(res.headers["retry-after"]).toBe("1");
    expect(res.json()).toEqual({
      success: false,
      code: "cwd-admission-unavailable",
      error: "cwd-admission-unavailable",
      message: "cwd admission could not be decided right now",
      retryAfterMs: 1000,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("X8: the token is released after the response even when the lib throws", async () => {
    const pinned = tmpDir("os-x8-");
    vi.spyOn(tasksLib, "readTasks").mockRejectedValue(new Error("boom"));
    const cap = captureAdmissions();
    await boot({ pinned: [pinned] });
    const res = await get(`/api/openspec/tasks?cwd=${q(pinned)}&change=x`);
    expect(res.statusCode).toBe(500);
    expect(cap.tokens).toHaveLength(1);
    expect(isAdmissionLive(cap.tokens[0])).toBe(false);
    cap.restore();
  });
});
