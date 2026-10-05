## Why

Plugin web apps served by the dashboard (`add-voice-wall-plugin` at `/apps/wall/`, `add-team-plugin` at `/apps/team/`) need three things core does not offer:

1. **Capability links.** A meeting participant opening a share link on their own phone over the tunnel is not genuine-local, not on a trusted network and not signed in. The universal network guard (`packages/server/src/auth/localhost-guard.ts:629` `createNetworkGuardHook`) denies every such request inside `/api/`. Its only in-namespace exceptions are `/api/health`, `/api/identity/login-config`, `PUBLIC_PAIRING_PREFIXES` and the user-configured `auth.bypassUrls` (`localhost-guard.ts:686-690`). A plugin cannot add a token-verified read-only exception, and `bypassUrls` is user config that disables auth for a prefix outright.
2. **Who is asking.** A plugin route cannot learn the signed-in caller's identity. `sessionPrincipalOf` (`packages/server/src/identity/session-access.ts:48`) is server-internal and `ServerPluginContext` (`packages/dashboard-plugin-runtime/src/server/server-context.ts:808`) exposes no equivalent. The wall needs it to attribute typing to signed-in, allow-listed people.
3. **One way to mount an app.** Each plugin hand-rolls `/apps/<id>/` static serving (`add-team-plugin` design D14), with no rule stopping one plugin from mounting another's path.

## What Changes

- **`ctx.registerCapabilityRoute({ prefix, verify })`**: a trusted plugin registers a public read-only prefix under its own `/api/plugins/<pluginId>/`.
  - Trusted means listed in `bundledPlugins` or in the config `auth.capabilityRoutePlugins`.
  - One early onRequest hook evaluates the verifier **once** per GET/HEAD whose raw and resolved targets both lie under the prefix, and stamps the result on the request.
  - Every admission check reads that stamp: identity floor, auth plugin, universal guard, per-route `ctx.networkGuard`, identity road gate.
- **`ctx.requestPrincipal(request)`**: the identity-plane principal, `{ kind: "local-operator" }`, or `null`. Read-only, trusted plugins only.
- **`ctx.serveApp({ dir, csp, appId? })`** (trusted plugins only): mounts a built SPA at `/apps/<appId>/`, skipped by the auth plugin.
  - `dir` is confined to the plugin's package, files are served from an extension allowlist, and `appId` must be unique.
  - CSP is required and is sent as an enforced header in every baseline mode.
  - `/apps/*` joins the guard's explicitly enumerated static-allow set.

## Capabilities

### New Capabilities
- `plugin-capability-routes`: capability prefix registration, single per-request admission stamp read by every check, request principal accessor, `/apps/<appId>/` mount.

### Modified Capabilities
- `trusted-networks`: public exceptions gain stamped capability GETs; the per-route guard factory honours the stamp; `/apps/*` joins the enumerated static-allow set.
- `baseline-content-security-policy`: a `serveApp` response keeps its app's enforced CSP in every baseline mode.
- `oauth-authentication`: the auth plugin's bypass list gains stamped capability requests and `/apps/<appId>/` mounts.

## Discipline Skills

- **`security-hardening`**: opens an unauthenticated path into `/api/`. Covers dot-segment smuggling (raw and resolved views), method restriction, verifier failure modes, the token oracle, and trust gating.
- **`doubt-driven-review`**: public plugin API plus a widened guard exception. Review before it stands.
- **`observability-instrumentation`**: log capability admissions and verifier rejections (count only, no token), and log registration and removal.
- **`review-code`**: before commit.
- Not triggered: `performance-optimization`. The verifier is a synchronous hash lookup on matching prefixes only.

## Impact

- `packages/server`: new `auth/capability-routes.ts` (registry, stamping hook), `auth/localhost-guard.ts` (hook exception + per-route factory), `auth/auth-plugin.ts`, `identity/identity-floor.ts`, `identity/identity-road-gate.ts`, `auth/csp.ts`, `server.ts` wiring, `src/__tests__/network-guard-namespace-coverage.test.ts` (enumerate `/apps/*`), config `auth.capabilityRoutePlugins`.
- `packages/dashboard-plugin-runtime`: `ServerPluginContext.registerCapabilityRoute`, `requestPrincipal`, `serveApp`.
- Consumers: `add-voice-wall-plugin` (share links, typing attribution, `/apps/wall/`). `add-team-plugin` may adopt `serveApp` and `requestPrincipal`.
- Compatibility: additive. With no registrations, every gate behaves exactly as today.
- Rollback: revert. Plugins that registered prefixes lose anonymous access, which fails closed.
