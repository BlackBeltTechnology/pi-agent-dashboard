/**
 * Host HTTP spawn stamps the request principal (session-ownership-scoping:
 * "Ownership is assigned only through trusted roads"; D11). The owner is filed
 * against a pre-minted spawn token BEFORE the spawn await, exactly like the
 * browser `spawn_session` road. Inert plane / principal-less ⇒ ownerless.
 */
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPendingPrincipalOwnerRegistry } from "../pending/pending-principal-owner-registry.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { registerSessionApi } from "../session/session-api.js";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("../spawn-process/process-manager.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  spawnPiSession: spawn,
}));
vi.mock("../spawn-process/spawn-register-watchdog.js", () => ({ armSpawnWatchdog: vi.fn() }));

const anna = { iss: "https://kc/realms/app", sub: "anna" };

async function build(opts: { active: boolean; principal?: typeof anna }) {
  const registry = createPendingPrincipalOwnerRegistry();
  const app = Fastify();
  app.addHook("onRequest", async (req) => {
    if (opts.principal) (req as { principal?: unknown }).principal = opts.principal;
  });
  registerSessionApi(app, {
    sessionManager: createMemorySessionManager(),
    piGateway: {} as never,
    browserGateway: { headlessPidRegistry: { register: vi.fn() } } as never,
    isResolverActive: () => opts.active,
    pendingPrincipalOwnerRegistry: registry,
  });
  return { app, registry };
}

describe("POST /api/session/spawn owner stamping", () => {
  beforeEach(() => {
    spawn.mockReset();
  });

  it("enforced + principal ⇒ owner filed against the token passed to the spawn", async () => {
    const { app, registry } = await build({ active: true, principal: anna });
    spawn.mockImplementation(async (_cwd: string, o: { spawnToken?: string }) => {
      // Filed BEFORE the spawn resolves (correlation timing, D11).
      expect(o.spawnToken && registry.resolve(o.spawnToken)).toEqual(anna);
      return { success: true, message: "ok", spawnToken: o.spawnToken };
    });
    const res = await app.inject({ method: "POST", url: "/api/session/spawn", payload: { cwd: "/w" } });
    expect(res.statusCode).toBe(200);
    expect(spawn).toHaveBeenCalledWith("/w", expect.objectContaining({ spawnToken: expect.any(String) }));
  });

  it("failed spawn ⇒ the filed owner is withdrawn", async () => {
    const { app, registry } = await build({ active: true, principal: anna });
    let token = "";
    spawn.mockImplementation(async (_cwd: string, o: { spawnToken?: string }) => {
      token = o.spawnToken ?? "";
      return { success: false, message: "nope" };
    });
    await app.inject({ method: "POST", url: "/api/session/spawn", payload: { cwd: "/w" } });
    expect(registry.resolve(token)).toBeNull();
  });

  it("inert plane ⇒ ownerless (no token minted for ownership)", async () => {
    const { app, registry } = await build({ active: false, principal: anna });
    spawn.mockResolvedValue({ success: true, message: "ok" });
    await app.inject({ method: "POST", url: "/api/session/spawn", payload: { cwd: "/w" } });
    expect(spawn.mock.calls[0][1]).not.toHaveProperty("spawnToken");
    expect(registry.size()).toBe(0);
  });

  it("principal-less (e.g. local-token process caller) ⇒ ownerless", async () => {
    const { app, registry } = await build({ active: true });
    spawn.mockResolvedValue({ success: true, message: "ok" });
    await app.inject({ method: "POST", url: "/api/session/spawn", payload: { cwd: "/w" } });
    expect(spawn.mock.calls[0][1]).not.toHaveProperty("spawnToken");
    expect(registry.size()).toBe(0);
  });
});
