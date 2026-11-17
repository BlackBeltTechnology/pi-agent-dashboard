import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import * as gitMod from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetPathDenials, listPathDenials } from "../../access/access-denials.js";
import { __resetAccessGrants, recordGrant } from "../../access/access-grants.js";
import { decidePassive } from "../../access/containment-gate.js";
import { installGrantCoordinator } from "../../access/denial-hold.js";
import type { GrantCoordinator } from "../../access/grant-coordinator.js";
import { type GrepMatch, runGrep } from "../../lib/grep.js";
import { resolveFileMention } from "../../lib/resolve-file-mention.js";
import { detectRipgrep, resetRipgrepCache } from "../../ripgrep-detection.js";
import type { SessionManager } from "../../session/memory-session-manager.js";
import { registerGrepRoutes } from "../grep-routes.js";

// Seams: the scan result can be stubbed per test (the real scan is the default), and git spawns are countable.
vi.mock("../../lib/grep.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/grep.js")>();
  return { ...actual, runGrep: vi.fn(actual.runGrep) };
});
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/git.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/platform/git.js")>();
  return { ...actual, checkoutRootsAsync: vi.fn(actual.checkoutRootsAsync), isBoundCheckoutAsync: vi.fn(actual.isBoundCheckoutAsync) };
});

const cleanup: string[] = [];
afterAll(() => {
  for (const r of cleanup) rmSync(r, { recursive: true, force: true });
});

function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "grep-route-"));
  cleanup.push(root);
  for (const [f, content] of Object.entries(files)) {
    const full = join(root, f);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function buildApp(sessionCwds: string[], grep?: { scanTimeoutMs?: number; scanWorkerUrl?: string }): FastifyInstance {
  const app = Fastify();
  const sessionManager = {
    listAll: () => sessionCwds.map((cwd) => ({ cwd })),
  } as unknown as SessionManager;
  const networkGuard = async () => {};
  registerGrepRoutes(app, { sessionManager, networkGuard, grep });
  // Liveness probe for "the server keeps answering while a scan runs".
  app.get("/ping", async () => ({ ok: true }));
  return app;
}

describe("GET /api/grep", () => {
  beforeEach(() => {
    // Force the JS-fallback path deterministically (do not depend on host rg).
    resetRipgrepCache();
    detectRipgrep(() => null);
  });

  it("400 when cwd or q missing", async () => {
    const app = buildApp(["/proj"]);
    const res = await app.inject({ method: "GET", url: "/api/grep?cwd=/proj" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("400 when q shorter than the minimum length", async () => {
    const app = buildApp(["/proj"]);
    const res = await app.inject({ method: "GET", url: "/api/grep?cwd=/proj&q=ab" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("403 when cwd is not a known session", async () => {
    const app = buildApp(["/known"]);
    const res = await app.inject({ method: "GET", url: "/api/grep?cwd=/unknown&q=needle" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("unknown session path");
    await app.close();
  });

  it("200 with matches via the JS fallback for a known cwd", async () => {
    const root = makeTree({ "src/a.ts": "const NEEDLE = 1\n" });
    const app = buildApp([root]);
    const res = await app.inject({ method: "GET", url: `/api/grep?cwd=${encodeURIComponent(root)}&q=NEEDLE` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.matches).toEqual([{ path: "src/a.ts", line: 1, col: 7, snippet: "const NEEDLE = 1" }]);
    await app.close();
  });

  it("only returns matches contained within cwd", async () => {
    const root = makeTree({ "in.ts": "needle\n" });
    const app = buildApp([root]);
    const res = await app.inject({ method: "GET", url: `/api/grep?cwd=${encodeURIComponent(root)}&q=needle` });
    const paths = res.json().data.matches.map((m: { path: string }) => m.path);
    for (const p of paths) expect(p.startsWith("..")).toBe(false);
    await app.close();
  });

  it("#X1: a catastrophic regex answers 504 `search timed out` while other requests are served", async () => {
    const root = makeTree({ "a.txt": `${"a".repeat(40)}!\n` });
    const app = buildApp([root], { scanTimeoutMs: 300 });
    const url = `/api/grep?cwd=${encodeURIComponent(root)}&q=(a%2B)%2B%24&regex=true`;
    const pending = app.inject({ method: "GET", url });
    const t0 = Date.now();
    const ping = await app.inject({ method: "GET", url: "/ping" });
    expect(ping.statusCode).toBe(200);
    expect(Date.now() - t0).toBeLessThan(200);
    const res = await pending;
    expect(res.statusCode).toBe(504);
    expect(res.json()).toEqual({ success: false, error: "search timed out" });
    await app.close();
  });

  it("#X3: a scan worker that dies on start is a non-success reply, never 200", async () => {
    const root = makeTree({ "a.txt": "needle\n", "boom.mjs": 'throw new Error("boom on start");\n' });
    const app = buildApp([root], { scanWorkerUrl: pathToFileURL(join(root, "boom.mjs")).href });
    const res = await app.inject({ method: "GET", url: `/api/grep?cwd=${encodeURIComponent(root)}&q=needle` });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(res.json().success).toBe(false);
    await app.close();
  });
});

// close-local-listener-and-egress-gaps — the passive match filter decides on REAL paths, consumes grants
// only when told to, and never originates a denial or holds a request.
describe("GET /api/grep — passive real-path filter (close-local-listener-and-egress-gaps)", () => {
  let savedHome: string | undefined;
  let savedStore: string | undefined;
  let holds: string[];

  /** A coordinator that records ANY use: a passive site must never touch it. */
  const watchdog = new Proxy({}, { get: (_t, prop) => (holds.push(String(prop)), () => undefined) }) as unknown as GrantCoordinator;

  beforeEach(() => {
    resetRipgrepCache();
    detectRipgrep(() => null);
    savedHome = process.env.HOME;
    savedStore = process.env.PI_ACCESS_GRANTS_STORE;
    const home = realpathSync(mkdtempSync(join(tmpdir(), "grep-home-")));
    cleanup.push(home);
    process.env.HOME = home;
    process.env.PI_ACCESS_GRANTS_STORE = join(home, "grants.json");
    __resetAccessGrants();
    __resetPathDenials();
    holds = [];
    installGrantCoordinator(watchdog);
    vi.mocked(gitMod.checkoutRootsAsync).mockClear();
    vi.mocked(gitMod.isBoundCheckoutAsync).mockClear();
  });

  afterEach(() => {
    installGrantCoordinator(null);
    vi.mocked(runGrep).mockClear();
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedStore === undefined) delete process.env.PI_ACCESS_GRANTS_STORE;
    else process.env.PI_ACCESS_GRANTS_STORE = savedStore;
    __resetAccessGrants();
  });

  const realTree = (files: Record<string, string>) => realpathSync(makeTree(files));
  const outsideDir = () => realpathSync(makeTree({ "o.txt": "needle\n" }));
  const stub = (rels: string[]): GrepMatch[] => rels.map((path) => ({ path, line: 1, col: 1, snippet: "needle" }));
  const search = async (app: FastifyInstance, cwd: string) => {
    const res = await app.inject({ method: "GET", url: `/api/grep?cwd=${encodeURIComponent(cwd)}&q=needle` });
    return { res, paths: (res.json().data?.matches ?? []).map((m: { path: string }) => m.path) as string[] };
  };

  it("T.7 a match via an escaping link is dropped; an in-anchor link and a plain file are kept; no denial, no new body", async () => {
    const cwd = realTree({ "plain.txt": "needle\n", "real.txt": "needle\n" });
    const outside = outsideDir();
    symlinkSync(join(outside, "o.txt"), join(cwd, "esc.txt"));
    symlinkSync(join(cwd, "real.txt"), join(cwd, "inl.txt"));
    vi.mocked(runGrep).mockResolvedValueOnce(stub(["esc.txt", "inl.txt", "plain.txt"]));
    const app = buildApp([cwd]);

    const { res, paths } = await search(app, cwd);
    expect(res.statusCode).toBe(200);
    expect(paths).toEqual(["inl.txt", "plain.txt"]);
    expect(Object.keys(res.json()).sort()).toEqual(["data", "success"]); // no denial / remedy body introduced
    expect(listPathDenials()).toEqual([]);
    await app.close();
  });

  it("T.37 decidePassive consumes a grant only with allowGrant:true; the route keeps the match; no denial, no hold", async () => {
    const cwd = realTree({ "plain.txt": "needle\n" });
    const granted = outsideDir();
    expect(recordGrant({ subject: granted, scope: "project", origin: "test" }).ok).toBe(true);
    const target = join(granted, "o.txt");

    const allow = await decidePassive(target, [cwd], { allowGrant: true });
    expect(allow).toMatchObject({ allowed: true, viaGrant: true });
    const refuse = await decidePassive(target, [cwd], { allowGrant: false });
    expect(refuse.allowed).toBe(false);

    // Through the route: a match whose absolute-resolved path lands in the granted tree is kept.
    symlinkSync(target, join(cwd, "granted-link.txt"));
    vi.mocked(runGrep).mockResolvedValueOnce(stub(["granted-link.txt", "plain.txt"]));
    const app = buildApp([cwd]);
    const { paths } = await search(app, cwd);
    expect(paths).toEqual(["granted-link.txt", "plain.txt"]);
    expect(listPathDenials()).toEqual([]);
    expect(holds).toEqual([]); // the coordinator was never consulted: nothing held, nobody asked
    await app.close();
  });

  it("T.38 non-regression refusal forms: escaping real path and hard-linked credential drop; contained matches survive", async () => {
    const cwd = realTree({ "keep.txt": "needle\n" });
    const outside = outsideDir();
    symlinkSync(join(outside, "o.txt"), join(cwd, "esc.txt")); // (c) lexically contained, real path escapes
    // (b) a hard-linked NAME for a pi-agent credential: invisible to any path check, caught by (dev, ino).
    const agentDir = join(process.env.HOME as string, ".pi", "agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "auth.json"), "needle CREDENTIAL\n");
    linkSync(join(agentDir, "auth.json"), join(cwd, "hard.txt"));
    // (a) the credential itself under an allowed path (cwd = $HOME style): lexically in the anchor.
    const homeCwd = process.env.HOME as string;
    vi.mocked(runGrep).mockResolvedValueOnce(stub([".pi/agent/auth.json"]));
    const appHome = buildApp([homeCwd]);
    const a = await search(appHome, homeCwd);
    expect(a.res.statusCode).toBe(200);
    expect(a.paths).toEqual([]);
    await appHome.close();

    vi.mocked(runGrep).mockResolvedValueOnce(stub(["esc.txt", "hard.txt", "keep.txt"]));
    const app = buildApp([cwd]);
    const { res, paths } = await search(app, cwd);
    expect(res.statusCode).toBe(200);
    expect(paths).toEqual(["keep.txt"]);
    expect(res.body).not.toContain("CREDENTIAL");
    expect(listPathDenials()).toEqual([]);
    await app.close();
  });

  it("T.139 1000 contained matches: zero git spawns and a bounded number of realpath calls per match (structural, no latency bound)", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 50; i++) files[`d/f${i}.txt`] = "needle\n";
    const cwd = realTree(files);
    const matches = Array.from({ length: 1000 }, (_, i) => `d/f${i % 50}.txt`);
    // Only calls on the match tree count; the state guard's credential-file resolutions live under HOME.
    const touchesFixture = (p: unknown) => String(p).startsWith(cwd);
    const spy = vi.spyOn(fsp, "realpath");
    try {
      // (1) the grep filter, through the route
      vi.mocked(runGrep).mockResolvedValueOnce(stub(matches));
      const app = buildApp([cwd]);
      spy.mockClear();
      vi.mocked(gitMod.checkoutRootsAsync).mockClear();
      const { res, paths } = await search(app, cwd);
      expect(res.statusCode).toBe(200);
      expect(paths).toHaveLength(1000);
      const perRequest = spy.mock.calls.filter((c) => touchesFixture(c[0])).length;
      // ≤ 4 per match: decision path + its anchor, plus the state guard's own resolution of the path.
      expect(perRequest / 1000).toBeLessThanOrEqual(4);
      expect(gitMod.checkoutRootsAsync).not.toHaveBeenCalled();
      await app.close();

      // (2) the mention resolver: same structural bound
      spy.mockClear();
      for (const m of matches) expect(await resolveFileMention(m, { cwd })).not.toBeNull();
      const perMention = spy.mock.calls.filter((c) => touchesFixture(c[0])).length;
      expect(perMention / 1000).toBeLessThanOrEqual(4);
      expect(gitMod.checkoutRootsAsync).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
