/**
 * Server-level D23 break-glass (tasks 18.23 / 18.25): with the IdP DOWN, the
 * host operator still gets in — `local-code` (local token) → `local-exchange`
 * (pre-auth, one-time code) → operator bearer → every session road + a ticketed
 * socket. Signed-out loopback stays refused (no localhost bypass).
 *
 * Folds the "IdP down + break-glass gets in" matrix row. See change:
 * add-multi-user-identity-plane (D23, D24).
 */
import fs from "node:fs";
import path from "node:path";
import { type FakeOidcIssuer, startFakeOidcIssuer } from "@blackbelt-technology/pi-dashboard-shared/test-support/fake-oidc-issuer.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type BootHarness, createBootHarness, loginPlugin } from "./boot-harness.js";

let h: BootHarness;
let idp: FakeOidcIssuer;
let idpClosed = false;

beforeEach(async () => {
  idp = await startFakeOidcIssuer();
  idpClosed = false;
  h = createBootHarness();
  h.dropIn("bg-login", loginPlugin("bg-login"));
  h.writeConfig({
    plugins: { "keycloak-resolver": { enabled: true, issuer: idp.issuer, audience: idp.audience, allowInsecureHttp: true } },
    identity: { trustedResolverPlugins: ["bg-login"] },
  });
  await h.boot();
});
afterEach(async () => {
  await h.teardown();
  if (!idpClosed) await idp.close();
});

const base = () => `http://127.0.0.1:${h.handle().httpPort}`;
const localToken = () => fs.readFileSync(path.join(h.home, ".pi", "dashboard", "local", "token"), "utf8").trim();
const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base()}${p}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

async function issueCode(): Promise<string> {
  const res = await post("/api/identity/local-code", {}, { "x-pi-local-token": localToken() });
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: { code: string } }).data.code;
}

describe("D23 break-glass (IdP down)", () => {
  it("the boot log names the recovery command while enforced (D23)", () => {
    expect(h.output()).toMatch(/pi-dashboard login --local/);
  });

  it("issuing a code needs the host-only local token", async () => {
    expect((await post("/api/identity/local-code", {})).status).toBe(401);
    expect((await post("/api/identity/local-code", {}, { "x-pi-local-token": "wrong" })).status).toBe(401);
  });

  it("signed-out loopback is still refused while enforced (no localhost bypass)", async () => {
    expect((await fetch(`${base()}/api/sessions`)).status).toBe(401);
  });

  it("IdP down: code → operator bearer → REST + socket; the code is single-use", async () => {
    await idp.close(); // the IdP is gone
    idpClosed = true;

    const code = await issueCode();
    const ex = await post("/api/identity/local-exchange", { code }); // pre-auth: no bearer
    expect(ex.status).toBe(200);
    const { access_token, expires_in } = (await ex.json()) as { access_token: string; expires_in: number };
    expect(access_token.startsWith("pi_op_")).toBe(true);
    expect(expires_in).toBeGreaterThan(0);

    // single-use
    expect((await post("/api/identity/local-exchange", { code })).status).toBe(401);

    const auth = { Authorization: `Bearer ${access_token}` };
    expect((await fetch(`${base()}/api/sessions`, { headers: auth })).status).toBe(200);
    expect(await (await fetch(`${base()}/auth/status`, { headers: auth })).json()).toMatchObject({
      authenticated: true,
      principal: { sub: "local-operator", name: "Local operator (break-glass)" },
    });
    expect(await (await fetch(`${base()}/api/identity/me`, { headers: auth })).json()).toMatchObject({ localOperator: true });

    const t = await post("/api/ws-ticket", { scope: "browser" }, auth);
    expect(t.status).toBe(200);
    const ticket = ((await t.json()) as { data: { ticket: string } }).data.ticket;
    const ws = await h.dial(ticket);
    expect(ws).not.toBeNull();
    ws?.close();
    expect(h.output()).toMatch(/break-glass: one-time local-operator code issued/);
    expect(h.output()).toMatch(/break-glass: local-operator bearer issued/);
  }, 40000);

  it("a forged or unknown credential gets nothing", async () => {
    expect((await post("/api/identity/local-exchange", { code: "forged" })).status).toBe(401);
    expect((await post("/api/identity/local-exchange", {})).status).toBe(401);
    expect((await fetch(`${base()}/api/sessions`, { headers: { Authorization: "Bearer pi_op_forged" } })).status).toBe(401);
  });
});
