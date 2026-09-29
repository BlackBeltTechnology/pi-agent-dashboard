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
import { codeHandlerPaths, FlowFileRegistry, registerFlowFileRoutes } from "../server/flow-files.js";

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
  const emitEventToSession = vi.fn(() => true);
  let live: Array<{ id: string; cwd: string; status?: string }>;

  beforeEach(async () => {
    live = [{ id: "S1", cwd: path.join(tmp, "cwd") }];
    emitEventToSession.mockClear();
    fastify = Fastify();
    registerFlowFileRoutes({
      fastify: fastify as never,
      networkGuard: async () => {},
      registerPiRequestHandler: (type, h) => {
        if (type === FLOW_FILES_REPORT) report = h;
      },
      sessionManager: { listActive: () => live, getSession: (id) => live.find((s) => s.id === id) },
      emitEventToSession,
      registry: new FlowFileRegistry(),
    });
    await fastify.ready();
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

  it("after a report: serves reported files, 403 for others, files map resolved with the session cwd", async () => {
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
