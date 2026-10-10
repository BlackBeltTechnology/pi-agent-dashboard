# DOX — packages/server/src/identity

Files in this directory. One row per source file. Multi-user identity plane (See change: add-multi-user-identity-plane).

| File | Purpose |
|------|---------|
| `__tests__/ws-message-tiers.test.ts` | `WS_MESSAGE_TIERS` equals SESSION_OWNED ∪ SESSION_LIST ∪ NON_SESSION (total over protocol); unlisted ⇒ operate; REST-parity spot checks. See change: add-passkey-user-auth. |
| `activation.ts` | D21 self-lockout guard. `isIdentityEnforced` / `identityDisarmedWarning` over `{resolverActive, loginProviderRegistered, legacyConnectorsActive, trustedPolicyPlugin, registeredPolicyCount}`. Armed only when fully configured; never aborts boot. |
| `auth-context.ts` | `buildAuthContext`: curated bounded `AuthContext` handed to resolvers (never the raw request). |
| `bootstrap-grants.ts` | Per-socket policy grants for non-session state. `decideBootstrapGrants(principal, policy)` → `{workspace,openspec,branch,terminal}`; `FRAME_FAMILY` maps frame type → family. Decided at WS upgrade, applied synchronously by the gateway. Operator ⇒ all; no principal ⇒ none; policy fault ⇒ deny. See change: add-multi-user-identity-plane (18.37a). |
| `break-glass.ts` | D23 `BreakGlass`: single-use ≤60 s code (`issueCode`/`redeem`), 1 h `pi_op_` operator bearer (`resolveBearer`). SHA-256 at rest, bounded, per-instance, in-memory. Resolves to frozen `LOCAL_OPERATOR`. |
| `browser-login-auth-status.ts` | `/auth/status` body when no legacy cookie auth: identity-aware, principal `{sub,name?,email?}`. |
| `browser-login-config-registry.ts` | Login descriptor registry (all trusted providers, load order) + `sanitizeBrowserLoginConfig` (same-origin only) + `publicLoginConfig` for `GET /api/identity/login-config`. |
| `dispatch.ts` | First-claim-wins resolver walk (claim / reject / none), bounded timeout, validate/copy/freeze via `principal-guard`. |
| `domain-fanout.ts` | `deliverDomainEvent`: policy-driven per-socket send of plugin domain events; operator bypass; no policy ⇒ plain broadcast. |
| `host-access.ts` | `HostPolicy` interface (`authorize({principal,action,resource,probe?})`) + `gateHttpNonSession`. |
| `host-resources.ts` | `HostActions` constants + `hostResource` descriptors. Families incl. `editor.write`, `live.read`, `live.write`. |
| `http-road-classification.ts` | `classifyHttpRoad(method, routePattern)` → identity / session / session-handler / non-session `{action,resource}`. Covers `/api/*`, `/editor/` (`editor.write`), `/live/` (`live.read` / `live.write`). `users` segment → `access`. See change: add-passkey-user-auth. |
| `identity-floor.ts` | D24 signed-out floor: enforced + no principal ⇒ `/api/`,`/editor/`,`/live/` 401 except pre-auth GETs and the one break-glass `POST /api/identity/local-exchange`. |
| `identity-me.ts` | `GET /api/identity/me` payload `{enforced, principal, localOperator, can}`. Uses `probe:true` so UI probes are never audited. |
| `identity-registration-tracker.ts` | Per-plugin ledger of identity registrations; releases a failed plugin's; `freeze()` latches after boot. |
| `identity-road-gate.ts` | Central `preHandler`: session routes ⇒ owner equality (404); non-session (`/api/`,`/editor/`,`/live/`) ⇒ optional policy (403); operator passes. |
| `plugin-identity.ts` | `createPluginIdentity(pluginId, deps)` = `ctx.identity` consumer seam: `isEnforced`, `principalOf`, `principalOfUpgrade`, `authorize` (namespaced `plugin:<id>:<action>`), `userDataDir` (`users/<sha256(iss,sub)>` 0700). See change: add-multi-user-identity-plane (18.27). |
| `policy-registry.ts` | The ONE host access policy: trust by `identity.trustedPolicyPlugin`, bounded, fail-closed, audited denies; `probe:true` decides without auditing. |
| `principal-guard.ts` | `sanitizePrincipalResolution`: validate/copy/freeze; refuses the reserved local-operator issuer. |
| `resolver-hook.ts` | `onRequest` hook: resolves `pi_op_` operator bearers first (unknown ⇒ 401), then trusted resolvers; sets `request.principal`. |
| `resolver-registry.ts` | Resolver registry + trust grant (bundled `keycloak-resolver` or `identity.trustedResolverPlugins`). |
| `route-owner-registry.ts` | Route → registering plugin attribution (load-bracket) for `plugin:<id>:<verb>` classification. |
| `session-access.ts` | `canAccessSession` owner equality; `LOCAL_OPERATOR` (matched by REFERENCE via `isLocalOperator`); `filterSnapshotForPrincipal` (+ visible terminal ids). |
| `socket-lifetime.ts` | Identity-expiry close (4001) + heartbeat per identity-bound socket. |
| `ws-message-scope.ts` | Browser→Server message classification (session-owned / session-list / non-session / …). Registers `set_focus_mode`, `set_focus_profile`, `set_folder_expanded`. See change: add-focus-mode-and-card-block-toggles. |
| `ws-road-classification.ts` | WS non-session command → `{action,resource}`; plugin frames `plugin:<id>:write`. Registers `set_focus_mode`, `set_focus_profile`, `set_folder_expanded`. See change: add-focus-mode-and-card-block-toggles. |
