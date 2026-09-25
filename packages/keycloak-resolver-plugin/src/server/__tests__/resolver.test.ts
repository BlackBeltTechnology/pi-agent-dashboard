import type { AuthContext } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  SignJWT,
  UnsecuredJWT,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { activeConfig, parseKeycloakResolverConfig } from "../../shared/config.js";
import { base64UrlSha256, JtiReplayCache } from "../dpop.js";
import { createKeycloakResolver } from "../resolver.js";

const ISSUER = "https://kc.example.test/realms/app";
const AUDIENCE = "dashboard";
const URL = "https://dashboard.example.test/api/sessions";

let rsaPrivate: CryptoKey;
let rsaPublicJwk: JWK;
let dpopPrivate: CryptoKey;
let dpopPublicJwk: JWK;
let dpopThumbprint: string;

beforeAll(async () => {
  const rsa = await generateKeyPair("RS256");
  rsaPrivate = rsa.privateKey;
  rsaPublicJwk = { ...(await exportJWK(rsa.publicKey)), kid: "rsa-1", alg: "RS256", use: "sig" };
  const ec = await generateKeyPair("ES256");
  dpopPrivate = ec.privateKey;
  dpopPublicJwk = await exportJWK(ec.publicKey);
  dpopThumbprint = await calculateJwkThumbprint(dpopPublicJwk);
});

function config(over: Record<string, unknown> = {}) {
  const parsed = parseKeycloakResolverConfig({ issuer: ISSUER, audience: AUDIENCE, ...over });
  const active = activeConfig(parsed);
  if (!active) throw new Error("test config unexpectedly inert");
  return active;
}

function context(token: string, over: Partial<AuthContext> = {}): AuthContext {
  return {
    method: "GET",
    url: URL,
    authorization: `Bearer ${token}`,
    isAuthenticated: false,
    ip: "127.0.0.1",
    ...over,
  };
}

function resolver(over: Record<string, unknown> = {}) {
  const local = createLocalJWKSet({ keys: [rsaPublicJwk] });
  return createKeycloakResolver({
    config: config(over),
    jwks: { getKeyFn: async () => local },
    replayCache: new JtiReplayCache(),
  });
}

async function accessToken(
  claims: Record<string, unknown> = {},
  options: { alg?: "RS256"; kid?: string } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: "user-1",
    exp: now + 300,
    iat: now,
    ...claims,
  })
    .setProtectedHeader({ alg: options.alg ?? "RS256", kid: options.kid ?? "rsa-1", typ: "at+jwt" })
    .sign(rsaPrivate);
}

async function dpopProof(token: string, claims: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    htm: "GET",
    htu: URL,
    ath: base64UrlSha256(token),
    iat: now,
    jti: `jti-${Math.random()}`,
    ...claims,
  })
    .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk: dpopPublicJwk })
    .sign(dpopPrivate);
}

describe("Keycloak resolver activation (§5.1)", () => {
  it("missing issuer/audience and http without opt-in are inert with no fallback", () => {
    expect(activeConfig(parseKeycloakResolverConfig({}))).toBeNull();
    expect(activeConfig(parseKeycloakResolverConfig({ issuer: ISSUER }))).toBeNull();
    expect(
      activeConfig(
        parseKeycloakResolverConfig({ issuer: "http://keycloak:8080/realms/app", audience: AUDIENCE }),
      ),
    ).toBeNull();
  });
});

describe("ownership disambiguation (§5.3)", () => {
  it("opaque/non-JWT bearer yields null", async () => {
    await expect(resolver()(context("opaque-device-token"))).resolves.toBeNull();
  });

  it("foreign-issuer JWT yields null", async () => {
    const token = await accessToken({ iss: "https://foreign.example/realm" });
    await expect(resolver()(context(token))).resolves.toBeNull();
  });

  it("owned invalid token yields reject, never fall-through", async () => {
    const token = await accessToken({}, { kid: "unknown" });
    await expect(resolver()(context(token))).resolves.toMatchObject({ reject: true });
  });
});

describe("RFC 9068 validation (§5.4 / §5.6)", () => {
  it("valid RS256 token resolves exact (iss, sub), raw exp, and verified email", async () => {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const token = await accessToken({ exp, email: "user@example.test", email_verified: true });
    await expect(resolver()(context(token))).resolves.toEqual({
      principal: { iss: ISSUER, sub: "user-1", email: "user@example.test" },
      expiresAt: exp * 1000,
    });
  });

  it("carries a display name from `name`, falling back to `preferred_username` (D22 user line)", async () => {
    const named = await resolver()(context(await accessToken({ name: "Anna Kovacs", preferred_username: "anna" })));
    expect(named).toMatchObject({ principal: { iss: ISSUER, sub: "user-1", name: "Anna Kovacs" } });
    const userOnly = await resolver()(context(await accessToken({ preferred_username: "anna" })));
    expect(userOnly).toMatchObject({ principal: { name: "anna" } });
    const none = (await resolver()(context(await accessToken({})))) as { principal: Record<string, unknown> };
    expect(none.principal.name).toBeUndefined();
  });

  it("unverified email is omitted", async () => {
    const token = await accessToken({ email: "user@example.test", email_verified: false });
    const outcome = await resolver()(context(token));
    expect(outcome).toMatchObject({ principal: { iss: ISSUER, sub: "user-1" } });
    expect(outcome && "principal" in outcome && "email" in outcome.principal).toBe(false);
  });

  it("rejects alg:none before JWKS/signature validation", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = new UnsecuredJWT({ iss: ISSUER, aud: AUDIENCE, sub: "u", exp: now + 300 }).encode();
    await expect(resolver()(context(token))).resolves.toMatchObject({ reject: true });
  });

  it("rejects missing/incorrect aud, azp, exp, or sub", async () => {
    const cases = [
      await accessToken({ aud: "other" }),
      await accessToken({ azp: "wrong" }),
      await accessToken({ exp: Math.floor(Date.now() / 1000) - 120 }),
      await accessToken({ sub: "" }),
    ];
    const resolve = resolver({ authorizedParty: "expected" });
    for (const token of cases) {
      await expect(resolve(context(token))).resolves.toMatchObject({ reject: true });
    }
  });

  it("catches induced JWKS fault on an owned token and returns reject", async () => {
    const token = await accessToken();
    const resolve = createKeycloakResolver({
      config: config(),
      jwks: { getKeyFn: async () => { throw new Error("discovery down"); } },
      replayCache: new JtiReplayCache(),
    });
    await expect(resolve(context(token))).resolves.toMatchObject({ reject: true });
  });
});

describe("conditional DPoP (§5.5)", () => {
  it("an unbound token validates as a plain bearer", async () => {
    const token = await accessToken();
    await expect(resolver()(context(token))).resolves.toMatchObject({ principal: { sub: "user-1" } });
  });

  it("a bound token without a proof rejects", async () => {
    const token = await accessToken({ cnf: { jkt: dpopThumbprint } });
    await expect(resolver()(context(token))).resolves.toMatchObject({ reject: true });
  });

  it("a malformed cnf.jkt rejects instead of downgrading to plain bearer", async () => {
    const token = await accessToken({ cnf: { jkt: 42 } });
    await expect(resolver()(context(token))).resolves.toMatchObject({ reject: true });
  });

  it("a proof without correct ath binding rejects", async () => {
    const token = await accessToken({ cnf: { jkt: dpopThumbprint } });
    const proof = await dpopProof(token, { ath: base64UrlSha256("different-token") });
    await expect(resolver()(context(token, { dpop: proof }))).resolves.toMatchObject({ reject: true });
  });

  it("a valid bound token + proof resolves; replayed jti rejects", async () => {
    const token = await accessToken({ cnf: { jkt: dpopThumbprint } });
    const proof = await dpopProof(token, { jti: "once" });
    const resolve = resolver();
    await expect(resolve(context(token, { dpop: proof }))).resolves.toMatchObject({ principal: { sub: "user-1" } });
    await expect(resolve(context(token, { dpop: proof }))).resolves.toMatchObject({ reject: true });
  });
});
