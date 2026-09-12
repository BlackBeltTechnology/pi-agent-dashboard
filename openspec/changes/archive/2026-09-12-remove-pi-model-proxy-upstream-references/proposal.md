## Why

The dashboard's built-in model proxy (`:8000/v1`, `packages/server/src/model-proxy/`, enabled by default) superseded the upstream `@blackbelt-technology/pi-model-proxy` pi extension (`:9876`, per-session). The dashboard still recommends the upstream extension, lists it as a "core" package in Update All, renders a coexistence advisory for it, and — worst — the only plugin service probe (`requires.services: ["pi-model-proxy"]`) answers "is the proxy up?" by hitting the upstream's `:9876`, so it can never reflect the dashboard's own proxy. Remove every upstream-facing reference and make the service probe answer for the dashboard proxy.

## What Changes

- **Recommended manifest**: drop the `@blackbelt-technology/pi-model-proxy` entry from `RECOMMENDED_EXTENSIONS` (`packages/shared/src/recommended-extensions.ts`) and its expected-id assertions in `recommended-extensions.test.ts`.
- **Pi-core package list**: drop `@blackbelt-technology/pi-model-proxy` from `CORE_PACKAGE_NAMES` / `DISPLAY_NAMES` in `packages/server/src/pi/pi-core-checker.ts`. Update All / `GET /api/pi-core/status` no longer report it. Stale comment in `UnifiedPackagesSection.tsx` updated.
- **Coexistence advisory**: remove the `upstreamExtensionDetected` prop, the `:9876` `<Note>` banner and its now-orphaned i18n keys from `ModelProxySection.tsx`; remove the `useInstalledPackages("global")` detection in `SettingsPanel.tsx` (that hook call exists solely for this advisory). Orphaned i18n keys (7, incl. `common.note`) go from all four locale sources: `i18n-en-source.json`, `i18n-hu.ts`, `i18n.tsx` (zh-CN), `i18n-legacy-aliases.ts`.
- **Plugin service probe** — **BREAKING** for plugin manifests: rename the closed-registry service name `pi-model-proxy` → `model-proxy`. The probe no longer performs HTTP (`:9876/v1/models` needs the upstream; the dashboard's own `/v1/models` requires a `pi-proxy-*` key and would 401 on self-fetch). Instead `RequirementProbeDeps` gains `isModelProxyEnabled?: () => boolean`; the probe is satisfied iff the dashboard's `/v1/*` routes were mounted at this boot (`modelProxy.enabled` as read at startup — route registration is boot-frozen, so the probe mirrors it). The server injects it at all three `RequirementProbeDeps` sites: the post-install `refreshRequirementProbesFor` call and the loader `requirementDeps` in `server.ts`, and the recommended-extensions enricher `reqDeps` in `routes/recommended-routes.ts`. `detectPiModelProxy`, `PROXY_MODEL_PREFERENCE`, `pickProxyDefaultModel` (zero callers, zero tests) are deleted. No monorepo plugin declares `requires.services` today, so nothing in-tree breaks.
- **Docs**: delete `docs/migration/from-pi-model-proxy.md` + its `.AGENTS.md` sidecar, the `docs/AGENTS.md` row, and the `README.md` migration link; rewrite the two `docs/architecture.md` lines naming the old probe / pi-core list; reword the `pi-anthropic-messages` provider-type mention in `README.md:~551` and `recommended-extensions.ts:~151` (DocScribe-delegated for `docs/`+README).
- **Spec text the sync cannot reach**: `openspec/specs/model-proxy/spec.md` Purpose preamble edited directly (design D6).
- **Kept on purpose**: `packages/server/src/model-proxy/convert/*` MIT attribution headers and `UPSTREAM.md` (license provenance of lifted code), `CHANGELOG.md` history, archived changes, `docs/qa/` archives.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `bundled-recommended-extensions`: "Curated additions present" scenario no longer lists `@blackbelt-technology/pi-model-proxy`.
- `pi-core-version-check`: core whitelist shrinks to the two pi forks + `@blackbelt-technology/pi-agent-dashboard`.
- `package-install`: examples in the `pi-core:` prefix requirement, the "Package queue dispatches by operation kind" requirement and "Update All splits into N enqueues" scenario no longer name pi-model-proxy.
- `model-proxy`: "Coexistence with upstream pi-model-proxy" requirement removed (both scenarios).
- `dashboard-plugin-loader`: closed service-probe registry entry renamed `pi-model-proxy` → `model-proxy`; probe semantics = dashboard `modelProxy.enabled`, not HTTP reachability of `:9876`.

## Impact

- `packages/shared/src/recommended-extensions.ts` + test
- `packages/server/src/pi/pi-core-checker.ts` (+ tests referencing the whitelist)
- `packages/client/src/components/settings/ModelProxySection.tsx`, `SettingsPanel.tsx`, `packages/client/src/components/packages/UnifiedPackagesSection.tsx` (comment), i18n sources (`i18n-en-source.json`, `i18n-hu.ts`, `i18n.tsx`, `i18n-legacy-aliases.ts`)
- `packages/dashboard-plugin-runtime/src/server/service-probes/pi-model-proxy.ts` → renamed/rewritten as `model-proxy.ts`; `requirement-probes.ts`; `server/index.ts` barrel; `manifest-types.ts` comment; runtime tests (`requirement-probes.test.ts`, `plugin-status-store-probe.test.ts`, `manifest-validator-requires.test.ts`)
- `packages/server/src/server.ts` (two `RequirementProbeDeps` injection sites + boot-time `modelProxyMounted` capture), `packages/server/src/routes/recommended-routes.ts` (third site)
- `openspec/specs/model-proxy/spec.md` preamble (direct edit), `docs/architecture.md`
- `docs/migration/`, `docs/AGENTS.md`, `README.md`, per-directory `AGENTS.md` rows for every touched file
- External plugins declaring `requires.services: ["pi-model-proxy"]` (none known) get `error: "unknown service name"` until they rename to `model-proxy`.

## Discipline Skills

- `doubt-driven-review` — removing a spec requirement (`model-proxy` coexistence) and renaming a plugin-manifest contract (`pi-model-proxy` → `model-proxy`) are public-contract changes; stress-test before they stand.
- `review-code` — non-trivial multi-package diff; run before commit.
- `security-hardening`, `performance-optimization`, `observability-instrumentation`: not triggered (no auth/untrusted-input/secrets change, no latency budget, no new endpoint — the HTTP self-probe is removed, not added).
