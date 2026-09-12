# Test Plan — remove-pi-model-proxy-upstream-references

Stage: design   Generated: 2026-05-20

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | dashboard-plugin-loader › closed service registry `model-proxy` | decision-table (dep present × value) | L1 | automated | `requires: { services: ["model-proxy"] }`, `deps.isModelProxyEnabled = () => true`, `fetch` replaced by a `vi.fn()` spy | `runRequirementProbesFor` | `services[0]` deep-equals `{ name: "model-proxy", satisfied: true }`; fetch spy `.mock.calls.length === 0` |
| E2 | same | decision-table | L1 | automated | same declaration, `isModelProxyEnabled = () => false` | `runRequirementProbesFor` → `missingFromReport` | `services[0]` = `{ name: "model-proxy", satisfied: false, error: "model proxy disabled" }`; `missingRequirements` contains `"model-proxy"` |
| E3 | same | decision-table | L1 | automated | same declaration, `deps` object has no `isModelProxyEnabled` key | `runRequirementProbesFor` | `services[0]` = `{ name: "model-proxy", satisfied: false, error: "probe not wired" }` |
| E4 | dashboard-plugin-loader › former name not an alias | EP (unknown-name partition) | L1 | automated | `services: ["pi-model-proxy"]`, `isModelProxyEnabled = () => true` | `probeService` | `{ name: "pi-model-proxy", satisfied: false, error: "unknown service name" }` |
| E5 | same | EP (mixed list) | L1 | automated | `services: ["model-proxy", "pi-model-proxy"]`, dep `() => true` | `runRequirementProbesFor` → `missingFromReport` | `missingRequirements` deep-equals `["pi-model-proxy"]` (exactly one entry) |
| E6 | dashboard-plugin-loader › probe reads dep per call | state (value flips between calls, cache bypassed) | L1 | automated | `let v = true; isModelProxyEnabled = () => v`; call once, set `v = false`, call again with a different plugin id (cache is per-id) | two `runRequirementProbesFor` calls | first report `satisfied: true`, second `satisfied: false` — registry does not snapshot the dep at build time |
| E7 | dashboard-plugin-loader › never `probe not wired` via `/api/packages/recommended` | decision-table (option supplied) | L1 | automated | `vi.mock("@blackbelt-technology/pi-dashboard-shared/recommended-extensions.js")` with one entry `requires: { services: ["model-proxy"] }`; `registerRecommendedRoutes(fastify, { packageManagerWrapper, isModelProxyEnabled: () => true })` | `GET /api/packages/recommended` | that entry's `requirements.services[0].satisfied === true`, `missingRequirements` undefined; after `invalidateRecommendedCache()` + re-register with `() => false` → `missingRequirements` deep-equals `["model-proxy"]` |
| E8 | dashboard-plugin-loader › never `probe not wired` via loader + post-install sites | source-assertion (wiring) | L1 | automated | `packages/server/src/server.ts` source text | read file, locate every `listInstalled:` inside a `RequirementProbeDeps` literal / `refreshRequirementProbesFor(` arg, and the `registerRecommendedRoutes(` call | each of the 3 sites' literal contains `isModelProxyEnabled: () => modelProxyMounted`; `let modelProxyMounted` declared at `createServer` scope above the first site; `modelProxyMounted = fullCfg.modelProxy.enabled` assigned inside the Model Proxy block |
| E9 | dashboard-plugin-runtime barrel API | EP (removed exports) | L1 | automated | `import * as srv from "../server/index.js"` | property lookup | `srv.detectPiModelProxy`, `srv.pickProxyDefaultModel`, `srv.PROXY_MODEL_PREFERENCE`, `srv.PROXY_MODELS_URL` are all `undefined`; `RequirementProbeDeps` type has no `fetchImpl` (a `// @ts-expect-error` assignment of `fetchImpl` compiles-as-error) |
| E10 | bundled-recommended-extensions › curated list | EP (absent id) | L1 | automated | `RECOMMENDED_EXTENSIONS` | filter by `id`/`source` substring `@blackbelt-technology/pi-model-proxy` | zero matches; no entry description contains the bare string `pi-model-proxy` (D7 reword of the `pi-anthropic-messages` entry) |
| E11 | bundled-recommended-extensions › probeable services closed set | EP | L1 | automated | every entry's `requires.services` | set-membership check | every declared service ∈ `{"model-proxy"}` (existing closed-registry guard updated) |
| E12 | pi-core-version-check › core whitelist | BVA (count) + EP | L1 | automated | `CORE_PACKAGE_NAMES` | length + membership | `length === 3`; excludes `@blackbelt-technology/pi-model-proxy`; `DISPLAY_NAMES` has no such key |
| E13 | pi-core-version-check › status omits upstream | EP (installed-but-not-core) | L1 | automated | mocked `npm list -g --json` output containing `@blackbelt-technology/pi-model-proxy@0.2.0` alongside the 3 core packages | `getPiCoreStatus()` (existing checker entry point) | returned `packages[]` has exactly 3 rows; no row `name === "@blackbelt-technology/pi-model-proxy"` |
| E14 | model-proxy › REMOVED coexistence requirement | EP (prop removed) | L1 | automated | `<ModelProxySection>` rendered with the full current prop set (no `upstreamExtensionDetected`) | render | no element contains text `:9876` in a `<code>` inside a Note, no text matching `/upstream/i`; `tsc --noEmit` rejects passing `upstreamExtensionDetected` (`// @ts-expect-error`) |
| E15 | model-proxy › secondPort untouched (contract 5) | regression EP | L1 | automated | `<ModelProxySection config={{ enabled: true, secondPort: 9876 }}>` | change secondPort input to `9877` | `onChange` called with `objectContaining({ secondPort: 9877 })`; placeholder `common.eG9876` still resolves to "e.g. 9876" (existing tests at `ModelProxySection.test.tsx:~159/201` stay green) |
| E16 | package-install › `pi-core:` prefix + Update All fan-out | regression EP | L1 | automated | `usePackageOperations.coreUpdate` with 3 core names (the two pi forks + `@blackbelt-technology/pi-agent-dashboard`) | Update All | 3 enqueues with sources `pi-core:<name>`; none with `pi-model-proxy` (existing `coreUpdate` tests re-pinned to the 3-name list) |
| E17 | i18n orphan removal (contract 6) | EP (catalog parity + zero consumers) | L1 | automated | the 7 removed keys (`common.note`, `common.theUpstream`, `common.whileTheUpstreamUses`, `common.consider`, `common.toAvoidDuplicateListeners`, `packages.disablingTheUpstreamExtension`, `packages.extensionIsAlsoActiveInOne`) | `node scripts/i18n-parity.mjs` + a test that scans `i18n-en-source.json`, `i18n-hu.ts`, `i18n.tsx`, `i18n-legacy-aliases.ts` | parity exits 0; each key appears 0 times in every catalog and in `i18n-legacy-aliases.ts` (neither as alias source nor target); `common.eG9876` still present in all catalogs |
| E18 | docs / product surface (contract 1) | EP (repo-wide grep as test) | L1 | automated | repo tree | the task 6.1 `rg` command run from a vitest test with the same globs | matches ⊆ `{ packages/server/src/model-proxy/convert/*, packages/server/src/model-proxy/UPSTREAM.md, openspec/changes/add-package-health-cleanup/proposal.md, packages/dashboard-plugin-runtime/src/__tests__/* }`; `docs/migration/from-pi-model-proxy.md` does not exist |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| — | none | — | — | — | the change removes an HTTP round-trip; no latency budget is stated in any delta, so no threshold-bearing scenario is emitted | — | — |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | model-proxy › D4 hook removal | state-convergence (fetch count) | L1 | automated | `<SettingsPanel>` with `/api/packages/installed` mocked via `vi.fn()` | open Settings → Model Proxy tab, wait for idle | `SettingsPanel.tsx` source contains exactly one `useInstalledPackages("global")` call (inside `GlobalPackagesBrowseAndDialogs`); the advisory's `upstreamPiModelProxyInstalled` identifier is absent from the file |
| F2 | docs coherence after migration-doc deletion | subjective read-through | — | manual-only | `README.md` proxy section + `docs/architecture.md` probe paragraph | human reads | [judgment: prose still reads as a complete story without the migration link — no automatable observable] |
| F3 | Settings → Model Proxy visual | subjective | — | manual-only | live dashboard with `@blackbelt-technology/pi-model-proxy` still listed in `~/.pi/agent/settings.json#packages` | open Settings → Model Proxy | [judgment: section layout unchanged apart from the missing amber Note; nothing looks orphaned] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | dashboard-plugin-loader › recommended enricher resilience | fault-injection (throw) | L1 | automated | `isModelProxyEnabled = () => { throw new Error("boom") }` passed to `registerRecommendedRoutes`; mocked entry declares `services: ["model-proxy"]` | `GET /api/packages/recommended` | HTTP 200; the entry is returned with `requirements === undefined` and no `missingRequirements` (existing `try { … } catch {}` at `recommended-routes.ts:~294` swallows probe failure — asserts that contract holds for the new dep) |
| X2 | dashboard-plugin-loader › boot with proxy disabled | state (boot-frozen flag) | L1 | automated | `server.ts` source | static assertion (extends E8) | the `modelProxyMounted` assignment is inside the `{ const fullCfg = loadConfig(); … }` block and there is no other write to `modelProxyMounted` in the file — a later config save cannot flip it (documented lag, design Risks) |

---

## Coverage summary

- Requirements covered: 8/8 delta requirements (5 spec files) + contracts 1, 5, 6
- Scenarios by class: edge 18 · perf 0 · frontend 3 · error 2
- Scenarios by level: L1 21 · L2 0 · L3 0
- Scenarios by disposition: automated 21 · manual-only 2

## New infra needed

- none. E8/X2 reuse the source-assertion pattern from `packages/server/src/__tests__/plugin-spawn-scope-env.test.ts:~84`; E18 reuses the `rg`-in-vitest pattern only if one exists — otherwise a plain `child_process.execSync("rg …")` in a new test is acceptable (no harness). No L3: no docker-harness plugin declares `requires.services`, and the `demo` fixture is excluded from the production bundle the harness runs, so a rendered-UI/e2e scenario has no vehicle; the observable is fully covered at L1.
