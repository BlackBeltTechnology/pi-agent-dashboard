/**
 * Route tests for `POST /api/tunnel-reserved-name` — folded from test-plan.md
 * (add-zrok-custom-reserved-name): X4, X5, X6, plus tasks 3.2/3.4a/3.4b.
 *
 * The engine's outcomes are covered in `zrok-reserved-name.test.ts`. What this
 * file owns is the part the engine cannot see: that the route is GUARDED, that
 * release ORDERING is correct on every path, and that a stored name never
 * silently diverges from the URL a live tunnel is serving.
 *
 * Release ordering is the sharp one. `reserveName` deliberately never releases
 * anything; the route decides. Getting that order wrong destroys a URL the
 * operator may have shared, which is not recoverable.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reserveNameMock = vi.fn();
const releaseShareMock = vi.fn(() => true);
const deleteTunnelMock = vi.fn(async () => {});
const stopWatchdogMock = vi.fn();
const getTunnelStatusMock = vi.fn(() => ({ status: "inactive", serverOs: "darwin" }) as any);
const writeConfigPartialMock = vi.fn(() => ({ success: true }) as any);

/** Order-sensitive: every side effect appends here, so ordering is assertable. */
const calls: string[] = [];

vi.mock("../tunnel-providers/zrok.js", async (orig) => ({
  ...(await orig<any>()),
  reserveName: (...a: any[]) => {
    calls.push("reserveName");
    return reserveNameMock(...a);
  },
}));

vi.mock("../tunnel/tunnel.js", async (orig) => ({
  ...(await orig<any>()),
  releaseShare: (...a: any[]) => {
    calls.push("releaseShare");
    return releaseShareMock(...a);
  },
  deleteTunnel: (...a: any[]) => {
    calls.push("deleteTunnel");
    return deleteTunnelMock(...(a as []));
  },
  getTunnelStatus: (...a: any[]) => getTunnelStatusMock(...(a as [])),
  getTunnelUrl: () => null,
  createTunnel: async () => null,
  ensureReservedName: () => undefined,
  getProviderReadiness: async () => [],
  connectResolvedProviders: async () => ({ plan: { providers: [], errors: [], refuseConnect: false }, connected: [], failures: [] }),
  disconnectResolvedProviders: async () => {},
  setPrimaryProvider: () => {},
}));

vi.mock("../tunnel/tunnel-watchdog.js", async (orig) => ({
  ...(await orig<any>()),
  stopTunnelWatchdog: () => {
    calls.push("stopTunnelWatchdog");
    stopWatchdogMock();
  },
  startTunnelWatchdog: () => {},
  getTunnelWatchdogStatus: () => null,
}));

vi.mock("../config-api.js", async (orig) => ({
  ...(await orig<any>()),
  writeConfigPartial: (...a: any[]) => {
    calls.push("writeConfigPartial");
    return writeConfigPartialMock(...a);
  },
}));

const { registerSystemRoutes } = await import("../routes/system-routes.js");

/** Records whether the guard ran, and can refuse like the real one. */
let guardRefuses = false;
let guardRan = false;

function makeConfig(over: Record<string, unknown> = {}): any {
  return {
    port: 8000,
    tunnelReservedName: undefined,
    tunnelPersistent: false,
    tunnelConfig: { enabled: true, provider: "zrok", mode: "public", zrok: {} },
    ...over,
  };
}

async function makeApp(config: any): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerSystemRoutes(app, {
    sessionManager: { listActive: () => [] } as any,
    preferencesStore: {} as any,
    metaPersistence: {} as any,
    config,
    networkGuard: (async (_req: any, reply: any) => {
      guardRan = true;
      if (guardRefuses) return reply.code(403).send({ success: false, error: "refused" });
    }) as any,
  });
  await app.ready();
  return app;
}

beforeEach(() => {
  calls.length = 0;
  guardRefuses = false;
  guardRan = false;
  reserveNameMock.mockReset();
  releaseShareMock.mockReset().mockReturnValue(true);
  deleteTunnelMock.mockReset();
  stopWatchdogMock.mockReset();
  writeConfigPartialMock.mockReset().mockReturnValue({ success: true });
  getTunnelStatusMock.mockReset().mockReturnValue({ status: "inactive", serverOs: "darwin" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

// ── 3.2 — the four outcomes reach the client ─────────────────────────
describe("the typed outcome is returned verbatim", () => {
  it.each([
    ["ok", { status: "ok", name: "robson-home-mac" }],
    ["taken", { status: "taken", name: "popular", message: "on another zrok account", cause: "another-account" }],
    ["invalid", { status: "invalid", name: "-lead", message: "start with a letter" }],
    ["write-failed", { status: "write-failed", name: "n", message: "could not write" }],
  ])("surfaces a %s outcome", async (_label, outcome: any) => {
    reserveNameMock.mockReturnValue(outcome);
    app = await makeApp(makeConfig());
    const res = await app.inject({
      method: "POST",
      url: "/api/tunnel-reserved-name",
      payload: { name: outcome.name },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe(outcome.status);
    expect(body.data.name).toBe(outcome.name);
    // A rejection is an ANSWER, not a transport error — the reason must survive.
    if (outcome.status !== "ok") expect(body.data.message).toBe(outcome.message);
  });

  it("a failed reservation persists nothing and releases nothing", async () => {
    reserveNameMock.mockReturnValue({ status: "taken", name: "popular", message: "x", cause: "another-account" });
    app = await makeApp(makeConfig({ tunnelReservedName: "old-name", tunnelPersistent: true }));
    await app.inject({ method: "POST", url: "/api/tunnel-reserved-name", payload: { name: "popular" } });
    expect(calls).not.toContain("releaseShare");
    expect(calls).not.toContain("writeConfigPartial");
  });
});

// ── 3.4a / X4 — the guard ────────────────────────────────────────────
describe("X4: the endpoint is guarded", () => {
  it("runs the network guard before doing anything", async () => {
    reserveNameMock.mockReturnValue({ status: "ok", name: "n" });
    app = await makeApp(makeConfig());
    await app.inject({ method: "POST", url: "/api/tunnel-reserved-name", payload: { name: "n" } });
    expect(guardRan).toBe(true);
  });

  it("a refused request reserves, releases and persists NOTHING", async () => {
    guardRefuses = true;
    app = await makeApp(makeConfig({ tunnelReservedName: "old-name" }));
    const res = await app.inject({
      method: "POST",
      url: "/api/tunnel-reserved-name",
      payload: { name: "new-name" },
    });
    expect(res.statusCode).toBe(403);
    expect(calls).toEqual([]);
    expect(reserveNameMock).not.toHaveBeenCalled();
  });

  it("the readiness endpoint is guarded too — it discloses installed tooling", async () => {
    guardRefuses = true;
    app = await makeApp(makeConfig());
    expect((await app.inject({ method: "GET", url: "/api/tunnel-readiness" })).statusCode).toBe(403);
  });
});

// ── X1 / X2 — release ordering ───────────────────────────────────────
describe("release ordering (X1/X2)", () => {
  it("X1: a FAILED replace leaves the old reservation intact", async () => {
    reserveNameMock.mockReturnValue({ status: "taken", name: "new-name", message: "x", cause: "another-account" });
    const config = makeConfig({ tunnelReservedName: "old-name", tunnelPersistent: true });
    app = await makeApp(config);
    await app.inject({ method: "POST", url: "/api/tunnel-reserved-name", payload: { name: "new-name" } });
    expect(releaseShareMock).not.toHaveBeenCalled();
    expect(config.tunnelReservedName).toBe("old-name");
  });

  it("releases the old name only AFTER the new reservation succeeds", async () => {
    reserveNameMock.mockReturnValue({ status: "ok", name: "new-name" });
    app = await makeApp(makeConfig({ tunnelReservedName: "old-name", tunnelPersistent: true }));
    await app.inject({ method: "POST", url: "/api/tunnel-reserved-name", payload: { name: "new-name" } });
    expect(calls.indexOf("reserveName")).toBeLessThan(calls.indexOf("releaseShare"));
    expect(releaseShareMock).toHaveBeenCalledWith("old-name");
  });

  it("X2: tears the live share DOWN before `delete name` is issued", async () => {
    reserveNameMock.mockReturnValue({ status: "ok", name: "new-name" });
    getTunnelStatusMock.mockReturnValue({ status: "active", url: "https://old-name.shares.zrok.io", serverOs: "darwin" });
    app = await makeApp(makeConfig({ tunnelReservedName: "old-name", tunnelPersistent: true }));
    await app.inject({ method: "POST", url: "/api/tunnel-reserved-name", payload: { name: "new-name" } });
    // `delete name` must never run against a running share.
    expect(calls.indexOf("deleteTunnel")).toBeLessThan(calls.indexOf("releaseShare"));
    expect(calls.indexOf("stopTunnelWatchdog")).toBeLessThan(calls.indexOf("deleteTunnel"));
  });

  it("X2 (clear): the same ordering holds on the clear path", async () => {
    app = await makeApp(makeConfig({ tunnelReservedName: "old-name", tunnelPersistent: true }));
    await app.inject({ method: "POST", url: "/api/tunnel-reserved-name", payload: { name: null } });
    expect(calls.indexOf("deleteTunnel")).toBeLessThan(calls.indexOf("releaseShare"));
    expect(releaseShareMock).toHaveBeenCalledWith("old-name");
  });

  it("clearing persists reservedName undefined + persistent false", async () => {
    app = await makeApp(makeConfig({ tunnelReservedName: "old-name", tunnelPersistent: true }));
    await app.inject({ method: "POST", url: "/api/tunnel-reserved-name", payload: { name: null } });
    expect(writeConfigPartialMock).toHaveBeenCalledWith({
      tunnel: { zrok: { reservedName: undefined, persistent: false } },
    });
  });

  it("a failed release is reported, not swallowed — an orphan counts against the account limit", async () => {
    releaseShareMock.mockReturnValue(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    app = await makeApp(makeConfig({ tunnelReservedName: "old-name", tunnelPersistent: true }));
    await app.inject({ method: "POST", url: "/api/tunnel-reserved-name", payload: { name: null } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("old-name"));
  });
});

// ── 3.4b / X5 / X6 — set while a tunnel is live ──────────────────────
describe("X5/X6: setting a name while the tunnel is live", () => {
  it("X5: never stores a name the live tunnel does not serve WITHOUT saying so", async () => {
    reserveNameMock.mockReturnValue({ status: "ok", name: "new-name" });
    getTunnelStatusMock.mockReturnValue({ status: "active", url: "https://old-name.shares.zrok.io", serverOs: "darwin" });
    app = await makeApp(makeConfig({ tunnelReservedName: "old-name", tunnelPersistent: true }));
    const body = (
      await app.inject({ method: "POST", url: "/api/tunnel-reserved-name", payload: { name: "new-name" } })
    ).json();
    // The share was torn down to release the old name, so the honest signal is
    // "stopped", NOT "still serving the old URL".
    expect(body.data.tunnelStopped).toBe(true);
    expect(body.data.liveUrlUnchanged).toBeUndefined();
  });

  it("reports liveUrlUnchanged when the tunnel was live and NOT replaced", async () => {
    reserveNameMock.mockReturnValue({ status: "ok", name: "first-name" });
    getTunnelStatusMock.mockReturnValue({ status: "active", url: "https://ephemeral.shares.zrok.io", serverOs: "darwin" });
    app = await makeApp(makeConfig({ tunnelReservedName: undefined, tunnelPersistent: false }));
    const body = (
      await app.inject({ method: "POST", url: "/api/tunnel-reserved-name", payload: { name: "first-name" } })
    ).json();
    expect(body.data.liveUrlUnchanged).toBe("https://ephemeral.shares.zrok.io");
    expect(body.data.tunnelStopped).toBeUndefined();
  });

  it("X6: a `taken` result leaves the running tunnel completely undisturbed", async () => {
    reserveNameMock.mockReturnValue({ status: "taken", name: "popular", message: "x", cause: "another-account" });
    getTunnelStatusMock.mockReturnValue({ status: "active", url: "https://live.shares.zrok.io", serverOs: "darwin" });
    app = await makeApp(makeConfig({ tunnelReservedName: "old-name", tunnelPersistent: true }));
    await app.inject({ method: "POST", url: "/api/tunnel-reserved-name", payload: { name: "popular" } });
    expect(deleteTunnelMock).not.toHaveBeenCalled();
    expect(stopWatchdogMock).not.toHaveBeenCalled();
    expect(releaseShareMock).not.toHaveBeenCalled();
  });

  it("says nothing about a live URL when no tunnel is running", async () => {
    reserveNameMock.mockReturnValue({ status: "ok", name: "n" });
    app = await makeApp(makeConfig());
    const body = (await app.inject({ method: "POST", url: "/api/tunnel-reserved-name", payload: { name: "n" } })).json();
    expect(body.data.liveUrlUnchanged).toBeUndefined();
    expect(body.data.tunnelStopped).toBeUndefined();
  });
});

// ── 3.5 — the persistence toggle ─────────────────────────────────────
describe("3.5: setting a name turns persistence ON", () => {
  it("records persistent=true in the in-memory config after a successful set", async () => {
    reserveNameMock.mockReturnValue({ status: "ok", name: "robson-home-mac" });
    const config = makeConfig();
    app = await makeApp(config);
    await app.inject({ method: "POST", url: "/api/tunnel-reserved-name", payload: { name: "robson-home-mac" } });
    expect(config.tunnelPersistent).toBe(true);
    expect(config.tunnelReservedName).toBe("robson-home-mac");
  });

  it("a subsequent status read reports the stored name, so the next connect serves it", async () => {
    reserveNameMock.mockReturnValue({ status: "ok", name: "robson-home-mac" });
    const config = makeConfig();
    app = await makeApp(config);
    await app.inject({ method: "POST", url: "/api/tunnel-reserved-name", payload: { name: "robson-home-mac" } });
    getTunnelStatusMock.mockReturnValue({ status: "inactive", serverOs: "darwin" });
    await app.inject({ method: "GET", url: "/api/tunnel-status" });
    expect(getTunnelStatusMock).toHaveBeenLastCalledWith({
      reservedName: "robson-home-mac",
      persistent: true,
    });
  });
});
