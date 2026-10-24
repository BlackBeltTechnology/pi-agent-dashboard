import { afterEach, describe, expect, it } from "vitest";
import { type FakeOidcIssuer, startFakeOidcIssuer } from "../fake-oidc-issuer.js";

// The redirect allowlist compares parsed URLs (same origin, no userinfo, path-segment
// boundary) instead of a raw string prefix. `prompt=none` with no SSO session makes an
// allowed target answer 302 straight to it, without the login form.
// See change: triage-codeql-alert-debt (design D3 #345).

let issuer: FakeOidcIssuer;
afterEach(async () => {
  await issuer?.close();
});

const USERS = [{ username: "anna", password: "anna-pw", sub: "sub-anna" }];
const PREFIX = "http://127.0.0.1:5000/cb";

async function authorize(redirectUri: string) {
  const u = new URL(`${issuer.issuer}/auth`);
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id: "dashboard-web",
    redirect_uri: redirectUri,
    state: "st-1",
    code_challenge: "c",
    code_challenge_method: "S256",
    prompt: "none",
  }))
    u.searchParams.set(k, v);
  return fetch(u, { redirect: "manual" });
}

describe("fake OIDC issuer — redirect allowlist boundaries", () => {
  it.each([PREFIX, `${PREFIX}/x`])("accepts %s (302 to that target)", async (target) => {
    issuer = await startFakeOidcIssuer({ users: USERS, redirectUriPrefixes: [PREFIX] });
    const res = await authorize(target);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")?.startsWith(`${target}?`)).toBe(true);
  });

  it.each([
    "http://127.0.0.1:50000/cb",
    "http://127.0.0.1:5000/cbx",
    "http://u@127.0.0.1:5000/cb",
    "https://127.0.0.1:5000/cb",
  ])("refuses %s (400, no location)", async (target) => {
    issuer = await startFakeOidcIssuer({ users: USERS, redirectUriPrefixes: [PREFIX] });
    const res = await authorize(target);
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    expect(((await res.json()) as { error: string }).error).toMatch(/not registered/);
  });

  it("keeps the host-wildcard form `http://host:` (any port) used by the e2e harnesses", async () => {
    issuer = await startFakeOidcIssuer({ users: USERS, redirectUriPrefixes: ["http://127.0.0.1:"] });
    expect((await authorize("http://127.0.0.1:7777/anything")).status).toBe(302);
    expect((await authorize("http://127.0.0.1.evil.test:7777/x")).status).toBe(400);
    expect((await authorize("http://u@127.0.0.1:7777/x")).status).toBe(400);
  });
});
