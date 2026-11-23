/**
 * Route tests for `POST /api/file/resolve-mention` + the `~/.pi` anchor on the
 * open route `GET /api/file`.
 *
 * Security: the untrusted-`cwd` gate MUST reject before any resolution/stat
 * (design D2). The open route MUST honor the SAME `~/.pi` anchor the resolver
 * uses, so a resolved home path also previews (design D7). Fake `$HOME` keeps
 * `~/.pi` under a controlled tmp home. See change:
 * server-side-file-mention-resolution.
 */

import { execFileSync } from "node:child_process";
import fsp from "node:fs/promises";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as accessGrants from "../access/access-grants.js";
import { createMentionFuzzyIndex, type MentionFuzzyIndex } from "../lib/mention-fuzzy-index.js";
import { registerFileRoutes } from "../routes/file-routes.js";

// Pass-through by default; the batch tests pin a grant by overriding `grantedSubjects` (E19).
vi.mock("../access/access-grants.js", async (orig) => {
  const actual = await orig<typeof import("../access/access-grants.js")>();
  return { ...actual, grantedSubjects: vi.fn(actual.grantedSubjects) };
});

/**
 * Task 3.0 / design D7: containment denials gained ADDITIVE remedy fields
 * (`reason`, `hint`, `subject`, `denialId`, `ancestors`). The pre-existing
 * fields are still pinned exactly — `error` is byte-identical and `success` is
 * still `false` — while the additive ones are asserted by SHAPE, because
 * `denialId` is an opaque per-denial UUID. This is strictly more assertion than
 * the previous `toEqual({ success, error })`, never less: no status code and no
 * error string is relaxed.
 */
function expectContainmentDenial(body: any, error: string): void {
  expect(body).toMatchObject({ success: false, error });
  expect(typeof body.reason).toBe("string");
  expect(typeof body.hint).toBe("string");
  expect(typeof body.subject).toBe("string");
  expect(typeof body.denialId).toBe("string");
  expect(body.denialId.length).toBeGreaterThan(0);
  expect(Array.isArray(body.ancestors)).toBe(true);
}


function makeApp(cwds: string[], pinned: string[] = [], mentionFuzzyIndex?: MentionFuzzyIndex): FastifyInstance {
  const app = Fastify({ logger: false });
  registerFileRoutes(app, {
    sessionManager: { listAll: () => cwds.map((cwd) => ({ cwd })) } as any,
    preferencesStore: { getPinnedDirectories: () => pinned } as any,
    networkGuard: async () => undefined,
    ...(mentionFuzzyIndex ? { mentionFuzzyIndex } : {}),
  });
  return app;
}

describe("POST /api/file/resolve-mention", () => {
  let app: FastifyInstance;
  let cwd: string;
  let home: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rme-cwd-")));
    home = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rme-home-")));
    origHome = process.env.HOME;
    process.env.HOME = home;
    await fsp.mkdir(path.join(home, ".pi", "agent"), { recursive: true });
    await fsp.writeFile(path.join(home, ".pi", "agent", "settings.json"), '{"a":1}\n');
    await fsp.writeFile(path.join(cwd, "real.ts"), "const x = 1;\n");
    app = makeApp([cwd]);
    await app.ready();
  });

  afterEach(async () => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    vi.restoreAllMocks();
    await app.close();
    await fsp.rm(cwd, { recursive: true, force: true });
    await fsp.rm(home, { recursive: true, force: true });
  });

  it("rejects an untrusted cwd with 403 and never stats (S1)", async () => {
    const statSpy = vi.spyOn(fs, "stat");
    const res = await app.inject({
      method: "POST",
      url: "/api/file/resolve-mention",
      payload: { cwd: "/etc", mention: "passwd" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "unknown session path", code: "cwd_unknown" });
    expect(statSpy).not.toHaveBeenCalled();
  });

  it("resolves a real relative file under a known cwd", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/file/resolve-mention",
      payload: { cwd, mention: "real.ts" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      data: { state: "found", resolved: path.join(cwd, "real.ts"), kind: "relative" },
    });
  });

  it("resolves a `~/.pi` home mention with kind tilde", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/file/resolve-mention",
      payload: { cwd, mention: "~/.pi/agent/settings.json" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      data: { state: "found", resolved: path.join(home, ".pi", "agent", "settings.json"), kind: "tilde" },
    });
  });

  // fix-file-link-editor-routing S7: `outside` maps through; a contained hit carries no `outside` key.
  it("maps an outside result through as { resolved, kind: tilde, outside: true } (S7)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/file/resolve-mention",
      payload: { cwd, mention: "~/Downloads/x.md" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      data: { state: "gated", resolved: path.join(home, "Downloads", "x.md"), kind: "tilde", outside: true },
    });
    const hit = await app.inject({
      method: "POST",
      url: "/api/file/resolve-mention",
      payload: { cwd, mention: "real.ts" },
    });
    expect(hit.json().data).not.toHaveProperty("outside");
  });

  // S69: the cwd gate runs first — no `outside` payload is ever produced for a non-admitted cwd.
  it("a non-admitted cwd yields 403, zero stat, no outside payload for either mention (S69)", async () => {
    const statSpy = vi.spyOn(fs, "stat");
    for (const mention of ["passwd", "~/x.md"]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/file/resolve-mention",
        payload: { cwd: "/etc", mention },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ success: false, error: "unknown session path", code: "cwd_unknown" });
      expect(JSON.stringify(res.json())).not.toContain("outside");
    }
    expect(statSpy).not.toHaveBeenCalled();
  });

  it("returns { resolved: null } for a junk mention (no error)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/file/resolve-mention",
      payload: { cwd, mention: "nope-does-not-exist.ts" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { state: "missing", resolved: null } });
  });
});

describe("GET /api/file — ~/.pi anchor honored by the open route", () => {
  let app: FastifyInstance;
  let cwd: string;
  let home: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rme-open-cwd-")));
    home = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rme-open-home-")));
    origHome = process.env.HOME;
    process.env.HOME = home;
    await fsp.mkdir(path.join(home, ".pi", "agent"), { recursive: true });
    await fsp.writeFile(path.join(home, ".pi", "agent", "settings.json"), '{"a":1}\n');
    await fsp.mkdir(path.join(home, ".ssh"), { recursive: true });
    await fsp.writeFile(path.join(home, ".ssh", "config"), "Host *\n");
    app = makeApp([cwd]);
    await app.ready();
  });

  afterEach(async () => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    await app.close();
    await fsp.rm(cwd, { recursive: true, force: true });
    await fsp.rm(home, { recursive: true, force: true });
  });

  it("reads a resolved `~/.pi/agent/settings.json` (200, S9)", async () => {
    const target = path.join(home, ".pi", "agent", "settings.json");
    const res = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(target)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ type: "file", content: '{"a":1}\n' });
  });

  it("rejects a `~/.ssh/config` read outside every anchor (403, S10)", async () => {
    const target = path.join(home, ".ssh", "config");
    const res = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(target)}`,
    });
    expect(res.statusCode).toBe(403);
    expectContainmentDenial(res.json(), "path outside working directory");
  });
});

// ---------------------------------------------------------------------------------------------
// change: rich-chat-links — batch route + the opt-in fields on the single route (design D3)
// ---------------------------------------------------------------------------------------------

const BATCH = "/api/file/resolve-mentions";
const SINGLE = "/api/file/resolve-mention";
const ETC_RE = /^\/(private\/)?etc(\/|$)/;

type BatchItem = { mention: string; toolCwd?: string; reRooted?: string };
type BatchResult = { state: string; resolved?: string; kind?: string; via?: string; candidates?: string[] };

describe("POST /api/file/resolve-mentions", () => {
  let app: FastifyInstance;
  let cwd: string;
  let home: string;
  let origHome: string | undefined;
  const post = (payload: unknown) => app.inject({ method: "POST", url: BATCH, payload: payload as object });
  const batch = async (items: BatchItem[], extra: Record<string, unknown> = {}): Promise<BatchResult[]> => {
    const res = await post({ cwd, items, ...extra });
    expect(res.statusCode).toBe(200);
    return res.json().data.results as BatchResult[];
  };

  beforeEach(async () => {
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rmb-cwd-")));
    home = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rmb-home-")));
    origHome = process.env.HOME;
    process.env.HOME = home;
    await fsp.writeFile(path.join(cwd, "real.ts"), "const x = 1;\n");
    vi.mocked(accessGrants.grantedSubjects).mockReturnValue([]);
    app = makeApp([cwd]);
    await app.ready();
  });

  afterEach(async () => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    vi.restoreAllMocks();
    await app.close();
    await fsp.rm(cwd, { recursive: true, force: true });
    await fsp.rm(home, { recursive: true, force: true });
  });

  it("resolves items in request order with the tagged wire shape", async () => {
    await fsp.mkdir(path.join(cwd, "pkg", "src"), { recursive: true });
    await fsp.writeFile(path.join(cwd, "pkg", "src", "a.ts"), "x");
    const results = await batch([
      { mention: "real.ts" },
      { mention: "nope.ts" },
      { mention: "src/a.ts", toolCwd: "pkg" },
    ]);
    expect(results).toEqual([
      { state: "found", resolved: path.join(cwd, "real.ts"), kind: "relative" },
      { state: "missing" },
      { state: "found", resolved: path.join(cwd, "pkg", "src", "a.ts"), kind: "relative", via: "tool-dir" },
    ]);
  });

  // E19
  it("out-of-scope mentions are byte-identical `gated` whether or not they exist, with zero stats", async () => {
    await fsp.mkdir(path.join(home, "Downloads"), { recursive: true });
    await fsp.writeFile(path.join(home, "Downloads", "a.md"), "# a\n");
    const statSpy = vi.spyOn(fs, "stat");
    const results = await batch([{ mention: "~/Downloads/a.md" }, { mention: "~/Downloads/b.md" }]);
    expect(results).toEqual([{ state: "gated" }, { state: "gated" }]);
    expect(JSON.stringify(results[0])).toBe(JSON.stringify(results[1]));
    expect(statSpy).not.toHaveBeenCalled();
  });

  it("with a grant over ~/Downloads the same mentions are `found` and `missing`", async () => {
    await fsp.mkdir(path.join(home, "Downloads"), { recursive: true });
    await fsp.writeFile(path.join(home, "Downloads", "a.md"), "# a\n");
    vi.mocked(accessGrants.grantedSubjects).mockReturnValue([path.join(home, "Downloads")]);
    const results = await batch([{ mention: "~/Downloads/a.md" }, { mention: "~/Downloads/b.md" }]);
    expect(results).toEqual([
      { state: "found", resolved: path.join(home, "Downloads", "a.md"), kind: "tilde" },
      { state: "missing" },
    ]);
  });

  // E20 — bounds
  describe("bounds (E20)", () => {
    const mk = (n: number): BatchItem[] =>
      Array.from({ length: n }, (_, i) => ({ mention: i % 2 === 0 ? "real.ts" : `missing-${i}.ts` }));

    it.each([[199], [200]])("%i items are all resolved in order", async (n) => {
      const results = await batch(mk(n));
      expect(results).toHaveLength(n);
      results.forEach((r, i) => expect(r.state).toBe(i % 2 === 0 ? "found" : "missing"));
    });

    it.each([[201], [250]])("%i items: the first 200 resolve, the rest are `unknown`, order kept", async (n) => {
      const results = await batch(mk(n));
      expect(results).toHaveLength(n);
      results.slice(0, 200).forEach((r, i) => expect(r.state).toBe(i % 2 === 0 ? "found" : "missing"));
      results.slice(200).forEach((r) => expect(r).toEqual({ state: "unknown" }));
    });

    it("a 1024-character mention is accepted", async () => {
      const results = await batch([{ mention: "a".repeat(1024) }]);
      expect(results).toEqual([{ state: "missing" }]);
    });

    it.each([
      ["mention", { mention: "a".repeat(1025) }],
      ["toolCwd", { mention: "x", toolCwd: "a".repeat(1025) }],
      ["reRooted", { mention: "x", reRooted: "a".repeat(1025) }],
    ])("a 1025-character %s → 400 with no filesystem access", async (_f, item) => {
      const statSpy = vi.spyOn(fs, "stat");
      const realpathSpy = vi.spyOn(fs, "realpath");
      const res = await post({ cwd, items: [{ mention: "real.ts" }, item] });
      expect(res.statusCode).toBe(400);
      expect(statSpy).not.toHaveBeenCalled();
      expect(realpathSpy).not.toHaveBeenCalled();
    });

    it("malformed bodies are 400", async () => {
      for (const body of [{ items: [] }, { cwd, items: "x" }, { cwd, items: [{ mention: 5 }] }, { cwd, items: [null] }]) {
        expect((await post(body)).statusCode).toBe(400);
      }
    });

    it("an empty items list answers an empty result list", async () => {
      expect(await batch([])).toEqual([]);
    });

    const bodyOfSize = (bytes: number): string => {
      const head = JSON.stringify({ cwd, items: [{ mention: "real.ts" }], pad: "" });
      return JSON.stringify({ cwd, items: [{ mention: "real.ts" }], pad: "x".repeat(bytes - Buffer.byteLength(head)) });
    };

    it("a body of exactly 512 KB is accepted; 513 KB → 413", async () => {
      const ok = await app.inject({
        method: "POST",
        url: BATCH,
        headers: { "content-type": "application/json" },
        payload: bodyOfSize(512 * 1024),
      });
      expect(ok.statusCode).toBe(200);
      const big = await app.inject({
        method: "POST",
        url: BATCH,
        headers: { "content-type": "application/json" },
        payload: bodyOfSize(513 * 1024),
      });
      expect(big.statusCode).toBe(413);
    });

    it("the 61st request in a minute from one principal is refused with 429", async () => {
      for (let i = 0; i < 60; i++) expect((await post({ cwd, items: [{ mention: "real.ts" }] })).statusCode).toBe(200);
      const limited = await post({ cwd, items: [{ mention: "real.ts" }] });
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toMatchObject({ success: false });
    });
  });

  // E21
  it("an un-admitted cwd is refused 403 with no stat (admission before any resolution)", async () => {
    const statSpy = vi.spyOn(fs, "stat");
    const res = await post({ cwd: "/etc", items: [{ mention: "passwd" }] });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "unknown session path", code: "cwd_unknown" });
    expect(statSpy).not.toHaveBeenCalled();
  });

  // E22 — pre-confirmed state equals what a click opens
  describe("worktree re-root (E22)", () => {
    it("(a) a present re-rooted copy is what the batch reports AND what a click resolves", async () => {
      await fsp.mkdir(path.join(cwd, "wt", "src"), { recursive: true });
      await fsp.writeFile(path.join(cwd, "wt", "src", "a.ts"), "x");
      const parent = path.join(cwd, "src", "a.ts");
      const reRooted = path.join(cwd, "wt", "src", "a.ts");
      const [r] = await batch([{ mention: parent, reRooted }]);
      expect(r).toEqual({ state: "found", resolved: reRooted, kind: "abs" });
      // click time: the client resolves the re-rooted candidate it chose
      const click = await app.inject({ method: "POST", url: SINGLE, payload: { cwd, mention: reRooted, recover: true } });
      expect(click.json().data.resolved).toBe(r.resolved);
    });

    it("(b) an absent re-rooted copy: batch and click both report the parent path", async () => {
      await fsp.mkdir(path.join(cwd, "src"), { recursive: true });
      await fsp.writeFile(path.join(cwd, "src", "a.ts"), "x");
      const parent = path.join(cwd, "src", "a.ts");
      const [r] = await batch([{ mention: parent, reRooted: path.join(cwd, "wt", "src", "a.ts") }]);
      expect(r).toEqual({ state: "found", resolved: parent, kind: "abs" });
      const click = await app.inject({ method: "POST", url: SINGLE, payload: { cwd, mention: parent, recover: true } });
      expect(click.json().data.resolved).toBe(parent);
    });

    it("(c) a re-rooted `/etc/passwd` is never statted and falls through to the original", async () => {
      await fsp.writeFile(path.join(cwd, "a.ts"), "x");
      const statSpy = vi.spyOn(fs, "stat");
      const [r] = await batch([{ mention: path.join(cwd, "a.ts"), reRooted: "/etc/passwd" }]);
      expect(statSpy.mock.calls.map((c) => String(c[0])).filter((p) => ETC_RE.test(p))).toEqual([]);
      expect(r).toEqual({ state: "found", resolved: path.join(cwd, "a.ts"), kind: "abs" });
    });
  });

  // E19/E-obs — one structured log line per request (design D14)
  it("emits one structured log line per request, without mentions or paths", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await batch([{ mention: "real.ts" }, { mention: "nope.ts" }, { mention: "~/Downloads/zz.md" }]);
    const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("resolve-mentions"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/items=3/);
    expect(lines[0]).toMatch(/found=1/);
    expect(lines[0]).toMatch(/missing=1/);
    expect(lines[0]).toMatch(/gated=1/);
    expect(lines[0]).not.toContain("real.ts");
    expect(lines[0]).not.toContain(cwd);
  });
});

describe("POST /api/file/resolve-mention — opt-in recovery fields", () => {
  let app: FastifyInstance;
  let cwd: string;
  let home: string;
  let origHome: string | undefined;
  const single = async (payload: Record<string, unknown>) => {
    const res = await app.inject({ method: "POST", url: SINGLE, payload: { cwd, ...payload } });
    expect(res.statusCode).toBe(200);
    return res.json().data as Record<string, unknown>;
  };

  beforeEach(async () => {
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rms-cwd-")));
    home = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rms-home-")));
    origHome = process.env.HOME;
    process.env.HOME = home;
    await fsp.mkdir(path.join(cwd, "deep", "dir"), { recursive: true });
    await fsp.writeFile(path.join(cwd, "deep", "dir", "only-here.ts"), "x");
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["add", "-A"], { cwd });
    vi.mocked(accessGrants.grantedSubjects).mockReturnValue([]);
    app = makeApp([cwd]);
    await app.ready();
  });

  afterEach(async () => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    vi.restoreAllMocks();
    await app.close();
    await fsp.rm(cwd, { recursive: true, force: true });
    await fsp.rm(home, { recursive: true, force: true });
  });

  // X3 — an old client (no `recover`) sees the prerequisite's behaviour
  it("without `recover` a fuzzy-only mention is unresolved, with `state: missing` and no candidates (X3)", async () => {
    const data = await single({ mention: "only-here.ts" });
    expect(data).toEqual({ state: "missing", resolved: null });
    expect(data).not.toHaveProperty("candidates");
    // a toolCwd without the opt-in is ignored as well
    expect(await single({ mention: "dir/only-here.ts", toolCwd: "deep" })).toEqual({ state: "missing", resolved: null });
  });

  it("with `recover: true` the single route recovers through the fuzzy index (state, kind, via)", async () => {
    expect(await single({ mention: "only-here.ts", recover: true })).toEqual({
      state: "recovered",
      resolved: path.join(cwd, "deep", "dir", "only-here.ts"),
      kind: "fuzzy",
      via: "fuzzy",
    });
  });

  it("with `recover: true` + `toolCwd` the tool dir is tried first", async () => {
    expect(await single({ mention: "dir/only-here.ts", recover: true, toolCwd: "deep" })).toEqual({
      state: "found",
      resolved: path.join(cwd, "deep", "dir", "only-here.ts"),
      kind: "relative",
      via: "tool-dir",
    });
  });

  it("an ambiguous result carries candidates and no resolved path", async () => {
    await fsp.mkdir(path.join(cwd, "other"), { recursive: true });
    await fsp.writeFile(path.join(cwd, "other", "only-here.ts"), "x");
    execFileSync("git", ["add", "-A"], { cwd });
    const data = await single({ mention: "only-here.ts", recover: true });
    expect(data.state).toBe("ambiguous");
    expect(data.resolved).toBeNull();
    expect((data.candidates as string[]).sort()).toEqual(
      [path.join(cwd, "deep", "dir", "only-here.ts"), path.join(cwd, "other", "only-here.ts")].sort(),
    );
  });

  it("a non-string `toolCwd` / non-boolean `recover` are ignored (opt-in must be literal true)", async () => {
    expect(await single({ mention: "only-here.ts", recover: "yes" })).toEqual({ state: "missing", resolved: null });
    expect(await single({ mention: "dir/only-here.ts", recover: true, toolCwd: 5 })).toMatchObject({ state: "recovered" });
  });

  it("the single route enforces the same 1024-character field limit when the opt-in fields are used", async () => {
    const res = await app.inject({ method: "POST", url: SINGLE, payload: { cwd, mention: "x", recover: true, toolCwd: "a".repeat(1025) } });
    expect(res.statusCode).toBe(400);
  });
});

/**
 * Performance (P1 warm, P2 cold): the batch handler over a realistic 200-mention workload sampled from this
 * repo's tracked files — 120 exact, 40 tool-dir, 30 fuzzy-unique, 10 ambiguous. Time is measured end to end
 * through `inject`, which only over-states the handler time.
 */
describe("POST /api/file/resolve-mentions — performance (P1, P2)", () => {
  let repo: string;
  let idx: MentionFuzzyIndex;
  let app: FastifyInstance;
  let items: BatchItem[];

  const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1];
  const run = async (): Promise<number> => {
    const t0 = performance.now();
    const res = await app.inject({ method: "POST", url: BATCH, payload: { cwd: repo, items } });
    const ms = performance.now() - t0;
    expect(res.statusCode).toBe(200);
    return ms;
  };

  beforeEach(async () => {
    vi.mocked(accessGrants.grantedSubjects).mockReturnValue([]);
    repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: __dirname, encoding: "utf8" }).trim();
    repo = await fsp.realpath(repo);
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\0")
      .filter((f) => f && /\.(ts|tsx|md|json)$/.test(f));
    const byBase = new Map<string, string[]>();
    for (const f of tracked) byBase.set(path.basename(f), [...(byBase.get(path.basename(f)) ?? []), f]);
    const unique = tracked.filter((f) => byBase.get(path.basename(f))?.length === 1 && f.includes("/"));
    const colliding = [...byBase.entries()].filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length);
    const stride = <T,>(xs: T[], n: number): T[] => Array.from({ length: n }, (_, i) => xs[Math.floor((i * xs.length) / n)]);
    const nested = tracked.filter((f) => f.split("/").length >= 3);
    items = [
      ...stride(tracked, 120).map((f) => ({ mention: f })),
      ...stride(nested, 40).map((f) => {
        const parts = f.split("/");
        return { mention: parts.slice(2).join("/"), toolCwd: parts.slice(0, 2).join("/") };
      }),
      ...stride(unique, 30).map((f) => ({ mention: path.basename(f) })),
      ...colliding.slice(0, 10).map(([base]) => ({ mention: base })),
    ];
    expect(items).toHaveLength(200);
    idx = createMentionFuzzyIndex();
    app = makeApp([repo], [], idx);
    await app.ready();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it("warm index: p95 < 150 ms over 50 repetitions (P1)", async () => {
    // Wall-clock latency on a shared host is noisy (the suite runs many workers at once): a clean
    // 50-repetition sample must clear the threshold, and up to 3 samples are taken so one contended
    // sample cannot fail the build. A real regression is slow in every sample.
    const samples: number[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      // A fresh app per sample: the route's 60/min limiter is per registration.
      if (attempt > 0) {
        await app.close();
        app = makeApp([repo], [], idx);
        await app.ready();
      }
      await run(); // warm the index
      const times: number[] = [];
      for (let i = 0; i < 50; i++) times.push(await run());
      samples.push(p95(times));
      if (samples[samples.length - 1] < 150) break;
    }
    console.info(`[P1] warm p95 per sample (ms): ${samples.map((v) => v.toFixed(1)).join(", ")}`);
    expect(Math.min(...samples)).toBeLessThan(150);
  }, 120_000);

  it("cold index: p95 < 3.5 s over 5 repetitions, including `git ls-files` (P2)", async () => {
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      idx.clear();
      times.push(await run());
    }
    const v = p95(times);
    console.info(`[P2] cold p95=${v.toFixed(1)}ms max=${Math.max(...times).toFixed(1)}ms`);
    expect(v).toBeLessThan(3500);
  }, 60_000);
});
