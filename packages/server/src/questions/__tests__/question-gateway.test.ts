/**
 * Registry ↔ question store wiring in the real browser gateway:
 * every removal path removes the record, deletes the file and broadcasts in the
 * same tick (test-plan #E13); transmit hides the row while the registry entry
 * stays (#E24); per-recipient frames on connect + owner filter (#E9 broadcast).
 * See change: add-pending-question-stack.
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserGateway } from "../../pairing/browser-gateway.js";
import { createMemoryEventStore } from "../../persistence/memory-event-store.js";
import type { PiGateway } from "../../pi/pi-gateway.js";
import { createMemorySessionManager } from "../../session/memory-session-manager.js";
import Fastify from "fastify";
import { registerQuestionRoutes } from "../question-routes.js";
import { createQuestionStack } from "../question-stack.js";

const anna = { iss: "kc", sub: "anna" };
const bela = { iss: "kc", sub: "bela" };

function fakeWs(principal?: { iss: string; sub: string }) {
  const ws = new EventEmitter() as EventEmitter & Record<string, unknown> & { send: ReturnType<typeof vi.fn> };
  ws.send = vi.fn();
  ws.close = vi.fn();
  ws.ping = vi.fn();
  ws.terminate = vi.fn();
  ws.readyState = 1;
  ws.OPEN = 1;
  ws.bufferedAmount = 0;
  if (principal) ws.principal = principal;
  return ws;
}
const frames = (ws: { send: ReturnType<typeof vi.fn> }) => ws.send.mock.calls.map((c) => JSON.parse(String(c[0])));
const qframes = (ws: { send: ReturnType<typeof vi.fn> }) => frames(ws).filter((m) => m.type === "questions_update");

function prompt(sessionId: string, promptId: string, over: Record<string, unknown> = {}) {
  return { type: "prompt_request", sessionId, promptId, prompt: { question: `q ${promptId}`, type: "select", options: ["a", "b"] }, component: { type: "x", props: {} }, placement: "inline", ...over };
}

describe("gateway ↔ question store", () => {
  let home: string;
  let origHome: string | undefined;
  beforeEach(() => {
    origHome = process.env.HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "qgw-"));
    process.env.HOME = home;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });
  const filesOnDisk = () => {
    const dir = path.join(home, ".pi", "dashboard", "questions");
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".json")) : [];
  };

  function setup(active = false) {
    const piGateway = {
      start: vi.fn(), stop: vi.fn(), sendToSession: vi.fn(() => true),
      getConnectedSessionIds: vi.fn(() => []), hasSession: vi.fn(() => false), onEvent: vi.fn(),
    } as unknown as PiGateway;
    const sessionManager = createMemorySessionManager();
    sessionManager.register({ id: "s1", cwd: "/p1", source: "dashboard" } as never);
    sessionManager.register({ id: "s2", cwd: "/p2", source: "dashboard" } as never);
    sessionManager.update("s1", { principalOwner: anna });
    sessionManager.update("s2", { principalOwner: bela });
    const eventStore = createMemoryEventStore(() => false);
    // autoBrief off: no generation noise; the registry wiring is under test.
    const { store } = createQuestionStack({ eventStore, sessionManager, getConfig: () => ({ autoBrief: false, minBriefChars: 240 }) });
    // Positional ctor: 21 unused optional deps, then isResolverActive, ping interval, questionStore.
    const create = createBrowserGateway as (...a: unknown[]) => ReturnType<typeof createBrowserGateway>;
    const gateway = create(sessionManager, eventStore, piGateway, ...new Array(21).fill(undefined), () => active, undefined, store);
    const wa = fakeWs(anna);
    const wb = fakeWs(bela);
    gateway.wss.emit("connection", wa, {});
    gateway.wss.emit("connection", wb, {});
    return { gateway, store, sessionManager, wa, wb, piGateway };
  }

  it("a new browser socket receives the current rows on connect (even when empty)", () => {
    const { gateway, wa } = setup();
    expect(qframes(wa)).toEqual([{ type: "questions_update", questions: [] }]);
    gateway.trackPromptRequest("s1", prompt("s1", "p1") as never);
    const late = fakeWs(anna);
    gateway.wss.emit("connection", late, {});
    expect(qframes(late)[0].questions).toHaveLength(1);
  });

  describe("every removal path removes record + file and broadcasts in the same tick (test-plan #E13)", () => {
    const paths: Array<[string, (g: ReturnType<typeof setup>["gateway"]) => void]> = [
      ["clearPromptRequest (prompt_dismiss / prompt_cancel / timeout)", (g) => g.clearPromptRequest("s1", "p1")],
      ["reconcilePromptRequests (id missing on replay)", (g) => g.reconcilePromptRequests("s1", [])],
      ["clearPendingRequestsForSession (session death)", (g) => g.clearPendingRequestsForSession("s1")],
    ];
    it.each(paths)("%s", (_name, act) => {
      vi.useFakeTimers();
      try {
        const { gateway, wa } = setup();
        gateway.trackPromptRequest("s1", prompt("s1", "p1") as never);
        vi.advanceTimersByTime(300); // the add frame has been delivered
        expect(qframes(wa).at(-1)!.questions).toHaveLength(1);
        expect(filesOnDisk()).toHaveLength(1);
        wa.send.mockClear();
        act(gateway);
        // no timer advance: the removal frame is already out
        expect(qframes(wa)).toEqual([{ type: "questions_update", questions: [] }]);
        expect(filesOnDisk()).toEqual([]);
        expect(gateway.hasPendingPromptRequests("s1")).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("reconcile keeps a re-sent prompt and drops the rest", () => {
      vi.useFakeTimers();
      try {
        const { gateway, wa } = setup();
        gateway.trackPromptRequest("s1", prompt("s1", "keep") as never);
        gateway.trackPromptRequest("s1", prompt("s1", "drop") as never);
        vi.advanceTimersByTime(300);
        wa.send.mockClear();
        gateway.reconcilePromptRequests("s1", ["keep"]);
        const last = qframes(wa).at(-1)!;
        expect(last.questions).toHaveLength(1);
        expect(filesOnDisk()).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("transmit hides the row at once while the registry entry stays until the echo (test-plan #E24)", () => {
    vi.useFakeTimers();
    try {
      const { gateway, store, wa } = setup();
      gateway.trackPromptRequest("s1", prompt("s1", "p1") as never);
      vi.advanceTimersByTime(300);
      const id = store.listRows()[0].id;
      wa.send.mockClear();
      expect(store.claim(id).status).toBe("claimed");
      store.markTransmitted(id);
      expect(qframes(wa).at(-1)).toEqual({ type: "questions_update", questions: [] });
      expect(gateway.hasPendingPromptRequests("s1")).toBe(true);
      gateway.clearPromptRequest("s1", "p1"); // prompt_dismiss echo
      expect(gateway.hasPendingPromptRequests("s1")).toBe(false);
      expect(store.lookup(id).state).toBe("answered"); // 409 window outlives the echo
    } finally {
      vi.useRealTimers();
    }
  });

  describe("browser prompt_response shares the REST answer claim (test-plan #X3)", () => {
    const respond = (ws: ReturnType<typeof fakeWs>, promptId: string, over: Record<string, unknown> = {}) =>
      ws.emit("message", JSON.stringify({ type: "prompt_response", sessionId: "s1", promptId, answer: "a", source: "dashboard-default", ...over }));
    const sent = (piGateway: PiGateway) => (piGateway.sendToSession as ReturnType<typeof vi.fn>).mock.calls.filter((c) => (c[1] as { type: string }).type === "prompt_response");

    async function withRest(ctx: ReturnType<typeof setup>) {
      const app = Fastify();
      registerQuestionRoutes(app, {
        networkGuard: async () => {},
        store: ctx.store,
        sendToSession: (sid, msg) => ctx.piGateway.sendToSession(sid, msg as never),
        isResolverActive: () => false,
        ownerOf: () => undefined,
      });
      await app.ready();
      return app;
    }

    it("browser answer first: forwarded once, row hidden, REST loser is 409 `answered`", async () => {
      const ctx = setup();
      ctx.gateway.trackPromptRequest("s1", prompt("s1", "p1") as never);
      const id = ctx.store.listRows()[0].id;
      const app = await withRest(ctx);
      respond(ctx.wa, "p1");
      const rest = await app.inject({ method: "POST", url: `/api/questions/${id}/answer`, payload: { answer: "a" } });
      expect(rest.statusCode).toBe(409);
      expect(rest.json().error).toContain("answered");
      expect(sent(ctx.piGateway)).toHaveLength(1);
      expect(ctx.store.listRows()).toEqual([]);
      expect(ctx.gateway.hasPendingPromptRequests("s1")).toBe(true); // until the echo
      await app.close();
    });

    it("REST answer first: a following browser answer is dropped (exactly one transmit)", async () => {
      const ctx = setup();
      ctx.gateway.trackPromptRequest("s1", prompt("s1", "p1") as never);
      const id = ctx.store.listRows()[0].id;
      const app = await withRest(ctx);
      const rest = await app.inject({ method: "POST", url: `/api/questions/${id}/answer`, payload: { answer: "b" } });
      expect(rest.json().data).toEqual({ transmitted: true });
      respond(ctx.wa, "p1", { answer: "a" });
      expect(sent(ctx.piGateway)).toHaveLength(1);
      expect(sent(ctx.piGateway)[0][1]).toMatchObject({ answer: "b" });
      await app.close();
    });

    it("browser cancel is claimed like an answer", async () => {
      const ctx = setup();
      ctx.gateway.trackPromptRequest("s1", prompt("s1", "p1") as never);
      respond(ctx.wa, "p1", { answer: undefined, cancelled: true });
      respond(ctx.wa, "p1");
      expect(sent(ctx.piGateway)).toHaveLength(1);
    });

    it("failed browser transmit releases the claim so a retry goes through", () => {
      const ctx = setup();
      ctx.gateway.trackPromptRequest("s1", prompt("s1", "p1") as never);
      (ctx.piGateway.sendToSession as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
      respond(ctx.wa, "p1");
      expect(ctx.store.listRows()).toHaveLength(1);
      respond(ctx.wa, "p1");
      expect(sent(ctx.piGateway)).toHaveLength(2);
      expect(ctx.store.listRows()).toEqual([]);
    });

    it("an untracked prompt proceeds untouched", () => {
      const ctx = setup();
      respond(ctx.wa, "never-tracked");
      expect(sent(ctx.piGateway)).toHaveLength(1);
    });

    it("file-access prompts are never claimed: browser answers repeat freely and stay listed", () => {
      const ctx = setup();
      ctx.gateway.trackPromptRequest("s1", prompt("s1", "p1", { prompt: { question: "Allow?", type: "confirm", metadata: { kind: "agent-path-gate" } } }) as never);
      respond(ctx.wa, "p1", { answer: "true" });
      respond(ctx.wa, "p1", { answer: "true" });
      expect(sent(ctx.piGateway)).toHaveLength(2);
      expect(ctx.store.listRows()).toHaveLength(1);
    });
  });

  it("re-sending the same prompt keeps the same id and does not duplicate", () => {
    const { gateway, store } = setup();
    gateway.trackPromptRequest("s1", prompt("s1", "p1") as never);
    const id = store.listRows()[0].id;
    gateway.trackPromptRequest("s1", prompt("s1", "p1") as never);
    expect(store.listRows()).toHaveLength(1);
    expect(store.listRows()[0].id).toBe(id);
    expect(gateway.hasPendingPromptRequests("s1")).toBe(true);
  });

  it("resolver active: each socket gets only its own sessions' questions (test-plan #E9)", () => {
    vi.useFakeTimers();
    try {
      const { gateway, wa, wb } = setup(true);
      gateway.trackPromptRequest("s1", prompt("s1", "p1") as never);
      gateway.trackPromptRequest("s2", prompt("s2", "p2") as never);
      vi.advanceTimersByTime(300);
      expect(qframes(wa).at(-1)!.questions.map((q: { sessionId: string }) => q.sessionId)).toEqual(["s1"]);
      expect(qframes(wb).at(-1)!.questions.map((q: { sessionId: string }) => q.sessionId)).toEqual(["s2"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("without a question store the gateway behaves exactly as before", () => {
    const piGateway = { start: vi.fn(), stop: vi.fn(), sendToSession: vi.fn(() => true), getConnectedSessionIds: vi.fn(() => []), hasSession: vi.fn(() => false), onEvent: vi.fn() } as unknown as PiGateway;
    const sm = createMemorySessionManager();
    const gateway = createBrowserGateway(sm, createMemoryEventStore(() => false), piGateway);
    const ws = fakeWs();
    gateway.wss.emit("connection", ws, {});
    gateway.trackPromptRequest("s1", prompt("s1", "p1") as never);
    gateway.clearPromptRequest("s1", "p1");
    expect(qframes(ws)).toEqual([]);
    expect(gateway.getQuestionStats()).toBeUndefined();
  });
});
