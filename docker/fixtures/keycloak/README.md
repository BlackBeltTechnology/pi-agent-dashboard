# Keycloak realm reference — identity-plane E2E (§11.2)

**The dashboard never ships or boots Keycloak.** You run your own IdP and point
the `keycloak-resolver` plugin at it — every provider field (issuer, audience,
azp, jwksUri, clock skew, allowInsecureHttp) is a plugin setting, defined in
`packages/keycloak-resolver-plugin/src/configSchema.json`. Nothing is hardcoded.

This directory holds only an **importable realm reference** for wiring the plugin
against a *real* Keycloak (production onboarding).

> **The identity-plane E2E does NOT use this Keycloak.** It uses a lightweight
> in-process fake OIDC issuer
> (`packages/shared/src/test-support/fake-oidc-issuer.ts`) — real RS256 keypair,
> real discovery + JWKS, so the resolver's verification path stays fully
> exercised without booting Keycloak (mainstream best practice for testing token
> validation). See `docker/compose.test.identity.yml` +
> `scripts/fake-oidc-run.ts`. This realm remains a one-time confidence
> check that the resolver works against a genuine Keycloak
> (`live-resolver-check.ts`, validated once).

## Contents

| File | Purpose |
|---|---|
| `realm-identity-plane.json` | Importable realm `pi-identity`: public PKCE client `dashboard-web` (S256, direct-grant on for the token helper) with a client-level `oidc-audience-mapper` → `pi-dashboard`; users `anna`/`bela` (full name + verified email so KC 26's declarative User Profile lets them log in). Import into YOUR Keycloak. |
| `../../compose.test.identity.yml` | Opt-in overlay that only WIRES the harness to your external Keycloak via `PI_E2E_IDENTITY_ISSUER`/`_AUDIENCE` env. Boots no Keycloak. |
| `live-resolver-check.ts` | Dev-only: drives the real `keycloak-resolver` against a running Keycloak (mirrors the plugin's wiring) and asserts anna/bela resolve to distinct principals + a foreign-issuer token is rejected. `KC=http://localhost:18080 npx tsx docker/fixtures/keycloak/live-resolver-check.ts` after minting `/tmp/tok-{anna,bela}.json`. |

> Realm design notes (learned by live-testing against KC 26): each user needs
> `firstName`+`lastName`+verified `email` or password grant fails with "Account
> is not fully set up"; and the audience must be a **client-level** protocol
> mapper — declaring a custom `clientScopes` array in the import suppresses the
> built-in `basic` scope, dropping the `sub` claim the identity plane keys on.

## Bring your own Keycloak

1. Start a Keycloak however you like (standalone container, hosted, shared dev
   instance). Example, entirely separate from the dashboard:

   ```bash
   docker run --rm -p 18080:8080 \
     -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
     -v "$PWD/realm-identity-plane.json:/opt/keycloak/data/import/realm.json:ro" \
     quay.io/keycloak/keycloak:26.0 start-dev --import-realm
   ```

2. Point the harness at it and merge the overlay:

   ```bash
   cd docker
   PI_E2E_IDENTITY_ISSUER=http://host.docker.internal:18080/realms/pi-identity \
   PI_E2E_IDENTITY_AUDIENCE=pi-dashboard \
   docker compose -f compose.test.yml -f compose.test.identity.yml up -d --build
   ```

   (A host-run Keycloak needs an `extra_hosts: host.docker.internal:host-gateway`
   mapping on the dashboard service, or use a reachable LAN/hosted URL.)

3. A real (non-test) user does the same wiring through the dashboard UI:
   **Settings ▸ Plugins ▸ keycloak-resolver** — set issuer + audience to their
   own Keycloak. `PI_E2E_IDENTITY` is only the test-harness seed shortcut for
   the same plugin config.

Mint a fixture token (ROPC direct grant) against your instance:

```bash
curl -s -X POST \
  "http://localhost:18080/realms/pi-identity/protocol/openid-connect/token" \
  -d grant_type=password -d client_id=dashboard-web \
  -d username=anna -d password=anna-pw -d scope=openid | jq -r .access_token
```

## Remaining to green (needs a running Keycloak — see task §11.2)

1. **`test-entrypoint.sh` `PI_E2E_IDENTITY` seed path** — DONE (minimal): writes
   the keycloak-resolver plugin config (`enabled`, `issuer`, `audience`,
   `allowInsecureHttp`) + adds it to `identity.trustedResolverPlugins`, so the
   plane activates and session owner-gating enforces the primary two-user
   isolation. Flag-gated (`PI_E2E_IDENTITY=1`), merge-preserving, idempotent.
   STILL DEFERRED: the `fixture-policy` trusted-policy seed for the secondary
   domain-event fan-out assertion — it needs Anna's `sub`, resolved by minting
   a token at boot against your Keycloak.
2. **Playwright specs** (`tests/e2e/identity-*.spec.ts`) — (a) two users log in
   via PKCE; (b) two-user HTTP + WS isolation across bootstrap, list, detail,
   subscribe, replay, command, and (with the fixture policy) domain-event
   fan-out, using `helpers/identity-tokens.ts` to mint bearers. Assert a
   non-owner (Béla) reaches none of Anna's sessions or events.
3. **Live validation** — point the harness at your Keycloak and iterate until
   the suite is green (realm import + resolver activation + policy trust are
   only fully verifiable against a running Keycloak).

The trusted policy plugin itself (`packages/fixture-policy-plugin`) is complete
and unit-tested; the token helper (`tests/e2e/helpers/identity-tokens.ts`) and
this realm are ready for the specs above.
