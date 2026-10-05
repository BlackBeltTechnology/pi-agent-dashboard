## Context

Admission inside `/api/` runs through **five** checks, each with its own closed list of exceptions:

| Check | Where | Kind | Public set today |
|---|---|---|---|
| Identity floor (identity enforced) | `packages/server/src/identity/identity-floor.ts:23`, hook at `packages/server/src/server.ts:1816` | onRequest | `PRE_AUTH_PATHS` (`/api/health`, `/api/identity/login-config`), GET/HEAD, both views |
| Auth plugin (OAuth configured) | `packages/server/src/auth/auth-plugin.ts:289-330` | onRequest | `/auth/*`, `PUBLIC_PAIRING_PREFIXES`, `/api/health`, `/api/identity/login-config`, `/v1/*`, `bypassUrls`, `bypassHosts` (raw `request.url` prefix) |
| Universal network guard | `packages/server/src/auth/localhost-guard.ts:629` `createNetworkGuardHook`, exception step `:686-690` | onRequest, registered last | `PUBLIC_IN_NAMESPACE_PATHS` (`/api/health`, `/api/identity/login-config`, GET/HEAD), pairing prefixes, `bypassUrls`, all held on both views (`openspec/specs/trusted-networks/spec.md`) |
| Per-route network guard | `createNetworkGuard` (`localhost-guard.ts:344-374`), handed to plugins as `ctx.networkGuard` (`packages/dashboard-plugin-runtime/src/server/server-context.ts:1152`) and attached as `preHandler` by plugins, e.g. `packages/goal-plugin/src/server/routes.ts:171` | preHandler | none |
| Identity road gate (identity enforced + host policy) | `packages/server/src/identity/identity-road-gate.ts:41-63`, registered at `server.ts:1880-1891` | preHandler | session/identity roads; a non-session road with a host policy needs a principal |

The host gate (`packages/server/src/auth/host-gate.ts`, registered first at `server.ts:1731`) runs before all five. It admits live tunnel origins (`host-gate.ts:347`).

Plugins get the root Fastify instance (`ServerPluginContext.fastify`, `server-context.ts:809`) and mount `/api/plugins/<id>/*`. A plugin is in-process code with the root instance: it could add its own hooks. Every rule below is therefore **API guardrails against accidents, not a boundary against a malicious plugin**.

The trusted-plugin precedent is the resolver registry. It accepts only the bundled resolver or a plugin named in `identity.trustedResolverPlugins` (`packages/server/src/identity/resolver-registry.ts:62`, used at `server.ts:3370-3377`). `manifest.priority` is a render-order knob and explicitly not trust (`server.ts:3322-3326`). The bundled plugin list is `packages/server/package.json#piDashboard.bundledPlugins`.

The request principal is `request.principal` (resolver hook). `sessionPrincipalOf` (`packages/server/src/identity/session-access.ts:48`) adds the D23 local operator. Nothing in `ServerPluginContext` exposes either.

CSP (`packages/server/src/auth/csp.ts:55-64`) emits only the active mode's header and preserves a header of that same name. In `report` mode the spec forbids an enforcing header on own paths (`openspec/specs/baseline-content-security-policy/spec.md`, "Mode-dependent header emission").

## Goals / Non-Goals

**Goals:** a trusted plugin can admit token-bearing anonymous GETs under its own namespace; every admission check agrees by construction; plugins can read who is asking; one guarded way to mount `/apps/<appId>/`.

**Non-Goals:** token storage, minting or expiry (the plugin's job); unsafe methods on capability prefixes; WebSocket admission (plugin WS stays genuine-local, `openspec/specs/plugin-ws-route`); a sandbox against malicious plugins; migrating Team.

## Decisions

**D1. One evaluation per request, read by every check.**
- `packages/server/src/auth/capability-routes.ts` holds the registry plus one onRequest hook registered **right after the host gate**, before the identity floor.
- The hook parses the target (`parseGuardTarget`, `localhost-guard.ts:477`). It finds the single prefix `p` with `raw.startsWith(p) && resolved.startsWith(p)`. On a GET/HEAD it calls that prefix's verifier **once**.
- It stamps `request.capability = { pluginId, prefix }` on acceptance, else `null`.
- All five checks read only the stamp: the floor, the auth plugin, the universal guard (as a fourth public-exception term), the per-route guard (as a fifth pass condition), and the road gate (as an exemption).
- No check calls the verifier, so a verifier cannot be judged twice or differently.
- Rejected: calling the predicate inside each check. The guard alone applies its exception test to both views, so the verifier would run 3–5 times per request, and a stateful verifier would make the checks disagree.
- Rejected: plugin-managed `bypassUrls`. These disable auth for the prefix wholesale and are user config.
- Rejected: a plugin path outside `/api/`. It would sidestep the guard.

**D2. Registration rules.**
- The plugin id must match `^[a-z0-9-]+$`.
- `prefix` must satisfy `prefix.startsWith("/api/plugins/" + pluginId + "/")` (a literal check, no regex interpolation), end with `/`, and have segments matching `[a-z0-9-]+`.
- A prefix nested in, or containing, an already registered prefix throws, so selection is unambiguous.
- **Trust** (shared by D2, D4, D5): a plugin is trusted when its **package directory name** is in `bundledPlugins` (the list holds directory names such as `goal-plugin`, not manifest ids; `packages/electron/scripts/bundle-server.mjs:137`), or its **manifest id** is in the config `auth.capabilityRoutePlugins: string[]` (default `[]`). The list is read when plugins activate, which is restart-effective like activation itself. An untrusted plugin gets an inert handle and one warning. `auth.capabilityRoutePlugins` alone counts as auth content for `parseAuthConfig` (`packages/shared/src/config.ts:1263`), so it is not dropped.
- Registrations are tracked per plugin, like `IdentityRegistrationTracker` (`server.ts:556-563`). They are swept on disable, teardown and failed activation, and a later activation may register again.

**D3. Verifier contract.**
- `verify(request): boolean` is synchronous, pure (no state changes, the same answer for the same request) and cheap: a header read plus a lookup. It runs before body parsing. It has no access to the reply.
- A throw means deny, plus one warning.
- Credentials belong in headers. For requests under a registered prefix, the guard's denial line logs only the prefix, not the rest of the path, so a token a plugin wrongly put in the path is never logged.
- A rejected capability request is not a network-policy event: it is neither recorded in the denial ring buffer nor raises a trust-network prompt (`localhost-guard.ts:299-311`, `openspec/specs/network-denial-ring-buffer`).
- Core logs capability admits at debug level. It logs capability rejects at warn level, rate-limited to one line per prefix per minute with a count, never with header or query values.
- A rejected request continues to the normal checks. Their own per-request denial lines (e.g. the guard's `[network-guard] denied`) are unchanged.

**D4. `ctx.requestPrincipal(request)`.** Returns:
- `{ kind: "principal", iss, sub, name? }` when `request.principal` is set;
- `{ kind: "local-operator" }` when `sessionPrincipalOf` returns `LOCAL_OPERATOR`, or when identity is inert and the request is genuine-local or carries the local token;
- `null` otherwise. The auth plugin's session cookie is admission, not identity.

Trust-gated (D2): it exposes principal claims, so an untrusted plugin always gets `null`. In inert identity with the OAuth cookie, a remote signed-in operator is `null`: only the local operator is identified. Consumers state this in their UI.

**D5. `ctx.serveApp({ dir, csp, appId? })`.**
- Trust-gated (D2); an untrusted plugin's call mounts nothing and logs once. `appId` defaults to the plugin id and must match `^[a-z0-9-]+$`. It is unique: a second mount of an id throws. Because only trusted plugins can mount, an untrusted plugin cannot squat a trusted app's id.
- `dir` must realpath inside the plugin's own package root.
- `csp` is required.
- Mounts `GET`/`HEAD /apps/<appId>` (308 redirect to the trailing slash) and `/apps/<appId>/*`.
- Serves realpath-confined files under `dir` with an extension allowlist: `.html .js .mjs .css .svg .png .jpg .jpeg .gif .webp .ico .woff .woff2`. `.json`, `.map`, dotfiles and directories are refused, so a stray `config.json` or source map is never served.
- Unmatched paths fall back to `index.html`. Files with a content-hash name get `immutable`; `index.html` gets `no-store`. A missing build returns 503, logged once.
- Every file response (assets and `index.html`) carries `csp` as an enforced `Content-Security-Policy`.
- Once per process: plugin activation is restart-effective (`packages/server/src/routes/plugin-activation-routes.ts:275-281`).
- `/apps/*` stays outside guard jurisdiction. Mounts are recorded in a mount registry (like `getWsRouteRegistry`), which the namespace-coverage test consults with prefix matching, so only `serveApp` mounts pass (`trusted-networks` delta).
- **The auth plugin skips registered mounts.** Its onRequest hook has no jurisdiction limit (`auth-plugin.ts:289-347`) and would otherwise redirect a participant's phone to `/auth/login`. The mount carries no data. (`add-team-plugin` D14's "loads unauthenticated" claim has the same gap; noted for that change.)
- Team's D14 recipe (`openspec/changes/add-team-plugin/design.md:376-405`) is the basis, adding `appId`, the allowlist, required CSP and `dir` confinement.

**D6. The identity floor and the road gate honour the stamp.** With identity enforced, "every browser road requires a principal" (D24) gains one exception: a stamped capability GET. The same holds for the road gate's host-policy branch. A share link is a credential scoped by its plugin, in the same class as the pairing code. Bundled plugins are trusted by membership, so a host that wants no anonymous access disables the plugin, or its share feature (the wall's `shareLinks.enabled`). `auth.capabilityRoutePlugins` only adds trust for non-bundled plugins.

**D7. An app's own CSP is permitted alongside the baseline.** A response from a `serveApp` mount carries the app's enforced `Content-Security-Policy` in every baseline mode. In `report` mode the baseline `-Report-Only` header is also added. In `off` mode no baseline hook exists, and `serveApp` sets the app's header itself. The baseline's mode governs the dashboard's own pages. An app that declared its own policy keeps it. This is a MODIFIED delta of "Mode-dependent header emission".

## Risks / Trade-offs

- **[Risk] Dot-segment smuggling.** The stamp requires both views under one prefix, the pairing-exception rule. → Tests reuse the guard's smuggling corpus.
- **[Risk] Verifier bug opens the namespace.** Bounded to GET/HEAD in the plugin's own namespace; a throw denies.
- **[Risk] Token oracle.** Refusals are the normal checks' denials; core adds no capability-specific shape.
- **[Risk] Host gate refuses the origin first.** A share link over a tunnel that is not live in the host gate never reaches the stamp. → Documented. Live tunnel origins are admitted by default.
- **[Trade-off] Floor and road-gate exception under enforced identity (D6).** Accepted, with an explicit allowlist.
- **[Trade-off] Not a boundary against malicious plugins.** Stated in Context. The trust list limits accidental use of a sensitive API.

## Migration Plan

Additive. With no registrations and no `serveApp` mounts, every check behaves exactly as today. Rollback: revert; consumers fail closed.

## Open Questions

None.
