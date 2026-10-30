/**
 * Automation REST routes admit the request `cwd` (S1r): a supplied cwd is admitted tri-state
 * (403 / 503) before any fs/git access, a folder-scope route without one is `cwd_required`
 * (never the server process cwd), a non-string cwd is `invalid_cwd`, and the admit set is read
 * per request from the host known folders plus the folder-scope contribution axis.
 *
 * See change: harden-git-terminal-plugin-boundaries (test-plan #SE27, #SE28, #SE29, #SE39, #SP3, #SX4).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as guard from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import { type GitProbeRunner, realpathAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { registerPlugin } from "../server/index.js";
import { type AutomationRouteHooks, mountAutomationRoutes } from "../server/routes.js";
import { finishRun, startRun } from "../server/run-store.js";

// Record every path-bearing read/write the routes perform, so "0 reads/writes under that cwd"
// is asserted on the real calls (the routes load fs lazily, so spying a default import is not enough).
const fsLog = vi.hoisted(() => ({ calls: [] as Array<{ fn: string; path: string }> }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const names = [
    "readFileSync",
    "writeFileSync",
    "mkdirSync",
    "readdirSync",
    "renameSync",
    "rmSync",
    "appendFileSync",
    "copyFileSync",
    "unlinkSync",
    "rmdirSync",
    "openSync",
  ] as const;
  const wrapped: Record<string, unknown> = { ...actual };
  for (const name of names) {
    const original = actual[name] as (...a: unknown[]) => unknown;
    wrapped[name] = (...args: unknown[]) => {
      if (typeof args[0] === "string") fsLog.calls.push({ fn: name, path: args[0] });
      return original(...args);
    };
  }
  return { ...wrapped, default: wrapped };
});

// Every git subprocess the ROUTES start (admission derives through its own injected runner).
const execLog = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/platform/exec.js")>();
  return {
    ...actual,
    execFileSync: (...args: Parameters<typeof actual.execFileSync>) => {
      execLog.calls.push(args);
      return actual.execFileSync(...args);
    },
  };
});

const touchedUnder = (dir: string) => fsLog.calls.filter((c) => c.path === dir || c.path.startsWith(dir + path.sep));

const canon = (p: string) => fs.realpathSync(p);
const mkTmp = (prefix: string) => canon(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

const CONFIG = {
  on: { kind: "schedule", cron: "* * * * *" },
  action: { kind: "prompt", prompt: "./prompt.md" },
  model: "@fast",
};
const YAML = `on: { kind: schedule, cron: "* * * * *" }
action: { kind: prompt, prompt: ./prompt.md }
model: "@fast"
`;

function writeAuto(base: string, name: string): void {
  const d = path.join(base, ".pi", "automation", name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "automation.yaml"), YAML);
  fs.writeFileSync(path.join(d, "prompt.md"), "hi");
}

let H: string; // $HOME (global scope base)
let R: string; // admitted repo
let U: string; // existing, unadmitted dir carrying a probe automation
let D: string; // decoy: what process.cwd() points at
let realHome: string | undefined;
let admitSpy: MockInstance<typeof guard.admitCwd>;
let realAdmitCwd: typeof guard.admitCwd;

beforeEach(() => {
  realHome = process.env.HOME;
  H = mkTmp("adm-home-");
  R = mkTmp("adm-repo-");
  U = mkTmp("adm-unknown-");
  D = mkTmp("adm-decoy-");
  process.env.HOME = H;
  for (const base of [H, R, U, D]) writeAuto(base, "nightly");
  writeAuto(D, "decoy");
  vi.spyOn(process, "cwd").mockReturnValue(D);
  realAdmitCwd = guard.admitCwd; // before the spy replaces it
  admitSpy = vi.spyOn(guard, "admitCwd");
});
afterEach(() => {
  vi.restoreAllMocks();
  process.env.HOME = realHome;
  for (const d of [H, R, U, D]) fs.rmSync(d, { recursive: true, force: true });
});

async function appWith(hooks: AutomationRouteHooks = {}): Promise<FastifyInstance> {
  const app = Fastify();
  mountAutomationRoutes(app, { knownCwds: () => [R], readFileGuarded: (p) => fs.promises.readFile(p, "utf-8"), ...hooks });
  await app.ready();
  return app;
}

type Scope = "absent" | "folder" | "global";
type CwdKind = "absent" | "empty" | "unadmitted" | "admitted";
const cwdOf = (k: CwdKind): string | undefined =>
  k === "absent" ? undefined : k === "empty" ? "" : k === "unadmitted" ? U : R;

interface Route {
  id: string;
  build(scope: Scope, cwd: string | undefined): { method: "GET" | "POST" | "DELETE"; url: string; payload?: object };
}
const qs = (o: Record<string, string | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join("&");
const common = (scope: Scope, cwd: string | undefined) => ({
  ...(scope === "absent" ? {} : { scope }),
  ...(cwd === undefined ? {} : { cwd }),
});

const FOLDER_SCOPE_ROUTES: Route[] = [
  {
    id: "create",
    build: (s, c) => ({
      method: "POST",
      url: "/api/plugins/automation/create",
      payload: { ...common(s, c), name: "fresh", config: CONFIG, promptBody: "hi" },
    }),
  },
  {
    id: "update",
    build: (s, c) => ({
      method: "POST",
      url: "/api/plugins/automation/update",
      payload: { ...common(s, c), name: "nightly", config: CONFIG, promptBody: "hi" },
    }),
  },
  {
    id: "delete",
    build: (s, c) => ({
      method: "DELETE",
      url: `/api/plugins/automation?${qs({ ...common(s, c), name: "nightly" })}`,
    }),
  },
  {
    id: "definition",
    build: (s, c) => ({
      method: "GET",
      url: `/api/plugins/automation/definition?${qs({ ...common(s, c), name: "nightly" })}`,
    }),
  },
  { id: "runs", build: (s, c) => ({ method: "GET", url: `/api/plugins/automation/runs?${qs(common(s, c))}` }) },
  {
    id: "result-by-run-id",
    build: (s, c) => ({
      method: "GET",
      url: `/api/plugins/automation/result?${qs({ ...common(s, c), runId: "r1" })}`,
    }),
  },
];

/** A finished run `r1` under every base, so a 2xx result lookup has something to find. */
function seedRuns(): void {
  for (const base of [H, R, U, D]) {
    startRun(base, "nightly", { runId: "r1" });
    finishRun(base, "r1", { status: "done", result: "- one" });
  }
}

describe("SE27 — folder-scope automation routes × scope × cwd", () => {
  for (const route of FOLDER_SCOPE_ROUTES) {
    for (const scope of ["absent", "folder", "global"] as const) {
      for (const kind of ["absent", "empty", "unadmitted", "admitted"] as const) {
        const folderScope = scope !== "global";
        const label = `${route.id} · scope ${scope} · cwd ${kind}`;
        it(label, async () => {
          seedRuns();
          const app = await appWith();
          fsLog.calls.length = 0;
          admitSpy.mockClear();
          const cwd = cwdOf(kind);
          const res = await app.inject(route.build(scope, cwd));
          await app.close();

          if (kind === "unadmitted") {
            expect(res.statusCode).toBe(403);
            expect(res.json()).toMatchObject({ error: "not-allowed", reason: expect.any(String), hint: expect.any(String) });
            expect(touchedUnder(U)).toEqual([]);
          } else if (folderScope && (kind === "absent" || kind === "empty")) {
            expect(res.statusCode).toBe(400);
            expect(res.json().error).toBe("cwd_required");
            expect(admitSpy).not.toHaveBeenCalled();
          } else {
            expect(res.statusCode, res.body).toBeLessThan(300);
          }
          // The decoy under process.cwd() is never read nor written, in any case.
          expect(touchedUnder(D)).toEqual([]);
        });
      }
    }
  }

  it("global scope + absent cwd resolves to the home dir", async () => {
    const app = await appWith();
    const res = await app.inject({
      method: "GET",
      url: `/api/plugins/automation/definition?${qs({ scope: "global", name: "nightly" })}`,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().config.model).toBe("@fast");
    expect(touchedUnder(H).length).toBeGreaterThan(0);
  });
});

describe("SE28 — remaining automation routes × {no cwd, unadmitted, admitted}", () => {
  it("GET /list: no cwd lists global only; unadmitted 403; admitted lists the folder", async () => {
    writeAuto(R, "build");
    const app = await appWith();
    const names = async (cwd?: string) => {
      const res = await app.inject({
        method: "GET",
        url: `/api/plugins/automation/list${cwd === undefined ? "" : `?${qs({ cwd })}`}`,
      });
      return { res, list: (res.json().automations ?? []) as Array<{ name: string; scope: string }> };
    };
    const none = await names();
    expect(none.res.statusCode).toBe(200);
    expect(none.list.every((a) => a.scope === "global")).toBe(true);
    expect(none.list.some((a) => a.name === "decoy")).toBe(false);

    fsLog.calls.length = 0;
    expect((await names(U)).res.statusCode).toBe(403);
    expect(touchedUnder(U)).toEqual([]);

    const ok = await names(R);
    expect(ok.res.statusCode).toBe(200);
    expect(ok.list.some((a) => a.name === "build" && a.scope === "folder")).toBe(true);
    await app.close();
  });

  it("GET /git-capable: no cwd → false; unadmitted 403; admitted answers", async () => {
    execFileSync("git", ["init", "-q"], { cwd: R });
    const app = await appWith();
    const get = (cwd?: string) =>
      app.inject({ method: "GET", url: `/api/plugins/automation/git-capable${cwd === undefined ? "" : `?${qs({ cwd })}`}` });
    expect((await get()).json()).toEqual({ gitCapable: false });
    expect((await get(U)).statusCode).toBe(403);
    const ok = await get(R);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ gitCapable: true });
    await app.close();
  });

  it("POST /run and /stop: no cwd unchanged; unadmitted 403 (hook not called); admitted passes cwd", async () => {
    const runNow = vi.fn(async () => ({ ok: true, runId: "x" }));
    const stopRun = vi.fn(async () => ({ ok: true }));
    const app = await appWith({ runNow, stopRun });
    const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload });

    expect((await post("/api/plugins/automation/run", { name: "n" })).statusCode).toBe(200);
    expect(runNow).toHaveBeenLastCalledWith({ scope: "folder", name: "n" });
    expect((await post("/api/plugins/automation/run", { name: "n", cwd: U })).statusCode).toBe(403);
    expect(runNow).toHaveBeenCalledTimes(1);
    expect((await post("/api/plugins/automation/run", { name: "n", cwd: R })).statusCode).toBe(200);
    expect(runNow).toHaveBeenLastCalledWith({ scope: "folder", cwd: R, name: "n" });

    expect((await post("/api/plugins/automation/stop", { runId: "r" })).statusCode).toBe(200);
    expect((await post("/api/plugins/automation/stop", { runId: "r", cwd: U })).statusCode).toBe(403);
    expect(stopRun).toHaveBeenCalledTimes(1);
    expect((await post("/api/plugins/automation/stop", { runId: "r", cwd: R })).statusCode).toBe(200);
    expect(stopRun).toHaveBeenLastCalledWith({ scope: "folder", cwd: R, runId: "r" });
    await app.close();
  });

  it("GET /actions: no cwd unchanged; unadmitted 403; admitted resolves for that cwd", async () => {
    const listActions = vi.fn((_cwd?: string) => []);
    const app = await appWith({ listActions });
    const get = (cwd?: string) =>
      app.inject({ method: "GET", url: `/api/plugins/automation/actions${cwd === undefined ? "" : `?${qs({ cwd })}`}` });
    expect((await get()).statusCode).toBe(200);
    expect(listActions).toHaveBeenLastCalledWith(undefined);
    expect((await get(U)).statusCode).toBe(403);
    expect(listActions).toHaveBeenCalledTimes(1);
    expect((await get(R)).statusCode).toBe(200);
    expect(listActions).toHaveBeenLastCalledWith(R);
    await app.close();
  });

  it("GET /trigger-kinds takes no cwd: unchanged whatever is passed", async () => {
    const app = await appWith();
    for (const url of ["/api/plugins/automation/trigger-kinds", `/api/plugins/automation/trigger-kinds?${qs({ cwd: U })}`]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(200);
    }
    expect(admitSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it("GET /result?sessionId=: no cwd searches global only; unadmitted 403; admitted finds the folder run", async () => {
    startRun(H, "nightly", { runId: "g1", sessionId: "s-global" });
    startRun(D, "nightly", { runId: "d1", sessionId: "s-decoy" });
    startRun(R, "nightly", { runId: "f1", sessionId: "s-folder" });
    const app = await appWith();
    const get = (sessionId: string, cwd?: string) =>
      app.inject({ method: "GET", url: `/api/plugins/automation/result?${qs({ sessionId, ...(cwd ? { cwd } : {}) })}` });
    expect((await get("s-global")).statusCode).toBe(200);
    expect((await get("s-decoy")).statusCode).toBe(404); // the process cwd is never searched
    expect((await get("s-folder")).statusCode).toBe(404); // folder scope needs a cwd
    fsLog.calls.length = 0;
    expect((await get("s-folder", U)).statusCode).toBe(403);
    expect(touchedUnder(U)).toEqual([]);
    expect((await get("s-folder", R)).json()).toMatchObject({ runId: "f1" });
    await app.close();
  });
});

describe("SE39 — a non-string cwd is invalid_cwd", () => {
  const POST_BAD: unknown[] = [{}, 42, true, ["/abs"]];

  it("POST routes: every non-string JSON cwd → 400 invalid_cwd, admission never called, no fs access", async () => {
    const app = await appWith({ runNow: async () => ({ ok: true }), stopRun: async () => ({ ok: true }) });
    const bodies: Array<[string, object]> = [
      ["create", { name: "fresh", config: CONFIG }],
      ["update", { name: "nightly", config: CONFIG }],
      ["run", { name: "nightly" }],
      ["stop", { runId: "r" }],
    ];
    for (const [route, base] of bodies) {
      for (const bad of POST_BAD) {
        fsLog.calls.length = 0;
        const res = await app.inject({ method: "POST", url: `/api/plugins/automation/${route}`, payload: { ...base, cwd: bad } });
        expect(res.statusCode, `${route} ${JSON.stringify(bad)}`).toBe(400);
        expect(res.json().error).toBe("invalid_cwd");
        expect(fsLog.calls).toEqual([]);
      }
    }
    expect(admitSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it("GET/DELETE routes: a repeated ?cwd= (array) → 400 invalid_cwd", async () => {
    const app = await appWith({ listActions: () => [] });
    const urls = [
      "list",
      "git-capable",
      "actions",
      "runs",
      "definition?name=nightly",
      "result?runId=r1",
      "result?sessionId=s1",
    ];
    for (const u of urls) {
      const sep = u.includes("?") ? "&" : "?";
      const res = await app.inject({ method: "GET", url: `/api/plugins/automation/${u}${sep}cwd=a&cwd=b` });
      expect(res.statusCode, u).toBe(400);
      expect(res.json().error).toBe("invalid_cwd");
    }
    const del = await app.inject({ method: "DELETE", url: "/api/plugins/automation?name=nightly&cwd=a&cwd=b" });
    expect(del.statusCode).toBe(400);
    expect(del.json().error).toBe("invalid_cwd");
    expect(admitSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it("an absent or empty cwd still answers cwd_required (a distinct code)", async () => {
    const app = await appWith();
    for (const cwd of [undefined, ""]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/plugins/automation/create",
        payload: { name: "fresh", config: CONFIG, ...(cwd === undefined ? {} : { cwd }) },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("cwd_required");
    }
    await app.close();
  });
});

describe("SE29 — the admit set: session cwd, pinned dir, folder-scope contribution", () => {
  const ENGINE_NOOP = () => {};

  /** Boot the production plugin entry on a real Fastify so the admit set is the one it wires. */
  async function boot(opts: { sessionCwd: string; pinned: string; provided: Map<string, unknown> }) {
    const app = Fastify();
    const { provided } = opts;
    const ctx = {
      fastify: app,
      sessionManager: { listAll: () => [{ cwd: opts.sessionCwd }], getSession: () => undefined },
      eventStore: {},
      broadcastToSubscribers: ENGINE_NOOP,
      registerPiHandler: ENGINE_NOOP,
      registerBrowserHandler: ENGINE_NOOP,
      onEvent: ENGINE_NOOP,
      onSessionEnded: ENGINE_NOOP,
      sendToSession: ENGINE_NOOP,
      emitEventToSession: ENGINE_NOOP,
      spawnSession: async () => ({ success: false }),
      abortSession: async () => true,
      abortSpawnedRun: async () => true,
      provide: (k: string, v: unknown) => provided.set(k, v),
      consume: (k: string) =>
        k === "host.knownFolderCwds" ? () => [opts.sessionCwd, opts.pinned] : provided.get(k),
      consumeAll: (prefix: string) =>
        [...provided.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value })),
      getPluginConfig: () => ({ scanGlobalScope: false, scanFolderScope: false }),
      updatePluginConfig: async () => {},
      logger: { info: ENGINE_NOOP, warn: ENGINE_NOOP, error: ENGINE_NOOP },
    } as unknown as Parameters<typeof registerPlugin>[0];
    await registerPlugin(ctx);
    await app.ready();
    return app;
  }

  it("admits the first three, refuses the fourth, and drops a disabled contributor on the very next request", async () => {
    const session = mkTmp("adm-session-");
    const pinned = mkTmp("adm-pinned-");
    const contributed = mkTmp("adm-contrib-");
    const provided = new Map<string, unknown>([["automation.folderscope.contrib", { base: contributed }]]);
    const app = await boot({ sessionCwd: session, pinned, provided });
    const status = async (cwd: string) =>
      (await app.inject({ method: "GET", url: `/api/plugins/automation/list?${qs({ cwd })}` })).statusCode;
    try {
      expect(await status(session)).toBe(200);
      expect(await status(pinned)).toBe(200);
      expect(await status(contributed)).toBe(200);
      expect(await status(U)).toBe(403);

      // "Disable" the contributing plugin: its contribution is gone. No restart, no cache.
      provided.delete("automation.folderscope.contrib");
      expect(await status(contributed)).toBe(403);
      expect(await status(session)).toBe(200);
    } finally {
      await app.close();
      for (const d of [session, pinned, contributed]) fs.rmSync(d, { recursive: true, force: true });
    }
  });
});

/** Every `admitCwd` token the routes mint, and whether each is still live (kit-equivalent, self-contained). */
function captureTokens(): { tokens: guard.AdmissionToken[]; admits: () => number } {
  const tokens: guard.AdmissionToken[] = [];
  admitSpy.mockImplementation(async (...args) => {
    const result = await realAdmitCwd(...args);
    if (result.kind === "admit") tokens.push(result.token);
    return result;
  });
  return { tokens, admits: () => tokens.length };
}

describe("SP3 — every admission token is released, no request is left pending", () => {
  it("1 000 mixed admit / refuse / indeterminate requests across the cwd-taking routes", async () => {
    const missing = path.join(os.tmpdir(), "adm-does-not-exist-sp3");
    const flaky = mkTmp("adm-flaky-");
    const realRealpath = realpathAsync;
    const app = await appWith({
      listActions: () => [],
      runNow: async () => ({ ok: true }),
      stopRun: async () => ({ ok: true }),
      admitOptions: {
        realpath: async (p) => (p === flaky ? { kind: "error", code: "EACCES" } : realRealpath(p)),
      },
    });
    const { tokens } = captureTokens();
    const kinds = [R, missing, flaky] as const; // admit, refuse, indeterminate
    const urls = (cwd: string) => [
      { method: "GET" as const, url: `/api/plugins/automation/list?${qs({ cwd })}` },
      { method: "GET" as const, url: `/api/plugins/automation/runs?${qs({ cwd })}` },
      { method: "GET" as const, url: `/api/plugins/automation/actions?${qs({ cwd })}` },
      { method: "POST" as const, url: "/api/plugins/automation/run", payload: { name: "n", cwd } },
      { method: "POST" as const, url: "/api/plugins/automation/stop", payload: { runId: "r", cwd } },
    ];
    const jobs: Array<{ method: "GET" | "POST"; url: string; payload?: object; expect: number }> = [];
    for (let i = 0; i < 1000; i++) {
      const cwd = kinds[i % 3]!;
      const job = urls(cwd)[i % 5]!;
      jobs.push({ ...job, expect: cwd === R ? 200 : cwd === missing ? 403 : 503 });
    }
    const statuses: number[] = [];
    for (let i = 0; i < jobs.length; i += 50) {
      const settled = await Promise.allSettled(
        jobs.slice(i, i + 50).map(async (j) => (await app.inject({ method: j.method, url: j.url, ...(j.payload ? { payload: j.payload } : {}) })).statusCode),
      );
      for (const r of settled) {
        expect(r.status).toBe("fulfilled");
        if (r.status === "fulfilled") statuses.push(r.value);
      }
    }
    await app.close();
    expect(statuses).toEqual(jobs.map((j) => j.expect));
    // Every minted token is released (nothing outstanding); admits are exactly the admitted requests.
    expect(tokens.length).toBe(jobs.filter((j) => j.expect === 200).length);
    expect(tokens.filter((t) => guard.isAdmissionLive(t))).toEqual([]);
    fs.rmSync(flaky, { recursive: true, force: true });
  }, 60_000);
});

describe("SX4 — admission runner failure / deadline → 503 with Retry-After, recovery admits", () => {
  const failingRunner: GitProbeRunner = async () => ({ ok: false, error: { kind: "spawn-failure", message: "EAGAIN" } });
  const slowRunner: GitProbeRunner = (_recipe, _input, ctx) =>
    new Promise((resolve) => {
      const fail = { ok: false, error: { kind: "spawn-failure", message: "slow" } } as const;
      const done = () => {
        ctx.onClose?.();
        resolve(fail as never);
      };
      const timer = setTimeout(done, 150);
      ctx.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        done();
      });
    });
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@t.com", "-c", "user.name=T", ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });

  it.each([
    ["runner fails", { runner: failingRunner } as const],
    // A runner slower than the whole-decision deadline. Like a real git child it ends its probe on
    // abort (`ctx.onClose`), so the derivation slot is freed and recovery is possible.
    ["deadline exceeded", { runner: slowRunner, deadlineMs: 30 } as const],
  ])("%s: every route family answers 503 cwd-admission-unavailable, touches nothing under the cwd, then recovers", async (_label, failing) => {
    // A linked worktree of the known repo R: not itself known, so admission must DERIVE its main checkout with git.
    git(R, "init", "-q");
    git(R, "commit", "--allow-empty", "-q", "-m", "init");
    const W = path.join(mkTmp("adm-wt-parent-"), "wt");
    git(R, "worktree", "add", "-q", "-b", "sx4", W);
    const admitOptions: NonNullable<AutomationRouteHooks["admitOptions"]> = { ...failing };
    const app = await appWith({
      listActions: () => [],
      runNow: async () => ({ ok: true }),
      stopRun: async () => ({ ok: true }),
      admitOptions,
    });
    const reqs: Array<{ method: "GET" | "POST" | "DELETE"; url: string; payload?: object }> = [
      { method: "POST", url: "/api/plugins/automation/create", payload: { name: "fresh", config: CONFIG, cwd: W } },
      { method: "POST", url: "/api/plugins/automation/update", payload: { name: "nightly", config: CONFIG, cwd: W } },
      { method: "DELETE", url: `/api/plugins/automation?${qs({ name: "nightly", cwd: W })}` },
      { method: "GET", url: `/api/plugins/automation/definition?${qs({ name: "nightly", cwd: W })}` },
      { method: "GET", url: `/api/plugins/automation/runs?${qs({ cwd: W })}` },
      { method: "GET", url: `/api/plugins/automation/result?${qs({ runId: "r1", cwd: W })}` },
      { method: "GET", url: `/api/plugins/automation/result?${qs({ sessionId: "s1", cwd: W })}` },
      { method: "GET", url: `/api/plugins/automation/list?${qs({ cwd: W })}` },
      { method: "GET", url: `/api/plugins/automation/git-capable?${qs({ cwd: W })}` },
      { method: "GET", url: `/api/plugins/automation/actions?${qs({ cwd: W })}` },
      { method: "POST", url: "/api/plugins/automation/run", payload: { name: "n", cwd: W } },
      { method: "POST", url: "/api/plugins/automation/stop", payload: { runId: "r", cwd: W } },
    ];
    fsLog.calls.length = 0;
    execLog.calls.length = 0;
    for (const r of reqs) {
      const res = await app.inject({ method: r.method, url: r.url, ...(r.payload ? { payload: r.payload } : {}) });
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(503);
      expect(res.json()).toMatchObject({ error: "cwd-admission-unavailable", retryAfterMs: 1000 });
      expect(res.headers["retry-after"]).toBe("1");
    }
    expect(touchedUnder(W)).toEqual([]);
    expect(execLog.calls).toEqual([]);

    // Recovery: the very next request (real git runner, no deadline) is admitted.
    delete admitOptions.runner;
    delete admitOptions.deadlineMs;
    const ok = await app.inject({ method: "GET", url: `/api/plugins/automation/list?${qs({ cwd: W })}` });
    expect(ok.statusCode).toBe(200);
    await app.close();
    fs.rmSync(path.dirname(W), { recursive: true, force: true });
  });
});
