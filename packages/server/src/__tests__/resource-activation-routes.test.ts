/**
 * Tests for resource-activation REST routes (toggle + reload).
 * The pi-delegating write is unit-tested in resource-activation-toggle.test.ts;
 * here we mock it and focus on affectedSessions, reload scoping, and auth.
 *
 * See change: folder-resource-activation-toggle.
 */

import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the pi-delegating write so route tests stay fast + deterministic.
const applyResourceToggleMock = vi.fn();
vi.mock("../pi/resource-activation-toggle.js", async () => {
  const actual = await vi.importActual<any>("../pi/resource-activation-toggle.js");
  return {
    ...actual,
    applyResourceToggle: (...args: any[]) => applyResourceToggleMock(...args),
  };
});

import { registerResourceActivationRoutes } from "../routes/resource-activation-routes.js";

function makeSessions(map: Record<string, { cwd: string; status?: string }>) {
  return {
    get: (sid: string) => (map[sid] ? { cwd: map[sid].cwd, status: map[sid].status ?? "idle" } : undefined),
  } as any;
}

function makeGateway(sessions: Record<string, { cwd: string; status?: string }>) {
  const ids = Object.keys(sessions);
  const sent: Array<{ sid: string; text: string }> = [];
  const gw = {
    getConnectedSessionIds: () => ids,
    findSessionsByCwd: (cwd: string) =>
      ids.filter((sid) => {
        const c = sessions[sid].cwd;
        return c === cwd || c.startsWith(`${cwd}/`) || cwd.startsWith(`${c}/`);
      }),
    sendToSession: (sid: string, msg: any) => {
      sent.push({ sid, text: msg.text });
      return true;
    },
  } as any;
  return { gw, sent };
}

const passGuard = async () => {};

describe("resource-activation-routes", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    applyResourceToggleMock.mockResolvedValue({ ok: true });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("toggle returns affectedSessions scoped to the folder (local)", async () => {
    const { gw } = makeGateway({
      a: { cwd: "/proj/x" },
      b: { cwd: "/proj/x/sub" },
      c: { cwd: "/other" },
    });
    app = Fastify();
    registerResourceActivationRoutes(app, {
      networkGuard: passGuard,
      piGateway: gw,
      sessionManager: makeSessions({ a: { cwd: "/proj/x" }, b: { cwd: "/proj/x/sub" }, c: { cwd: "/other" } }),
    });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/resources/toggle",
      payload: { scope: "local", cwd: "/proj/x", type: "extension", filePath: "/proj/x/.pi/e.ts", enabled: false },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.affectedSessions.sort()).toEqual(["a", "b"]);
  });

  it("toggle propagates the write error status (404)", async () => {
    applyResourceToggleMock.mockResolvedValue({ ok: false, status: 404, error: "not found" });
    const { gw } = makeGateway({});
    app = Fastify();
    registerResourceActivationRoutes(app, { networkGuard: passGuard, piGateway: gw, sessionManager: makeSessions({}) });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/resources/toggle",
      payload: { scope: "global", type: "skill", filePath: "/x", enabled: false },
    });
    expect(res.statusCode).toBe(404);
  });

  it("toggle is rejected when the network guard denies (unauthenticated)", async () => {
    const denyGuard = async (_req: any, reply: any) => {
      reply.code(401).send({ success: false, error: "unauthorized" });
    };
    const { gw } = makeGateway({});
    app = Fastify();
    registerResourceActivationRoutes(app, { networkGuard: denyGuard, piGateway: gw, sessionManager: makeSessions({}) });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/resources/toggle",
      payload: { scope: "global", type: "skill", filePath: "/x", enabled: false },
    });
    expect(res.statusCode).toBe(401);
    expect(applyResourceToggleMock).not.toHaveBeenCalled();
  });

  it("reload local targets only the folder's sessions", async () => {
    const sessions = { a: { cwd: "/proj/x" }, b: { cwd: "/proj/x/sub" }, c: { cwd: "/other" } };
    const { gw, sent } = makeGateway(sessions);
    app = Fastify();
    registerResourceActivationRoutes(app, { networkGuard: passGuard, piGateway: gw, sessionManager: makeSessions(sessions) });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/resources/reload",
      payload: { scope: "local", cwd: "/proj/x" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.reloaded).toBe(2);
    expect(sent.map((s) => s.sid).sort()).toEqual(["a", "b"]);
    expect(sent.every((s) => s.text === "/reload")).toBe(true);
  });

  it("reload global targets all connected sessions", async () => {
    const sessions = { a: { cwd: "/proj/x" }, b: { cwd: "/other" } };
    const { gw, sent } = makeGateway(sessions);
    app = Fastify();
    registerResourceActivationRoutes(app, { networkGuard: passGuard, piGateway: gw, sessionManager: makeSessions(sessions) });
    await app.ready();

    const res = await app.inject({ method: "POST", url: "/api/resources/reload", payload: { scope: "global" } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.reloaded).toBe(2);
    expect(sent.map((s) => s.sid).sort()).toEqual(["a", "b"]);
  });
});
