/**
 * Edit-mode routes: `GET|PUT /api/plugins/flows/edit-mode-default` and
 * `GET /api/plugins/flows/edit-mode-state`. Guarded, narrow, merge-preserving,
 * lock-coordinated; the global file is `<home>/.pi/agent/settings.json` with
 * `PI_CODING_AGENT_DIR` ignored. See change: stop-flows-edit-mode-project-writes
 * (D2, D4; test-plan #E2–#E7, #X1, #X2, #P1).
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalSettingsPath, registerEditModeRoutes } from "../server/edit-mode.js";

const lockfile = createRequire(import.meta.url)("proper-lockfile") as typeof import("proper-lockfile");

const DEFAULT_URL = "/api/plugins/flows/edit-mode-default";
const STATE_URL = "/api/plugins/flows/edit-mode-state";

let home: string;
let cwd: string;
let sessions: Array<{ id: string; cwd: string; status?: string }>;
let broadcast: ReturnType<typeof vi.fn<(msg: unknown) => void>>;
let app: FastifyInstance;
let lockFs: Record<string, unknown> | undefined;

const gfile = () => globalSettingsPath(home);
const pfile = (c = cwd) => path.join(c, ".pi", "settings.json");
const writeJson = (file: string, v: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof v === "string" ? v : JSON.stringify(v, null, 2));
};

async function build(): Promise<FastifyInstance> {
  const a = Fastify();
  await registerEditModeRoutes({
    fastify: a as never,
    networkGuard: async () => {},
    sessionManager: { listActive: () => sessions },
    broadcastToSubscribers: broadcast,
    home,
    ...(lockFs ? { lockFs: lockFs as never } : {}),
  });
  await a.ready();
  return a;
}

beforeEach(async () => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "emr-home-")));
  cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "emr-cwd-")));
  sessions = [{ id: "s1", cwd }];
  broadcast = vi.fn<(msg: unknown) => void>();
  lockFs = undefined;
  app = await build();
});
afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
});

const put = (payload: unknown) =>
  app.inject({ method: "PUT", url: DEFAULT_URL, headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) });

describe("GET edit-mode-default (#E6)", () => {
  it("{} → off", async () => {
    writeJson(gfile(), {});
    expect((await app.inject({ method: "GET", url: DEFAULT_URL })).json()).toEqual({ enabled: false });
  });
  it("legacy flowsEditFlow:true → on", async () => {
    writeJson(gfile(), { flowsEditFlow: true });
    expect((await app.inject({ method: "GET", url: DEFAULT_URL })).json()).toEqual({ enabled: true });
  });
  it("missing file → off, no file created", async () => {
    expect((await app.inject({ method: "GET", url: DEFAULT_URL })).json()).toEqual({ enabled: false });
    expect(fs.existsSync(gfile())).toBe(false);
  });
});

describe("PUT edit-mode-default", () => {
  it.each([[{ enabled: "yes" }], [{}], [null], [{ enabled: 1 }]])("rejects %j with 400, file byte-identical (#E3)", async (body) => {
    writeJson(gfile(), { flows: { editFlow: false } });
    const before = fs.readFileSync(gfile());
    const r = await put(body);
    expect(r.statusCode).toBe(400);
    expect(fs.readFileSync(gfile()).equals(before)).toBe(true);
  });

  it("extra keys are ignored: only flows.editFlow is written (#E3)", async () => {
    writeJson(gfile(), {});
    const r = await put({ enabled: true, path: "/etc/x" });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(fs.readFileSync(gfile(), "utf-8"))).toEqual({ flows: { editFlow: true } });
  });

  it("preserves unrelated keys (#E4)", async () => {
    const prior = {
      packages: [{ source: "npm:x" }],
      dashboardPluginBridges: { a: { enabled: true } },
      flows: { someOtherKey: 7 },
    };
    writeJson(gfile(), prior);
    expect((await put({ enabled: true })).statusCode).toBe(200);
    const after = JSON.parse(fs.readFileSync(gfile(), "utf-8"));
    expect(after.flows.editFlow).toBe(true);
    expect(after.packages).toEqual(prior.packages);
    expect(after.dashboardPluginBridges).toEqual(prior.dashboardPluginBridges);
    expect(after.flows.someOtherKey).toBe(7);
  });

  it("writes <home>/.pi/agent, never $PI_CODING_AGENT_DIR (#E5)", async () => {
    const alt = path.join(home, "alt");
    writeJson(path.join(alt, "settings.json"), { sentinel: true });
    const altBefore = fs.readFileSync(path.join(alt, "settings.json"));
    const prev = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = alt;
    let lockSeenAtHome = false;
    await app.close();
    lockFs = {
      writeFile: async (p: string, d: string) => {
        lockSeenAtHome ||= fs.existsSync(`${gfile()}.lock`);
        await fs.promises.writeFile(p, d, "utf-8");
      },
    };
    app = await build();
    try {
      expect((await put({ enabled: true })).statusCode).toBe(200);
    } finally {
      if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = prev;
    }
    expect(JSON.parse(fs.readFileSync(gfile(), "utf-8")).flows.editFlow).toBe(true);
    expect(lockSeenAtHome).toBe(true);
    expect(fs.readFileSync(path.join(alt, "settings.json")).equals(altBefore)).toBe(true);
    expect(fs.existsSync(path.join(alt, "settings.json.lock"))).toBe(false);
  });

  it("unparseable global → 400 + position-only parseError, byte-identical (#X1)", async () => {
    writeJson(gfile(), '{"flows":');
    const before = fs.readFileSync(gfile());
    const r = await put({ enabled: true });
    expect(r.statusCode).toBe(400);
    expect(r.json().parseError).toMatch(/^Invalid JSON( at line \d+, column \d+)?$/);
    expect(fs.readFileSync(gfile()).equals(before)).toBe(true);
  });

  it("lock held past the retry budget → 503, byte-identical (#X2)", async () => {
    writeJson(gfile(), { flows: { editFlow: false } });
    const before = fs.readFileSync(gfile());
    const release = await lockfile.lock(gfile(), { realpath: false, stale: 10_000 });
    try {
      const r = await put({ enabled: true });
      expect(r.statusCode).toBe(503);
    } finally {
      await release();
    }
    expect(fs.readFileSync(gfile()).equals(before)).toBe(true);
  });

  it("pushes one frame per active session, one project read per cwd (#P1)", async () => {
    const cwds = Array.from({ length: 5 }, (_, i) => {
      const c = path.join(cwd, `repo${i}`);
      fs.mkdirSync(c);
      return c;
    });
    writeJson(pfile(cwds[0]), { flows: { editFlow: false } });
    sessions = Array.from({ length: 50 }, (_, i) => ({ id: `s${i}`, cwd: cwds[i % 5] }));
    const readSpy = vi.spyOn(fs, "readFileSync");
    expect((await put({ enabled: true })).statusCode).toBe(200);
    const projectReads = readSpy.mock.calls.filter((c) => cwds.some((cw) => String(c[0]) === pfile(cw)));
    expect(projectReads).toHaveLength(5);
    const frames = broadcast.mock.calls.map((c) => c[0] as { type: string; sessionId: string }).filter((f) => f.type === "flows_edit_mode_state");
    expect(frames).toHaveLength(50);
    expect(frames.find((f) => f.sessionId === "s0")).toEqual({ type: "flows_edit_mode_state", sessionId: "s0", enabled: false });
    expect(frames.find((f) => f.sessionId === "s1")).toEqual({ type: "flows_edit_mode_state", sessionId: "s1", enabled: true });
  });
});

describe("GET edit-mode-state", () => {
  it("unknown session → 404 before any file read (#E7)", async () => {
    const readSpy = vi.spyOn(fs, "readFileSync");
    const r = await app.inject({ method: "GET", url: `${STATE_URL}?sessionId=ghost` });
    expect(r.statusCode).toBe(404);
    expect(readSpy).not.toHaveBeenCalled();
  });

  it("remote-origin session → 404 before any file read", async () => {
    sessions = [{ id: "s1", cwd, originDeviceId: "dev-remote" } as never];
    const readSpy = vi.spyOn(fs, "readFileSync");
    expect((await app.inject({ method: "GET", url: `${STATE_URL}?sessionId=s1` })).statusCode).toBe(404);
    expect(readSpy).not.toHaveBeenCalled();
  });

  it("ended session → 404", async () => {
    sessions = [{ id: "s1", cwd, status: "ended" }];
    expect((await app.inject({ method: "GET", url: `${STATE_URL}?sessionId=s1` })).statusCode).toBe(404);
  });

  it("unparseable project → global value, project file untouched (#E2)", async () => {
    writeJson(pfile(), "{bad json");
    writeJson(gfile(), { flows: { editFlow: true } });
    const before = fs.readFileSync(pfile());
    const mtime = fs.statSync(pfile()).mtimeMs;
    const r = await app.inject({ method: "GET", url: `${STATE_URL}?sessionId=s1` });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ enabled: true });
    expect(fs.readFileSync(pfile()).equals(before)).toBe(true);
    expect(fs.statSync(pfile()).mtimeMs).toBe(mtime);
  });

  it("project value overrides global", async () => {
    writeJson(pfile(), { flows: { editFlow: true } });
    writeJson(gfile(), { flows: { editFlow: false } });
    expect((await app.inject({ method: "GET", url: `${STATE_URL}?sessionId=s1` })).json()).toEqual({ enabled: true });
  });
});
