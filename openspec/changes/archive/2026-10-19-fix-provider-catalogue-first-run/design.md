## Context

See proposal.md "Why" for the deadlock. The approach builds on the code below.

**Bridge catalogue cache**
- `packages/server/src/package/provider-catalogue-cache.ts` holds one `latest: ProviderInfo[] | null`; the last push wins.
- `setCatalogueForSession` stores every push verbatim, including `[]`. `invalidateCatalogue()` runs on last-bridge disconnect (`event-wiring.ts:461-471`). `isCatalogueReady()` is `latest !== null`.
- The bridge pushes `[]` while it has not yet captured a `ModelRegistry` (`packages/extension/src/provider-register.ts:763-765`; sent at `bridge.ts:2121`, `session-sync.ts:166,317`).
  - `provider-auth-bridge` spec (`:316`) says the bridge skips that push, so the bridge spec is stale on this point. That is out of scope here, but it is why the server must tolerate `[]`.

**Auth status**
- `getAuthStatus()` (`packages/server/src/auth/provider-auth-storage.ts:533`) is synchronous: `_buildAuthStatus(getLatestCatalogue(), readAuthJson(), getOAuthRegistry())`.
- `_buildAuthStatus` (`:403-530`) is pure and already handles every `ProviderInfo` field: custom skip, OAuth-twin suffix, D1 `rowConfigured`, D7 `envLabelAuth`.

**Server runtime**
- The server owns one pi `ModelRuntime` (`packages/server/src/model-proxy/server-model-runtime.ts:101-121`). It is created with `DashboardCredentialStore`, `modelsPath: null`, `refreshOnCreate: false`, `allowModelNetwork: false`.
- `server.ts:2944` injects the runtime into `auth/provider-auth-registry.ts` via `setOAuthRegistryRuntimeSource(getServerModelRuntime)`.
- `initOAuthRegistry` (`provider-auth-registry.ts:183-218`) resolves the handle. It throws `"the runtime exposes no provider with an OAuth login"` when the OAuth list is empty.
- `auth/` must not import `model-proxy/` (`provider-auth-registry.ts` `RuntimeHandleLike` comment).
- `GET /api/provider-auth/status` awaits `registryReady` (`provider-auth-routes.ts:167`). `GET /api/provider-auth/catalogue-ready` does not (`:184-186`).

**pi-coding-agent 1.3.0 `ModelRuntime` behaviour (verified in `node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js`)**
- `getProviders()` is a live delegation (`:283`).
- `getProviderAuthStatus(id)` (`:441-450`) reads `snapshot.storedProviders` and `snapshot.auth`. Only `runAvailabilityRefresh` / `refreshProviderAvailability` (`:189-245`) fill that snapshot. On the server's runtime it therefore reports `{configured:false}` for env-credentialed providers.
- `refresh()` (`:587`) can refresh expired OAuth tokens and persist them (pi-ai `models.js:231-242` `resolveRefreshCredential`). The server deliberately avoids it.
- `checkAuth(id)` (`:310`) delegates to pi-ai `Models.checkAuth` (`pi-ai/dist/models.js:283`) → `checkProviderAuth` (`:261-282`):
  - a stored OAuth credential → `{source:"OAuth",type:"oauth"}`, with no token refresh;
  - otherwise `apiKey.check(...)` when the provider defines it (no built-in provider does), or `resolveProviderAuth` → `apiKey.resolve(...)`. That reads env vars and ambient files and writes nothing; token refresh only happens in `resolveRefreshCredential` on the `refresh()` path, `models.js:231`;
  - result: `AuthCheck { source?, type }` or `undefined`.
- Labels can come from two places.
  - Registered (extension-layer) providers: pi-coding-agent `provider-composer.js:481-484` joins several env names (`names.join(", ")`).
  - Built-ins: the provider's `resolve()` sets `source`, e.g. Bedrock returns `"AWS_PROFILE"` (`pi-ai/dist/providers/amazon-bedrock.js:53-72`).
- The server runtime's `ServerModelRuntime` type (`server-model-runtime.ts:47-54`) does not declare `checkAuth` yet. The real object has it (`model-runtime.d.ts:77`).

**Bridge catalogue builder**
- The bridge builds its catalogue in `_buildProviderCatalogue` (`packages/extension/src/provider-register.ts:643-723`) from:
  - OAuth ids ∪ model providers;
  - `getProviderAuthStatus` on the session's refreshed registry;
  - `findEnvKeys`/`getEnvApiKey`;
  - `custom` = ids registered from `providers.json`.

**Custom providers config**
- `readProvidersFromDisk()` (`packages/server/src/package/provider-probe.ts:103-111`) computes `CONFIG_PATH` at module load (`:20`).

**Client**
- `ProviderAuthSection.tsx:704,835,885` warns, and suppresses the empty state, whenever `catalogueReady === false`.
- `LandingPage.tsx:375-386` derives the step states.
- `usePersistedBoolean` (`packages/client/src/hooks/usePersistedBoolean.ts:17-31`) already persists a boolean in localStorage, with an in-memory fallback.

## Goals / Non-Goals

**Goals:**
- A fresh install with no session offers every built-in API-key provider pi knows in the Add-provider picker.
- Fallback rows feed the existing `_buildAuthStatus` unchanged, so the row rules have one implementation.
- Onboarding cannot deadlock even when the runtime fails to load.

**Non-Goals:**
- Parity with the bridge on:
  - `envVar` for unconfigured rows;
  - `ambient` / `maskedKey: "(ambient)"`;
  - extension-registered providers.
  The bridge stays authoritative for all of these.
- Any new persisted server state.
- Filtering OAuth-only providers out of the api-key list. The bridge catalogue lists them too (`provider-register.ts:649-663`, OAuth ids ∪ model providers), and the `<id>-api` twin is applied server-side (`provider-auth-storage.ts:461`), so this is parity, not a regression.
- `ambient` parity. Example: Bedrock via `AWS_PROFILE` reports as an env-var row (configured, not authenticated) in the fallback. A Bedrock-profile-only user has Skip for now, and the bridge corrects the row on the first push.
- Changing the existing "Runtime surface missing is diagnosable" health error for a runtime with zero OAuth providers. The spec mandates it, and sign-in really is unavailable then.

## Decisions

### D1: Fallback source is the server's `ModelRuntime` and its `checkAuth`
`getProviders()` from pi-ai was rejected: `provider-auth-server` forbids server runtime code from importing pi-ai, and a hoisted copy can be the wrong one. `getProviderAuthStatus` was rejected because it is empty on the server's runtime (see Context). A one-time `runtime.refresh()` would fill it, but it was also rejected: it can refresh and persist OAuth tokens, which `server-model-runtime.ts` D4 explicitly forbids at boot. `checkAuth(id)` is public, async, refreshes no tokens, and writes nothing.

New module `packages/server/src/auth/runtime-provider-catalogue.ts` (structural types, no SDK import):

```ts
buildRuntimeCatalogue(runtime, { customIds, authData, env }): Promise<ProviderInfo[]>
```

The whole build is wrapped in try/catch and resolves `[]` on any throw (e.g. `getProviders()` throwing). Per provider `p`, the per-provider `checkAuth` is caught individually and treated as `undefined`:
- `id = p.id`, `displayName = p.name || p.id`, `hasOAuth = !!p.auth?.oauth`, `custom = customIds.has(id) || undefined`.
- `check = await runtime.checkAuth(p.id)`:
  - `undefined` → `configured: false`;
  - `check.type === "oauth"` → `configured: false`. A stored OAuth credential is not api-key evidence; this matches the D1 `source:"stored"` exclusion in `_buildAuthStatus`;
  - `authData[id]` present → `configured: true, source: "stored"`. `_buildAuthStatus`'s `hasStoredKey` does the rest;
  - otherwise → `configured: true, source: "environment", authLabel: check.source || undefined`.
- `envVar` = the first `check.source.split(",").map(trim)` name matching `/^[A-Z][A-Z0-9_]*$/` with `env[name]` set.

  Setting `envVar` keeps D7's `envLabelAuth` from promoting env-var rows to `authenticated`, which is what the bridge does. An ambient source such as an AWS profile or ADC carries no env-shaped set name. Such a row gets no `envVar`, so `envLabelAuth` marks it authenticated, close to the bridge's `ambient` result (minus the `(ambient)` mask).

The `checkAuth` calls run concurrently (`Promise.all`).

**Corrupt `auth.json` guard.** `buildRuntimeCatalogue` receives `authData` from the caller's single `tryReadAuthJson()`. When that returns `null` (the file exists but does not parse), the fallback resolves `[]` without calling `checkAuth`. Otherwise every `DashboardCredentialStore.read` would fall to the locked read path (`dashboard-credential-store.ts`, `readStoredCredentialLocked`), causing ~42 concurrent lock acquisitions plus repeated quarantine attempts. With a parseable file, the store reads unlocked.

**Typed surface.** Add `checkAuth(providerId): Promise<{ source?: string; type: "api_key" | "oauth" } | undefined>` to `ServerModelRuntime` (structural, no pi-ai import). It is **required** in `RuntimeCatalogueSource`. A handle without it is treated as runtime-unavailable for the fallback (`[]`, `fallback: false`), so a missing surface fails visibly in tests.

### D2: Precedence and lifetime
The fallback is derived per status request and is never stored in `latest`.

- A credential write is reflected on the next request.
- A non-empty bridge push wins at once.
- `invalidateCatalogue()` hands back to the fallback.

`setCatalogueForSession` ignores an empty `providers` array: it keeps any previous snapshot and does not mark the catalogue ready. This closes the "empty push masks fallback" hole. The `request_providers` nudge keys on `!isCatalogueReady()`, which now also covers the empty-push case, so the nudge keeps firing until a real catalogue arrives.

Rejected alternative: seed `latest` with the fallback. `isCatalogueReady()` would then lie.

`getAuthStatus()` becomes `async`. Its only callers are in `provider-auth-routes.ts` and tests; the routes are async already. When `isCatalogueReady()` it uses `latest`; otherwise `await buildRuntimeCatalogue(getRegistryRuntime(), …)`; with no runtime, `[]`. The pure `_buildAuthStatus` is unchanged.

### D3: Wiring without breaking the `auth/` ↛ `model-proxy/` rule
- **Runtime handle.** `initOAuthRegistry` stores the resolved `handle.runtime` in a module-level `registryRuntime` before it checks the OAuth entries. A generation counter, bumped by `setOAuthRegistryRuntimeSource`, is captured at init start. An init whose generation is stale writes neither `registryRuntime` nor the snapshot. This closes the race where an in-flight init from an old source lands after a reset. The retention is structural: the reference is set once the handle resolves and `getProviders` is a function, and cleared only if `getRuntime()` itself rejects or the handle lacks `getProviders`, or on `setOAuthRegistryRuntimeSource`. An empty OAuth list therefore keeps the runtime available for api-key rows, consistent with the existing scenario "Runtime surface missing is diagnosable".
- **Accessors.** It is exposed as `getRegistryRuntime(): RuntimeCatalogueSource | undefined`, with the structural `RuntimeCatalogueSource` `{ getProviders(): readonly { id: string; name?: string; auth?: { oauth?: unknown } }[]; checkAuth(id): Promise<AuthCheckLike | undefined> }`, defined in `auth/runtime-provider-catalogue.ts`. `RuntimeHandleLike.runtime` (`provider-auth-registry.ts:66-68`) is widened to it, and `RuntimeProvider` in `server-model-runtime.ts` gains `name?: string`. A test seam `_setRegistryRuntimeForTests(rt | null)` is added beside it.
- **Custom ids.** `customIds` = `Object.keys(readProvidersFromDisk())`. The server runtime does expose custom providers: `internal-registry.ts:387` projects non-built-in providers onto it with `registerProvider.call(this.runtime, …)` (`registry-singleton.ts:101` passes the shared runtime). The filter is therefore load-bearing. `provider-probe.ts` is changed to resolve `CONFIG_PATH` per call (`join(os.homedir(), …)`), so tests that change `HOME` work.

  A corrupt `providers.json` reads as `{}`, so no id is marked custom and custom ids then appear as api-key rows (fail-open). This is accepted and stated in the spec: a corrupt file already breaks custom providers, the dashboard shows the corruption separately, and fail-closed would need a built-in id list the server cannot get without pi-ai.

  The server runtime also holds models.json providers via `internal-registry.ts` projection. These are NOT marked custom, matching the bridge, whose `custom` set is only the dashboard's `providers.json` ids.

### D4: `catalogue-ready` gains `fallback` and awaits readiness
The route `await registryReady` first, like `/status`. It then returns `{ ready, fallback }`, where:

```ts
fallback = !ready && (await buildRuntimeCatalogue(...)).some((e) => !e.custom)
```

`fallback` is computed after the custom filter, so "fallback" means an api-key row can actually be shown.

Add `CatalogueReadyResponse { ready: boolean; fallback?: boolean }` to `packages/shared/src/rest-api.ts`. `fallback` is optional so the client tolerates old servers. The route-tier entry (`packages/shared/src/route-tiers.ts:224`, `observe`) is unchanged.

### D5: Client notice and empty state
`ProviderAuthSection` stores `{ ready, fallback } | null`, and `catalogueUnavailable = ready === false && fallback !== true`.

- The existing warning and empty-state suppression key on `catalogueUnavailable`, so they apply to the unavailable state only.
- In the fallback state the normal empty state renders. An `InlineMessage severity="info"` (`testId="catalogue-fallback-notice"`) is added next to it.
- New i18n keys: `providers.catalogueFallbackTitle` and `providers.catalogueFallbackBody`. They go in every locale under `packages/client/src/i18n`.

### D6: Landing "Skip for now"
- **State.** Reuse `usePersistedBoolean("pi-dashboard.onboarding.providersSkipped")`; `skipped = value === true`. No new hook. Call it alongside the existing hooks, before the `if (!hasOnboardingContext) return` early return (`LandingPage.tsx:363`), to respect the rules of hooks. When storage is unavailable, its `useState` fallback lasts as long as the component stays mounted, which matches the relaxed spec wording.
- **Step derivation.**
  - `step1 = providersReady ? "done" : skipped ? "skipped" : "pending"`.
  - `step1Satisfied = step1 !== "pending"`. Step ② and the `lockText` "waits for step 1" branch use `step1Satisfied` instead of `providersReady`.
  - `firstPending` searches for `"pending"`, so a skipped step is never expanded.
- **StepRow.**
  - Widen `StepState` (`LandingPage.tsx:44`) and `Marker` with `"skipped"`. The Step ① testId branch (`:443`) gains `onboarding-step-1-skipped`, so a skipped row is never tagged `-locked`.
  - It gets a `"skipped"` state: a skip glyph plus text, and a secondary **Set up now** button (`onboarding-step-1-resume`) that navigates to `/settings/providers`.
  - The pending Step ① body gets a secondary **Skip for now** button (`onboarding-step-1-skip`).
  - i18n keys: `landing.skipProviders`, `landing.step1Skipped`, `landing.step1SkippedHint`, `landing.resumeProviders`.
- **No automatic clearing.** Done wins in the derivation, and a later sign-out does not force the user back into the gate.

## Risks / Trade-offs

- **Fallback lists fewer providers than the bridge.** Extension-registered providers are absent, and unconfigured rows carry no `envVar`.
  → The info notice says so. The first non-empty bridge push replaces the fallback.
- **The server's environment can differ from a pi session's.** For example, Electron launched from Finder has no shell env vars, so `configured/source` can differ.
  → First-run stored keys come from `auth.json` through `_buildAuthStatus` and are runtime-independent. Env-only differences correct themselves once a bridge pushes.
- **Per-request cost.** Each `/status` and `/catalogue-ready` request runs ~42 async `checkAuth` calls. A Settings load fires both, and `useProvidersReady` refetches on every focus.
  → Task 2.7 measures both endpoints concurrently on a cold profile (50 iterations each). If p95 exceeds 50 ms, add one single-flight promise plus a memo keyed on the `auth.json` mtime+size (TTL 5 s), shared by both routes. Measure first; the fallback path only runs while no session is connected.
- **`checkAuth` → `resolveProviderAuth` could execute commands for `models_json_command` sources.**
  → The server runtime uses `modelsPath: null`, so no models.json command sources exist on it. Built-in providers resolve env/ambient only (security-hardening check, task 2.8).
- **`getAuthStatus()` becomes async, which affects other callers.**
  → Task 2.3 lists every caller found by grep and updates them in the same commit.
- **Skip lets a user reach a session with no model.**
  → Intended. The skipped row says sessions need a provider.

## Migration Plan

No data migration. Deploy = server restart + client build (see the `implement` skill rebuild matrix). Rollback = revert. A leftover localStorage key is harmless.

## Open Questions

- Exact skip glyph and copy: settle during implementation against `ui-contract.md`. This does not affect the specs.
