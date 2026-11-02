/**
 * REST question roads against the REAL question store + Fastify
 * (test-plan #E6 #E8 #E9 #E11 #E12 #X2 #X7, summarize).
 * See change: add-pending-question-stack (D8, D9).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerBearerAuth } from "../../auth/bearer-auth.js";
import { createNetworkGuard } from "../../auth/localhost-guard.js";
import { ROUTE_TIERS } from "@blackbelt-technology/pi-dashboard-shared/route-tiers.js";
import { WS_MESSAGE_TIERS } from "@blackbelt-technology/pi-dashboard-shared/ws-message-tiers.js";
import { createRouteTierGate } from "../../auth/route-tier-gate.js";
import { createMemoryEventStore } from "../../persistence/memory-event-store.js";
import { PairedDeviceRegistry } from "../../pairing/paired-devices.js";
import type { BriefOutcome } from "../brief-generator.js";
import { createQuestionFileStore } from "../question-files.js";
import { registerQuestionRoutes } from "../question-routes.js";
import { createQuestionStore, TRANSMITTED_WINDOW_MS, type QuestionStore } from "../question-store.js";

const anna = { iss: "kc", sub: "anna" };
const bela = { iss: "kc", sub: "bela" };

function promptMsg(sessionId: string, promptId: string, prompt: Record<string, unknown> = {}) {
  return {
    type: "prompt_request",
    sessionId,
    promptId,
    prompt: { question: "Resume or hand back?", type: "select", options: ["Resume", "Hand back"], ...prompt },
    component: { type: "x", props: {} },
    placement: "inline",
  } as Record<string, unknown>;
}

describe("question REST roads", () => {
  let home: string;
  let origHome: string | undefined;
  let clock: number;
  const apps: FastifyInstance[] = [];

  beforeEach(() => {
    origHome = process.env.HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "qroutes-"));
    process.env.HOME = home;
    clock = 1_000_000;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    for (const a of apps.splice(0)) await a.close();
    process.env.HOME = origHome;
    fs.rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const ok = (text = "A generated brief."): BriefOutcome => ({ ok: true, text, label: "generated", latencyMs: 5 });

  function makeStore(over: { generate?: () => Promise<BriefOutcome>; describe?: (sid: string) => unknown } = {}) {
    const generate = vi.fn(over.generate ?? (async () => ok()));
    const store = createQuestionStore({
      eventStore: createMemoryEventStore(() => false, 32, 20000, 100_000, 1_000_000),
      files: createQuestionFileStore(),
      describeSession: (over.describe as never) ?? ((sid: string) => ({ label: `label-${sid}` })),
      briefs: { generate: generate as never, stats: () => ({ ready: 0, failed: 0, unavailable: 0, fallbacks: 0, queued: 0, inFlight: 0 }) },
      config: () => ({ autoBrief: false, minBriefChars: 240 }),
      now: () => clock,
    });
    return { store, generate };
  }

  async function makeApp(
    store: QuestionStore,
    opts: {
      send?: (sid: string, msg: Record<string, unknown>) => boolean;
      active?: boolean;
      owners?: Record<string, { iss: string; sub: string } | undefined>;
      tierGate?: { reg: PairedDeviceRegistry };
    } = {},
  ) {
    const send = vi.fn(opts.send ?? (() => true));
    const app = Fastify();
    apps.push(app);
    await app.register(rateLimit, { global: true, max: 100_000, timeWindow: "1 minute" });
    app.decorateRequest("principal", null);
    app.addHook("onRequest", async (req) => {
      const p = req.headers["x-principal"];
      if (typeof p === "string") (req as unknown as { principal: unknown }).principal = JSON.parse(p);
    });
    if (opts.tierGate) {
      registerBearerAuth(app, { registry: opts.tierGate.reg });
      app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => [], logRefusal: () => {} }));
    }
    registerQuestionRoutes(app, {
      networkGuard: opts.tierGate ? createNetworkGuard([]) : async () => {},
      store,
      sendToSession: send as never,
      isResolverActive: () => opts.active ?? false,
      ownerOf: (sid) => opts.owners?.[sid],
    });
    await app.ready();
    return { app, send };
  }

  const as = (p: { iss: string; sub: string }) => ({ "x-principal": JSON.stringify(p) });
  const idOf = (store: QuestionStore, i = 0) => store.listRows()[i].id;
  const post = (app: FastifyInstance, id: string, body: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url: `/api/questions/${id}/answer`, payload: body as never, headers });

  describe("list + detail", () => {
    it("lists rows without context bodies, newest first", async () => {
      const { store } = makeStore();
      store.onTracked("s1", promptMsg("s1", "p1"));
      clock += 10;
      store.onTracked("s2", promptMsg("s2", "p2"));
      const { app } = await makeApp(store);
      const res = await app.inject({ method: "GET", url: "/api/questions" });
      expect(res.statusCode).toBe(200);
      const rows = res.json().data as Array<Record<string, unknown>>;
      expect(rows.map((r) => r.sessionId)).toEqual(["s2", "s1"]);
      for (const r of rows) {
        expect(r).not.toHaveProperty("snapshot");
        expect(r).not.toHaveProperty("brief");
        expect(r).not.toHaveProperty("options");
      }
    });

    it("detail carries brief, snapshot and answerable; 404 unknown / not pending", async () => {
      const { store } = makeStore();
      store.onTracked("s1", promptMsg("s1", "p1", { metadata: { message: "m".repeat(300) } }));
      const id = idOf(store);
      const { app } = await makeApp(store);
      const res = await app.inject({ method: "GET", url: `/api/questions/${id}` });
      expect(res.statusCode).toBe(200);
      const d = res.json().data;
      expect(d).toMatchObject({ id, question: "Resume or hand back?", options: ["Resume", "Hand back"], answerable: true, briefStatus: "provided" });
      expect(d.snapshot).toBeDefined();
      expect((await app.inject({ method: "GET", url: "/api/questions/nope" })).statusCode).toBe(404);
      store.removeQuestion("s1", "p1", "cleared");
      expect((await app.inject({ method: "GET", url: `/api/questions/${id}` })).statusCode).toBe(404);
    });

    it("a transmitted question is not listed and its detail is 404", async () => {
      const { store } = makeStore();
      store.onTracked("s1", promptMsg("s1", "p1"));
      const id = idOf(store);
      const { app } = await makeApp(store);
      expect((await post(app, id, { answer: "Resume" })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/questions" })).json().data).toEqual([]);
      expect((await app.inject({ method: "GET", url: `/api/questions/${id}` })).statusCode).toBe(404);
    });
  });

  describe("visibility on every road (test-plan #E9)", () => {
    it("resolver off → everything visible", async () => {
      const { store } = makeStore();
      store.onTracked("s1", promptMsg("s1", "p1"));
      const { app } = await makeApp(store, { active: false });
      expect((await app.inject({ method: "GET", url: "/api/questions" })).json().data).toHaveLength(1);
    });

    it.each([
      ["owner", anna, true],
      ["other principal", bela, false],
      ["no principal", undefined, false],
    ])("resolver on, owned session, %s", async (_n, principal, visible) => {
      const { store } = makeStore();
      store.onTracked("s1", promptMsg("s1", "p1"));
      const id = idOf(store);
      const { app, send } = await makeApp(store, { active: true, owners: { s1: anna } });
      const headers = principal ? as(principal) : {};
      const list = await app.inject({ method: "GET", url: "/api/questions", headers });
      expect(list.json().data).toHaveLength(visible ? 1 : 0);
      expect((await app.inject({ method: "GET", url: `/api/questions/${id}`, headers })).statusCode).toBe(visible ? 200 : 404);
      const ans = await post(app, id, { answer: "Resume" }, headers);
      expect(ans.statusCode).toBe(visible ? 200 : 404);
      expect(send).toHaveBeenCalledTimes(visible ? 1 : 0);
    });

    it("resolver on, ownerless session is hidden from a human principal", async () => {
      const { store } = makeStore();
      store.onTracked("auto", promptMsg("auto", "p1"));
      const id = idOf(store);
      const { app } = await makeApp(store, { active: true, owners: {} });
      expect((await app.inject({ method: "GET", url: "/api/questions", headers: as(anna) })).json().data).toEqual([]);
      expect((await post(app, id, { answer: "Resume" }, as(anna))).statusCode).toBe(404);
    });

    it("a 404 for an invisible question leaves it open for its owner", async () => {
      const { store } = makeStore();
      store.onTracked("s1", promptMsg("s1", "p1"));
      const id = idOf(store);
      const { app, send } = await makeApp(store, { active: true, owners: { s1: anna } });
      await post(app, id, { answer: "Resume" }, as(bela));
      expect((await post(app, id, { answer: "Resume" }, as(anna))).statusCode).toBe(200);
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  // test-plan #E14 #X3 — See change: add-ask-user-inline-other
  describe("inline Other opt-in (test-plan #E14, #X3)", () => {
    it("opted-in select accepts a custom answer, transmitted unchanged; detail exposes allowOther", async () => {
      const { store } = makeStore();
      store.onTracked("s1", promptMsg("s1", "p1", { metadata: { allowOther: true } }));
      const id = idOf(store);
      const { app, send } = await makeApp(store);
      const detail = await app.inject({ method: "GET", url: `/api/questions/${id}` });
      expect(detail.json().data.allowOther).toBe(true);
      const res = await post(app, id, { answer: "C" });
      expect(res.statusCode).toBe(200);
      expect(send).toHaveBeenCalledWith("s1", expect.objectContaining({ promptId: "p1", answer: "C" }));
    });

    it("a prompt without the opt-in rejects the custom answer (400) and stays open", async () => {
      const { store } = makeStore();
      store.onTracked("s1", promptMsg("s1", "p1"));
      const id = idOf(store);
      const { app, send } = await makeApp(store);
      const detail = await app.inject({ method: "GET", url: `/api/questions/${id}` });
      expect(detail.json().data).not.toHaveProperty("allowOther");
      expect((await post(app, id, { answer: "C" })).statusCode).toBe(400);
      expect(send).not.toHaveBeenCalled();
      expect(store.listRows()).toHaveLength(1);
    });

    it("opted-in prompt with its own Other option rejects custom text", async () => {
      const { store } = makeStore();
      store.onTracked("s1", promptMsg("s1", "p1", { options: ["A", "Other (describe)"], metadata: { allowOther: true } }));
      const { app } = await makeApp(store);
      expect((await post(app, idOf(store), { answer: "C" })).statusCode).toBe(400);
    });

    it("opted-in batch sub-question accepts custom text; others do not", async () => {
      const { store } = makeStore();
      const questions = [
        { method: "select", title: "a", options: ["A", "B"], allowOther: true },
        { method: "select", title: "b", options: ["A", "B"] },
      ];
      store.onTracked("s1", promptMsg("s1", "p1", { type: "batch", options: undefined, metadata: { questions } }));
      const { app } = await makeApp(store);
      const id = idOf(store);
      expect((await post(app, id, { answer: JSON.stringify([{ value: "C" }, { value: "A" }]) })).statusCode).toBe(200);
      store.onTracked("s1", promptMsg("s1", "p2", { type: "batch", options: undefined, metadata: { questions } }));
      const id2 = idOf(store);
      expect((await post(app, id2, { answer: JSON.stringify([{ value: "A" }, { value: "C" }]) })).statusCode).toBe(400);
    });

    it("the persisted question file never carries allowOther", async () => {
      const { store } = makeStore();
      store.onTracked("s1", promptMsg("s1", "p1", { metadata: { allowOther: true } }));
      const dir = path.join(home, ".pi", "dashboard", "questions");
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) expect(fs.readFileSync(path.join(dir, f), "utf8")).not.toContain("allowOther");
    });
  });

  describe("answer validation (test-plan #E6)", () => {
    const batchSubs = [
      { method: "select", question: "a?", options: ["x", "y"] },
      { method: "confirm", question: "b?" },
    ];
    const table: Array<[string, Record<string, unknown>, unknown, number]> = [
      ["confirm true", { type: "confirm", options: undefined }, { answer: "true" }, 200],
      ["confirm false", { type: "confirm", options: undefined }, { answer: "false" }, 200],
      ["confirm junk", { type: "confirm", options: undefined }, { answer: "yes" }, 400],
      ["select option", { type: "select" }, { answer: "Resume" }, 200],
      ["select non-option", { type: "select" }, { answer: "Nope" }, 400],
      ["multiselect ok", { type: "multiselect" }, { answer: '["Resume"]' }, 200],
      ["multiselect empty", { type: "multiselect" }, { answer: "[]" }, 200],
      ["multiselect dup", { type: "multiselect" }, { answer: '["Resume","Resume"]' }, 400],
      ["multiselect non-json", { type: "multiselect" }, { answer: "Resume" }, 400],
      ["input any", { type: "input", options: undefined }, { answer: "hello" }, 200],
      ["input empty", { type: "input", options: undefined }, { answer: "" }, 200],
      ["editor any", { type: "editor", options: undefined }, { answer: "text\nmore" }, 200],
      ["batch ok", { type: "batch", options: undefined, metadata: { questions: batchSubs } }, { answer: JSON.stringify([{ value: "x" }, { confirmed: true }]) }, 200],
      ["batch wrong length", { type: "batch", options: undefined, metadata: { questions: batchSubs } }, { answer: JSON.stringify([{ value: "x" }]) }, 400],
      ["batch bad entry", { type: "batch", options: undefined, metadata: { questions: batchSubs } }, { answer: JSON.stringify([{ value: "z" }, { confirmed: true }]) }, 400],
      ["both answer + cancelled", { type: "select" }, { answer: "Resume", cancelled: true }, 400],
      ["neither", { type: "select" }, {}, 400],
      ["answer not a string", { type: "select" }, { answer: 3 }, 400],
      ["cancelled false", { type: "select" }, { cancelled: false }, 400],
      ["no body", { type: "select" }, undefined, 400],
    ];
    it.each(table)("%s → %i", async (_name, prompt, body, status) => {
      const { store } = makeStore();
      store.onTracked("s1", promptMsg("s1", "p1", prompt));
      const id = idOf(store);
      const { app, send } = await makeApp(store);
      const res = await post(app, id, body);
      expect(res.statusCode).toBe(status);
      if (status === 400) {
        expect(send).not.toHaveBeenCalled();
        expect(store.listRows()).toHaveLength(1); // still open
      } else {
        expect(res.json().data).toEqual({ transmitted: true });
        expect(send).toHaveBeenCalledTimes(1);
      }
    });

    it("transmits the same message shape the browser road sends; images are not expressible", async () => {
      const { store } = makeStore();
      store.onTracked("s1", promptMsg("s1", "p1", { type: "input", options: undefined }));
      const { app, send } = await makeApp(store);
      await post(app, idOf(store), { answer: "hi", images: [{ type: "image", data: "xx", mimeType: "image/png" }] });
      expect(send).toHaveBeenCalledWith("s1", { type: "prompt_response", sessionId: "s1", promptId: "p1", answer: "hi", source: "dashboard-default" });
    });

    it("cancel transmits a cancel (no answer) and hides the row", async () => {
      const { store } = makeStore();
      store.onTracked("s1", promptMsg("s1", "p1"));
      const { app, send } = await makeApp(store);
      const res = await post(app, idOf(store), { cancelled: true });
      expect(res.json().data).toEqual({ transmitted: true });
      expect(send).toHaveBeenCalledWith("s1", { type: "prompt_response", sessionId: "s1", promptId: "p1", cancelled: true, source: "dashboard-default" });
      expect(store.listRows()).toEqual([]);
    });
  });

  describe("409 window (test-plan #E8)", () => {
    it("answered → 409 naming `answered` up to 10 min, then 404; a restart forgets it", async () => {
      const { store } = makeStore();
      store.onTracked("s1", promptMsg("s1", "p1"));
      const id = idOf(store);
      const { app } = await makeApp(store);
      expect((await post(app, id, { answer: "Resume" })).statusCode).toBe(200);
      clock += TRANSMITTED_WINDOW_MS - 1000;
      const inside = await post(app, id, { answer: "Resume" });
      expect(inside.statusCode).toBe(409);
      expect(inside.json().error).toContain("answered");
      clock += 2000;
      expect((await post(app, id, { answer: "Resume" })).statusCode).toBe(404);

      // restart: a brand-new store has no memory of the id
      const fresh = makeStore().store;
      const { app: app2 } = await makeApp(fresh);
      expect((await post(app2, id, { answer: "Resume" })).statusCode).toBe(404);
    });
  });

  describe("file-access prompts (test-plan #E11)", () => {
    it.each(["agent-path-gate", "agent-path-gate-confirm"])("%s: listed with origin file, POST 403, still pending", async (kind) => {
      const { store } = makeStore();
      store.onTracked("s1", promptMsg("s1", "p1", { metadata: { kind } }));
      const id = idOf(store);
      const { app, send } = await makeApp(store);
      expect((await app.inject({ method: "GET", url: "/api/questions" })).json().data[0].origin).toBe("file");
      expect((await app.inject({ method: "GET", url: `/api/questions/${id}` })).json().data.answerable).toBe(false);
      expect((await post(app, id, { answer: "Resume" })).statusCode).toBe(403);
      expect((await post(app, id, { cancelled: true })).statusCode).toBe(403);
      expect(send).not.toHaveBeenCalled();
      expect(store.listRows()).toHaveLength(1);
      expect(store.claim(id).status).toBe("claimed"); // no claim was taken
    });
  });

  it("chat-gateway session prompts are answerable under the same rules (test-plan #E12)", async () => {
    const { store } = makeStore({ describe: () => ({ label: "discord", chatGateway: true }) });
    store.onTracked("s1", promptMsg("s1", "p1"));
    const id = idOf(store);
    expect(store.listRows()[0].origin).toBe("chat-gateway");
    const { app, send } = await makeApp(store);
    const res = await post(app, id, { answer: "Resume" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ transmitted: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("transmission failure releases the claim; retry succeeds (test-plan #X2)", async () => {
    const { store } = makeStore();
    store.onTracked("s1", promptMsg("s1", "p1"));
    const id = idOf(store);
    let connected = false;
    const { app, send } = await makeApp(store, { send: () => connected });
    const first = await post(app, id, { answer: "Resume" });
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toEqual({ transmitted: false });
    expect(store.listRows()).toHaveLength(1);
    connected = true;
    const retry = await post(app, id, { answer: "Resume" });
    expect(retry.json().data).toEqual({ transmitted: true });
    expect(send).toHaveBeenCalledTimes(2);
    expect(store.listRows()).toEqual([]);
  });

  it("a throwing transmit releases the claim too", async () => {
    const { store } = makeStore();
    store.onTracked("s1", promptMsg("s1", "p1"));
    const id = idOf(store);
    let boom = true;
    const { app } = await makeApp(store, { send: () => { if (boom) throw new Error("ws gone"); return true; } });
    expect((await post(app, id, { answer: "Resume" })).statusCode).toBe(500);
    boom = false;
    expect((await post(app, id, { answer: "Resume" })).json().data).toEqual({ transmitted: true });
  });

  it("double POST: second is 409 and exactly one transmit", async () => {
    const { store } = makeStore();
    store.onTracked("s1", promptMsg("s1", "p1"));
    const id = idOf(store);
    const { app, send } = await makeApp(store);
    const [a, b] = await Promise.all([post(app, id, { answer: "Resume" }), post(app, id, { answer: "Hand back" })]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("an answered question is a 404 (not 409) for a non-owner: no cross-owner oracle", async () => {
    const { store } = makeStore();
    store.onTracked("s1", promptMsg("s1", "p1"));
    const id = idOf(store);
    const { app } = await makeApp(store, { active: true, owners: { s1: anna } });
    expect((await post(app, id, { answer: "Resume" }, as(anna))).statusCode).toBe(200);
    expect((await post(app, id, { answer: "Resume" }, as(anna))).statusCode).toBe(409);
    expect((await post(app, id, { answer: "Resume" }, as(bela))).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/questions/${id}/summarize`, headers: as(bela) })).statusCode).toBe(404);
  });

  // See change: close-security-map-high-findings (test-plan #E50): removing the MCP
  // answer tools (D2) leaves every non-MCP answer road exactly as it was.
  describe("non-MCP answer roads unchanged (test-plan #E50)", () => {
    it("POST /api/questions/:id/answer delivers a non-file prompt exactly once", async () => {
      const { store } = makeStore();
      store.onTracked("s1", promptMsg("s1", "p1"));
      const id = idOf(store);
      const { app, send } = await makeApp(store);
      expect((await post(app, id, { answer: "Resume" })).statusCode).toBe(200);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith("s1", {
        type: "prompt_response",
        sessionId: "s1",
        promptId: "p1",
        answer: "Resume",
        source: "dashboard-default",
      });
      expect((await post(app, id, { answer: "Resume" })).statusCode).toBe(409);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("a file-kind question is still refused (403) and nothing is sent", async () => {
      const { store } = makeStore();
      store.onTracked("s1", promptMsg("s1", "p1", { metadata: { kind: "agent-path-gate" } }));
      const { app, send } = await makeApp(store);
      expect((await post(app, idOf(store), { answer: "Resume" })).statusCode).toBe(403);
      expect(send).not.toHaveBeenCalled();
    });

    it("the dashboard WS `prompt_response` stays control; the access-prompt road stays operate", () => {
      expect(WS_MESSAGE_TIERS.prompt_response).toBe("control");
      expect(ROUTE_TIERS.find((r) => r.method === "POST" && r.path === "/api/access/prompts/:promptId")?.tier).toBe("operate");
      expect(ROUTE_TIERS.find((r) => r.method === "POST" && r.path === "/api/questions/:id/answer")?.tier).toBe("control");
    });
  });

  describe("tier gate + unknown id (test-plan #X7)", () => {
    it("observe-tier token cannot answer; control can; unknown id is 404", async () => {
      const reg = new PairedDeviceRegistry(path.join(home, "paired.json"));
      const observe = reg.add("o", "manual", "observe").token;
      const control = reg.add("c", "manual", "control").token;
      const { store } = makeStore();
      store.onTracked("s1", promptMsg("s1", "p1"));
      const id = idOf(store);
      const { app, send } = await makeApp(store, { tierGate: { reg } });
      const remote = "203.0.113.5";
      const h = (t: string) => ({ authorization: `Bearer ${t}` });

      const refused = await app.inject({ method: "POST", url: `/api/questions/${id}/answer`, remoteAddress: remote, headers: h(observe), payload: { answer: "Resume" } });
      expect(refused.statusCode).toBe(403);
      expect(refused.headers["www-authenticate"]).toContain('scope="control"');
      expect(send).not.toHaveBeenCalled();
      expect(store.listRows()).toHaveLength(1);

      const readOk = await app.inject({ method: "GET", url: `/api/questions/${id}`, remoteAddress: remote, headers: h(observe) });
      expect(readOk.statusCode).toBe(200);
      const missing = await app.inject({ method: "GET", url: "/api/questions/unknown-id", remoteAddress: remote, headers: h(observe) });
      expect(missing.statusCode).toBe(404);

      const summarize = await app.inject({ method: "POST", url: `/api/questions/${id}/summarize`, remoteAddress: remote, headers: h(observe) });
      expect(summarize.statusCode).toBe(403);

      const accepted = await app.inject({ method: "POST", url: `/api/questions/${id}/answer`, remoteAddress: remote, headers: h(control), payload: { answer: "Resume" } });
      expect(accepted.statusCode).toBe(200);
    });
  });

  describe("summarize", () => {
    const sum = (app: FastifyInstance, id: string, headers: Record<string, string> = {}) =>
      app.inject({ method: "POST", url: `/api/questions/${id}/summarize`, headers });

    it("generates on demand and returns the updated detail", async () => {
      const { store, generate } = makeStore();
      store.onTracked("s1", promptMsg("s1", "p1"));
      const id = idOf(store);
      const { app } = await makeApp(store);
      const res = await sum(app, id);
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({ id, brief: "A generated brief.", briefLabel: "generated", briefStatus: "ready" });
      expect(generate).toHaveBeenCalled();
    });

    it("failure keeps the current brief and answers an error", async () => {
      const { store } = makeStore({ generate: async () => ({ ok: false, kind: "failed", reason: "timeout", latencyMs: 20000 }) as BriefOutcome });
      store.onTracked("s1", promptMsg("s1", "p1", { metadata: { message: "m".repeat(300) } }));
      const id = idOf(store);
      const { app } = await makeApp(store);
      const res = await sum(app, id);
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.json()).toMatchObject({ success: false });
      expect(res.json().error).toBeTruthy();
      expect(store.get(id)!.brief).toBe("m".repeat(300));
    });

    it("404 unknown / invisible; 409 answered", async () => {
      const { store } = makeStore();
      store.onTracked("s1", promptMsg("s1", "p1"));
      const id = idOf(store);
      const { app } = await makeApp(store, { active: true, owners: { s1: anna } });
      expect((await sum(app, "nope", as(anna))).statusCode).toBe(404);
      expect((await sum(app, id, as(bela))).statusCode).toBe(404);
      await post(app, id, { answer: "Resume" }, as(anna));
      expect((await sum(app, id, as(anna))).statusCode).toBe(409);
    });
  });
});
