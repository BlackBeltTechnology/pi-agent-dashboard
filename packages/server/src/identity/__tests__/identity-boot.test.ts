/**
 * Server-level boot tests for the D21 self-lockout guard (tasks 18.6–18.9).
 *
 * Boots a REAL server (`createTestServer`) against a throwaway HOME holding a
 * config + trusted drop-in plugins, because the thing under test is the
 * ordering inside `createServer`'s pre-listen arming block, which the pure
 * `activation.test.ts` decision table cannot observe.
 *
 * Folds test-plan LK-4, LK-5, LK-7, LK-8, LK-13.
 * See change: add-multi-user-identity-plane (D21, D8, D9).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type BootHarness, createBootHarness, loginPlugin } from "./boot-harness.js";

const ISSUER = "https://kc.example.test/realms/t";
const KEYCLOAK = { enabled: true, issuer: ISSUER, audience: "pi-dashboard" };
const LEGACY_AUTH = { secret: "x".repeat(32), providers: { github: { clientId: "id", clientSecret: "sec" } } };
const UNRESOLVABLE_AUTH = { secret: "x".repeat(32), providers: { oidc: { clientId: "id", clientSecret: "sec" } } };

let h: BootHarness;
beforeEach(() => {
  h = createBootHarness();
});
afterEach(() => h.teardown());

const dropIn = (id: string, src: string) => h.dropIn(id, src);
const LOGIN_OK = (id: string) => loginPlugin(id);
const LOGIN_THEN_THROW = (id: string) => loginPlugin(id, { thenThrow: true });
const writeConfig = (extra: Record<string, unknown>) =>
  h.writeConfig({ plugins: { "keycloak-resolver": KEYCLOAK }, ...extra });
const boot = (o?: Parameters<BootHarness["boot"]>[0]) => h.boot(o);
const json = (p: string) => h.json(p);
const output = () => h.output();
const notEnforcedLines = () => h.notEnforcedLines();
const dialTicketless = async () => {
  const ws = await h.dial();
  ws?.close();
  return ws !== null;
};

describe("18.6 failed login plugin (LK-4)", () => {
  it("boots inert: registrations released, login-config inactive, ticketless local /ws admitted", async () => {
    dropIn("broken-login", LOGIN_THEN_THROW("broken-login"));
    writeConfig({ identity: { trustedResolverPlugins: ["broken-login"] } });
    await boot();

    expect(await json("/api/identity/login-config")).toEqual({ active: false });
    expect(notEnforcedLines()).toHaveLength(1);
    expect(output()).toMatch(/no login provider is registered/);
    expect(await dialTicketless()).toBe(true);
  }, 40000);
});

describe("18.7 D8/D9 disarm never aborts (LK-5, LK-13)", () => {
  it("(a) named-but-absent trustedPolicyPlugin boots inert with the reason logged", async () => {
    dropIn("login-a", LOGIN_OK("login-a"));
    writeConfig({ identity: { trustedResolverPlugins: ["login-a"], trustedPolicyPlugin: "ghost-policy" } });
    await boot();

    expect(await json("/api/identity/login-config")).toEqual({ active: false });
    expect(output()).toMatch(/ghost-policy.*registered 0 policies/);
  }, 40000);

  it("(c) resolvable auth.providers connectors disarm identity (D8) without aborting boot", async () => {
    dropIn("login-c", LOGIN_OK("login-c"));
    writeConfig({
      identity: { trustedResolverPlugins: ["login-c"] }
    });
    await boot({ authConfig: LEGACY_AUTH });

    expect(await json("/api/identity/login-config")).toEqual({ active: false });
    expect(output()).toMatch(/auth\.providers confidential cookie connectors are active/);
  }, 40000);

  it("(d) an auth.providers entry that resolves to NO provider leaves the plane ENFORCED", async () => {
    dropIn("login-d", LOGIN_OK("login-d"));
    writeConfig({
      identity: { trustedResolverPlugins: ["login-d"] }
    });
    await boot({ authConfig: UNRESOLVABLE_AUTH });

    const cfg = await json("/api/identity/login-config");
    expect(cfg).toMatchObject({ active: true, pluginId: "login-d" });
    expect(notEnforcedLines()).toHaveLength(0);
    // Enforced ⇒ a ticketless upgrade is refused.
    expect(await dialTicketless()).toBe(false);
  }, 40000);
});

describe("18.8 /auth/status placement (LK-7)", () => {
  it("(a) enforced + no resolvable provider: identity-aware answer", async () => {
    dropIn("login-s", LOGIN_OK("login-s"));
    writeConfig({ identity: { trustedResolverPlugins: ["login-s"] } });
    await boot();

    // Enforced and no bearer ⇒ only a resolved principal is authenticated.
    expect(await json("/auth/status")).toMatchObject({ authenticated: false });
    expect(await json("/api/identity/login-config")).toMatchObject({ active: true });
  }, 40000);

  it("(b) resolved legacy providers: legacy cookie route owns /auth/status, identity inert", async () => {
    dropIn("login-s2", LOGIN_OK("login-s2"));
    writeConfig({
      identity: { trustedResolverPlugins: ["login-s2"] }
    });
    await boot({ authConfig: LEGACY_AUTH });

    const status = await json("/auth/status");
    expect(status).toHaveProperty("authenticated");
    expect(await json("/api/identity/login-config")).toEqual({ active: false });
  }, 40000);
});

describe("18.9 registration latch (LK-8)", () => {
  it("late registration after listen() is refused; ticket still required; descriptor stays advertised", async () => {
    // The plugin keeps its ctx and tries to publish a SECOND descriptor after boot.
    dropIn(
      "login-latch",
      `export default async (ctx) => {
         const off = ctx.registerBrowserLoginConfig({ loginUrl: "/login-latch/login", logoutUrl: "/login-latch/logout" });
         globalThis.__latch = { ctx, off };
       };`,
    );
    writeConfig({ identity: { trustedResolverPlugins: ["login-latch"] } });
    await boot();
    expect(await json("/api/identity/login-config")).toMatchObject({ active: true, pluginId: "login-latch" });

    const latch = (globalThis as any).__latch as { ctx: any; off: () => void };
    // Unregister handle after listen() is a logged no-op…
    latch.off();
    // …and a late registration is refused + logged.
    latch.ctx.registerBrowserLoginConfig({ loginUrl: "/late/login", logoutUrl: "/late/logout" });

    expect(output()).toMatch(/tried to unregister an identity registration after startup/);
    expect(output()).toMatch(/registered a browser login config after startup; ignored until restart/);
    expect(await json("/api/identity/login-config")).toMatchObject({ active: true, pluginId: "login-latch" });
    expect(await dialTicketless()).toBe(false);
    delete (globalThis as any).__latch;
  }, 40000);
});
