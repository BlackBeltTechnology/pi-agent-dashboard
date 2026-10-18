# identity-auth-plugin-guide.md — identity auth plugin index

Pull-only condensed map. Source: `docs/identity-auth-plugin-guide.md`. Dashboard AUTH plugin: login UI and/or authorization policy. Ground truth: change `add-multi-user-identity-plane`.

## 1. Three-way split (D18)
- Core: `login-provider` slot, `/login` `/logout`, `GET /api/identity/login-config`, owner gate, policy dispatch. No login UI.
- `keycloak-resolver`: token validation only (RFC 9068 + DPoP). Bearer → `(iss, sub)`.
- Your plugin: login UI and/or policy. Browser = user app; dashboard = resource server (D20).
- Flow: `loginUrl` → IdP PKCE → `returnTo#pi_handoff=code` (≤60 s) → `tokenUrl` → bearer → resolver → owner gate / policy.

## 2. Trust and activation
- Trust = operator config, never `manifest.priority` (orders resolvers only).
- Config `~/.pi/dashboard/config.json`; plugin config `plugins.<id>.*` (`ctx.getPluginConfig()`).
- `identity.trustedResolverPlugins: string[]`. `keycloak-resolver` always trusted.
- `identity.trustedPolicyPlugin?: string`. Unset → no policy → non-session roads ungated.
- `identity.resolverTimeoutMs` 2000 [100, 5000]. `identity.policyTimeoutMs` 500 [50, 2000].
- ENFORCED ⇔ trusted resolver active AND trusted login descriptor. Decided before `listen()`, latched. Runtime toggle = no-op.
- Disarm (`identity/activation.ts`, `isIdentityEnforced`): absent or duplicate policy; active `auth.providers` (D8); resolver with no login provider. Reason logged.
- Throwing plugin → registrations released (`IdentityRegistrationTracker`).

## 3. Login plugin (separate-view, D19/D20/D22/D25)
- Own pages. No client bundle. `claims: []`. No rebuild.
- Manifest `package.json#pi-dashboard-plugin`: `id`, `claims`, `priority`, `server: ./server.mjs`, `configSchema`.
- Drop dir `~/.pi/dashboard/plugins/<id>/` (`findInstalledPluginsDir()`, `loader.ts`).
- Routes on `ctx.fastify` OUTSIDE `/api/`, `/v1/`, `/editor/`, `/live/`.
- Unconfigured → register nothing. Feature-detect `ctx.registerBrowserLoginConfig`.

### Descriptor
- Host stamps `pluginId`. Returns unregister handle.
- `loginUrl`: same-origin path, sign-in entry.
- `logoutUrl`: same-origin path. Never falls back to `loginUrl`.
- `tokenUrl?`: POST `{code, verifier}` → `{access_token, expires_in, id_token?}`.
- `postLogoutUrl?`, `label?` (cap 40), `endsProviderSession?`, `silentSignIn?`.

### Sanitization (`sanitizeBrowserLoginConfig`)
- URLs: same-origin PATH only. Reject absolute, `//host`, origin-less, `/callback`, `/logout`.
- Need `issuer`+`clientId` (component) OR `loginUrl` (separate-view). Else `null`.
- Unknown fields dropped. Booleans strict.

### D22 handoff (no cookies)
- SPA: PKCE `verifier` in `sessionStorage`. Navigates `loginUrl?returnTo=&challenge=`.
- OAuth `state`, PKCE, `returnTo` in plugin server state.
- Redirect `returnTo#pi_handoff=<code>`. Single-use, ≤60 s, bound to `challenge`.
- SPA strips fragment, POSTs `tokenUrl`. Bearer memory only. Never localStorage, URL, cookie.
- `Authorization: Bearer` on REST and `POST /api/ws-ticket`. No refresh token.
- Logout → `logoutUrl?returnTo=` → IdP session end → `postLogoutUrl`.
- `returnTo`: same-origin, not `/callback`, not `/auth/login`. Else `/`.

### Silent sign-in and several providers
- `silentSignIn: true` → `prompt=none`. No session → `#pi_login_error=login_required`. Once per load.
- `BrowserLoginConfigRegistry.list()` → `GET /api/identity/login-config` → `{active, providers:[...]}`.
- Handoff redeemed at starting provider's `tokenUrl`. No descriptor → `{active:false}`.

## 4. Custom resolver
- Only if plugin in `identity.trustedResolverPlugins`. Feature-detect `ctx.registerPrincipalResolver`.
- `PrincipalResolverFn(ctx: AuthContext) → Promise<ResolverOutcome>`.
- Outcomes (D5): `{principal:{iss,sub,email?}, expiresAt}` claim · `null` not mine · `{reject:true, reason?}` mine + invalid → 401.
- `AuthContext` = `{method, url, authorization?, cookie?, dpop?, isAuthenticated, ip}`. Never raw request.
- Claim own issuer only. Foreign `iss` → `null`. Owned-invalid → `reject`. Never throw.
- Validate: non-empty `iss`/`sub`, future finite `expiresAt`, bounded lengths.
- Order `(manifest.priority asc, pluginId asc)`. Import `@blackbelt-technology/pi-dashboard-shared/identity.js`.

## 5. Authorization

### (a) Session roads — core-enforced, not policy
- Owner `principalOwner: {iss, sub}`. Exact equality (`principalEquals`). No email fallback. Deny = 404.
- Covers HTTP + WS: detail, transcript, mutation, bootstrap, list (per item), subscribe, replay, inbound commands.
- Ownerless hidden from humans. Principal-less socket refused owned sessions.
- Gate `identity-road-gate.ts` (preHandler, task 18.28).
- Owner set only via trusted roads: browser `spawn_session` (`ws.principal`), host HTTP spawn (`request.principal`), trusted policy owned-spawn API. `cwd` never signal.

### (b) Host access policy — non-session only
- `HostAccessPolicyFn({principal, action, resource}) → Promise<boolean>` (`packages/shared/src/identity.ts`). One per host.
- Register `ctx.registerHostAccessPolicy(authorize)` from `identity.trustedPolicyPlugin`.

#### Central gate (`identity/identity-road-gate.ts`)
Classification `identity/http-road-classification.ts`: route PATTERN → road.

| Road | Match | Decision |
|---|---|---|
| `identity` | `/api/health`, `/api/ws-ticket`, `/api/identity/*` | never gated |
| `session` | `:id`/`:sessionId` under `/api/session(s)`, `/api/events`, `/api/session-change` | owner equality → 404 |
| `session-handler` | lists, `/api/session-diff`, `/api/session-file`, archived | in handler |
| `non-session` | everything else | policy → 403 |
| unclassified | — | 403, audit `unclassified` |

- Inert → no-op. No policy → ungated (D24). Policy loaded: local operator bypasses; principal-less → 403 `{success:false,error:"forbidden"}`.
- Session roads never consult policy. `POST /api/session/spawn` = `workspace.write`.

#### Naming (`identity/host-resources.ts` `HostActions`)
- `<family>.read` (GET/HEAD) / `<family>.write`. Families: `workspace openspec branch terminal files config providers plugins packages access gateway system`. Plus `terminal.create`, `domain.event`.
- HTTP resource `{kind, route}` (pattern, never URL).
- Plugin: `plugin:<id>:read|write`, resource `{kind:"plugin", pluginId, route}`.

#### Plugin routes (D24)
- `/api/plugins/<id>/…` by path. Else loader `begin(id)`/`end()` + Fastify `onRoute` (`identity/route-owner-registry.ts`).
- Core plugin mgmt → `plugins.read|write`.

#### WS gate (D14/D24)
- `pairing/browser-gateway.ts` + `classifyWsRoad` (`identity/ws-road-classification.ts`).
- `plugin_action` → `plugin:<msg.pluginId>:write`. Custom frames → `plugin:<registering id>:write`.
- Principal-less socket dropped. Deny = silent drop. Session frames never consult policy.
- Fail closed: `false`/throw/timeout/non-boolean → DENY + audit (`PolicyRegistry`).
- Policy: pure, fast, no I/O.

#### `GET /api/identity/me` (advisory)
- `{enforced, principal|null, localOperator, can:{<action>:bool}}`. `email` omitted if absent. `domain.event` excluded. UI hint only.

#### Example
- Role table keyed `iss|sub`. Admin all. Others: `*.read`, own `plugin:myproduct:` prefix. Default deny.
- Reference: `packages/fixture-policy-plugin/src/server/{index.ts,policy.ts,config.ts}`.

### (c) Product RBAC — your plugin
- Read `request.principal` untyped (`identity/resolver-hook.ts`; also `principalExpiresAt`, `isAuthenticated`).
- No policy → `true` = D24 floor. Add own checks.
- Plugin routes get host policy `plugin:<id>:<verb>` first.

### Not yet live
- 18.27: `ctx.identity` seam `{isEnforced, principalOf, authorize, userDataDir}`. Absent.
- 18.37: WS bootstrap disclosure gate; `deliverDomainEvent` wiring; classify `/editor/`, `/live/`; non-auditing `/api/identity/me` probe.

## 6. Break-glass (D23)
- Network position ≠ identity. Loopback not exempt while enforced.
- Principal `local-operator` (`urn:pi-dashboard:local-operator`). Short-lived, warn-logged.
- Implemented: host-only `local-token` → `LOCAL_OPERATOR` on session roads (`identity/session-access.ts`).
- Planned (18.23/18.24): `pi-dashboard login --local`. Token `~/.pi/dashboard/local/token` (0700 dir, 0600 file). One-time code ≤60 s → `?pi_local=<code>`.
- CLI today: `start stop restart status runtime` (`packages/server/src/cli.ts` `SUBCOMMANDS`).
- NEVER localhost bypass: sidecar, LB, `ssh -L`, `kubectl port-forward` all arrive `127.0.0.1`.

## 7. Testing
- Policy unit: `packages/fixture-policy-plugin/src/server/__tests__/policy.test.ts`.
- E2E: `tests/e2e/identity-matrix/` (`npm run test:e2e:identity-matrix`, opt-in). Scenarios A–K.
- Spike: `spike/identity-login-plane/` tests, `lan-e2e.mjs`, `two-user-e2e.mjs`.
- Resolver: `packages/keycloak-resolver-plugin/src/__tests__/`.
- Checklist: exact issuer string; no tokens in URLs/storage/logs/cookies; same-origin redirects, no logout→login fallback; fail closed (reject, default-deny, bounded timeouts, no 500); output-validate principals; `email` = label, never key.

## 8. References
- Specs `openspec/changes/add-multi-user-identity-plane/specs/`: `principal-resolution`, `keycloak-principal-resolver`, `host-access-policy`, `browser-principal-client`, `dashboard-shell-slots`, `session-ownership-scoping`, `websocket-principal-binding`, `permissioned-event-fanout`.
- Design D9, D11, D14, D18–D25 in `design.md`.
- Code: `packages/shared/src/identity.ts`, `packages/shared/src/config.ts`, `packages/server/src/identity/*.ts`, `packages/dashboard-plugin-runtime/src/server/server-context.ts`.
- See change: `add-multi-user-identity-plane`.
