/**
 * D23 break-glass, local-token part (task 18.23): while identity is enforced a
 * request presenting the host-only local token (CLI / bridge, file 0600) and NO
 * signed-in principal acts as the LOCAL OPERATOR and sees every session —
 * owned or ownerless. Before this, it passed the signed-out floor and then got
 * an EMPTY list (multi-user run, 2026-09-24).
 */
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerSessionRoutes } from "../../routes/session-routes.js";
import { createMemorySessionManager } from "../../session/memory-session-manager.js";
import { canAccessSession, LOCAL_OPERATOR, markLocalOperator } from "../session-access.js";

const anna = { iss: "https://kc/realms/app", sub: "anna" };

describe("LOCAL_OPERATOR access rule", () => {
  it("sees owned AND ownerless sessions while enforced", () => {
    expect(canAccessSession({ active: true, principal: LOCAL_OPERATOR, owner: anna })).toBe(true);
    expect(canAccessSession({ active: true, principal: LOCAL_OPERATOR, owner: undefined })).toBe(true);
  });

  it("is matched by reference only — a look-alike principal is an ordinary non-owner", () => {
    const forged = { ...LOCAL_OPERATOR };
    expect(canAccessSession({ active: true, principal: forged, owner: anna })).toBe(false);
    expect(canAccessSession({ active: true, principal: forged, owner: undefined })).toBe(false);
  });

  it("LOCAL_OPERATOR is frozen", () => {
    expect(Object.isFrozen(LOCAL_OPERATOR)).toBe(true);
  });
});

describe("GET /api/sessions for a local-operator request", () => {
  async function app() {
    const sessionManager = createMemorySessionManager();
    sessionManager.register({ id: "a1", cwd: "/pa", source: "dashboard" } as never);
    sessionManager.update("a1", { principalOwner: anna });
    sessionManager.register({ id: "orphan", cwd: "/pt", source: "tui" } as never);
    const f = Fastify();
    // Stand-in for server.ts: the floor hook marks a verified local-token request.
    f.addHook("onRequest", async (req) => {
      if (req.headers["x-test-local-operator"] === "1") markLocalOperator(req);
    });
    registerSessionRoutes(f, {
      sessionManager,
      eventStore: {} as never,
      networkGuard: async () => {},
      isResolverActive: () => true,
    } as never);
    await f.ready();
    return f;
  }
  const ids = (res: { payload: string }) => (JSON.parse(res.payload).data as { id: string }[]).map((s) => s.id).sort();

  it("an unmarked principal-less request sees nothing", async () => {
    const f = await app();
    expect(ids(await f.inject({ method: "GET", url: "/api/sessions" }))).toEqual([]);
  });

  it("a marked local-operator request sees every session", async () => {
    const f = await app();
    const res = await f.inject({ method: "GET", url: "/api/sessions", headers: { "x-test-local-operator": "1" } });
    expect(ids(res)).toEqual(["a1", "orphan"]);
  });
});
