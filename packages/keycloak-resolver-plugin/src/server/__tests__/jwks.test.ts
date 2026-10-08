import type { AuthContext } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import { exportJWK, generateKeyPair, type JWK, jwtVerify, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { activeConfig, parseKeycloakResolverConfig } from "../../shared/config.js";
import { JtiReplayCache } from "../dpop.js";
import { JwksSource } from "../jwks.js";
import { createKeycloakResolver } from "../resolver.js";

const ISSUER = "https://kc.example.test/realms/app";
const JWKS_URI = "https://kc.example.test/realms/app/protocol/openid-connect/certs";
const AUDIENCE = "dashboard";

let privateKey: CryptoKey;
let publicJwk: JWK;
let token: string;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "kid-1", alg: "RS256", use: "sig" };
  token = await new SignJWT({ iss: ISSUER, aud: AUDIENCE, sub: "u1" })
    .setProtectedHeader({ alg: "RS256", kid: "kid-1" })
    .setExpirationTime("5m")
    .sign(privateKey);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", "cache-control": "max-age=300" },
  });
}

function active() {
  const c = activeConfig(parseKeycloakResolverConfig({ issuer: ISSUER, audience: AUDIENCE }));
  if (!c) throw new Error("test config unexpectedly inert");
  return c;
}

describe("OIDC discovery + JWKS cache (§5.2)", () => {
  it("coalesces concurrent first fetches and serves later validations from cache", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration")) {
        return json({ issuer: ISSUER, jwks_uri: JWKS_URI });
      }
      if (url === JWKS_URI) return json({ keys: [publicJwk] });
      return json({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const source = new JwksSource({ issuer: ISSUER, networkTimeoutMs: 1000 });
    const getKey = await source.getKeyFn();
    await Promise.all([
      jwtVerify(token, getKey, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["RS256"] }),
      jwtVerify(token, getKey, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["RS256"] }),
    ]);
    await jwtVerify(token, getKey, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["RS256"] });

    // One discovery + one JWKS request. Concurrent and subsequent validation
    // share jose's in-flight/cached RemoteJWKSet.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("coalesces one refresh for concurrent unknown-kid misses after cooldown", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration")) {
        return json({ issuer: ISSUER, jwks_uri: JWKS_URI });
      }
      if (url === JWKS_URI) return json({ keys: [publicJwk] });
      return json({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    const source = new JwksSource({ issuer: ISSUER, networkTimeoutMs: 1000 });
    const getKey = await source.getKeyFn();
    await jwtVerify(token, getKey, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["RS256"] });

    // jose's RemoteJWKSet uses a 30s cooldown after a successful fetch. Once
    // outside it, concurrent unknown-kid misses share one in-flight reload.
    const realNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(realNow + 31_000);
    const unknown = await new SignJWT({ iss: ISSUER, aud: AUDIENCE, sub: "u1" })
      .setProtectedHeader({ alg: "RS256", kid: "missing-kid" })
      .setExpirationTime("5m")
      .sign(privateKey);
    await Promise.allSettled([
      jwtVerify(unknown, getKey, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["RS256"] }),
      jwtVerify(unknown, getKey, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["RS256"] }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3); // discovery + initial JWKS + one refresh
  });

  it("skips discovery when jwksUri is explicitly configured", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) => json({ keys: [publicJwk] }));
    vi.stubGlobal("fetch", fetchMock);
    const source = new JwksSource({ issuer: ISSUER, jwksUri: JWKS_URI, networkTimeoutMs: 1000 });
    const getKey = await source.getKeyFn();
    await jwtVerify(token, getKey, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["RS256"] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(JWKS_URI);
  });

  it("discovery outage rejects an owned token rather than accepting unverified", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 503)));
    const source = new JwksSource({ issuer: ISSUER, networkTimeoutMs: 1000 });
    const resolve = createKeycloakResolver({ config: active(), jwks: source, replayCache: new JtiReplayCache() });
    const ctx: AuthContext = {
      method: "GET",
      url: "https://dashboard.example.test/api/sessions",
      authorization: `Bearer ${token}`,
      isAuthenticated: false,
      ip: "127.0.0.1",
    };
    await expect(resolve(ctx)).resolves.toMatchObject({ reject: true });
  });
});
