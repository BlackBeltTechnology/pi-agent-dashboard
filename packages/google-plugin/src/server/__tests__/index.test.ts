/**
 * Plugin entry wiring (task 1.1, 3.3, 3.7): credential seam, hub-local lanes, `google.connect`, routes, `priority`.
 * See change: add-google-connect.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { account, capturingLogger, memoryCredentials, OWN_BB, ownClient } from "../../__tests__/fakes.js";
import { ACCOUNTS_TYPE, CONNECT_SERVICE, LEASE_TYPE } from "../../shared/protocol.js";
import registerPlugin from "../index.js";
import { acctKey, clientKey } from "../store.js";

const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});

function ctxOf(over: Record<string, unknown> = {}) {
  const fastify = Fastify();
  apps.push(fastify);
  const handlers = new Map<string, { fn: (p: unknown) => Promise<unknown>; opts?: unknown }>();
  const provided = new Map<string, unknown>();
  const logger = capturingLogger();
  const creds = memoryCredentials({
    [clientKey("bb")]: ownClient("bb", "BB") as never,
    [acctKey("s1")]: account("s1", "a@x.com", { client: "own:bb", clientId: OWN_BB.clientId, expires: Date.now() + 3_600_000 }) as never,
  });
  const ctx = {
    fastify,
    logger,
    credentials: creds,
    oauth: { startFlow: vi.fn() },
    networkGuard: async () => {},
    registerPiRequestHandler: (t: string, fn: (p: unknown) => Promise<unknown>, opts?: unknown) => handlers.set(t, { fn, opts }),
    provide: (n: string, v: unknown) => provided.set(n, v),
    consume: () => undefined,
    getDashboardBaseUrl: () => "https://dash.example.com",
    ...over,
  };
  return { ctx: ctx as never, fastify, handlers, provided, logger };
}

describe("registerPlugin", () => {
  it("without a credential store the plugin is inactive and says so", async () => {
    const { ctx, handlers, logger, fastify } = ctxOf({ credentials: undefined });
    await registerPlugin(ctx);
    expect(handlers.size).toBe(0);
    expect(logger.warns[0]).toContain("inactive");
    expect((await fastify.inject({ method: "GET", url: "/api/plugins/google/state" })).statusCode).toBe(404);
  });

  it("registers BOTH lanes hub-local-only and provides only google.connect", async () => {
    const { ctx, handlers, provided } = ctxOf();
    await registerPlugin(ctx);
    expect([...handlers.keys()].sort()).toEqual([ACCOUNTS_TYPE, LEASE_TYPE].sort());
    for (const h of handlers.values()) expect(h.opts).toEqual({ hubLocalOnly: true });
    expect([...provided.keys()]).toEqual([CONNECT_SERVICE]);
    expect(typeof (provided.get(CONNECT_SERVICE) as { importLegacyGmail: unknown }).importLegacyGmail).toBe("function");
  });

  it("google/accounts is secret-free; google/lease serves a token", async () => {
    const { ctx, handlers } = ctxOf();
    await registerPlugin(ctx);
    const rows = (await handlers.get(ACCOUNTS_TYPE)?.fn({})) as unknown[];
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/REFRESH|ACCESS/);
    expect(await handlers.get(LEASE_TYPE)?.fn({ account: "a@x.com", product: "gmail" })).toMatchObject({ accessToken: "ACCESS-s1", email: "a@x.com" });
  });

  it("mounts the routes; the dashboard base seam feeds the state", async () => {
    const { ctx, fastify } = ctxOf();
    await registerPlugin(ctx);
    const r = await fastify.inject({ method: "GET", url: "/api/plugins/google/state" });
    expect(r.json().webRedirectUri).toBe("https://dash.example.com/api/plugins/google/oauth/callback");
  });

  it("works on a host without the base seam: web/return paths then refuse instead of guessing", async () => {
    const { ctx, fastify } = ctxOf({ getDashboardBaseUrl: undefined });
    await registerPlugin(ctx);
    const r = await fastify.inject({ method: "GET", url: "/api/plugins/google/state" });
    expect(r.json().webRedirectUri).toBeUndefined();
  });
});

describe("manifest (task 1.1)", () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, "../../../package.json"), "utf8"));
  it("id google, priority 200 (before gmail's 210), settings-section claim, NO dependsOn", () => {
    const m = pkg["pi-dashboard-plugin"];
    expect(m).toMatchObject({ id: "google", priority: 200, server: "./src/server/index.ts", bridge: "./src/bridge/index.ts", client: "./src/client/index.tsx" });
    expect(m.claims).toEqual([{ slot: "settings-section", component: "GoogleSettings", tab: "general" }]);
    expect(m.dependsOn).toBeUndefined();
    const gmail = JSON.parse(readFileSync(join(__dirname, "../../../../gmail-plugin/package.json"), "utf8"));
    expect(m.priority).toBeLessThan(gmail["pi-dashboard-plugin"].priority);
  });
});
