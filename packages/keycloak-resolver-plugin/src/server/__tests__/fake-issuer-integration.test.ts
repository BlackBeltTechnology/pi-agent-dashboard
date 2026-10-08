/**
 * Integration test: the REAL resolver + REAL JwksSource (live HTTP OIDC
 * discovery + JWKS fetch + `jose` RS256 verify) against the lightweight fake
 * OIDC issuer — no Keycloak, no Docker (openspec §11.2).
 *
 * This is the fidelity the unit tests can't reach: they inject a local JWKS
 * (`createLocalJWKSet`) and never exercise discovery/JWKS-over-HTTP. Here the
 * resolver discovers `${issuer}/.well-known/openid-configuration`, fetches
 * `${issuer}/jwks`, and verifies real signatures — the exact path that runs in
 * production against a real Keycloak, minus the Keycloak.
 */
import type { AuthContext } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import { isPrincipalResolution } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import {
  type FakeOidcIssuer,
  startFakeOidcIssuer,
} from "@blackbelt-technology/pi-dashboard-shared/test-support/fake-oidc-issuer.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activeConfig, parseKeycloakResolverConfig } from "../../shared/config.js";
import { JtiReplayCache } from "../dpop.js";
import { JwksSource } from "../jwks.js";
import { createKeycloakResolver } from "../resolver.js";

const AUDIENCE = "pi-dashboard";

let issuer: FakeOidcIssuer;
let resolve: ReturnType<typeof createKeycloakResolver>;

function ctx(token: string): AuthContext {
  return {
    method: "GET",
    url: "http://dashboard.local/api/sessions",
    authorization: `Bearer ${token}`,
    isAuthenticated: false,
    ip: "127.0.0.1",
  };
}

beforeAll(async () => {
  issuer = await startFakeOidcIssuer({ audience: AUDIENCE });
  const config = activeConfig(
    parseKeycloakResolverConfig({ issuer: issuer.issuer, audience: AUDIENCE, allowInsecureHttp: true }),
  );
  if (!config) throw new Error("resolver config did not activate");
  resolve = createKeycloakResolver({
    config,
    jwks: new JwksSource(config), // REAL discovery + remote JWKS
    replayCache: new JtiReplayCache(),
  });
});

afterAll(async () => {
  await issuer.close();
});

describe("keycloak-resolver against a fake OIDC issuer (§11.2)", () => {
  it("resolves two users to DISTINCT principals — the isolation key", async () => {
    const anna = await resolve(ctx(await issuer.mint({ sub: "user-anna" })));
    const bela = await resolve(ctx(await issuer.mint({ sub: "user-bela" })));

    if (!isPrincipalResolution(anna) || !isPrincipalResolution(bela)) {
      throw new Error(`expected both resolved: ${JSON.stringify({ anna, bela })}`);
    }
    expect(anna.principal.iss).toBe(issuer.issuer);
    expect(anna.principal.sub).toBe("user-anna");
    expect(bela.principal.sub).toBe("user-bela");
    expect(anna.principal.sub).not.toBe(bela.principal.sub); // ownership keys differ
  });

  it("carries a verified email when present, drops it when unverified", async () => {
    const verified = await resolve(
      ctx(await issuer.mint({ sub: "u", extra: { email: "u@x.test", email_verified: true } })),
    );
    const unverified = await resolve(
      ctx(await issuer.mint({ sub: "u", extra: { email: "u@x.test", email_verified: false } })),
    );
    if (!isPrincipalResolution(verified) || !isPrincipalResolution(unverified)) {
      throw new Error("expected both resolved");
    }
    expect(verified.principal.email).toBe("u@x.test");
    expect(unverified.principal.email).toBeUndefined();
  });

  it("returns null for a FOREIGN issuer's token (not ours → fall through)", async () => {
    const other = await startFakeOidcIssuer({ audience: AUDIENCE });
    try {
      const foreign = await resolve(ctx(await other.mint({ sub: "user-anna" })));
      expect(foreign).toBeNull();
    } finally {
      await other.close();
    }
  });

  it("REJECTS a token with the wrong audience", async () => {
    const out = await resolve(ctx(await issuer.mint({ sub: "user-anna", aud: "some-other-api" })));
    expect(out).toEqual({ reject: true, reason: expect.any(String) });
  });

  it("REJECTS an expired token (beyond the 30s default clock skew)", async () => {
    const out = await resolve(ctx(await issuer.mint({ sub: "user-anna", expSeconds: -120 })));
    expect(out).toEqual({ reject: true, reason: expect.any(String) });
  });

  it("mints over HTTP POST /mint (the cross-container path) and resolves", async () => {
    const res = await fetch(`${issuer.issuer}/mint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sub: "user-http" }),
    });
    expect(res.ok).toBe(true);
    const { access_token } = (await res.json()) as { access_token: string };
    const out = await resolve(ctx(access_token));
    if (!isPrincipalResolution(out)) throw new Error(`expected resolved: ${JSON.stringify(out)}`);
    expect(out.principal.sub).toBe("user-http");
  });
});
