/**
 * mcp-client routes · async tri-state cwd admission + the host `holdCwdDenial`
 * seam. Covers test-plan E21, E23, E27–E29, E31–E34 (route level).
 * See change: harden-plugin-cwd-admission.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CwdHoldDecision } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { createMcpClientConfigService } from "@blackbelt-technology/pi-dashboard-mcp-core/service.js";
import type { ConfigIO, PiMcpListRunner, Scope } from "@blackbelt-technology/pi-dashboard-mcp-core/types.js";
import type { GitProbeRunner } from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import { runAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/runner.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountMcpClientRoutes } from "../routes.js";

// Spy on the SYNCHRONOUS guard: no route may reach it for a project scope.
const syncGuard = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@blackbelt-technology/pi-dashboard-shared/cwd-guard.js", async (orig) => {
  const real = await orig<typeof import("@blackbelt-technology/pi-dashboard-shared/cwd-guard.js")>();
  return {
    ...real,
    isAllowedCwd: (...args: Parameters<typeof real.isAllowedCwd>) => {
      syncGuard.calls += 1;
      return real.isAllowedCwd(...args);
    },
  };
});

const GLOBAL = "/agent/mcp.json";
const timeoutRunner: GitProbeRunner = async () => ({
  ok: false,
  error: { kind: "timeout", timeoutMs: 1000, binary: "git" },
});

interface H {
  app: FastifyInstance;
  files: Map<string, string>;
  writes: string[];
  tmp: string;
  known: string[];
  seen: Array<{ method: string; scope: Scope }>;
  runnerSpawns: { n: number };
  hold: ReturnType<typeof vi.fn>;
}

let h: H | null = null;

async function harness(
  opts: {
    hold?: ((cwd: string) => Promise<CwdHoldDecision>) | "absent";
    runner?: GitProbeRunner;
  } = {},
): Promise<H> {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "mcp-adm-")));
  const files = new Map<string, string>([[GLOBAL, JSON.stringify({ mcpServers: { a: { command: "a" } } })]]);
  const writes: string[] = [];
  const io: ConfigIO = {
    readFile: (p) => files.get(p) ?? null,
    writeFileAtomic: (p, c) => {
      writes.push(p);
      files.set(p, c);
    },
  };
  const known: string[] = [];
  const runner: PiMcpListRunner = async () => ({ stdout: JSON.stringify({ servers: [], errors: [] }), code: 0 });
  const runtime = createMcpClientConfigService({
    configIO: io,
    paths: { globalPath: () => GLOBAL, projectPath: (cwd) => `${cwd}/.pi/mcp.json` },
    knownCwds: () => known,
    isProjectTrusted: () => true,
    scratchCwd: "/tmp/mcp-scratch",
    runner,
  });
  const seen: H["seen"] = [];
  const spied = new Proxy(runtime, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        const scope = args.find((a): a is Scope => typeof a === "object" && a !== null && "kind" in a);
        if (scope) seen.push({ method: String(prop), scope });
        return v.apply(target, args);
      };
    },
  });
  const spawns = { n: 0 };
  const countingRunner: GitProbeRunner = async (recipe, input, ctx) => {
    spawns.n++;
    return (opts.runner ?? runAsync)(recipe, input, ctx);
  };
  const hold = vi.fn(async (_req: unknown, _reply: unknown, input: { cwd: string }) =>
    typeof opts.hold === "function" ? opts.hold(input.cwd) : ({ kind: "refuse" } as CwdHoldDecision),
  );
  const app = Fastify();
  mountMcpClientRoutes(app, {
    runtime: spied,
    knownCwds: () => known,
    networkGuard: async () => undefined,
    ...(opts.hold === "absent" ? {} : { holdCwdDenial: hold as never }),
    admitOptions: { runner: countingRunner },
  });
  await app.ready();
  h = { app, files, writes, tmp, known, seen, runnerSpawns: spawns, hold };
  return h;
}

beforeEach(() => {
  syncGuard.calls = 0;
});
afterEach(async () => {
  if (h) {
    await h.app.close();
    rmSync(h.tmp, { recursive: true, force: true });
    h = null;
  }
});

const dir = (hh: H, name: string) => {
  const d = join(hh.tmp, name);
  mkdirSync(d, { recursive: true });
  return d;
};
const put = (hh: H, cwd: string, extra: Record<string, unknown> = {}) =>
  hh.app.inject({
    method: "PUT",
    url: "/api/mcp-client/servers/x",
    payload: { scope: "project", cwd, entry: { command: "x" }, ...extra },
  });
const NOT_ALLOWED = (cwd: string) => ({
  error: "not-allowed",
  message: `cwd not allowed: ${cwd}`,
  reason: "cwd is not a known session or pinned directory.",
  hint: "Pin this directory to allow it, or open a session rooted in it.",
});

describe("E21: a client-sent admission is ignored", () => {
  it("403 existing body and no file written", async () => {
    const hh = await harness();
    const res = await put(hh, "/unknown", { admission: { canonCwd: "/unknown", rawCwd: "/unknown" } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(NOT_ALLOWED("/unknown"));
    expect(hh.writes).toEqual([]);
  });
});

describe("E23: every route that reaches the writer / live reader passes a live token", () => {
  it("PUT, DELETE, enabled, convert, /live and /effective on an admissible cwd never reach the sync guard", async () => {
    const hh = await harness();
    const cwd = dir(hh, "proj");
    hh.known.push(cwd);
    const q = `scope=project&cwd=${encodeURIComponent(cwd)}`;
    // Sequential: the routes act on ONE shared server entry, so concurrent calls would make
    // each status depend on interleaving (a convert racing the save), not on admission.
    const calls = [
      await put(hh, cwd),
      await hh.app.inject({
        method: "PUT",
        url: "/api/mcp-client/servers/x/enabled",
        payload: { scope: "project", cwd, enabled: false },
      }),
      await hh.app.inject({ method: "POST", url: "/api/mcp-client/servers/x/convert", payload: { scope: "project", cwd } }),
      await hh.app.inject({ method: "GET", url: `/api/mcp-client/live?cwd=${encodeURIComponent(cwd)}` }),
      await hh.app.inject({ method: "GET", url: `/api/mcp-client/effective?cwd=${encodeURIComponent(cwd)}` }),
      await hh.app.inject({ method: "DELETE", url: `/api/mcp-client/servers/x?${q}` }),
    ];
    for (const r of calls) expect([200, 404, 409]).toContain(r.statusCode);
    const methods = new Set(hh.seen.map((s) => s.method));
    for (const m of ["saveServer", "removeServer", "setEnabled", "convertAdapterLeftovers", "getLiveState", "getEffectiveView"]) {
      expect(methods.has(m)).toBe(true);
    }
    for (const { scope } of hh.seen) {
      expect(scope.kind === "project" && scope.admission !== undefined).toBe(true);
    }
    expect(syncGuard.calls).toBe(0);
  });

  it("the token dies when the request finishes", async () => {
    const hh = await harness();
    const cwd = dir(hh, "proj");
    hh.known.push(cwd);
    await put(hh, cwd);
    const { isAdmissionLive } = await import("@blackbelt-technology/pi-dashboard-shared/cwd-guard.js");
    const save = hh.seen.find((s) => s.method === "saveServer");
    expect(save?.scope.kind === "project" && isAdmissionLive(save.scope.admission)).toBe(false);
  });
});

describe("E27–E31: user-initiated writes raise the access dialog", () => {
  it("E27: allow-always → pinned, 200, file written", async () => {
    const hh = await harness({
      hold: async (cwd) => {
        const canon = realpathSync(cwd);
        hh.known.push(canon);
        return { kind: "admit", canonCwd: canon, cwd: resolve(cwd) };
      },
    });
    const cwd = dir(hh, "x");
    const res = await put(hh, cwd);
    expect(res.statusCode).toBe(200);
    expect(hh.known).toEqual([cwd]);
    expect(hh.writes).toEqual([`${cwd}/.pi/mcp.json`]);
    expect(hh.hold).toHaveBeenCalledWith(expect.anything(), expect.anything(), { cwd, origin: "mcp:save" });
  });

  it("E28: allow-always with an undecidable re-run is 503, not 403", async () => {
    const hh = await harness({ hold: async () => ({ kind: "indeterminate" }) });
    const cwd = dir(hh, "x");
    const res = await put(hh, cwd);
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("cwd-admission-unavailable");
    expect(hh.writes).toEqual([]);
  });

  it("E29: allow-once completes one write, pins nothing, and the next save asks again", async () => {
    const hh = await harness({ hold: async (cwd) => ({ kind: "admit", canonCwd: realpathSync(cwd), cwd: resolve(cwd) }) });
    const cwd = dir(hh, "x");
    expect((await put(hh, cwd)).statusCode).toBe(200);
    expect(hh.known).toEqual([]);
    expect((await put(hh, cwd)).statusCode).toBe(200);
    expect(hh.hold).toHaveBeenCalledTimes(2); // no cached admission between requests
  });

  it("a decision that answers a DIFFERENT cwd never mints a token (replay)", async () => {
    const hh = await harness({ hold: async () => ({ kind: "admit", canonCwd: "/somewhere/else", cwd: "/somewhere/else" }) });
    const cwd = dir(hh, "x");
    const res = await put(hh, cwd);
    expect(res.statusCode).toBe(403);
    expect(hh.writes).toEqual([]);
  });

  it("E31: refuse (deny / expiry / no coordinator) → existing 403 body", async () => {
    const hh = await harness({ hold: async () => ({ kind: "refuse" }) });
    const cwd = dir(hh, "x");
    const res = await put(hh, cwd);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(NOT_ALLOWED(cwd));
  });

  it("host without the seam → existing 403, as before", async () => {
    const hh = await harness({ hold: "absent" });
    const cwd = dir(hh, "x");
    const res = await put(hh, cwd);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(NOT_ALLOWED(cwd));
  });

  it("an invalid body never raises the dialog", async () => {
    const hh = await harness({ hold: async () => ({ kind: "refuse" }) });
    const cwd = dir(hh, "x");
    const res = await hh.app.inject({
      method: "PUT",
      url: "/api/mcp-client/servers/x",
      payload: { scope: "project", cwd, entry: "not-an-object" },
    });
    expect(res.statusCode).toBe(400);
    expect(hh.hold).not.toHaveBeenCalled();
  });

  it.each([
    ["delete", "mcp:delete", (hh: H, cwd: string) => hh.app.inject({ method: "DELETE", url: `/api/mcp-client/servers/x?scope=project&cwd=${encodeURIComponent(cwd)}` })],
    ["enable", "mcp:enable", (hh: H, cwd: string) => hh.app.inject({ method: "PUT", url: "/api/mcp-client/servers/x/enabled", payload: { scope: "project", cwd, enabled: true } })],
    ["convert", "mcp:convert", (hh: H, cwd: string) => hh.app.inject({ method: "POST", url: "/api/mcp-client/servers/x/convert", payload: { scope: "project", cwd } })],
  ])("%s raises the dialog with origin %s", async (_n, origin, fire) => {
    const hh = await harness({ hold: async () => ({ kind: "refuse" }) });
    const cwd = dir(hh, "x");
    expect((await fire(hh, cwd)).statusCode).toBe(403);
    expect(hh.hold).toHaveBeenCalledWith(expect.anything(), expect.anything(), { cwd, origin });
  });
});

describe("E32: reads never prompt", () => {
  it("GET /effective and /live on an unknown cwd are 403 and never call the seam", async () => {
    const hh = await harness({ hold: async () => ({ kind: "admit", canonCwd: "/x", cwd: "/x" }) });
    const cwd = dir(hh, "x");
    for (const route of ["effective", "live"]) {
      const res = await hh.app.inject({ method: "GET", url: `/api/mcp-client/${route}?cwd=${encodeURIComponent(cwd)}` });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual(NOT_ALLOWED(cwd));
    }
    expect(hh.hold).not.toHaveBeenCalled();
  });
});

describe("E33 / E34: indeterminate and HTTP shapes", () => {
  it("E33: a probe timeout on a write is 503 and never raises the dialog", async () => {
    const hh = await harness({ runner: timeoutRunner });
    const cwd = dir(hh, "wt");
    const res = await put(hh, cwd);
    expect(res.statusCode).toBe(503);
    expect(hh.hold).not.toHaveBeenCalled();
    expect(hh.writes).toEqual([]);
  });

  it("E34: indeterminate → 503 {error,message,retryAfterMs} + Retry-After; refuse → 403 body; missing cwd → 400 with no spawn", async () => {
    const hh = await harness({ runner: timeoutRunner });
    const cwd = dir(hh, "wt");
    const res = await hh.app.inject({ method: "GET", url: `/api/mcp-client/effective?cwd=${encodeURIComponent(cwd)}` });
    expect(res.statusCode).toBe(503);
    expect(res.headers["retry-after"]).toBe("1");
    expect(res.json()).toEqual({
      error: "cwd-admission-unavailable",
      message: expect.any(String),
      retryAfterMs: 1000,
    });

    const spawnsBefore = hh.runnerSpawns.n;
    const missing = await hh.app.inject({
      method: "PUT",
      url: "/api/mcp-client/servers/x",
      payload: { scope: "project", entry: { command: "x" } },
    });
    expect(missing.statusCode).toBe(400);
    expect(hh.runnerSpawns.n).toBe(spawnsBefore);

    const gone = join(hh.tmp, "gone-worktree");
    const refused = await hh.app.inject({ method: "GET", url: `/api/mcp-client/effective?cwd=${encodeURIComponent(gone)}` });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual(NOT_ALLOWED(gone));
  });
});
