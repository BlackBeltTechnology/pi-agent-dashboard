/**
 * The post-start route-registration invariant (S1r caveat): the universal network guard is bound to routes
 * at `preReady`, so a route registered AFTER `ready()` would be served without it. Fastify refuses such a
 * registration (`route.js` `throwIfAlreadyStarted('Cannot add route!')`), and that refusal IS the enforcement.
 * These tests boot the REAL server and fail if post-start registration ever stops being refused (for
 * instance after a fastify bump), or if a plugin hot-load stops degrading to "plugin failed, server fine".
 *
 * See change: harden-git-terminal-plugin-boundaries (test-plan #SX5, #SX6; spec: trusted-networks).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearDiscoveryCache,
  getPluginStatusStore,
  loadServerEntries,
  type ServerPluginContext,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type DashboardServer } from "../server.js";
import { installFakePlugin, pluginCtx, resetPluginHostHarness } from "./helpers/plugin-host-harness.js";

const HOST_ID = "poststart-host";
const UNTRUSTED_IP = "203.0.113.7"; // TEST-NET-3: not loopback, not in any trusted network
const TRUSTED_IP = "127.0.0.1"; // loopback peer
const LATE = "LATE";

let server: DashboardServer;
let app: FastifyInstance;

beforeAll(async () => {
  resetPluginHostHarness();
  installFakePlugin({ id: HOST_ID, priority: 50 });
  server = await createServer({
    port: 0,
    piPort: 0,
    host: "127.0.0.1",
    dev: true,
    autoShutdown: false,
    shutdownIdleSeconds: 999,
    tunnel: false,
  });
  await server.start();
  app = pluginCtx(HOST_ID).fastify as FastifyInstance;
}, 90_000);

afterAll(async () => {
  await server?.stop();
});

const get = (url: string, remoteAddress: string) => app.inject({ method: "GET", url, remoteAddress });

describe("S1r caveat — a route registered after ready() is refused in this server", () => {
  it("get and post both throw once the server has started", () => {
    expect(() => app.get("/api/poststart/regression", async () => LATE)).toThrow(/already|Cannot add route/i);
    expect(() => app.post("/api/poststart/regression", async () => LATE)).toThrow(/already|Cannot add route/i);
  });
});

describe("SX5 — late registration under every namespace is refused and never served", () => {
  const PATHS = ["/api/x", "/v1/x", "/editor/x", "/live/x", "/other"] as const;
  const GUARDED = new Set<string>(["/api/x", "/v1/x", "/editor/x", "/live/x"]);

  for (const p of PATHS) {
    it(`${p}: app.get and app.post throw; no response carries the handler marker`, async () => {
      expect(() => app.get(p, async () => LATE)).toThrow();
      expect(() => app.post(p, async () => LATE)).toThrow();

      for (const [label, ip] of [
        ["untrusted unauthenticated", UNTRUSTED_IP],
        ["trusted peer", TRUSTED_IP],
      ] as const) {
        for (const method of ["GET", "POST"] as const) {
          const res = await app.inject({ method, url: p, remoteAddress: ip });
          expect(res.body, `${method} ${p} as ${label}`).not.toContain(LATE);
        }
      }
      if (GUARDED.has(p)) {
        // The guard is still deny-by-default for a path that never got a route. `/v1/*` is first
        // answered by the model-proxy auth gate (401, it runs before the guard); every other
        // namespace reaches the guard's 403.
        const status = (await get(p, UNTRUSTED_IP)).statusCode;
        expect(p === "/v1/x" ? [401, 403] : [403]).toContain(status);
      }
    });
  }

  it("the server keeps serving after the refused registrations", async () => {
    expect((await get("/api/health", TRUSTED_IP)).statusCode).toBe(200);
  });
});

describe("SX6 — a plugin hot-load that registers a route after start fails that plugin only", () => {
  const FAILING_ID = "poststart-late-route";
  const PEER_ID = "poststart-late-peer";

  /** Write an installed-dir plugin AFTER boot (so discovery sees it only on the hot-load pass). */
  function writeLatePlugin(id: string, entry: string): void {
    const dir = path.join(os.homedir(), ".pi", "dashboard", "plugins", id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: id,
        "pi-dashboard-plugin": { id, displayName: id, priority: 50, claims: [], server: "./server.mjs" },
      }),
    );
    fs.writeFileSync(path.join(dir, "server.mjs"), entry);
  }

  it("is logged, the plugin is marked failed, nothing is served, no exception escapes, others load", async () => {
    const live: ServerPluginContext = pluginCtx(HOST_ID);
    writeLatePlugin(
      FAILING_ID,
      `export default function registerPlugin(ctx) {
  ctx.fastify.get("/api/plugins/${FAILING_ID}/x", async () => ${JSON.stringify(LATE)});
}
`,
    );
    writeLatePlugin(
      PEER_ID,
      `export default function registerPlugin(ctx) {
  (globalThis.__poststartPeer ??= []).push(ctx ? "registered" : "no-ctx");
}
`,
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    clearDiscoveryCache(); // the refresher does the same before it rediscovers
    // The loader's own additive hot-load pass, driven with the LIVE (already started) host instance.
    await expect(
      loadServerEntries({
        createContext: () => live,
        isEnabled: () => true,
        onlyIds: new Set([FAILING_ID, PEER_ID]),
      }),
    ).resolves.toBeUndefined();

    const store = getPluginStatusStore();
    expect(store.getStoredStatus(FAILING_ID)).toMatchObject({ loaded: false });
    expect(store.getStoredStatus(FAILING_ID)?.error).toMatch(/already|Cannot add route/i);
    expect(store.getStoredStatus(PEER_ID)).toMatchObject({ loaded: true });
    expect(store.getStoredStatus(HOST_ID)).toMatchObject({ loaded: true });
    const logged = [...error.mock.calls, ...warn.mock.calls].map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).toContain(FAILING_ID);
    error.mockRestore();
    warn.mockRestore();

    for (const ip of [UNTRUSTED_IP, TRUSTED_IP]) {
      const res = await get(`/api/plugins/${FAILING_ID}/x`, ip);
      expect(res.body).not.toContain(LATE);
    }
    expect((await get("/api/health", TRUSTED_IP)).statusCode).toBe(200);
    expect((globalThis as { __poststartPeer?: string[] }).__poststartPeer).toEqual(["registered"]);
  });
});
