/**
 * Server-level D20 smoke checks over the real resource-server path (tasks 17.2,
 * 17.6): independent login plugin ⇒ descriptor relay + current-allowlist trust;
 * bearer expiry ⇒ 401 on REST and a 4001 close on the socket.
 *
 * Boots a REAL server against the in-process fake OIDC issuer (RS256 + JWKS), so
 * the resolver verifies real signatures. Replaces the NOT-RUN rows of the
 * disposable smoke (`spike/identity-login-plane`). Isolation (SM-5) is asserted
 * by `tests/e2e/identity/two-user-isolation.spec.ts` in the harness.
 *
 * Folds test-plan SM-2, SM-6. See change: add-multi-user-identity-plane (D20).
 */
import { type FakeOidcIssuer, startFakeOidcIssuer } from "@blackbelt-technology/pi-dashboard-shared/test-support/fake-oidc-issuer.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { type BootHarness, createBootHarness, loginPlugin } from "./boot-harness.js";

let h: BootHarness;
let idp: FakeOidcIssuer;

beforeEach(async () => {
  idp = await startFakeOidcIssuer();
  h = createBootHarness();
});
afterEach(async () => {
  await h.teardown();
  await idp.close();
});

function configure(trusted: string[]) {
  h.writeConfig({
    plugins: {
      "keycloak-resolver": { enabled: true, issuer: idp.issuer, audience: idp.audience, allowInsecureHttp: true, clockSkewSeconds: 0 },
    },
    identity: { trustedResolverPlugins: trusted },
  });
}

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

async function ticketFor(token: string): Promise<{ status: number; ticket?: string }> {
  const res = await fetch(`http://127.0.0.1:${h.handle().httpPort}/api/ws-ticket`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token) },
    body: JSON.stringify({ scope: "browser" }),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: { ticket?: string } };
  return { status: res.status, ticket: body.data?.ticket };
}

describe("17.2 SM-2 — descriptor seam + current-allowlist trust", () => {
  it("relays the sanitized {pluginId, loginUrl, logoutUrl} when the plugin is in the CURRENT allowlist", async () => {
    h.dropIn("indep-login", loginPlugin("indep-login"));
    configure(["indep-login"]);
    await h.boot();
    expect(await h.json("/api/identity/login-config")).toMatchObject({
      active: true,
      pluginId: "indep-login",
      loginUrl: "/indep-login/login",
      logoutUrl: "/indep-login/logout",
    });
  }, 40000);

  it("a plugin NOT in the allowlist registers nothing ⇒ {active:false}, no details disclosed", async () => {
    h.dropIn("indep-login", loginPlugin("indep-login"));
    configure([]); // resolver active, but the login plugin lost trust
    await h.boot();
    const cfg = await h.json("/api/identity/login-config");
    expect(cfg).toEqual({ active: false });
    expect(h.output()).toMatch(/plugin 'indep-login' is not trusted to publish a browser login config/);
  }, 40000);
});

describe("17.6 SM-6 — expiry", () => {
  it("a token past exp is refused (401) on REST, and a socket is closed 4001 at principalExpiresAt", async () => {
    h.dropIn("indep-login", loginPlugin("indep-login"));
    configure(["indep-login"]);
    await h.boot();
    const base = `http://127.0.0.1:${h.handle().httpPort}`;

    // Stale token: refused, discloses nothing.
    const stale = await idp.mint({ sub: "sub-anna", expSeconds: -600 });
    const refused = await fetch(`${base}/api/sessions`, { headers: bearer(stale) });
    expect(refused.status).toBe(401);

    // Short-lived token: ticket + upgrade work now…
    const short = await idp.mint({ sub: "sub-anna", expSeconds: 3 });
    const { status, ticket } = await ticketFor(short);
    expect(status).toBe(200);
    const ws = await h.dial(ticket);
    expect(ws).not.toBeNull();

    // …then the socket is closed with 4001 once the token lapses.
    const closeCode = await new Promise<number>((resolve) => {
      ws!.on("close", (code) => resolve(code));
      setTimeout(() => resolve(-1), 8000);
    });
    expect(closeCode).toBe(4001);

    // And the expired bearer can no longer mint a ticket.
    await new Promise((r) => setTimeout(r, 500));
    expect((await ticketFor(short)).status).toBe(401);
  }, 40000);
});

describe("18.27 ctx.identity — plugin consumer seam on a real server", () => {
  it("a plugin reads the principal behind a WS upgrade, authorizes namespaced actions, and gets per-user storage", async () => {
    h.dropIn(
      "consumer",
      `export default async (ctx) => {
         ctx.registerBrowserLoginConfig({ loginUrl: "/consumer/login", logoutUrl: "/consumer/logout" });
         globalThis.__consumerIdentity = ctx.identity;
       };`,
    );
    configure(["consumer"]);
    await h.boot();
    const seam = (globalThis as any).__consumerIdentity;
    try {
      expect(seam).toBeDefined();
      expect(seam.isEnforced()).toBe(true);

      const token = await idp.mint({ sub: "sub-anna" });
      const upgrade = (authorization?: string) => ({
        url: "/ws/consumer/x",
        headers: authorization ? { authorization } : {},
        socket: { remoteAddress: "127.0.0.1" },
      });
      const anna = await seam.principalOfUpgrade(upgrade(`Bearer ${token}`));
      expect(anna).toMatchObject({ iss: idp.issuer, sub: "sub-anna" });
      expect(await seam.principalOfUpgrade(upgrade())).toBeNull();
      expect(await seam.principalOfUpgrade(upgrade("Bearer garbage"))).toBeNull();
      expect(await seam.principalOfUpgrade(upgrade("Bearer pi_op_forged"))).toBeNull();

      // No policy registered ⇒ authorize is true for any principal (D24 default); bad action names are refused.
      expect(await seam.authorize(anna, "export", { kind: "note" })).toBe(true);
      expect(await seam.authorize(anna, "a:b", { kind: "note" })).toBe(false);

      // Per-user storage lives under THIS plugin's data root, keyed by a hash.
      const dir: string = seam.userDataDir(anna);
      expect(dir).toContain(`${"/.pi/dashboard/plugins/consumer/users/"}`);
      expect(dir.startsWith(h.home)).toBe(true);
    } finally {
      delete (globalThis as any).__consumerIdentity;
    }
  }, 40000);
});

describe("18.13 terminal + live WS scopes require a principal ticket while enforced", () => {
  const upgrade = (port: number, path_: string): Promise<{ status?: number; opened?: boolean }> =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path_}`);
      ws.on("open", () => {
        ws.close();
        resolve({ opened: true });
      });
      ws.on("unexpected-response", (_req, res) => resolve({ status: res.statusCode }));
      ws.on("error", () => resolve({}));
      setTimeout(() => resolve({}), 5000);
    });

  it("ticketless loopback is refused 403 (no legacy allowance); a principal ticket passes the auth gate", async () => {
    h.dropIn("tl-login", loginPlugin("tl-login"));
    configure(["tl-login"]);
    await h.boot();
    const port = h.handle().httpPort;
    expect(await upgrade(port, "/ws/terminal/term-missing")).toEqual({ status: 403 });
    expect(await upgrade(port, "/live/nope")).toEqual({ status: 403 });

    const token = await idp.mint({ sub: "sub-anna" });
    for (const scope of ["terminal", "live"] as const) {
      const res = await fetch(`http://127.0.0.1:${port}/api/ws-ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scope }),
      });
      expect(res.status).toBe(200);
      const ticket = ((await res.json()) as { data: { ticket: string } }).data.ticket;
      const path_ = scope === "terminal" ? "/ws/terminal/term-missing" : "/live/nope";
      // Past auth: the (absent) target destroys the socket — NOT the 403 of the auth gate.
      const out = await upgrade(port, `${path_}?ticket=${encodeURIComponent(ticket)}`);
      expect(out.status).not.toBe(403);
    }
  }, 40000);
});
