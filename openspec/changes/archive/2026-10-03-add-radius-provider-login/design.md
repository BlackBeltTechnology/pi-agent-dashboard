## Context

pi 1.0.0 adds Radius as a top-level `/login` option. On success, `/login` offers to point the Radius MCP server at that login, then reloads the session. The dashboard registry hard-excludes `radius` today.

Verified against the installed pi 1.0.0:

- The built-in provider is `radiusProvider()` with no options (`node_modules/@earendil-works/pi-ai/dist/providers/all.js:116`). `radiusProvider` falls back to `DEFAULT_RADIUS_GATEWAY` (`pi-ai/dist/providers/radius.js:10`; constant `https://radius.pi.dev` in `pi-ai/dist/providers/radius-config.js:1`). Its `auth.oauth` is a `lazyOAuth({ name, load })` wrapper (`radius.js:21`) that exposes `name` synchronously and no `isSubscription` (`pi-ai/dist/auth/helpers.js:38-52`).
- `PI_RADIUS_GATEWAY` is read only by `getRadiusGatewayUrl()` (`pi-coding-agent/dist/core/radius.js:8`), and only the bug-report path uses that function (`core/bug-report-upload.js:9`, `modes/interactive/bug-report.js:83`). Login never consults it.
- Besides an extension registering id `radius` (see Risks), `ModelRuntime.configureRadiusProviders()` replaces `builtins[<id>]` with a custom-gateway Radius for every `models.json` provider that has `oauth === "radius"` and a `baseUrl` (`pi-coding-agent/dist/core/model-runtime.js:114-126`). When `<id>` is `radius`, pi sessions use that gateway in place of the built-in one.
- The Radius OAuth login asks a `select` first: option ids `browser` / `device-code` (`pi-ai/dist/auth/oauth/radius.js` `createRadiusOAuth.login`).
  - Browser: the callback listener is pinned to `127.0.0.1:1456`, with no manual-code prompt.
  - Device code: pure polling.
- pi's follow-up is `InteractiveMode.offerRadiusMcpServer` (`pi-coding-agent/dist/modes/interactive/interactive-mode.js:5251-5290`). It:
  - finds a global server by trailing-slash-insensitive URL equality with `RADIUS_MCP_URL`;
  - returns without asking when that server already has `auth.provider === providerId`;
  - picks the name: existing name, else `radius`, else `radius-mcp` when `radius` is taken;
  - sets `auth: { provider }` and deletes `oauth`;
  - calls `addMcpServerConfig`, then `handleReloadCommand`.
- `RADIUS_MCP_URL` is `${normalizeRadiusGatewayUrl(DEFAULT_RADIUS_GATEWAY)}/mcp` (`core/radius.js:5`). pi's package index does not export it.

Dashboard side:

- Registry: `EXCLUDED_PROVIDER_IDS` / `isOAuthProvider` / `mapProviders` (`packages/server/src/auth/provider-auth-registry.ts:53,105-123`).
  - The registry is built once with `modelsPath: null` (`:212-215`).
  - `FLOW_TYPE_HINT` (`:40-46`) has no `radius` entry. This change adds `radius: "auth_code"`, the same as `openai-codex`, whose first step is also a browser/device `select`. The `device_code` pane promises a user code on start (`openspec/specs/provider-add-flow/spec.md` "Device-code pane requires an explicit browser action"), which Radius doesn't produce.
- Routes: `registerProviderAuthRoutes(fastify, { piGateway, browserGateway })` (`packages/server/src/server.ts:2370`).
- The `auth.json` dir is `~/.pi/agent` (`packages/server/src/auth/provider-auth-storage.ts:37-38`).
- Reload fan-out precedent: `registerPiRetryRoutes({ reloadConnectedSessions })` uses `reloadFanOutTargets()` + `dispatchReload` (`packages/server/src/server.ts:1947-1991`).
- Writer precedent: `mcp-server-plugin` imports `createMcpClientConfigService` from `@blackbelt-technology/pi-dashboard-mcp-client-plugin/core` with no `dependsOn` (`packages/mcp-server-plugin/src/server/provisioning.ts:36,188`).
  - `migrate-mcp-to-pi-builtin` (planned, 0/55 tasks) retargets that writer at pi's `mcp.json`, validates `auth` (https-or-loopback URL), refuses `auth` at project scope, and defines the closed refusal set.
- Client: the Add-provider dialog closes on completion; the section owns flows and the `handleChanged` funnel (`packages/client/src/components/settings/ProviderAuthSection.tsx.AGENTS.md` § Flows).
- Model proxy refresh: `OAUTH_LOADER_EXPORTS` has no Radius loader (`packages/shared/src/piai-compat/oauth-facade.ts:28-43`).

## Goals / Non-Goals

**Goals**
- Radius sign-in from the dashboard: built-in gateway only, through the generic panes.
- Never sign in to the default gateway while pi sessions would use a `models.json`-declared custom `radius` gateway (extension-registered overrides are out of reach; see Risks).
- Opt-in, pi-equivalent "configure Radius MCP" follow-up, with sessions reloaded afterwards.

**Non-Goals**
- Custom-gateway Radius login: any `models.json` `oauth: "radius"` provider.
- Dashboard model-proxy routing or refresh of a Radius OAuth credential. pi sessions refresh their own `auth.json` entry; adding a Radius loader to `oauth-facade.ts` is a separate change.
- `/share` → Radius artifacts.
- Radius-specific UI that hides the browser method for remote clients.

## Decisions

Q-defaults: the user deferred the open questions ("go on"). D2, D4, D5 and D6 are the recommended defaults and are flagged for doubt-review and user confirmation.

### D1 — Drop the unconditional exclusion; no gateway env handling
Delete the `EXCLUDED_PROVIDER_IDS` set. Built-in Radius always targets `radius.pi.dev`, so the server reads neither its own `PI_RADIUS_GATEWAY` nor that of the pi it spawns. This resolves the proposal's open question 1: the variable has no effect on login.

*Alternative rejected:* gating on `PI_RADIUS_GATEWAY` being unset. That would hide Radius for users whose login is unaffected by the variable.

### D2 — models.json `radius` override → exclude, freshness-checked (Q-default)
Add `isRadiusOverridden()` in a new module, `packages/server/src/auth/radius-override.ts`, consumed by `provider-auth-registry.ts`. It is true iff all of these hold:
- the Pi-global `models.json` has `providers.radius.oauth === "radius"`;
- `baseUrl` is a non-empty string;
- `baseUrl` normalized differs from the default gateway `https://radius.pi.dev`. Normalization mirrors pi: strip `/v1/?$` (`model-runtime.js:125`), then apply the ported normalization below.

The rule mirrors `ModelRuntime.configureRadiusProviders` (`model-runtime.js:114-126`). A default-gateway `baseUrl` replaces the built-in with an identical gateway, so it is not treated as an override.

- **Path:** `join(getAgentDir(), "models.json")`. `getAgentDir` is a public export of the pi-coding-agent index (`dist/index.d.ts:2`), taken from the module the registry already loads. This honours `PI_CODING_AGENT_DIR` like pi does (`dist/config.js`).
- **Parse:** exactly pi's parse (`model-config.js:251`): `JSON.parse(stripJsonComments(stripBom(content)))`.
  - pi's `stripJsonComments` (`pi-coding-agent/dist/utils/json.js`) strips `//` comments and trailing commas outside strings. It does not strip block comments. The npm `strip-json-comments` package differs in both respects (it strips block comments and keeps trailing commas), so it is not used.
  - Neither `stripBom` nor `stripJsonComments` is a public pi export. Port both locally into `radius-override.ts` (two regexes plus a BOM check) and guard them with the drift test below.
  - Missing file, IO error, parse error, or a non-object at `providers` / `providers.radius` → no override.
  - Schema validation is not replicated. A schema-invalid file (which pi ignores wholesale) that carries the override shape still excludes Radius. This only fails toward hiding Radius, never toward a wrong-gateway sign-in.
  - Gateway normalization is ported from pi-ai's `normalizeRadiusGatewayUrl`. It is resolvable via pi-ai's `./providers/*` export, but server runtime code must not import pi-ai. Prepend `https://` when the URL has no scheme, then strip trailing slashes.
- **Runtime unavailable:** if the pi module failed to load, `getAgentDir` is missing. The registry is empty anyway, so `/start radius` is already 400, and `POST /radius/mcp` refuses with 503 `runtime-unavailable` rather than assuming "no override".
- **Freshness / cost:** cache the predicate's result for at most 1 s, then re-read and re-parse the (tiny) file. There is no stat-based memo, because an mtime/size key misses same-size edits within a tick. One `/status` reaches the registry several times (`getAuthStatus`, `oauthIdSet`); all of them hit the cache, so worst-case cost is one small sync read per second. Update the docstring of `getOAuthRegistry()`, which is no longer a pure snapshot read. Do the filtering in `getOAuthRegistry()`, so every consumer agrees: `/providers`, `/handlers`, `/start`, `oauthIdSet()` and the status rows. The twin-naming rule follows. A stored `radius` OAuth credential still makes `radius` an OAuth id through the stored-credential union (`provider-auth-storage.ts` `oauthIdsFrom`).
- **Drift guard (bi-implication):** an L1 test runs the real `ModelRuntime.create({ modelsPath })` over a fixture matrix: plain, BOM, `//` comments, trailing comma, block comment, default-gateway `baseUrl`, scheme-less `baseUrl`, and `providers: null`. It points both sides at the same file by setting `PI_CODING_AGENT_DIR` to the fixture dir and passing that file as `modelsPath`. For each schema-valid fixture it asserts that `isRadiusOverridden()` is true **iff** the runtime's `radius` provider no longer resolves to the default-gateway built-in. Observable signal: `radiusProvider` seeds its baseline catalogue only for the default gateway (`pi-ai/dist/providers/radius.js:11-13`). The test passes an empty credential store and `refreshOnCreate: false`. Pi stays the oracle for the predicate.

*Alternatives:*
- Show with a warning: the user could still write a wrong-gateway token under the `radius` key, which pi would then send to the custom gateway.
- Build the registry with the real `modelsPath`: this surfaces every custom `oauth: "radius"` provider (out of scope) and breaks the deliberate `modelsPath: null` invariant.

### D3 — Generic select; remote browser limitation accepted
No Radius-specific client code. The browser method only works when the user's browser shares the server's loopback; pi's own label ("…when signing in from another device") steers remote users to device code. The existing "Callback port already bound" path covers a concurrent pi `/login` on port 1456.

### D4 — MCP offer is inline on the section after completion (Q-default)
The dialog closes on completion (existing contract), so the offer renders as a dismissible inline panel on the providers section, keyed to the completed `radius` flow. This mirrors pi's post-login prompt.

*Alternative:* an action in MCP settings. That discards the timing pi uses, and would make `mcp-client-plugin` own provider-auth knowledge.

### D5 — Server-side configure endpoint using the mcp-client writer (Q-default)
New module `packages/server/src/auth/radius-mcp.ts`:

- `RADIUS_MCP_URL` constant `https://radius.pi.dev/mcp`.
  - pi's index doesn't export it, and the server must not import pi-ai or reach into pi's file layout.
  - An L1 drift test (test-only exception to the "no internal layout" rule, which governs server runtime code) imports pi's `dist/core/radius.js` by resolved path and asserts equality. The test resolves through the pi-coding-agent copy the server depends on.
- `planRadiusMcp(globalEntries)` → `{ configured, name, entry? }`. Pure; ports pi's `offerRadiusMcpServer` rules (`interactive-mode.js:5251-5290`).
- `configureRadiusMcp(deps)` runs these steps:
  1. Runtime check: 503 `provider_auth.radius_mcp_runtime_unavailable` when the pi module did not load.
  2. Credential check through `readAuthJson()` (`…_no_credential`).
  3. `isRadiusOverridden()` check (`…_overridden`).
  4. Read the global entries through the service (unparseable → `…_write_refused` with `reason`).
  5. Plan; already configured → no-op.
  - Refusal codes follow the domain-prefixed convention (`provider_auth.credential_type_conflict`, `ui-i18n-coverage`), with `err.provider_auth.radius_mcp_*` keys added to every locale catalog.
  6. Write one entry with the writer's single-entry save operation at global scope.
     - The operation name is the one `migrate-mcp-to-pi-builtin` lands. Today's service exposes only `ensureServerEntry` / `applyServerPatch` / `readServerEntry` against the adapter file; it has no global-list read and is not the target.
     - The service is constructed with the host's known-folder cwds and the `isProjectTrusted` predicate that change introduces, so the writer's `-`/`_` cross-folder collision check is live (the `mcp-server-plugin` precedent passes `knownCwds: () => []`; that is not copied).
     - Writer refusals map to 409 `provider_auth.radius_mcp_write_refused` with `vars.reason` = the writer's code.
     - The service needs a global-entry list read. The migrate change's "read effective view" covers it; if it does not, that change must add one.
  7. On a written result, call the injected reload callback, which returns the count of `respawn | forwarded` outcomes. This follows the newest fan-out precedent, `setReloadSessions` (`server.ts:2228-2238`), rather than the retry route's target count.

Routes: `GET|POST /api/provider-auth/radius/mcp` in `provider-auth-routes.ts`.
- They are protected by the server-wide gates every `/api/*` route gets:
  - universal network guard `createNetworkGuardHook` (`packages/server/src/auth/localhost-guard.ts`);
  - route-tier gate (`route-tier-gate.ts`);
  - mutation-origin gate for POST (`mutation-origin-gate.ts`).
- Provider-auth routes have no route-level guard today (`server.ts:2370`), and none is added.
- Add both `ROUTE_TIERS` rows (`operate`, `packages/shared/src/route-tiers.ts`, next to the existing provider-auth rows). The MCP manifest already denylists the `/api/provider-auth/` prefix (`packages/mcp-server-plugin/src/server/tools.denylist.ts:16`); the completeness test must stay green.
- The override filter is a shared helper applied both inside `getOAuthRegistry()` and to a route-injected `deps.oauthRegistry`, which covers `/providers`, `/handlers` and `/start`. `/status` reads `getOAuthRegistry()` directly (`provider-auth-storage.ts` `getAuthStatus`), so its override and twin scenarios are tested against the real registry path with a temp `PI_CODING_AGENT_DIR`.

Wiring: `server.ts` passes a reload callback built on `reloadFanOutTargets()` + `dispatchReload` (counting actual reloads), and a lazily constructed config service.

The server package gains a workspace dependency on `mcp-client-plugin`, importing `./core` only (no React or host imports, per `packages/mcp-client-plugin/src/core/AGENTS.md`). This follows the `mcp-server-plugin` precedent and keeps a single writer. Server core has not imported a plugin package before; the user must confirm this.

*Alternatives:*
- Client calls the mcp-client plugin REST and then a separate reload: two non-atomic calls, and provider-auth logic duplicated in the client.
- Server writes `mcp.json` directly: a second writer that bypasses pi-entry validation and the refusal set.

### D6 — Reload fan-out after a write (Q-default)
pi reloads its one session because the MCP extension reads `mcp.json` only at session start. The dashboard dispatches `/reload` to every `reloadFanOutTargets()` id. `dispatchReload` already owns the busy decision and reports per-session failures as `command_feedback`, so a streaming session is not torn down. The response carries the target count.

*Alternative:* no reload, with a note to restart sessions. Rejected because pi itself reloads.

## Risks / Trade-offs

- **Dependency on an unbuilt change.** The D5 writer contract (pi-shape `mcp.json`, `auth` validation) only exists after `migrate-mcp-to-pi-builtin` ships. Tasks are ordered so the registry and UI parts (D1–D3) can land independently; the MCP tasks are blocked until then.
- **Wrong-gateway token** if `models.json` gains a `radius` override after sign-in: the stored credential stays. This matches pi's behaviour; per-request evaluation hides the re-login path immediately.
- **Fan-out reload interrupts idle sessions' extension state.** This is the same trade-off as the retry-policy editor, and it is opt-in via the offer.
- **Security.**
  - The write is limited to one global entry with a fixed https URL and `auth.provider` (no secret material).
  - It is gated by the server-wide network guard, route-tier gate, mutation-origin gate, credential presence and the override check.
  - Writer refusals are surfaced, never coerced.
- **Dashboard model proxy and Radius OAuth** (trade-off, unchanged by this change). `OAUTH_LOADER_EXPORTS` has no Radius loader, so the proxy cannot refresh an expired Radius OAuth token and reports the facade's "unavailable" error for it; api-key models are unaffected. This is already true for a Radius credential written by pi's own `/login`. The `model-proxy` requirement "Model availability mirrors dashboard's effective catalog" is consciously not extended here. Follow-up: teach the facade loader map to pass `{ name, gateway }` to `loadRadiusOAuth`.
- **Shared global file, no lock** (trade-off). `mcp-server-plugin` provisioning and this endpoint both read-modify-write the Pi-global `mcp.json` through the same atomic-rename writer, which takes no lock (`packages/mcp-client-plugin/src/core/config-io.ts`). A concurrent provisioning run and a POST can lose one update. The window is small: provisioning runs at server start, and the POST is a user click. pi's own `addMcpServerConfig` is equally unlocked. Re-running either repairs it.
- **Extension-registered `radius`** (unprotected path). A pi extension calling `pi.registerProvider({ id: "radius", oauth })` overrides the built-in OAuth in sessions (`provider-composer.js` `composeOAuthAuth`). The dashboard registry (`modelsPath: null`, built-ins only) cannot see this. The override check covers `models.json` only; the extension case is documented, not detected.
- **"API key provider registry" wording.** That requirement says "registered OAuth handler", but the code (`provider-auth-storage.ts` `oauthIdsFrom`) and "Stored OAuth credentials are visible without a registry entry" already use registry ∪ stored OAuth ids. That is a pre-existing ambiguity; this change relies on the union and does not restate the requirement.
- **URL-matched entry with another `auth.provider`.** Mirroring pi, POST repoints it to `radius`. The offer names the entry before the user accepts.
- **Agent-dir asymmetry** (pre-existing). The override check honours `PI_CODING_AGENT_DIR` via `getAgentDir()`. `auth.json` access (`provider-auth-storage.ts:37-38`) still hardcodes `~/.pi/agent`. Not widened here.
- **GET exposes the absolute `mcp.json` path.** This is behind the `operate` tier, and pi shows the same path in its prompt. Accepted.
- **Scope of "no Radius-specific client code".** The rule applies to sign-in. The post-sign-in MCP offer is deliberately Radius-specific UI.

## Migration Plan

- No data migration.
- Rollback: revert the change. A `radius` credential in `auth.json` and an `mcp.json` entry remain valid pi state and still work in pi; the dashboard simply stops offering re-login.
- Compatibility: older clients ignore the new endpoints; `radius` then appears as an ordinary device-code provider in their picker.

## Open Questions

- Confirm Q-defaults D2, D4, D5 and D6 with the user. D5's server→plugin import is the one with architectural weight.
