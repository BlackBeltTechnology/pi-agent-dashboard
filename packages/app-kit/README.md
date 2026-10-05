# @blackbelt-technology/pi-dashboard-app-kit

Client plumbing for a **standalone SPA on its own origin** (e.g. `team.example.com`)
that talks to a pi-dashboard host (e.g. `dash.example.com`):

- runtime dashboard endpoint (`/config.json`) — one static build, any host
- identity modes from the host's login descriptor (`oidc` / `none`, fail-closed otherwise)
- OIDC Authorization Code + PKCE public-client config (`oidc-client-ts`, `react-oidc-context`)
- bearer-carrying `fetch` that never sends cookies and never leaks the bearer to another origin
- single-use `browser`-scope WebSocket tickets — the bearer never appears in a URL
- a reconnecting socket that mints a fresh ticket per attempt

Two entries:

| Entry | Contents | Imports React? |
|---|---|---|
| `@blackbelt-technology/pi-dashboard-app-kit` | `loadAppConfig`, `configureDashboard`, `apiUrl`, `wsUrl`, `initIdentity`, `fetchLoginDescriptor`, `authedFetch`, `mintWsTicket`, `ticketSocketUrl`, `connectWithReconnect`, identity state | no |
| `@blackbelt-technology/pi-dashboard-app-kit/react` | `buildOidcConfig`, `OidcIdentityBridge`, `IdentityProvider`, `useIdentity`, `useOptionalIdentity`, `operatorFromUser` | yes (peer) |

## Install

```bash
npm install @blackbelt-technology/pi-dashboard-app-kit react
```

## Configure

Serve a `config.json` next to `index.html`:

```json
{ "dashboardUrl": "https://dash.example.com" }
```

An absent or empty `dashboardUrl` means "the page's own origin". The file must be a
JSON object: a `404`, an HTML body (SPA fallback), a network error or a non-object
fails with `AppKitError` code `app_config_unavailable`. Pass `{ allowMissing: true }`
behind a dev proxy to treat a `404` / HTML body as same origin. A non-`http(s)` or
userinfo-bearing `dashboardUrl` fails with `invalid_dashboard_url`.

## Boot

```tsx
import { AuthProvider } from "react-oidc-context";
import { initIdentity, loadAppConfig, connectWithReconnect, ticketSocketUrl } from "@blackbelt-technology/pi-dashboard-app-kit";
import { OidcIdentityBridge, buildOidcConfig } from "@blackbelt-technology/pi-dashboard-app-kit/react";

await loadAppConfig();
const login = await initIdentity(); // sets the identity mode

const app =
  login.mode === "oidc" ? (
    <AuthProvider {...buildOidcConfig(login.descriptor, { redirectUri: `${location.origin}/auth/callback` })}>
      <OidcIdentityBridge providerLabel={login.descriptor.label}>
        <App />
      </OidcIdentityBridge>
    </AuthProvider>
  ) : login.mode === "none" ? (
    <OidcIdentityBridge>
      <App />
    </OidcIdentityBridge>
  ) : (
    <SignInUnavailable />
  );

// Sockets: a fresh single-use ticket per (re)connect.
connectWithReconnect({
  url: "/ws",
  resolveUrl: () => ticketSocketUrl("/ws"),
  onStatus, onOpen, onMessage,
});
```

Identity modes:

| Mode | When | Requests |
|---|---|---|
| `unknown` | descriptor not read yet | none (`NoCredentialError`) |
| `oidc` | descriptor active with `issuer` + `clientId` | `Authorization: Bearer` to the dashboard origin only; none without a token |
| `none` | descriptor `{active:false}` | plain; a dashboard `401`/`403` throws `NotAdmittedError` (`not_admitted`) |
| `unavailable` | descriptor read failed / malformed / active without `issuer`+`clientId` | none — never falls back to `none` |

Roles are an app concern: pass `resolveRole={(op) => …}` to `OidcIdentityBridge`.

## Host prerequisites

The kit changes nothing on the host; the deployment must provide:

- **CORS**: the app origin in the dashboard's `cors.allowedOrigins` (REST and WS).
- **Host admission**: the dashboard host in `allowedHosts` / `publicBaseUrls`.
- **HTTPS** for the app and the dashboard: PKCE needs `crypto.subtle` (secure context).
- **Identity plugin** publishing the browser login config (`GET /api/identity/login-config`
  returns `{ active: true, issuer, clientId }`).
- **OIDC client**: public (no secret), standard flow + PKCE, the **exact** redirect URI
  registered, silent renew allowed, and an **audience mapper** so access tokens carry the
  audience the host's resolver requires (the Keycloak resolver checks `audience` exactly).
- **`none` mode** only from loopback or a trusted network: the host admits a
  credential-less caller only there.

## Security notes

- The access token is held in `sessionStorage` (per issuer + client), readable by
  script on the app origin. Ship a **strict Content-Security-Policy** (no inline
  script, `connect-src` limited to the dashboard and the issuer).
- Requests always use `credentials: "omit"`; the bearer and WS tickets are attached only
  to URLs on the dashboard origin.

## Provenance

Ported and generalised from InvoiceBot's finance SPA
(`BlackBeltTechnology/invoice-bot-dashboard`, `src/auth/*`, `src/reconnecting-socket.ts`);
signatures stay compatible with its call sites. See OpenSpec change
`extract-standalone-app-kit`.
