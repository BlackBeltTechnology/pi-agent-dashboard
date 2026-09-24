/**
 * Identity-plane SECURITY abuse cases against REAL running dashboards (the
 * matrix boots them; see global-setup). Each test is an attacker move; the
 * assertion is that it gains nothing.
 *
 *   A — enforced (resolver + trusted login plugin, fake OIDC issuer)
 *   I — enforced, IdP unreachable
 *   E — no identity plugins (legacy network guard)
 *
 * Threat model: STRIDE over the bearer (REST/WS), the one-time handoff code,
 * returnTo / fragments, token storage, and the pre-auth endpoints.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { generateKeyPair, SignJWT } from "jose";
import WebSocket from "ws";
import { lanIPv4, readState } from "./matrix-lifecycle.js";

let cached: ReturnType<typeof readState> | undefined;
const st = () => {
  cached ??= readState();
  return cached;
};
const url = (id: string, host = "127.0.0.1") => `http://${host}:${st().instances[id].port}`;
const A = () => url("A");

async function mint(input: { sub: string; aud?: string; expSeconds?: number; extra?: Record<string, unknown> }): Promise<string> {
  const res = await fetch(`${st().issuer}/mint`, { method: "POST", body: JSON.stringify(input) });
  return ((await res.json()) as { access_token: string }).access_token;
}
const get = (base: string, p: string, headers: Record<string, string> = {}) => fetch(`${base}${p}`, { headers });
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** A JWT signed by an ATTACKER key, claiming the real issuer (and a kid the JWKS doesn't have). */
async function forgedWithAttackerKey(iss: string, sub = "sub-anna"): Promise<string> {
  const { privateKey } = await generateKeyPair("RS256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ azp: "dashboard-web" })
    .setProtectedHeader({ alg: "RS256", kid: "attacker-kid" })
    .setIssuer(iss)
    .setSubject(sub)
    .setAudience("pi-dashboard")
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

async function ticketFor(base: string, token?: string): Promise<{ status: number; ticket?: string }> {
  const r = await fetch(`${base}/api/ws-ticket`, {
    method: "POST",
    headers: { Origin: base, "content-type": "application/json", ...(token ? bearer(token) : {}) },
    body: JSON.stringify({ scope: "browser" }),
  });
  const ticket = ((await r.json().catch(() => ({}))) as { data?: { ticket?: string } }).data?.ticket;
  return { status: r.status, ticket };
}
function openSocket(base: string, ticket: string): Promise<"open" | `refused ${number}`> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws?ticket=${ticket}`, { headers: { Origin: base } });
    ws.on("unexpected-response", (_q, res) => resolve(`refused ${res.statusCode ?? 0}`));
    ws.on("error", () => {});
    ws.on("open", () => {
      resolve("open");
      ws.close();
    });
  });
}

const PROTECTED = ["/api/sessions", "/api/config", "/api/providers", "/api/preferences/display", "/api/known-servers"];

// ── Spoofing: forged / tampered / expired / foreign bearers ─────────────────
test.describe("A — bearer spoofing is refused (401, and the token is never echoed)", () => {
  test("a valid bearer gets in (control)", async () => {
    const anna = await mint({ sub: "sub-anna" });
    expect((await get(A(), "/api/sessions", bearer(anna))).status).toBe(200);
  });

  const cases: Array<[string, () => Promise<string>]> = [
    ["alg:none token", async () => `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ iss: st().issuer, sub: "sub-anna", aud: "pi-dashboard", exp: 9_999_999_999 })}.`],
    ["signed by an attacker key (unknown kid)", () => forgedWithAttackerKey(st().issuer)],
    [
      "payload tampered after signing (sub swapped)",
      async () => {
        const [h, , sig] = (await mint({ sub: "sub-anna" })).split(".");
        const now = Math.floor(Date.now() / 1000);
        return `${h}.${b64url({ iss: st().issuer, sub: "sub-bela", aud: "pi-dashboard", azp: "dashboard-web", iat: now, exp: now + 300 })}.${sig}`;
      },
    ],
    ["expired 10 minutes ago", () => mint({ sub: "sub-anna", expSeconds: -600 })],
    ["wrong audience", () => mint({ sub: "sub-anna", aud: "some-other-app" })],
    ["garbage", async () => "not.a.jwt"],
    ["empty-ish", async () => "a"],
  ];
  for (const [name, make] of cases) {
    test(`${name}`, async () => {
      const token = await make();
      for (const p of PROTECTED) {
        const res = await get(A(), p, bearer(token));
        expect(res.status, `${name} ${p}`).toBe(401);
        const body = await res.text();
        if (token.length >= 8) expect(body, "token echoed in the error").not.toContain(token.slice(0, 40));
      }
      expect((await ticketFor(A(), token)).ticket, "a ws-ticket was minted for a bad bearer").toBeUndefined();
    });
  }

  test("a token from a FOREIGN issuer is not ours → no principal → 401", async () => {
    const foreign = await forgedWithAttackerKey("https://evil.example/realms/x");
    expect((await get(A(), "/api/sessions", bearer(foreign))).status).toBe(401);
  });

  test("a bearer smuggled in the query string or a cookie is ignored", async () => {
    const anna = await mint({ sub: "sub-anna" });
    expect((await get(A(), `/api/sessions?access_token=${anna}`)).status).toBe(401);
    expect((await get(A(), "/api/sessions", { Cookie: `access_token=${anna}; token=${anna}` })).status).toBe(401);
  });

  test("the Authorization scheme must be Bearer (Basic / raw token refused)", async () => {
    const anna = await mint({ sub: "sub-anna" });
    expect((await get(A(), "/api/sessions", { Authorization: anna })).status).toBe(401);
    expect((await get(A(), "/api/sessions", { Authorization: `Basic ${Buffer.from(`x:${anna}`).toString("base64")}` })).status).toBe(401);
  });
});

// ── Elevation: the signed-out floor on a live server ────────────────────────
test.describe("A — signed-out floor on the live server", () => {
  test("every protected road and method is 401 without a principal — localhost included", async () => {
    for (const p of PROTECTED) {
      for (const method of ["GET", "POST", "PUT", "DELETE"]) {
        const res = await fetch(`${A()}${p}`, { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
        expect(res.status, `${method} ${p}`).toBe(401);
      }
    }
    expect((await fetch(`${A()}/api/restart`, { method: "POST" })).status).toBe(401);
  });

  test("path tricks do not reach a protected road", async () => {
    for (const p of ["//api/config", "/api//config", "/%61pi/config", "/api/health/..%2fconfig", "/api/health/%2e%2e/config", "/api/identity/login-config/../../config"]) {
      const res = await fetch(`${A()}${p}`, { redirect: "manual" });
      const body = await res.text();
      expect(res.status === 401 || res.status === 404 || res.status === 400, `${p} → ${res.status}`).toBe(true);
      expect(body, p).not.toMatch(/"providers"|"trustedResolverPlugins"|"sessions"\s*:\s*\[/);
    }
  });

  test("spoofed forwarding headers do not buy loopback trust", async () => {
    const spoofs: Record<string, string>[] = [{ "X-Forwarded-For": "127.0.0.1" }, { "X-Real-IP": "127.0.0.1" }, { Forwarded: "for=127.0.0.1" }, { "X-Forwarded-Host": "localhost" }];
    for (const h of spoofs) {
      expect((await get(A(), "/api/sessions", h)).status, JSON.stringify(h)).toBe(401);
    }
    const lan = lanIPv4();
    test.skip(!lan, "no non-loopback IPv4 on this host");
    const remoteA = url("A", lan ?? "");
    expect((await get(remoteA, "/api/sessions", { "X-Forwarded-For": "127.0.0.1" })).status).toBe(401);
  });

  test("a WRONG local token is refused; the real host-only one admits same-user CLI callers", async () => {
    expect((await get(A(), "/api/sessions", { "x-pi-local-token": "guess-0000000000000000" })).status).toBe(401);
    const real = fs.readFileSync(path.join(st().instances.A.home, ".pi", "dashboard", "local", "token"), "utf-8").trim();
    expect((await get(A(), "/api/sessions", { "x-pi-local-token": real })).status).toBe(200);
  });

  test("pre-auth endpoints disclose only the allowlisted login descriptor", async () => {
    const lc = (await (await get(A(), "/api/identity/login-config")).json()) as Record<string, unknown>;
    const allowed = new Set(["active", "pluginId", "issuer", "clientId", "loginUrl", "logoutUrl", "tokenUrl", "postLogoutUrl", "label", "endsProviderSession", "silentSignIn", "providers"]);
    for (const k of Object.keys(lc)) expect(allowed.has(k), `unexpected key ${k}`).toBe(true);
    const status = (await (await get(A(), "/auth/status")).json()) as Record<string, unknown>;
    expect(status.authenticated).toBe(false);
    expect(status).not.toHaveProperty("principal");
  });
});

// ── WebSocket: tickets need a principal, are single-use ─────────────────────
test.describe("A — websocket tickets", () => {
  test("no ticket / garbage ticket is refused", async () => {
    expect(await openSocket(A(), "")).toMatch(/^refused/);
    expect(await openSocket(A(), "forged-ticket-value")).toMatch(/^refused/);
  });

  test("a ticket is single-use (replay refused)", async () => {
    const { ticket } = await ticketFor(A(), await mint({ sub: "sub-anna" }));
    expect(ticket).toBeTruthy();
    expect(await openSocket(A(), ticket ?? "")).toBe("open");
    expect(await openSocket(A(), ticket ?? "")).toMatch(/^refused/);
  });
});

// ── IdP down: fail closed ────────────────────────────────────────────────────
test.describe("I — IdP unreachable fails CLOSED", () => {
  test("a well-formed bearer is not accepted when its issuer cannot be verified", async () => {
    const t = await mint({ sub: "sub-anna" }); // signed by the live fake issuer; I's resolver points at a dead one
    expect((await get(url("I"), "/api/sessions", bearer(t))).status).toBe(401);
    expect((await get(url("I"), "/api/sessions")).status).toBe(401);
  });
});

// ── No identity: spoofed headers still do not make a LAN caller "local" ──────
test.describe("E — legacy network guard", () => {
  test("a LAN caller claiming X-Forwarded-For: 127.0.0.1 is still refused", async () => {
    const lan = lanIPv4();
    test.skip(!lan, "no non-loopback IPv4 on this host");
    expect((await get(url("E", lan ?? ""), "/api/sessions", { "X-Forwarded-For": "127.0.0.1" })).status).toBe(403);
  });
});

// ── Browser: handoff replay, login CSRF, open redirect, XSS, token storage ──
async function signInAnna(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign in with Keycloak" }).click();
  await page.locator("#username").fill("anna");
  await page.locator("#password").fill("anna-pw");
  await page.locator("#kc-login").click();
}

test.describe("A — browser attacks on the login flow", () => {
  test("no token is left in web storage, cookies or the URL after sign-in", async ({ page, context }) => {
    await page.goto(`${A()}/`);
    await expect(page.getByTestId("login-page")).toBeVisible();
    await signInAnna(page);
    await expect(page.getByTestId("user-bar")).toBeVisible({ timeout: 20_000 });
    const stored = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join("\n"));
    expect(stored).not.toMatch(/eyJ[\w-]+\.[\w-]+\.[\w-]+/); // no JWT anywhere in web storage
    // The dashboard sets NO cookie. (The fake IdP's own SSO cookie shares the
    // 127.0.0.1 host — cookies are not port-scoped — so it is excluded here.)
    expect((await context.cookies(A())).filter((c) => c.name !== "fake_oidc_sso")).toEqual([]);
    expect(page.url()).not.toMatch(/pi_handoff|access_token|id_token/);
  });

  test("a handoff code cannot be replayed in another browser", async ({ page, browser }) => {
    let code = "";
    page.on("framenavigated", (f) => {
      const m = /[#&]pi_handoff=([^&]+)/.exec(f.url());
      if (m) code = m[1];
    });
    await page.goto(`${A()}/`);
    await signInAnna(page);
    await expect(page.getByTestId("user-bar")).toBeVisible({ timeout: 20_000 });
    expect(code).not.toBe("");
    const other = await (await browser.newContext()).newPage();
    await other.goto(`${A()}/#pi_handoff=${code}`);
    await expect(other.getByTestId("login-page")).toBeVisible({ timeout: 20_000 });
    await expect(other.getByTestId("user-bar")).toHaveCount(0);
  });

  test("login CSRF: an attacker's fresh handoff code planted in a victim's browser signs nobody in", async ({ browser }) => {
    // Attacker completes the IdP leg but never redeems the code.
    const attacker = await (await browser.newContext()).newPage();
    await attacker.route("**/identity-login/token", (r) => r.abort());
    let code = "";
    attacker.on("framenavigated", (f) => {
      const m = /[#&]pi_handoff=([^&]+)/.exec(f.url());
      if (m) code = m[1];
    });
    await attacker.goto(`${A()}/`);
    await signInAnna(attacker);
    await expect.poll(() => code, { timeout: 20_000 }).not.toBe("");
    // Victim follows the attacker's link.
    const victim = await (await browser.newContext()).newPage();
    await victim.goto(`${A()}/#pi_handoff=${code}`);
    await expect(victim.getByTestId("login-page")).toBeVisible({ timeout: 20_000 });
    await expect(victim.getByTestId("user-bar")).toHaveCount(0);
    expect(await victim.evaluate(() => fetch("/api/sessions").then((r) => r.status))).toBe(401);
  });

  test("open redirect: /login?returnTo=<evil> lands back on the dashboard, not evil", async ({ page }) => {
    await page.goto(`${A()}/login?returnTo=${encodeURIComponent("https://evil.example/phish")}`);
    await signInAnna(page);
    await expect(page.getByTestId("user-bar")).toBeVisible({ timeout: 20_000 });
    expect(new URL(page.url()).origin).toBe(A());
  });

  test("XSS through #pi_login_error does not execute", async ({ page }) => {
    await page.goto(`${A()}/#pi_login_error=${encodeURIComponent('<img src=x onerror="window.__pwned=1">')}`);
    await expect(page.getByTestId("login-page")).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(await page.locator("img").count()).toBe(0);
  });

  test("signed out, the page itself cannot read protected data (the server refuses, not just the UI)", async ({ page }) => {
    await page.goto(`${A()}/login?pi_signed_out=1`); // no silent round-trip on the signed-out page
    await expect(page.getByTestId("login-page")).toHaveAttribute("data-variant", "signed-out");
    const statuses = await page.evaluate(async (paths) => Promise.all(paths.map((p) => fetch(p).then((r) => r.status))), PROTECTED);
    expect(statuses.every((s) => s === 401)).toBe(true);
  });

  test("after sign-out the old in-memory token is gone: back/forward does not restore the session", async ({ page }) => {
    await page.goto(`${A()}/`);
    await signInAnna(page);
    await expect(page.getByTestId("user-bar")).toBeVisible({ timeout: 20_000 });
    const skip = page.getByRole("button", { name: /^skip$/i });
    if (await skip.isVisible()) await skip.click();
    await page.getByTestId("user-bar-signout").click();
    await expect(page.getByTestId("login-page")).toHaveAttribute("data-variant", "signed-out", { timeout: 20_000 });
    await page.goBack();
    await expect(page.getByTestId("user-bar")).toHaveCount(0, { timeout: 10_000 });
    expect(await page.evaluate(() => fetch("/api/sessions").then((r) => r.status))).toBe(401);
  });
});
