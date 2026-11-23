/**
 * Plugin-owned flow-file serving: the flows-plugin bridge reports the files its
 * session's pi-flows uses; the plugin server serves EXACTLY those (flow YAML,
 * agent .md, code handlers). Nothing else becomes readable.
 * See change: attach-flow-before-run.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLOW_FILES_REPORT, FLOW_FILES_REQUEST_EVENT } from "../flow-files-contract.js";
import { codeHandlerPaths, FlowFileRegistry, MAX_FILE_BYTES, registerFlowFileRoutes } from "../server/flow-files.js";
import { openHarness } from "./flow-open-harness.js";

let tmp: string;
let flowFile: string;
let handler: string;
let targeted: string;
let helper: string;
let agentFile: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "flow-files-")));
  const flowDir = path.join(tmp, "pkg", "flows", "ns", "demo");
  fs.mkdirSync(flowDir, { recursive: true });
  fs.mkdirSync(path.join(tmp, "pkg", "agents"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "cwd", "handlers"), { recursive: true });
  flowFile = path.join(flowDir, "flow.yaml");
  handler = path.join(flowDir, "load.ts");
  helper = path.join(flowDir, "_shared.ts");
  targeted = path.join(tmp, "cwd", "handlers", "check.ts");
  agentFile = path.join(tmp, "pkg", "agents", "filler.md");
  fs.writeFileSync(
    flowFile,
    [
      "name: demo",
      "description: d",
      "steps:",
      "  - id: load",
      "    type: code",
      "  - id: fill",
      "    type: agent",
      "    agent: filler",
      "  - id: check",
      "    type: code-decision",
      "    target: handlers/check.ts",
      "    branches: { ok: load }",
      "",
    ].join("\n"),
  );
  for (const f of [handler, helper, targeted]) fs.writeFileSync(f, `// ${path.basename(f)}\n`);
  fs.writeFileSync(agentFile, "---\nname: filler\n---\n");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("codeHandlerPaths", () => {
  it("convention <flowDir>/<id>.ts, explicit target resolved against cwd", () => {
    expect(codeHandlerPaths(flowFile, path.join(tmp, "cwd"))).toEqual({ load: handler, check: targeted });
  });
  it("explicit target without a cwd is skipped", () => {
    expect(codeHandlerPaths(flowFile, undefined)).toEqual({ load: handler });
  });
});

describe("FlowFileRegistry", () => {
  it("allows exactly reported flow/agent/handler files", () => {
    const r = new FlowFileRegistry();
    r.report(
      "S1",
      {
        flows: [{ name: "ns:demo", source: flowFile }, { name: "bad", source: "relative.yaml" }],
        agents: [{ name: "filler", source: agentFile }, { name: "x", source: "/etc/passwd" }],
      },
      path.join(tmp, "cwd"),
    );
    for (const ok of [flowFile, agentFile, handler, targeted]) expect(r.isAllowed("S1", ok)).toBe(true);
    for (const no of [helper, "/etc/passwd", path.dirname(flowFile)]) expect(r.isAllowed("S1", no)).toBe(false);
    expect(r.isAllowed("S2", flowFile)).toBe(false);
    expect(r.files("S1")).toEqual({
      agents: { filler: agentFile },
      handlers: { "ns:demo": { load: handler, check: targeted } },
    });
  });

  it("retainOnly drops sessions that are no longer live", () => {
    const r = new FlowFileRegistry();
    r.report("S1", { flows: [{ name: "ns:demo", source: flowFile }] });
    r.retainOnly(new Set());
    expect(r.has("S1")).toBe(false);
  });
});

describe("flow file routes", () => {
  let fastify: FastifyInstance;
  let report: (payload: unknown, meta: { sessionId: string }) => unknown;
  let reportOpts: { hubLocalOnly?: boolean } | undefined;
  const emitEventToSession = vi.fn(() => true);
  let live: Array<{ id: string; cwd: string; status?: string }>;

  beforeEach(async () => {
    live = [{ id: "S1", cwd: path.join(tmp, "cwd") }];
    emitEventToSession.mockClear();
    fastify = Fastify();
    await registerFlowFileRoutes({
      fastify: fastify as never,
      networkGuard: async () => {},
      readFileGuarded: (p) => fs.promises.readFile(p, "utf8"),
      registerPiRequestHandler: (type, h, opts) => {
        if (type === FLOW_FILES_REPORT) {
          report = h;
          reportOpts = opts;
        }
      },
      sessionManager: { listActive: () => live, getSession: (id) => live.find((s) => s.id === id) },
      emitEventToSession,
      registry: new FlowFileRegistry(),
    });
    await fastify.ready();
  });

  // The report stores bridge-claimed absolute paths the hub later reads from its own disk: hub-local sessions only.
  // See change: harden-bridge-session-claim (D3).
  it("registers the report handler hub-local-only", () => {
    expect(reportOpts).toEqual({ hubLocalOnly: true });
  });

  it("BE108/BX9: a session whose report was denied by the host (origin_denied, handler never ran) gets the unreported answer and no file read", async () => {
    const res = await getFile(flowFile);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.payload).retry).toBe(true);
  });
  afterEach(async () => fastify.close());

  const getFile = (p: string, sid = "S1") =>
    fastify.inject({ method: "GET", url: `/api/plugins/flows/file?sessionId=${sid}&path=${encodeURIComponent(p)}` });

  it("not reported yet → asks the bridge and answers retry", async () => {
    const res = await getFile(flowFile);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.payload).retry).toBe(true);
    expect(emitEventToSession).toHaveBeenCalledWith("S1", FLOW_FILES_REQUEST_EVENT, {});
    const files = JSON.parse((await fastify.inject({ method: "GET", url: "/api/plugins/flows/files?sessionId=S1" })).payload);
    expect(files.data.reported).toBe(false);
  });

  it("BE107: after a hub-local report: serves reported files, 403 for others, files map resolved with the session cwd", async () => {
    report({ flows: [{ name: "ns:demo", source: flowFile }], agents: [{ name: "filler", source: agentFile }] }, { sessionId: "S1" });
    const ok = await getFile(handler);
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.payload).data.content).toBe("// load.ts\n");
    expect((await getFile(agentFile)).statusCode).toBe(200);
    expect((await getFile(targeted)).statusCode).toBe(200);
    expect((await getFile(helper)).statusCode).toBe(403);
    const files = JSON.parse((await fastify.inject({ method: "GET", url: "/api/plugins/flows/files?sessionId=S1" })).payload);
    expect(files.data).toEqual({
      reported: true,
      agents: { filler: agentFile },
      handlers: { "ns:demo": { load: handler, check: targeted } },
    });
  });

  it("asks the bridge at most once per cooldown; a reported path that is a directory is not served", async () => {
    await getFile(flowFile);
    await getFile(flowFile);
    expect(emitEventToSession).toHaveBeenCalledTimes(1);
    const dirAsYaml = path.join(tmp, "dir.yaml");
    fs.mkdirSync(dirAsYaml);
    report({ flows: [{ name: "d", source: dirAsYaml }] }, { sessionId: "S1" });
    expect((await getFile(dirAsYaml)).statusCode).toBe(404);
  });

  it("a symlink to an unreported file is refused; unknown / ended session → 404", async () => {
    report({ flows: [{ name: "ns:demo", source: flowFile }] }, { sessionId: "S1" });
    const link = path.join(tmp, "evil.yaml");
    fs.symlinkSync(helper, link);
    expect((await getFile(link)).statusCode).toBe(403);
    expect((await getFile(flowFile, "S9")).statusCode).toBe(404);
    live = [{ id: "S1", cwd: tmp, status: "ended" }];
    expect((await getFile(flowFile)).statusCode).toBe(404);
  });
});

// #E30 / #E31 (close-security-map-high-findings): the route reads CONTENT only through the host's `readFileGuarded`
// seam and fails closed when it is null or absent (an older host) — it never falls back to plain `fs`.
describe("flow file route × host readFileGuarded seam", () => {
  type Guard = ((absPath: string) => Promise<string | null>) | undefined;
  async function build(guard: Guard) {
    let report: (payload: unknown, meta: { sessionId: string }) => unknown = () => undefined;
    const app = Fastify();
    await registerFlowFileRoutes({
      fastify: app as never,
      networkGuard: async () => {},
      readFileGuarded: guard,
      registerPiRequestHandler: (type, h) => {
        if (type === FLOW_FILES_REPORT) report = h;
      },
      sessionManager: { listActive: () => [{ id: "S1", cwd: tmp }], getSession: () => ({ cwd: tmp }) },
      emitEventToSession: () => true,
      registry: new FlowFileRegistry(),
    });
    await app.ready();
    const get = (p: string) => app.inject({ method: "GET", url: `/api/plugins/flows/file?sessionId=S1&path=${encodeURIComponent(p)}` });
    return { app, report: (payload: unknown) => report(payload, { sessionId: "S1" }), get };
  }

  it("E30 present+ok → unchanged content; null → the existing 403; absent seam → the existing 403; plain fs.readFile never called when refused", async () => {
    const readSpy = vi.spyOn(fs.promises, "readFile");
    const ok = await build((p) => fs.promises.readFile(p, "utf8").then((c) => c));
    ok.report({ flows: [{ name: "ns:demo", source: flowFile }] });
    const res = await ok.get(handler);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).data.content).toBe("// load.ts\n");
    await ok.app.close();

    for (const guard of [async () => null, undefined] as Guard[]) {
      readSpy.mockClear();
      const refused = await build(guard);
      refused.report({ flows: [{ name: "ns:demo", source: flowFile }] });
      const r = await refused.get(handler);
      expect(r.statusCode).toBe(403);
      expect(JSON.parse(r.payload)).toEqual({ success: false, error: "not a flow file of this session" });
      expect(readSpy).not.toHaveBeenCalled();
      await refused.app.close();
    }
  });

  it("E31 a reported file that is a symlink to a credential file is refused by the seam: 403, no bytes; an ordinary reported file is unchanged; an unreported path keeps its 403", async () => {
    const credDir = path.join(tmp, "agent");
    fs.mkdirSync(credDir);
    fs.writeFileSync(path.join(credDir, "auth.json"), "FLOWS-CRED-MARKER");
    const link = path.join(tmp, "cwd", "x.md");
    fs.symlinkSync(path.join(credDir, "auth.json"), link);
    // Stand-in for the host guard: decides on the REAL path (the real guard is covered in the server package).
    const asked: string[] = [];
    const guard: Guard = async (p) => {
      asked.push(p);
      return fs.realpathSync(p).endsWith(`${path.sep}auth.json`) ? null : fs.promises.readFile(p, "utf8");
    };
    const t = await build(guard);
    t.report({ flows: [{ name: "ns:demo", source: flowFile }], agents: [{ name: "evil", source: link }, { name: "filler", source: agentFile }] });
    const bad = await t.get(link);
    expect(bad.statusCode).toBe(403);
    expect(bad.payload).not.toContain("FLOWS-CRED-MARKER");
    expect(asked.some((p) => fs.realpathSync(p).endsWith(`${path.sep}auth.json`))).toBe(true); // the seam, not the allow-list, refused it
    expect((await t.get(agentFile)).statusCode).toBe(200);
    expect((await t.get(helper)).statusCode).toBe(403);
    await t.app.close();
  });
});

// ── flow_open path admission + opened-file serving. See change: add-flow-open-tool. ──

describe("flow/open path admission (E2–E7, X6)", () => {
  let w: string;
  const write = (rel: string, body = "name: x\nsteps: []\n") => {
    const f = path.join(w, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
    return f;
  };
  beforeEach(() => {
    vi.useFakeTimers();
    w = path.join(tmp, "w");
    fs.mkdirSync(w, { recursive: true });
  });
  afterEach(() => vi.useRealTimers());

  it("E2: a directory with a direct flow.yaml is admitted, view-only, cwd-relative name, realpath source", async () => {
    write("flows/a/flow.yaml");
    const h = openHarness({ sessions: { S: w }, autoAck: ["ws1"] });
    const r = await h.call({ path: "flows/a" });
    expect(r).toMatchObject({ status: "shown", acks: 1, viewOnly: true, name: "flows/a/flow.yaml" });
    expect(h.broadcasts[0].attachment).toMatchObject({
      source: fs.realpathSync(path.join(w, "flows/a/flow.yaml")),
      name: "flows/a/flow.yaml",
      viewOnly: true,
    });
  });

  it("E3: paths outside the cwd (parent, absolute, prefix-sharing sibling) → path-not-allowed, no read", async () => {
    const other = path.join(tmp, "other", "flow.yaml");
    fs.mkdirSync(path.dirname(other), { recursive: true });
    fs.writeFileSync(other, "steps: []\n");
    const sibling = path.join(tmp, "w2", "flow.yaml");
    fs.mkdirSync(path.dirname(sibling), { recursive: true });
    fs.writeFileSync(sibling, "steps: []\n");
    const h = openHarness({ sessions: { S: w } });
    for (const p of ["../other/flow.yaml", "/etc/flow.yaml", sibling]) {
      expect(await h.call({ path: p })).toEqual({ status: "refused", reason: "path-not-allowed" });
    }
    expect(h.readFileGuarded).not.toHaveBeenCalled();
    expect(h.broadcasts).toHaveLength(0);
  });

  it("E4: a symlinked directory escaping the cwd → path-not-allowed", async () => {
    const outside = path.join(tmp, "outside");
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "flow.yaml"), "steps: []\n");
    fs.mkdirSync(path.join(w, "flows"), { recursive: true });
    fs.symlinkSync(outside, path.join(w, "flows", "link"));
    const h = openHarness({ sessions: { S: w } });
    expect(await h.call({ path: "flows/link" })).toEqual({ status: "refused", reason: "path-not-allowed" });
    expect(await h.call({ path: "flows/link/flow.yaml" })).toEqual({ status: "refused", reason: "path-not-allowed" });
  });

  it("E5: wrong name, oversize and a directory named flow.yaml → not-a-flow; exactly MAX_FILE_BYTES admitted", async () => {
    write("x/other.yaml");
    fs.mkdirSync(path.join(w, "d", "flow.yaml"), { recursive: true });
    const h = openHarness({ sessions: { S: w }, autoAck: ["ws"] });
    expect(await h.call({ path: "x/other.yaml" })).toMatchObject({ status: "refused", reason: "not-a-flow" });
    expect(await h.call({ path: "d/flow.yaml" })).toMatchObject({ status: "refused", reason: "not-a-flow" });
    write("y/flow.yaml", `steps: []\n# ${"a".repeat(MAX_FILE_BYTES - 13)}\n`);
    expect(fs.statSync(path.join(w, "y/flow.yaml")).size).toBe(MAX_FILE_BYTES);
    expect(await h.call({ path: "y/flow.yaml" })).toMatchObject({ status: "shown" });
    fs.appendFileSync(path.join(w, "y/flow.yaml"), "#");
    h.readFileGuarded?.mockClear();
    expect(await h.call({ path: "y/flow.yaml" })).toMatchObject({ status: "refused", reason: "not-a-flow" });
    expect(h.readFileGuarded).not.toHaveBeenCalled();
  });

  it("E6: session cwd `/` admits an absolute path (no `//` prefix bug)", async () => {
    const f = write("tmpx/flow.yaml");
    const h = openHarness({ sessions: { S: "/" }, autoAck: ["ws"] });
    const r = await h.call({ path: fs.realpathSync(f) });
    expect(r).toMatchObject({ status: "shown", name: path.relative("/", fs.realpathSync(f)) });
  });

  it("E7: a directory without a direct flow lists ≤20 cwd-relative candidates, depth ≤6, no node_modules/.git/symlinks", async () => {
    for (let i = 0; i < 25; i++) {
      const depth = (i % 7) + 1;
      write(`root/${Array.from({ length: depth }, (_, d) => `d${i}_${d}`).join("/")}/flow.yaml`);
    }
    write("root/node_modules/flow.yaml");
    write("root/.git/flow.yaml");
    const ext = path.join(tmp, "ext");
    fs.mkdirSync(ext, { recursive: true });
    fs.writeFileSync(path.join(ext, "flow.yaml"), "steps: []\n");
    fs.symlinkSync(ext, path.join(w, "root", "linked"));
    const h = openHarness({ sessions: { S: w } });
    const r = await h.call({ path: "root" });
    expect(r).toMatchObject({ status: "refused", reason: "not-a-flow" });
    const c = (r as { candidates: string[] }).candidates;
    expect(c.length).toBeGreaterThan(0);
    expect(c.length).toBeLessThanOrEqual(20);
    for (const p of c) {
      expect(path.isAbsolute(p)).toBe(false);
      expect(p.startsWith("root/")).toBe(true);
      expect(p.split("/").length - 2).toBeLessThanOrEqual(6);
      expect(p).not.toMatch(/node_modules|\.git|linked/);
    }
  });

  it("X6: no host readFileGuarded seam → unavailable", async () => {
    write("flows/a/flow.yaml");
    const h = openHarness({ sessions: { S: w }, readFileGuarded: null });
    expect(await h.call({ path: "flows/a" })).toEqual({ status: "refused", reason: "unavailable" });
  });
});

describe("opened flow files through the plugin file route (E12–E15, X7)", () => {
  let w: string;
  let flowDir: string;
  let app: FastifyInstance;
  let registry: FlowFileRegistry;
  let report: (payload: unknown, meta: { sessionId: string }) => unknown;
  const live = () => [
    { id: "S", cwd: w },
    { id: "S2", cwd: w },
  ];

  beforeEach(async () => {
    w = path.join(tmp, "w");
    flowDir = path.join(w, "flows", "f");
    fs.mkdirSync(flowDir, { recursive: true });
    fs.writeFileSync(
      path.join(flowDir, "flow.yaml"),
      ["name: f", "steps:", "  - id: load", "    type: code", "  - id: x", "    type: code", "    target: ../../out/s.ts", ""].join("\n"),
    );
    fs.writeFileSync(path.join(flowDir, "load.ts"), "// load\n");
    fs.writeFileSync(path.join(flowDir, "_lib.ts"), "// lib\n");
    fs.mkdirSync(path.join(tmp, "out"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "out", "s.ts"), "// secret\n");
    registry = new FlowFileRegistry();
    app = Fastify();
    await registerFlowFileRoutes({
      fastify: app as never,
      networkGuard: async () => {},
      readFileGuarded: (p) => fs.promises.readFile(p, "utf8"),
      registerPiRequestHandler: (type, h) => {
        if (type === FLOW_FILES_REPORT) report = h;
      },
      sessionManager: { listActive: live, getSession: (id) => live().find((s) => s.id === id) },
      emitEventToSession: () => true,
      registry,
    });
    await app.ready();
    vi.useFakeTimers();
    const h = openHarness({ sessions: { S: w }, autoAck: ["ws"], registry });
    expect(await h.call({ path: "flows/f" })).toMatchObject({ status: "shown" });
    vi.useRealTimers();
  });
  afterEach(async () => app.close());

  const get = (p: string, sid = "S") =>
    app.inject({ method: "GET", url: `/api/plugins/flows/file?sessionId=${sid}&path=${encodeURIComponent(p)}` });

  it("E12: serves the named handler only; unnamed sibling and escaped target refused", async () => {
    expect((await get(path.join(flowDir, "load.ts"))).statusCode).toBe(200);
    expect((await get(path.join(flowDir, "_lib.ts"))).statusCode).toBe(403);
    expect((await get(path.resolve(w, "../../out/s.ts"))).statusCode).toBe(403);
    expect((await get(path.join(tmp, "out", "s.ts"))).statusCode).toBe(403);
  });

  it("E13: another session cannot read S's opened flow", async () => {
    report({ flows: [] }, { sessionId: "S2" });
    expect((await get(path.join(flowDir, "flow.yaml"), "S2")).statusCode).toBe(403);
  });

  it("E14: a catalog re-report keeps the opened files readable", async () => {
    report({ flows: [] }, { sessionId: "S" });
    expect((await get(path.join(flowDir, "flow.yaml"))).statusCode).toBe(200);
  });

  it("E15: never-reported session: /files reported:true with handlers[displayName]; /file 200 (no 409)", async () => {
    const files = JSON.parse((await app.inject({ method: "GET", url: "/api/plugins/flows/files?sessionId=S" })).payload);
    expect(files.data.reported).toBe(true);
    expect(files.data.handlers["flows/f/flow.yaml"]).toEqual({ load: path.join(flowDir, "load.ts") });
    expect((await get(path.join(flowDir, "flow.yaml"))).statusCode).toBe(200);
  });

  it("X7: definition swapped for a symlink to outside after admission → 403", async () => {
    const outside = path.join(tmp, "outside.yaml");
    fs.writeFileSync(outside, "steps: []\n");
    fs.rmSync(path.join(flowDir, "flow.yaml"));
    fs.symlinkSync(outside, path.join(flowDir, "flow.yaml"));
    expect((await get(path.join(flowDir, "flow.yaml"))).statusCode).toBe(403);
  });
});
