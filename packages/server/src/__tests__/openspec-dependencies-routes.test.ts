/**
 * HTTP-level tests for GET/PUT /api/openspec/dependencies: gate order (#X1),
 * traversal (#X2), write guard (#X3), lock (#X4), precondition (#X5), key
 * injection (#X6), GET body (#X8) and the structured PUT log line (#X14).
 *
 * See change: add-openspec-change-dependencies.
 */
import nodeFs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { parseDependenciesFile } from "@blackbelt-technology/pi-dashboard-shared/openspec-dependencies.js";
import { routeTier } from "@blackbelt-technology/pi-dashboard-shared/route-tiers.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyHttpRoad } from "../identity/http-road-classification.js";
import { writeDependenciesFile } from "../openspec/dependencies-file.js";
import { registerOpenSpecRoutes } from "../routes/openspec-routes.js";
import { makeFakeCli, mkRepo, mkTmp, stubDeps, write } from "./helpers/workflow-schema-fixtures.js";

const PASSTHRU = async () => {};
const roots: string[] = [];
let fastify: FastifyInstance | undefined;
const logLines: string[] = [];

afterEach(async () => {
  await fastify?.close();
  fastify = undefined;
  vi.restoreAllMocks();
  logLines.length = 0;
  for (const r of roots.splice(0)) nodeFs.rmSync(r, { recursive: true, force: true });
});

interface Opts {
  sessionCwds?: string[];
  pinned?: string[];
  mode?: "all" | "fallback" | undefined;
  data?: unknown;
  enabled?: boolean;
  optOut?: string[];
  statusRoot?: { path?: string; source?: string };
  workflowSchemaCli?: Parameters<typeof stubDeps>[0];
}

function repoWith(...changes: string[]): string {
  const root = mkRepo();
  roots.push(root);
  for (const c of changes) write(root, `openspec/changes/${c}/proposal.md`, "# p\n");
  return root;
}

const cached = (...names: string[]) => ({
  initialized: true,
  changes: names.map((name) => ({ name, dependencies: { hasFile: false, blockedBy: [], blocks: [], related: [], overlaps: [], wave: 1, issues: [] } })),
});

async function setup(root: string, o: Opts = {}) {
  const fake = makeFakeCli(o.statusRoot ? { statusRoot: o.statusRoot } : {});
  const refreshOpenSpec = vi.fn(async () => cached("foo"));
  const deps = {
    sessionManager: { listAll: () => (o.sessionCwds ?? [root]).map((cwd) => ({ id: "s", cwd })) } as never,
    preferencesStore: { getPinnedDirectories: () => o.pinned ?? [] } as never,
    directoryService: {
      getOpenSpecPollMode: () => ("mode" in o ? o.mode : "all"),
      getOpenSpecData: () => ("data" in o ? o.data : cached("foo", "bar")),
      refreshOpenSpec,
    } as never,
    networkGuard: PASSTHRU,
    onOpenSpecChanged: vi.fn(),
    getOpenSpecConfig: () =>
      ({ enabled: o.enabled ?? true, optOutDirectories: o.optOut ?? [], workflowSchema: { defaultForNewProjects: false } }) as never,
    workflowSchemaDeps: stubDeps(fake),
  };
  fastify = Fastify({
    logger: {
      level: "info",
      stream: new Writable({
        write(chunk, _enc, cb) {
          logLines.push(String(chunk));
          cb();
        },
      }),
    },
  });
  registerOpenSpecRoutes(fastify, deps);
  await fastify.ready();
  return { fake, deps, refreshOpenSpec };
}

const get = (cwd: string, change: string) =>
  fastify!.inject({ method: "GET", url: `/api/openspec/dependencies?cwd=${encodeURIComponent(cwd)}&change=${encodeURIComponent(change)}` });
const put = (body: Record<string, unknown>) => fastify!.inject({ method: "PUT", url: "/api/openspec/dependencies", payload: body });
const body = (cwd: string, extra: Record<string, unknown> = {}) => ({
  cwd,
  change: "foo",
  blockedBy: [{ change: "bar", reason: "api" }],
  notBlockedBy: [],
  related: [],
  expected: null,
  ...extra,
});
const reasonOf = (res: { payload: string }) => (JSON.parse(res.payload) as { reason?: string }).reason;
const fileOf = (root: string, change = "foo") => path.join(root, "openspec/changes", change, "dependencies.yaml");

describe("#X1 gate order", () => {
  it.each([
    ["1 bad change id", (root: string) => ({ cwd: root, change: "Bad_Name", o: {} }), 400, "invalid-request"],
    ["2 untracked", (root: string) => ({ cwd: root, change: "foo", o: { sessionCwds: [] } }), 403, "cwd-not-tracked"],
    ["3 disabled", (root: string) => ({ cwd: root, change: "foo", o: { enabled: false } }), 403, "openspec-disabled"],
    ["4 opted out", (root: string) => ({ cwd: root, change: "foo", o: { optOut: [root] } }), 403, "opted-out"],
    ["6 fallback", (root: string) => ({ cwd: root, change: "foo", o: { mode: "fallback" } }), 409, "status-all-unsupported"],
    ["7 no cached result", (root: string) => ({ cwd: root, change: "foo", o: { mode: undefined, data: undefined } }), 503, "pending"],
    ["8 unknown change", (root: string) => ({ cwd: root, change: "nope", o: {} }), 404, "unknown-change"],
  ] as const)("%s", async (_name, row, status, reason) => {
    const root = repoWith("foo", "bar");
    const { cwd, change, o } = row(root);
    await setup(root, o as Opts);
    const g = await get(cwd, change);
    expect([g.statusCode, reasonOf(g)]).toEqual([status, reason]);
    const p = await put(body(cwd, { change }));
    expect([p.statusCode, reasonOf(p)]).toEqual([status, reason]);
    expect(nodeFs.existsSync(fileOf(root))).toBe(false);
  });

  it("5 a tracked directory without openspec/ → 404 no-openspec-dir", async () => {
    const bare = mkTmp("deps-bare");
    roots.push(bare);
    await setup(bare, { sessionCwds: [bare] });
    for (const res of [await get(bare, "foo"), await put(body(bare))]) {
      expect([res.statusCode, reasonOf(res)]).toEqual([404, "no-openspec-dir"]);
    }
  });

  it("gates 1–2 touch no filesystem", async () => {
    const root = repoWith("foo");
    await setup(root, { sessionCwds: [] });
    const spies = (["stat", "lstat", "readFile", "readdir", "realpath"] as const).map((m) => vi.spyOn(fsp, m));
    const bad = await get(root, "../../etc");
    const untracked = await get(root, "foo");
    expect([bad.statusCode, untracked.statusCode]).toEqual([400, 403]);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

describe("#X2 traversal", () => {
  it("a traversing change name is rejected before any filesystem access", async () => {
    const root = repoWith("foo");
    await setup(root);
    const spies = (["stat", "lstat", "readFile", "readdir", "realpath", "writeFile", "rename", "link"] as const).map((m) => vi.spyOn(fsp, m));
    const res = await put(body(root, { change: "../../etc" }));
    expect([res.statusCode, reasonOf(res)]).toEqual([400, "invalid-request"]);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it.each([
    ["missing expected", (b: Record<string, unknown>) => { delete b.expected; }],
    ["self reference", (b: Record<string, unknown>) => { b.blockedBy = [{ change: "foo" }]; }],
    ["bad name in notBlockedBy", (b: Record<string, unknown>) => { b.notBlockedBy = ["Bad_Name"]; }],
    ["reason too long", (b: Record<string, unknown>) => { b.blockedBy = [{ change: "bar", reason: "x".repeat(501) }]; }],
    ["body too large", (b: Record<string, unknown>) => { b.blockedBy = Array.from({ length: 4000 }, (_, i) => ({ change: `change-${i}`, reason: "y".repeat(10) })); }],
  ])("PUT %s → 400 invalid-request", async (_n, mutate) => {
    const root = repoWith("foo", "bar");
    await setup(root);
    const b = body(root);
    mutate(b);
    const res = await put(b);
    expect([res.statusCode, reasonOf(res)]).toEqual([400, "invalid-request"]);
  });
});

describe("#X8 GET body", () => {
  it("valid file with reasons → declared + file stat; invalid → declaredError; none → nulls", async () => {
    const root = repoWith("foo", "bar", "baz");
    write(root, "openspec/changes/foo/dependencies.yaml", "blocked_by:\n  - change: bar\n    reason: api\nrelated: [baz]\n");
    write(root, "openspec/changes/bar/dependencies.yaml", "blocks: [x]\n");
    await setup(root, { data: cached("foo", "bar", "baz") });

    const ok = JSON.parse((await get(root, "foo")).payload).data;
    expect(ok.declared).toEqual({ blockedBy: [{ change: "bar", reason: "api" }], notBlockedBy: [], related: ["baz"] });
    expect(ok.declaredError).toBeNull();
    expect(ok.file).toEqual({ mtimeMs: expect.any(Number), size: expect.any(Number) });
    expect(ok.dependencies).toMatchObject({ hasFile: false, wave: 1 });

    const bad = JSON.parse((await get(root, "bar")).payload).data;
    expect(bad.declared).toBeNull();
    expect(bad.declaredError).toMatch(/blocks/);
    expect(bad.file).toEqual({ mtimeMs: expect.any(Number), size: expect.any(Number) }); // a replace needs its precondition

    const none = JSON.parse((await get(root, "baz")).payload).data;
    expect([none.declared, none.declaredError, none.file]).toEqual([null, null, null]);
  });

  it("a symlinked dependencies.yaml is invalid and never read through", async () => {
    const root = repoWith("foo");
    nodeFs.symlinkSync("/dev/zero", fileOf(root));
    await setup(root, { data: cached("foo") });
    const t0 = Date.now();
    const data = JSON.parse((await get(root, "foo")).payload).data;
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(data.declared).toBeNull();
    expect(data.declaredError).toMatch(/symlink/);
  });
});

describe("PUT writes", () => {
  it("creates the file atomically (no temp file left) and refreshes the poll", async () => {
    const root = repoWith("foo", "bar");
    const { refreshOpenSpec } = await setup(root);
    const res = await put(body(root));
    expect(res.statusCode).toBe(200);
    const parsed = parseDependenciesFile(nodeFs.readFileSync(fileOf(root), "utf8"));
    expect(parsed).toEqual({ ok: true, value: { blockedBy: [{ change: "bar", reason: "api" }], notBlockedBy: [], related: [] } });
    expect(nodeFs.readdirSync(path.dirname(fileOf(root))).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    const { file } = JSON.parse(res.payload).data;
    expect(file.size).toBe(nodeFs.statSync(fileOf(root)).size);
    expect(refreshOpenSpec).toHaveBeenCalledTimes(1);
  });

  it("#X14 logs one structured line with cwd, change and counts", async () => {
    const root = repoWith("foo", "bar");
    await setup(root);
    await put(body(root, { notBlockedBy: ["baz"], related: ["qux", "quux"] }));
    const lines = logLines.map((l) => JSON.parse(l)).filter((l) => l.event === "openspec.dependencies");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ cwd: root, change: "foo", blockedBy: 1, notBlockedBy: 1, related: 2 });
  });
});

describe("#X3 write guard", () => {
  it.each([
    [
      "change dir symlink outside the repo",
      (root: string) => {
        const outside = mkTmp("deps-outside");
        roots.push(outside);
        nodeFs.rmSync(path.join(root, "openspec/changes/foo"), { recursive: true });
        nodeFs.symlinkSync(outside, path.join(root, "openspec/changes/foo"));
        return outside;
      },
    ],
    [
      "dependencies.yaml symlink",
      (root: string) => {
        const outside = mkTmp("deps-outside");
        roots.push(outside);
        const target = path.join(outside, "target.yaml");
        nodeFs.writeFileSync(target, "related: []\n");
        nodeFs.symlinkSync(target, fileOf(root));
        return outside;
      },
    ],
    [
      "openspec/changes is a symlink (realpath outside)",
      (root: string) => {
        const outside = mkTmp("deps-outside");
        roots.push(outside);
        nodeFs.cpSync(path.join(root, "openspec/changes"), outside, { recursive: true });
        nodeFs.rmSync(path.join(root, "openspec/changes"), { recursive: true });
        nodeFs.symlinkSync(outside, path.join(root, "openspec/changes"));
        return outside;
      },
    ],
  ])("%s → refused, nothing written", async (_n, arrange) => {
    const root = repoWith("foo", "bar");
    const outside = arrange(root);
    await setup(root);
    const before = nodeFs.readdirSync(outside).sort();
    const res = await put(body(root, { expected: nodeFs.existsSync(fileOf(root)) ? { mtimeMs: 0, size: 0 } : null }));
    expect([res.statusCode, reasonOf(res)]).toEqual([403, "write-refused"]);
    expect(nodeFs.readdirSync(outside).sort()).toEqual(before);
  });

  it("a stale root (the CLI reports another project) → refused", async () => {
    const root = repoWith("foo", "bar");
    await setup(root, { statusRoot: { path: mkTmp("deps-other") } });
    const res = await put(body(root));
    expect([res.statusCode, reasonOf(res)]).toEqual([403, "write-refused"]);
    expect(nodeFs.existsSync(fileOf(root))).toBe(false);
  });
});

describe("#X4 lock", () => {
  it("a workflow-schema action holding the cwd lock → 409 locked, also through a symlinked spelling", async () => {
    const root = repoWith("foo", "bar");
    const link = path.join(mkTmp("deps-link"), "spelling");
    roots.push(path.dirname(link));
    nodeFs.symlinkSync(root, link);

    // The enable action takes the lock, then hangs on its first generation CLI call.
    let release!: () => void;
    const hang = new Promise<void>((r) => { release = r; });
    const fake = makeFakeCli();
    const base = stubDeps(fake);

    // A CLI that hangs on `--version` (generation's first call) after the write guard passed.
    const slow = { ...base, cli: async (call: { op: string }, ctx: never) => (call.op === "version" ? (await hang, { ok: true as const, stdout: "1.11.0\n" }) : (base.cli as never as (c: unknown, x: unknown) => Promise<unknown>)(call, ctx)) };
    fastify = Fastify();
    registerOpenSpecRoutes(fastify, {
      sessionManager: { listAll: () => [root, link].map((cwd) => ({ id: "s", cwd })) } as never,
      preferencesStore: { getPinnedDirectories: () => [] } as never,
      directoryService: { getOpenSpecPollMode: () => "all", getOpenSpecData: () => cached("foo", "bar"), refreshOpenSpec: async () => cached("foo") } as never,
      networkGuard: PASSTHRU,
      getOpenSpecConfig: () => ({ enabled: true, optOutDirectories: [], workflowSchema: { defaultForNewProjects: false } }) as never,
      workflowSchemaDeps: slow as never,
    });
    await fastify.ready();

    const enable = fastify.inject({ method: "POST", url: "/api/openspec/workflow-schema", payload: { cwd: root, action: "enable" } });
    for (let i = 0; i < 400 && !(fake.calls as unknown[]).some((c) => (c as { call: { op: string } }).call.op === "statusAll"); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    await new Promise((r) => setTimeout(r, 50)); // past the write guard, inside generation
    for (const cwd of [root, link]) {
      const res = await put(body(cwd));
      expect([res.statusCode, reasonOf(res)]).toEqual([409, "locked"]);
    }
    expect(nodeFs.existsSync(fileOf(root))).toBe(false);
    release();
    await enable;
  });
});

describe("#X5 precondition", () => {
  it("mtime differs / size differs / expected null but file exists → 409 modified, file unchanged; matching → written", async () => {
    const root = repoWith("foo", "bar");
    write(root, "openspec/changes/foo/dependencies.yaml", "related: [bar]\n");
    await setup(root);
    const st = nodeFs.statSync(fileOf(root));
    const original = nodeFs.readFileSync(fileOf(root), "utf8");
    for (const expected of [{ mtimeMs: st.mtimeMs + 1000, size: st.size }, { mtimeMs: st.mtimeMs, size: st.size + 1 }, null]) {
      const res = await put(body(root, { expected }));
      expect([res.statusCode, reasonOf(res)]).toEqual([409, "modified"]);
      expect(nodeFs.readFileSync(fileOf(root), "utf8")).toBe(original);
    }
    const ok = await put(body(root, { expected: { mtimeMs: st.mtimeMs, size: st.size } }));
    expect(ok.statusCode).toBe(200);
    expect(nodeFs.readFileSync(fileOf(root), "utf8")).not.toBe(original);
    expect(nodeFs.readdirSync(path.dirname(fileOf(root))).filter((n) => n.includes(".tmp"))).toEqual([]);
  });

  it("a file created after GET (expected null) is never overwritten", async () => {
    const root = repoWith("foo", "bar");
    await setup(root);
    write(root, "openspec/changes/foo/dependencies.yaml", "related: [agent]\n");
    const res = await put(body(root, { expected: null }));
    expect([res.statusCode, reasonOf(res)]).toEqual([409, "modified"]);
    expect(nodeFs.readFileSync(fileOf(root), "utf8")).toBe("related: [agent]\n");
  });
});

describe("#X6 injection", () => {
  it("a reason with a newline cannot inject a key", async () => {
    const root = repoWith("foo", "bar");
    await setup(root);
    const reason = "x\nnot_blocked_by: [a]";
    const res = await put(body(root, { blockedBy: [{ change: "bar", reason }] }));
    expect(res.statusCode).toBe(200);
    const parsed = parseDependenciesFile(nodeFs.readFileSync(fileOf(root), "utf8"));
    expect(parsed).toEqual({ ok: true, value: { blockedBy: [{ change: "bar", reason }], notBlockedBy: [], related: [] } });
  });
});

describe("#X7 registration", () => {
  const URL = "/api/openspec/dependencies";

  it("GET is observe and PUT is control; both are road-classified (manifest rows: mcp-server-plugin dependencies-tools.test.ts)", () => {
    expect(routeTier("GET", URL)).toBe("observe");
    expect(routeTier("PUT", URL)).toBe("control");
    for (const method of ["GET", "PUT"]) {
      expect(classifyHttpRoad(method, URL)?.road).toBe("non-session");
    }
  });

  it("both routes run the network guard as a preHandler", async () => {
    const root = repoWith("foo");
    const seen: Record<string, unknown> = {};
    const guard = async () => {};
    const app = Fastify();
    app.addHook("onRoute", (r) => {
      if (r.url === URL) seen[String(r.method)] = r.preHandler;
    });
    registerOpenSpecRoutes(app, {
      sessionManager: { listAll: () => [{ id: "s", cwd: root }] } as never,
      preferencesStore: { getPinnedDirectories: () => [] } as never,
      directoryService: {} as never,
      networkGuard: guard,
    });
    await app.ready();
    await app.close();
    expect(seen.GET).toBe(guard);
    expect(seen.PUT).toBe(guard);
  });
});

describe("review: writeDependenciesFile owns its containment", () => {
  it("a change name that resolves to openspec/changes itself ('.') is refused and writes nothing", async () => {
    const root = mkRepo({ config: "schema: pi-spec-driven\n" });
    for (const change of [".", ""]) {
      const out = await writeDependenciesFile({ root, change, content: "blocked_by: []\n", expected: null });
      expect(out.ok, `change ${JSON.stringify(change)}`).toBe(false);
    }
    expect(nodeFs.existsSync(path.join(root, "openspec", "changes", "dependencies.yaml"))).toBe(false);
    nodeFs.rmSync(root, { recursive: true, force: true });
  });
});
