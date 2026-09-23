/**
 * `/api/health` access-grant counters (change: add-access-grant-dialog, task 9.3;
 * test-plan #E23 diagnosability).
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AccessGrantHealth, snapshotAccessGrantHealth } from "../access/access-health.js";
import { AccessPlaneRegistry } from "../access/access-plane.js";
import { GrantCoordinator } from "../access/grant-coordinator.js";
import { createFilesystemPlane } from "../access/planes.js";
import { registerSystemRoutes } from "../routes/system-routes.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function makeApp(readAccessGrants?: () => AccessGrantHealth): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  apps.push(app);
  registerSystemRoutes(app, {
    sessionManager: { listActive: () => [], listAll: () => [] },
    preferencesStore: { flush: () => {} },
    metaPersistence: { flushAll: () => {} },
    config: { port: 8000, piPort: 9999, dev: false },
    networkGuard: async () => {},
    version: "test",
    clientDir: null,
    readAccessGrants,
  } as never);
  await app.ready();
  return app;
}

async function health(app: FastifyInstance): Promise<Record<string, unknown>> {
  const res = await app.inject({ method: "GET", url: "/api/health" });
  expect(res.statusCode).toBe(200);
  return res.json();
}

function coordinator() {
  const planes = new AccessPlaneRegistry();
  planes.register(createFilesystemPlane());
  return new GrantCoordinator({
    planes,
    broadcast: () => {},
    hostGateMode: () => "enforce",
    promptEnabled: () => true,
    killSwitch: () => false,
    operatorChannels: () => 1,
    onTransition: () => {},
  });
}

const yoloIdle = { status: () => null, counters: () => ({ autoAllowed: 0, refusedByPriorRefusal: 0 }) };

describe("9.3 access-grant counters", () => {
  it("counts every transition, by reason, so per-channel starvation is told apart from the global cap", () => {
    const c = coordinator();
    const d = (subject: string, channel: string) =>
      c.onDenial({ plane: "filesystem", rawSubject: subject, origin: "s", channel, requestHoldsCapability: true }, false);
    d("/a1", "A"); // prompted
    d("/a2", "A"); // flooded: channel-concurrent
    d("/b1", "B"); // prompted (second global slot)
    d("/c1", "C"); // flooded: concurrent-cap
    const snap = snapshotAccessGrantHealth({
      coordinator: c,
      yolo: yoloIdle,
      refusalCount: () => 3,
      promptEnabled: () => true,
      killSwitch: () => false,
      hostGateMode: () => "enforce",
      operatorChannels: () => 2,
    });
    expect(snap.registry).toMatchObject({ recorded: 4, prompted: 2, pending: 4 });
    expect(snap.registry.flooded).toEqual({ "channel-concurrent": 1, "concurrent-cap": 1 });
    expect(snap.prompting).toEqual({ enabled: true, killSwitch: false, hostGateMode: "enforce", operatorChannels: 2 });
    expect(snap.refusals).toBe(3);
  });

  it("reports YOLO state and cumulative auto-answers", () => {
    const snap = snapshotAccessGrantHealth({
      coordinator: coordinator(),
      yolo: {
        status: () => ({ source: "env", activatedAt: 0, expiresAt: null, unscoped: false, roots: [{ path: "/r", addedAt: 0 }] }),
        counters: () => ({ autoAllowed: 250, refusedByPriorRefusal: 4 }),
      },
      refusalCount: () => 0,
      promptEnabled: () => false,
      killSwitch: () => true,
      hostGateMode: () => "report",
      operatorChannels: () => 0,
    });
    // 250 is past the bounded history's 200: the counter must not cap.
    expect(snap.yolo).toEqual({
      active: true,
      source: "env",
      unscoped: false,
      roots: 1,
      expiresAt: null,
      autoAllowed: 250,
      refusedByPriorRefusal: 4,
    });
  });

  it("appears in /api/health", async () => {
    const snap = snapshotAccessGrantHealth({
      coordinator: coordinator(),
      yolo: yoloIdle,
      refusalCount: () => 0,
      promptEnabled: () => false,
      killSwitch: () => false,
      hostGateMode: () => "report",
      operatorChannels: () => 0,
    });
    const body = await health(await makeApp(() => snap));
    expect(body.accessGrants).toEqual(JSON.parse(JSON.stringify(snap)));
  });

  it("is null when unwired, and a throwing read never breaks /api/health", async () => {
    expect((await health(await makeApp())).accessGrants).toBeNull();
    const throwing = vi.fn(() => {
      throw new Error("boom");
    });
    const body = await health(await makeApp(throwing));
    expect(body.accessGrants).toBeNull();
    expect(body.ok).toBe(true);
  });

  it("hides accessGrants from a remote or tunnel-forwarded caller (unguarded endpoint)", async () => {
    const app = await makeApp(() => ({ sentinel: true }) as unknown as AccessGrantHealth);
    const remote = await app.inject({ method: "GET", url: "/api/health", remoteAddress: "203.0.113.9" });
    expect(remote.json().accessGrants).toBeNull();
    const tunnel = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { "x-forwarded-for": "198.51.100.4" },
    });
    expect(tunnel.json().accessGrants).toBeNull();
    const local = await health(app);
    expect(local.accessGrants).not.toBeNull();
  });
});
