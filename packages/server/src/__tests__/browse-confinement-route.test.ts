/**
 * `/api/browse`, `/api/browse/flags`, `/api/browse/mkdir`: confined to the shared
 * roots for NON-LOCAL requests only; local requests are unchanged.
 * See change: harden-server-capability-bounds (test-plan #E14-#E25, #E36, #P1).
 */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerFileRoutes } from "../routes/file-routes.js";

const REMOTE = "192.168.1.5";
let tmp: string;
let home: string;
let pinnedDirs: string[];
let sessionCwds: string[];
let grantDirs: string[];
let app: FastifyInstance;
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

const mk = async (...parts: string[]) => {
  const p = path.join(tmp, ...parts);
  await fsp.mkdir(p, { recursive: true });
  return p;
};

async function boot(confineRemote = true) {
  app = Fastify({ logger: false });
  registerFileRoutes(app, {
    sessionManager: { listAll: () => sessionCwds.map((cwd) => ({ cwd })) } as never,
    preferencesStore: {
      getPinnedDirectories: () => pinnedDirs,
      getWorkspaces: () => [],
    } as never,
    networkGuard: async () => undefined,
    browseRootSources: { worktreeRoots: () => [], projectGrants: () => grantDirs },
    browseConfineRemote: confineRemote,
  });
  await app.ready();
}

beforeEach(async () => {
  tmp = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "browse-confine-")));
  home = await mk("home");
  await mk("home", "Project");
  pinnedDirs = [];
  sessionCwds = [];
  grantDirs = [];
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  await boot();
});

afterEach(async () => {
  await app.close();
  process.env.HOME = saved.HOME;
  process.env.USERPROFILE = saved.USERPROFILE;
  vi.restoreAllMocks();
  await fsp.rm(tmp, { recursive: true, force: true });
});

const browse = (p?: string, opts: { remote?: boolean; headers?: Record<string, string> } = {}) =>
  app.inject({
    method: "GET",
    url: p === undefined ? "/api/browse" : `/api/browse?path=${encodeURIComponent(p)}`,
    remoteAddress: opts.remote === false ? "127.0.0.1" : REMOTE,
    headers: opts.headers,
  });
const local = (p?: string) => browse(p, { remote: false });
const mkdir = (parent: string, name: string, remote = true) =>
  app.inject({ method: "POST", url: "/api/browse/mkdir", payload: { parent, name }, remoteAddress: remote ? REMOTE : "127.0.0.1" });
const flags = (paths: string[], remote = true) =>
  app.inject({
    method: "GET",
    url: `/api/browse/flags?paths=${encodeURIComponent(JSON.stringify(paths))}`,
    remoteAddress: remote ? REMOTE : "127.0.0.1",
  });

describe("E14 locality x containment", () => {
  it("local: `/` and home both browse, no `confined` flag", async () => {
    const root = path.parse(tmp).root;
    const a = await local(root);
    expect(a.statusCode).toBe(200);
    expect(a.json().data.confined).toBeUndefined();
    const b = await local(path.join(home, "Project"));
    expect(b.statusCode).toBe(200);
    expect(b.json().data.confined).toBeUndefined();
  });

  it("remote: `/` is 403, home is 200 with confined:true", async () => {
    const a = await browse(path.parse(tmp).root);
    expect(a.statusCode).toBe(403);
    expect(a.json()).toMatchObject({ success: false, error: "path outside allowed roots" });
    const b = await browse(path.join(home, "Project"));
    expect(b.statusCode).toBe(200);
    expect(b.json().data.confined).toBe(true);
  });

  it("remote with no path defaults to home (picker open)", async () => {
    const res = await browse();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.current).toBe(home);
  });

  it("E15 a loopback peer relaying via x-forwarded-for is remote", async () => {
    const res = await browse(path.parse(tmp).root, { remote: false, headers: { "x-forwarded-for": "203.0.113.9" } });
    expect(res.statusCode).toBe(403);
  });
});

describe("browse.confineRemote = false (operator opt-out)", () => {
  it("a remote caller browses and creates anywhere, exactly like a local one", async () => {
    await app.close();
    await boot(false);
    const root = path.parse(tmp).root;
    const res = await browse(root);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.confined).toBeUndefined();
    const outside = await mk("outside");
    expect((await mkdir(outside, "n")).statusCode).toBe(200);
    expect((await flags(["/etc"])).statusCode).toBe(200);
  });
});

describe("E16 sources / E25 recompute", () => {
  it("pinned, session cwd and project grant dirs outside home are browsable remotely", async () => {
    const pinned = await mk("srv", "pinned");
    const cwd = await mk("srv", "cwd");
    const grant = await mk("srv", "grant");
    const other = await mk("srv", "other");
    pinnedDirs = [pinned];
    sessionCwds = [cwd];
    grantDirs = [grant];
    for (const d of [pinned, cwd, grant]) expect((await browse(d)).statusCode).toBe(200);
    expect((await browse(other)).statusCode).toBe(403);
  });

  it("E25 pinning applies to the next request without a restart", async () => {
    const work = await mk("srv", "work");
    expect((await browse(work)).statusCode).toBe(403);
    pinnedDirs = [work];
    expect((await browse(work)).statusCode).toBe(200);
  });
});

describe("E18 sensitive / E20 non-existent / E21 parent / E22 listing", () => {
  it("remote refuses ~/.ssh and ~/.pi/agent; local still lists ~/.ssh", async () => {
    await mk("home", ".ssh");
    await mk("home", ".pi", "agent");
    expect((await browse(path.join(home, ".ssh"))).statusCode).toBe(403);
    expect((await browse(path.join(home, ".pi", "agent"))).statusCode).toBe(403);
    expect((await local(path.join(home, ".ssh"))).statusCode).toBe(200);
  });

  it("E20 a non-existent path inside a root is 'directory not found', not 403", async () => {
    const res = await browse(path.join(home, "does-not-exist"));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: false, error: "directory not found" });
  });

  it("E21 `parent` is null at the root top remotely, set below it, and unchanged locally", async () => {
    expect((await browse(home)).json().data.parent).toBeNull();
    expect((await browse(path.join(home, "Project"))).json().data.parent).toBe(home);
    const l = (await local(home)).json().data;
    expect(l.parent).toBe(path.dirname(home));
    expect(l.confined).toBeUndefined();
  });

  it("E22 a symlinked dir pointing outside is never offered in a remote listing", async () => {
    const outside = await mk("outside", "Dropbox");
    await fsp.symlink(outside, path.join(home, "Dropbox"));
    const names = (await browse(home)).json().data.entries.map((e: { name: string }) => e.name);
    expect(names).toContain("Project");
    expect(names).not.toContain("Dropbox");
  });
});

describe("E23 flags / E24 mkdir", () => {
  it("E23 flags: any outside path is 403 (no probe); all-inside is 200", async () => {
    await mk("home", "a");
    await mk("home", "b");
    const bad = await flags([path.join(home, "a"), "/etc"]);
    expect(bad.statusCode).toBe(403);
    const ok = await flags([path.join(home, "a"), path.join(home, "b")]);
    expect(ok.statusCode).toBe(200);
    expect(Object.keys(ok.json().data.flags)).toHaveLength(2);
  });

  it("E24 mkdir: remote outside -> 403 and nothing created; remote inside ok; local outside ok", async () => {
    const outside = await mk("outside");
    const refused = await mkdir(outside, "n");
    expect(refused.statusCode).toBe(403);
    await expect(fsp.stat(path.join(outside, "n"))).rejects.toThrow();
    const inside = await mkdir(path.join(home, "Project"), "n");
    expect(inside.statusCode).toBe(200);
    expect((await fsp.stat(path.join(home, "Project", "n"))).isDirectory()).toBe(true);
    const loc = await mkdir(outside, "n", false);
    expect(loc.statusCode).toBe(200);
    expect((await fsp.stat(path.join(outside, "n"))).isDirectory()).toBe(true);
  });

  it("a symlinked parent escaping home is refused remotely and creates nothing", async () => {
    const outside = await mk("outside");
    await fsp.symlink(outside, path.join(home, "escape"));
    expect((await mkdir(path.join(home, "escape"), "pwned")).statusCode).toBe(403);
    await expect(fsp.stat(path.join(outside, "pwned"))).rejects.toThrow();
  });
});

describe("E36 refusal log line", () => {
  it("logs exactly one line per refusal with the requested path", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await browse("/etc");
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("[browse] refused"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("/etc");
  });
});

describe("P1 confined browse latency budget", () => {
  // The budget is p95 < 50 ms over 100 sequential calls. A timed test shares the
  // machine with the rest of the parallel suite, so a contended window must not
  // fail it: pass when ANY of three windows meets the budget (a genuinely slow
  // implementation misses all three).
  it("200 roots + 200-entry dir: p95 < 50 ms over 100 sequential calls", async () => {
    const roots: string[] = [];
    for (let i = 0; i < 200; i++) roots.push(await mk("roots", `r${i}`));
    pinnedDirs = roots;
    const big = await mk("home", "big");
    await Promise.all(Array.from({ length: 200 }, (_, i) => fsp.mkdir(path.join(big, `d${i}`))));
    await browse(big); // warm
    const p95s: number[] = [];
    for (let window = 0; window < 3; window++) {
      const times: number[] = [];
      for (let i = 0; i < 100; i++) {
        const t0 = performance.now();
        const res = await browse(big);
        times.push(performance.now() - t0);
        expect(res.statusCode).toBe(200);
      }
      times.sort((a, b) => a - b);
      p95s.push(times[94]);
      if (times[94] < 50) break;
    }
    expect(Math.min(...p95s), `p95 per window (ms): ${p95s.map((n) => n.toFixed(1)).join(", ")}`).toBeLessThan(50);
  });
});
