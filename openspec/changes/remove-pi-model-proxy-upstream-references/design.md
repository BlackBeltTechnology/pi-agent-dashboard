## Context

See proposal.md — Why.

Current wiring that constrains the approach:

- `packages/dashboard-plugin-runtime/src/server/requirement-probes.ts` owns a closed `KNOWN_SERVICES` registry with one entry, `"pi-model-proxy"`, mapped to `probePiModelProxy({ fetchImpl })`, which GETs `http://localhost:9876/v1/models` (the upstream extension's port).
- The dashboard's own `/v1/models` is behind `createModelProxyAuthGate` (`packages/server/src/model-proxy/auth-gate.ts`): every `/v1/*` request needs `Authorization: Bearer pi-proxy-*` with scope `models:list`. There is no loopback or same-process exemption.
- `RequirementProbeDeps` is built at three sites: `packages/server/src/server.ts` (the post-install `refreshRequirementProbesFor(null, {...})` call at ~1748 and the loader's `requirementDeps` literal at ~2286) and `packages/server/src/routes/recommended-routes.ts` (`reqDeps` at ~348, used to enrich every `RECOMMENDED_EXTENSIONS` entry with `requirements`/`missingRequirements`). None passes a service dep today. The runtime package must stay free of server-package imports.
- `modelProxy.enabled` defaults to `true` (`DEFAULT_MODEL_PROXY` in `packages/shared/src/config.ts`). `server.ts:~1942` reads it **once at boot** (`if (fullCfg.modelProxy.enabled)`) to decide whether the auth gate, `/v1/*` routes and key-management routes are registered; toggling the flag in config after boot has no effect until restart (spec `model-proxy`: listening surface changes at restart).
- `requirement-probes.ts` caches each plugin's report for `TTL_MS = 30_000`.
- No monorepo plugin declares `requires.services`. Three runtime tests reference the `pi-model-proxy` service name.

## Goals / Non-Goals

**Goals:**
- Service probe reflects the dashboard proxy's availability, without network I/O or auth.
- Zero remaining product-facing references to the upstream extension (manifest, core list, settings UI, docs).

**Non-Goals:**
- Detecting whether the upstream extension is *installed* in a user's pi (dropping the advisory means we stop caring).
- Probing that `/v1/*` actually answers (port bound, providers authenticated). The probe answers "were the proxy routes mounted at this boot", nothing more.
- Touching the lifted converter code or its MIT attribution.
- `Prompt stories/**`, `docs/qa/**`, `CHANGELOG.md`, archived changes: historical/narrative, not product-facing — mentions stay.

## Decisions

### D1 — Probe = boot-time mount flag, not HTTP

`KNOWN_SERVICES["model-proxy"] = (deps) => ({ satisfied: deps.isModelProxyEnabled?.() ?? false })`, with an `error: "model proxy disabled"` when false and `error: "probe not wired"` when the dep is absent.

The server injects a closure over the **boot-time** value, not a live `loadConfig()` read: `server.ts` sets `modelProxyMounted = fullCfg.modelProxy.enabled` inside the existing Model Proxy block (~1941) and every `RequirementProbeDeps` site passes `isModelProxyEnabled: () => modelProxyMounted`. Rationale: route registration is itself boot-frozen (see Context), so a live read would let the probe disagree with reality in both directions after a config save without restart. `modelProxyMounted` is declared `let modelProxyMounted = false` at `createServer` scope (before the ~1748 `setCompleteListener` callback) and only *assigned* inside the nested Model Proxy block — the block is `{ const fullCfg = loadConfig(); if (...) {...} }`, so a declaration inside it is invisible at both injection sites. `registerRecommendedRoutes` takes `deps: { packageManagerWrapper }` only (`recommended-routes.ts:~318`; `getDefaultRegistry` is a static import, not injected) — it gains an `isModelProxyEnabled?: () => boolean` option (optional — existing test call sites keep compiling), `server.ts:~1791` passes `() => modelProxyMounted`, and `reqDeps` forwards it. Runtime order is safe: all three closures fire post-boot.

Alternatives considered:
- *Self-fetch `http://localhost:<port>/v1/models`* — 401s without a `pi-proxy-*` key; minting/holding a key for a self-probe is a secret-handling surface for no gain. Rejected.
- *Add an unauthenticated loopback exemption to the auth gate* — weakens the uniform-auth invariant the `model-proxy` spec states ("authenticated uniformly via per-key proxy API keys"). Rejected.
- *Fetch `/api/health` and read a `modelProxy` field* — still HTTP, still needs a port, and `/api/health` already runs behind the network guard. Rejected.

The dep-injection shape mirrors `listInstalled` (a closure the server hands in), keeping the runtime package free of server imports. All three sites must carry the dep; a site that omits it reports `satisfied: false, error: "probe not wired"` for every plugin — silent de-support, not a crash.

### D2 — Rename the service to `model-proxy`

The name `pi-model-proxy` is the upstream npm package's short name; keeping it would misdescribe what the probe now answers. No consumer exists in-tree; the closed registry means external plugins get a clear `error: "unknown service name"` if they use the old name. A silent alias was considered and rejected — it would keep the upstream name alive in the contract indefinitely for a consumer that does not exist.

### D3 — Delete, don't stub, the dead probe helpers

`detectPiModelProxy`, `ProxyDetection` (type), `PROXY_MODEL_PREFERENCE`, `pickProxyDefaultModel`, `PROXY_MODELS_URL` have zero callers and zero tests (only `export *` from `server/index.ts:11`). `RequirementProbeDeps.fetchImpl` (`requirement-probes.ts:~54`, "tests inject") is consumed only by the old `pi-model-proxy` entry and goes with it — no shipped probe performs HTTP anymore, so leaving the field would be dead API. They are exported from the `server/index.ts` barrel, so their removal is a package-API change; since the package is `@blackbelt-technology/dashboard-plugin-runtime` (published), note it in `CHANGELOG.md` under Unreleased.

### D4 — Remove `useInstalledPackages("global")` from SettingsPanel

Its only consumer in the panel is the advisory. Leaving the hook in place would keep an `/api/packages/installed` fetch on every Settings open for nothing. Surgical rule: remove only the orphan this change creates.

### D5 — Docs deletion over rewrite

`docs/migration/from-pi-model-proxy.md` exists only to move users *off* the upstream. With the upstream no longer referenced anywhere, the migration doc has no entry point; delete it plus its sidecar and the `docs/AGENTS.md` row, and drop the README link. Its `modelProxy.secondPort` recipe (`:9876` SDK-compat listener) is not re-homed: `secondPort` itself, its spec scenarios and the field help in `ModelProxySection` stay; only the "replace the upstream on its old port" framing goes. Delegated to DocScribe per repo rule.

Same DocScribe pass rewrites the two `docs/architecture.md` lines that name the old probe (`service-probes/pi-model-proxy.ts::detectPiModelProxy`, ~746) and list pi-model-proxy among pi-core packages (~2002).

### D6 — Stale text the archive sync cannot reach

`openspec archive` replaces requirement blocks only. Exactly one reference survives a clean sync and is edited directly in this change: the `openspec/specs/model-proxy/spec.md` Purpose preamble ("…coexists with upstream `@blackbelt-technology/pi-model-proxy`"). Everything else in `openspec/specs/**` (incl. the three `package-install` requirements) is carried as MODIFIED/REMOVED delta blocks and handled by the sync — do not hand-edit those.

### D7 — Provider-type mentions in kept text

`README.md:~551` and the `pi-anthropic-messages` entry description in `recommended-extensions.ts:~151` list "pi-model-proxy" as one provider type whose Claude models need the tool-call fix. That refers to the upstream; reword to "the dashboard model proxy" so the product-facing text stops naming the upstream.

## Risks / Trade-offs

- [External plugin used `pi-model-proxy`] → it now reports `missingRequirements: ["pi-model-proxy"]` with `error: "unknown service name"`; CHANGELOG Unreleased entry names the rename.
- [`enabled: true` but proxy unusable (no providers authenticated)] → probe says satisfied while `/v1/models` would return an empty list. Accepted: the probe answers "is the service on", not "is it useful"; same posture as the previous `:9876` reachability check.
- [Config toggled after boot] → probe keeps reporting the boot-time state until restart — by design, because the routes do too (D1). Documented in the probe's JSDoc.
- [30 s report cache] → a plugin's `missingRequirements` lags a restart by up to `TTL_MS`; pre-existing behaviour, unchanged.
- [i18n key removal] → `i18n-legacy-aliases.ts` may alias the removed keys; `npm run i18n:check` (or the repo's i18n test) must stay green after removal.
- [Spec deletion in `model-proxy`] → the archive sync refuses when a REMOVED block does not match verbatim; delta uses the exact heading text from `openspec/specs/model-proxy/spec.md`.

## Migration Plan

Single PR; no data or config migration. Rollback = revert. Rebuild matrix: shared+server → `/api/restart`; client → `npm run build` + restart.
