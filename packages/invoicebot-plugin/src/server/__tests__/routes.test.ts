/**
 * Routes: forward `{ selector, ...args }` to the port for the request `cwd`,
 * reject missing cwd/selector with 400 (no engine call), keep concurrent A/B
 * requests cwd-isolated, dispatch a flow for flow-triggering ops and attach the
 * returned sessionId, and mark consequential ops. See change:
 * add-invoicebot-rest-plugin (§4.5, §5.5).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EngineResult, FlowRunSpec, InvoiceEngine } from "../engine/port.js";
import { mountInvoiceBotRoutes } from "../routes.js";

/** Recording engine: captures every (cwd, args) and returns a canned result. */
function makeRecorder() {
  const calls: { method: string; cwd: string; args: any }[] = [];
  const flowFor = (args: any): FlowRunSpec | undefined => {
    if (args.action === "approve") return { flowName: "invoicebot:process", task: `source://${args.invoice_id}` };
    if (args.action === "request") return { flowName: "invoicebot:add-rule", task: "{}" };
    return undefined;
  };
  const mk = (method: string) => async (cwd: string, args: any): Promise<EngineResult> => {
    calls.push({ method, cwd, args });
    const flow = method === "review" || method === "rules" ? flowFor(args) : undefined;
    return { content: [{ type: "text", text: `${method}:${args.view ?? args.action}` }], details: { echoedCwd: cwd, ok: true }, ...(flow ? { flow } : {}) };
  };
  const ingest = async (cwd: string, files: any[]) => {
    calls.push({ method: "ingest", cwd, args: files });
    return { results: [], landed: 0, skipped: 0, rejected: 0 };
  };
  // Recorded separately so the strict `calls` assertions above stay unaffected.
  const ensureCalls: string[] = [];
  const ensureAutomation = async (cwd: string) => { ensureCalls.push(cwd); return { automation: [] }; };
  const engine: InvoiceEngine = { query: mk("query"), review: mk("review"), setup: mk("setup"), rules: mk("rules"), ingest, ensureAutomation };
  return { engine, calls, ensureCalls };
}

let app: FastifyInstance;
let calls: { method: string; cwd: string; args: any }[];
let ensureCalls: string[];
let dispatchCalls: { cwd: string; flow: FlowRunSpec; sessionId?: string; invoiceId?: string }[];
let scopedCalls: { cwd: string; invoiceId: string }[];
let scopedResult: string | undefined;
let cwdA: string;
let cwdB: string;

beforeEach(async () => {
  const rec = makeRecorder();
  calls = rec.calls;
  ensureCalls = rec.ensureCalls;
  dispatchCalls = [];
  scopedCalls = [];
  scopedResult = "scoped-1";
  app = Fastify();
  mountInvoiceBotRoutes(app, {
    engine: rec.engine,
    dispatchFlow: async (a) => { dispatchCalls.push(a); return "sess-NEW"; },
    ensureScopedSession: async (cwd, invoiceId) => {
      scopedCalls.push({ cwd, invoiceId });
      return scopedResult;
    },
  });
  await app.ready();
  cwdA = mkdtempSync(join(tmpdir(), "ib-A-"));
  cwdB = mkdtempSync(join(tmpdir(), "ib-B-"));
});
afterEach(async () => {
  await app.close();
  for (const d of [cwdA, cwdB]) rmSync(d, { recursive: true, force: true });
});

async function post(path: string, body: Record<string, unknown>) {
  const res = await app.inject({ method: "POST", url: `/api/plugins/invoicebot/${path}`, payload: body });
  return { status: res.statusCode, json: res.json() as any };
}

describe("cwd + selector validation", () => {
  it("query forwards {view} to engine for the given cwd", async () => {
    const { status, json } = await post("query", { cwd: cwdA, view: "pending" });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.echoedCwd).toBe(cwdA);
    expect(calls).toEqual([{ method: "query", cwd: cwdA, args: expect.objectContaining({ view: "pending" }) }]);
  });

  it("missing cwd → 400, no engine call", async () => {
    const { status, json } = await post("query", { view: "pending" });
    expect(status).toBe(400);
    expect(json.error).toMatch(/cwd/);
    expect(calls).toHaveLength(0);
  });

  it("non-existent cwd → 400", async () => {
    const { status } = await post("query", { cwd: "/no/such/dir/xyz", view: "pending" });
    expect(status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("missing view → 400, no mutation", async () => {
    const { status } = await post("query", { cwd: cwdA });
    expect(status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("review missing action → 400", async () => {
    const { status } = await post("review", { cwd: cwdA });
    expect(status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("ensure-intake-automation on first touch", () => {
  it.each([
    ["query", { view: "pending" }],
    ["review", { action: "note", target_kind: "invoice", target_id: "x", author: "a", text: "t" }],
    ["setup", { action: "cadence", which: "process", cron: "* * * * *" }],
    ["rules", { action: "approve", id: "r1" }],
  ])("%s ensures the intake scaffold with the request cwd", async (path, extra) => {
    await post(path, { cwd: cwdA, ...extra });
    expect(ensureCalls).toEqual([cwdA]);
  });

  it("invalid cwd → 400 and does NOT ensure", async () => {
    const { status } = await post("query", { view: "pending" });
    expect(status).toBe(400);
    expect(ensureCalls).toHaveLength(0);
  });
});

describe("scoped-session bootstrap", () => {
  it("returns the ensured session id and runs workspace initialization", async () => {
    const { status, json } = await post("scoped-session", { cwd: cwdA, invoice_id: "inv-42" });
    expect(status).toBe(200);
    expect(json).toEqual({ sessionId: "scoped-1" });
    expect(scopedCalls).toEqual([{ cwd: cwdA, invoiceId: "inv-42" }]);
    expect(ensureCalls).toEqual([cwdA]);
  });

  it("rejects malformed input with 400 without ensuring", async () => {
    expect((await post("scoped-session", { invoice_id: "inv-42" })).status).toBe(400);
    expect((await post("scoped-session", { cwd: cwdA, invoice_id: "" })).status).toBe(400);
    expect((await post("scoped-session", { cwd: cwdA })).status).toBe(400);
    expect(scopedCalls).toHaveLength(0);
  });

  it("returns 503 when no session can be produced", async () => {
    scopedResult = undefined;
    const { status, json } = await post("scoped-session", { cwd: cwdA, invoice_id: "inv-42" });
    expect(status).toBe(503);
    expect(json).toEqual({ error: "scoped session unavailable" });
  });
});

describe("cwd isolation", () => {
  it("A and B target their own workspace", async () => {
    await post("query", { cwd: cwdA, view: "list" });
    await post("query", { cwd: cwdB, view: "list" });
    expect(calls.map((c) => c.cwd)).toEqual([cwdA, cwdB]);
  });

  it("concurrent A/B never cross cwd", async () => {
    await Promise.all([
      post("query", { cwd: cwdA, view: "pending" }),
      post("query", { cwd: cwdB, view: "pending" }),
      post("query", { cwd: cwdA, view: "status" }),
      post("query", { cwd: cwdB, view: "finance" }),
    ]);
    // each recorded call's cwd matches its own view's workspace
    const byView = new Map(calls.map((c) => [c.args.view, c.cwd]));
    expect(byView.get("pending") === cwdA || byView.get("pending") === cwdB).toBe(true);
    expect(byView.get("status")).toBe(cwdA);
    expect(byView.get("finance")).toBe(cwdB);
  });
});

describe("flow-triggering ops dispatch + sessionId", () => {
  it("approve dispatches the flow and attaches sessionId + consequential", async () => {
    const { json } = await post("review", { cwd: cwdA, action: "approve", invoice_id: "a1b2", sessionId: "sess-77" });
    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0]).toMatchObject({ cwd: cwdA, sessionId: "sess-77", invoiceId: "a1b2", flow: { flowName: "invoicebot:process" } });
    expect(json.sessionId).toBe("sess-NEW");
    expect(json.consequential).toBe(true);
  });

  it("note is pure — no dispatch, no sessionId", async () => {
    const { json } = await post("review", { cwd: cwdA, action: "note", target_kind: "invoice", target_id: "x", author: "a", text: "t" });
    expect(dispatchCalls).toHaveLength(0);
    expect(json.sessionId).toBeUndefined();
    expect(json.consequential).toBeUndefined();
  });

  it("rules request dispatches invoicebot:add-rule", async () => {
    const { json } = await post("rules", { cwd: cwdA, action: "request", id: "r2", seq: 20, description: "x" });
    expect(dispatchCalls[0].flow.flowName).toBe("invoicebot:add-rule");
    expect(json.sessionId).toBe("sess-NEW");
  });

  it("handoff with confirm is marked consequential (pure, no flow)", async () => {
    const { json } = await post("review", { cwd: cwdA, action: "handoff", target_id: "book1", confirm: true });
    expect(dispatchCalls).toHaveLength(0);
    expect(json.consequential).toBe(true);
  });
});
