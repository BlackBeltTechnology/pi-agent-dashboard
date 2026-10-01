/**
 * Identity-plane token-minting helper for the §11.2 E2E specs
 * (openspec: add-multi-user-identity-plane).
 *
 * Mints access tokens from the lightweight fake OIDC issuer
 * (`@blackbelt-technology/pi-dashboard-shared/test-support/fake-oidc-issuer`),
 * NOT a real Keycloak. The issuer runs inside the harness container so the
 * in-container resolver can discover it; the host mints over its `POST /mint`
 * endpoint. This exercises the resolver's real discovery + JWKS + RS256 verify
 * path (the fidelity that matters) with zero Keycloak dependency — the
 * mainstream best practice for testing token VALIDATION (cf. oauth2-mock-server).
 *
 * Tokens carry stable `sub`s so ownership assertions are deterministic (unlike
 * Keycloak's random UUIDs). The interactive PKCE browser flow is a separate
 * login spec; these bearers drive the HTTP + WS isolation specs directly.
 */

/** Seeded fixture users → their stable `sub` (the identity-plane ownership key). */
export const FIXTURE_USERS = {
  anna: { sub: "user-anna" },
  bela: { sub: "user-bela" },
} as const;

export type FixtureUser = keyof typeof FIXTURE_USERS;

/**
 * Base URL of the harness fake OIDC issuer (host-mapped port). The E2E harness
 * publishes the in-container issuer port and exports it as PW_IDENTITY_ISSUER_URL.
 */
export function fakeIssuerBaseUrl(): string {
  const port = process.env.PW_IDENTITY_ISSUER_PORT ?? "18090";
  return process.env.PW_IDENTITY_ISSUER_URL ?? `http://localhost:${port}`;
}

/**
 * Mint an access token for a fixture user via the issuer's `/mint` endpoint.
 * Throws on a non-2xx response so a misconfigured harness fails the spec loudly
 * instead of silently issuing an anonymous request.
 */
export async function mintToken(user: FixtureUser): Promise<string> {
  const { sub } = FIXTURE_USERS[user];
  const res = await fetch(`${fakeIssuerBaseUrl()}/mint`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sub }),
  });
  if (!res.ok) {
    throw new Error(`mintToken(${user}) failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error(`mintToken(${user}) returned no access_token`);
  return json.access_token;
}

/** Authorization header for a fixture user's bearer token. */
export async function bearerHeader(user: FixtureUser): Promise<{ Authorization: string }> {
  return { Authorization: `Bearer ${await mintToken(user)}` };
}
