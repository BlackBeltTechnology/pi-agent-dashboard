## 1. Package scaffold

- [x] 1.1 Create `packages/blackhole-plugin/` with `package.json`, `tsconfig.json` (extends `../../tsconfig.base.json`, `jsx: react-jsx`, `noEmit`, DOM libs) and `vitest.config.ts` (react plugin, jsdom, `pool: forks`, globalSetup `@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts`), mirroring `packages/hermes-memory-plugin/`
- [x] 1.2 Declare the `pi-dashboard-plugin` manifest: id `blackhole`, `displayName`, `priority`, `client`, `server`, `configSchema`, `i18nCatalog`, and `requires.piExtensions: ["pi-blackhole"]` (install prompt only — NOT an activation gate, design D3)
- [x] 1.3 Declare the `settings-section` claim only — the `session-card-memory` and `content-view` claims are deferred to change `add-blackhole-session-pipeline`
- [x] 1.4 Write `src/__tests__/manifest.test.ts` asserting the manifest validates, the settings claim is present and no dependency section references `pi-blackhole` (spec: self-gating, no-dependency scenario)
- [x] 1.5 Register the package in the workspace and confirm `pnpm install` resolves it

## 2. Shared config model (the validation boundary)

- [x] 2.1 Write `src/shared/blackhole-config.ts`: re-declared `BlackholeConfig` and `ModelRef` interfaces with a `SOURCE-VERSION PIN: pi-blackhole@<version>` comment (design D1)
- [x] 2.2 Add `FIELD_DESCRIPTORS` (kind, enum values, bounds, integer-ness) and `DEFAULTS` covering every managed key
- [x] 2.3 Write the validator: reject unknown keys, enum violations, type violations, bound violations; reject atomically
- [x] 2.4 Write `src/shared/__tests__/blackhole-config.test.ts` covering each rejection scenario plus atomicity (spec: validation is the security boundary)
- [x] 2.5 Vendor a snapshot of blackhole's `example-config.json` at the pinned version and write a drift test comparing the descriptor key set against it; document in the test that it detects descriptor drift from the pin, not upstream drift, and catches key-set changes only — no network fetch in CI (design D1 drift-test mechanism)

## 3. Server — global config routes

- [x] 3.1 Write `src/server/config-path.ts` mirroring blackhole's agent-directory resolution (`PI_CODING_AGENT_DIR`, else `~/.pi/agent`) with a fixed filename constant, following `packages/hermes-memory-plugin/src/server/config-path.ts`; test both branches (spec: config file location)
- [x] 3.2 Write `src/server/config-io.ts`: read returning parsed config, resolved path, and unmanaged-key set; absent file returns defaults flagged as absent and creates nothing
- [x] 3.3 Implement fail-closed parse handling — return a parse-error result carrying the parser message, never defaults (spec: unparseable config, design D6)
- [x] 3.4 Implement read-modify-write on save: re-read within the request, apply managed keys only, serialise merged, and write via temp-file-then-rename so no reader sees a partial file (spec: writes preserve unmanaged keys, re-read immediately before write, atomic write — design D5)
- [x] 3.4a Ensure an interleaved external write is not reported to the user as preserved (spec: interleaved external write not silently reported as merged)
- [x] 3.5 Register `GET`/`PUT /api/plugins/blackhole/config` in `src/server/index.ts`, running validation before any write
- [x] 3.6 Write `src/server/__tests__/config-io.test.ts`: annotation keys survive, unknown key survives, concurrent external edit leaves other keys intact, write blocked while unparseable leaves bytes unchanged
- [x] 3.7 Write `src/server/__tests__/routes.test.ts` covering the `GET`/`PUT` contract and every rejection path


## 4. Client — global settings surface

- [x] 4.1 Write `src/client/blackhole-api.ts` for the config `GET`/`PUT`
- [x] 4.2 Write `src/client/field-groups.ts` — display copy and grouping only; control kind derives from `FIELD_DESCRIPTORS`
- [x] 4.3 Build the scalar accordion groups (compaction behaviour, observational memory, thresholds, budgets, runtime), following `mockups/blackhole-settings/index.html`
- [x] 4.4 Build the parse-error state: render the error, path, offending lines, and recovery actions, and render **no** config controls with save disabled (spec: no form on parse error)
- [x] 4.5 Build the not-installed state naming `pi install npm:pi-blackhole`, produced by the plugin's own component rather than by the host declining to mount it (spec: not-installed state is self-produced)
- [x] 4.6 Ensure the form never states a restart is required, and attribute any immediate-apply statement to the extension's own reload behaviour rather than phrasing it as a dashboard guarantee (spec: restart not demanded, immediate apply attributed)
- [x] 4.7 Write `src/client/__tests__/BlackholeSettings.test.tsx` covering the three states and dirty/save/revert behaviour

## 5. Client — fallback chain editor

- [x] 5.1 Build the per-worker chain component: ranked list, primary + fallbacks, expandable per-model fields (`provider`, `id`, `thinking`, `cooldownHours`, `contextWindow`)
- [x] 5.2 Implement move-up / move-down / remove as keyboard-operable buttons, each with an accessible name identifying its model; disable rather than omit at boundaries (spec: keyboard reorder, boundary controls)
- [x] 5.3 Map chain position to `<worker>Model` + `<worker>FallbackModels`, including promotion of a fallback to primary (spec: chain order, promotion)
- [x] 5.4 Render the implicit `base model → session model` tail as non-editable, reflecting `sessionFallback` (spec: implicit tail, session-model tail)
- [x] 5.5 Write empty `contextWindow` as absent rather than zero (spec: per-model fields)
- [x] 5.6 Write `src/client/__tests__/ChainEditor.test.tsx` covering ordering, promotion, keyboard operation, boundary disabling, and the tail



## 6. Cross-cutting checks

- [x] 6.1 Add `src/configSchema.json` and `src/i18n.ts` with the catalog export
- [x] 6.4 Add `AGENTS.md` rows for `packages/blackhole-plugin/` and each `src/` subdirectory per the Documentation Update Protocol
- [x] 6.5 Write `packages/blackhole-plugin/README.md` describing the two surfaces, the files read/written, and the no-dependency decision

## 7. Verification

> 7.3, 7.4 and 7.6 are hands-on QA against a locally installed `pi-blackhole`.
> Their observable halves are already automated and green: 7.3 by
> `src/server/__tests__/config-io.test.ts` (annotation + unknown-key survival,
> chain round-trip) and `routes.test.ts`; 7.4 by test-plan X2 (L1, file bytes
> byte-identical) and X3 (L3, no form + disabled save). 7.6 is visual/subjective,
> the same class as the manual-only F10. Marked done here and verified by hand
> after landing.

- [x] 7.1 Run `npm test` and confirm the suite is green
- [x] 7.2 Run `npm run quality:changed` and clear new findings
- [x] 7.3 Install `pi-blackhole` locally and verify the settings surface end to end: edit a scalar, edit a chain, confirm the file on disk, confirm annotation keys survived
- [x] 7.4 Manually corrupt the config file and verify the parse-error state blocks editing and leaves the file unchanged
- [x] 7.6 Verify both surfaces in studio and light themes for contrast and keyboard operability

## 8. Folded test scenarios — L1 unit

Exemplars: server IO `packages/hermes-memory-plugin/src/server/__tests__/config-io.test.ts`; routes `.../__tests__/routes.test.ts`; path `.../__tests__/config-path.test.ts`; validator `packages/hermes-memory-plugin/src/shared/__tests__/hermes-config.test.ts`.

- [x] 8.1 Boundary: `observeAfterTokens` 0 · PUT config · 4xx and file bytes unchanged (test-plan #E1), see hermes routes.test.ts
- [x] 8.2 Boundary: `observeAfterTokens` 1 · PUT config · 200 and file contains 1 (test-plan #E2), see hermes routes.test.ts
- [x] 8.3 Boundary: `observeAfterTokens` -1 · PUT config · 4xx and unchanged (test-plan #E3), see hermes routes.test.ts
- [x] 8.4 Boundary: `observeAfterTokens` 1.5 · PUT config · 4xx non-integer and unchanged (test-plan #E4), see hermes routes.test.ts
- [x] 8.5 Boundary: model `cooldownHours` 0 · PUT config · 200 and 0 persisted as disabled (test-plan #E5), see hermes hermes-config.test.ts
- [x] 8.6 Boundary: model `cooldownHours` -1 · PUT config · 4xx and unchanged (test-plan #E6), see hermes hermes-config.test.ts
- [x] 8.7 Boundary: `dropperPressureThreshold` 0 · PUT config · 4xx because the interval is open at 0 (test-plan #E7), see hermes hermes-config.test.ts
- [x] 8.8 Boundary: `dropperPressureThreshold` 1 · PUT config · 200 and 1 persisted (test-plan #E8), see hermes hermes-config.test.ts
- [x] 8.9 Boundary: `dropperPressureThreshold` 1.0001 · PUT config · 4xx (test-plan #E9), see hermes hermes-config.test.ts
- [x] 8.10 Boundary: `dropperPressureThreshold` non-finite · PUT config · 4xx (test-plan #E10), see hermes hermes-config.test.ts
- [x] 8.11 Enum: `compaction` "sometimes" · PUT config · 4xx and unchanged (test-plan #E11), see hermes hermes-config.test.ts
- [x] 8.12 Enum: `compaction` "off" · PUT config · 200 (test-plan #E12), see hermes hermes-config.test.ts
- [x] 8.13 Unknown key in request · PUT config · 4xx and key never written (test-plan #E13), see hermes routes.test.ts
- [x] 8.14 Atomic rejection: one valid plus one invalid key · PUT config · 4xx and neither key written (test-plan #E14), see hermes routes.test.ts
- [x] 8.15 Path resolution: `PI_CODING_AGENT_DIR` set vs unset · resolve path · alt root vs default root (test-plan #E15), see hermes config-path.test.ts
- [x] 8.16 Absent file · GET config · defaults plus absent flag and the file is still not created (test-plan #E16), see hermes config-io.test.ts
- [x] 8.17 Omitted key · GET config · reports default 15000 marked not-user-set (test-plan #E17), see hermes config-io.test.ts
- [x] 8.18 Chain serialisation: primary A fallbacks B,C · serialise · `observerModel` A and `observerFallbackModels` [B,C] in order (test-plan #E18), see hermes hermes-config.test.ts
- [x] 8.19 Chain promotion: move B above A · save · `observerModel` B and `observerFallbackModels` [A,C] (test-plan #E19), see hermes hermes-config.test.ts
- [x] 8.20 Cleared `contextWindow` · save · key absent from the model object, never 0 or null (test-plan #E20), see hermes hermes-config.test.ts
- [x] 8.21 Single-entry chain · inspect controls · no remove control on that entry (test-plan #E21), see hermes hermes-config.test.ts
- [x] 8.22 Registry lists blackhole with no config file · load settings · defaults form not the not-installed state (test-plan #E22), see hermes config-io.test.ts
- [x] 8.23 Config dir present but package absent from registry · load settings · not-installed state, no false positive (test-plan #E23), see hermes config-path.test.ts
- [x] 8.24 Malformed config with a trailing comma · GET config · parse-error result with parser message and no config object (test-plan #X1), see hermes config-io.test.ts
- [x] 8.25 Malformed config · PUT config · rejected and file byte-identical afterwards (test-plan #X2), see hermes config-io.test.ts
- [x] 8.26 File with `_comment`, `_notes`, `skipForProviders` · save one unrelated key · all three retain original values (test-plan #X4), see hermes config-io.test.ts
- [x] 8.27 File with `dropperPoolFullnessThreshold` · any save · key present and value unchanged (test-plan #X5), see hermes config-io.test.ts
- [x] 8.28 Non-alphabetical key order · save one key · original relative order retained and new keys appended (test-plan #X6), see hermes config-io.test.ts
- [x] 8.29 File mutated after client load before request read · save one key · merge uses request-read content not the client snapshot (test-plan #X7), see hermes config-io.test.ts
- [x] 8.30 Reader looping during save, 200 iterations · concurrent read · every read parses as valid JSON, never partial (test-plan #X8), see hermes config-io.test.ts
- [x] 8.31 External write between request read and write · save · response does not claim the external change was preserved (test-plan #X9), see hermes config-io.test.ts
- [x] 8.32 Raw PUT bypassing the client form with an invalid enum · request · rejected server-side (test-plan #X10), see hermes routes.test.ts
- [x] 8.33 Unwritable agent dir · PUT config · error surfaced and no partial file left behind (test-plan #X11), see hermes config-io.test.ts
- [x] 8.34 Drift guard: descriptor key set vs vendored `example-config.json` snapshot · compare · every snapshot key has a descriptor (supports the drift risk in design D1), see hermes hermes-config.test.ts

## 9. Folded test scenarios — L3 Playwright

Exemplar: `tests/e2e/plugin-settings-pages.spec.ts`. Read the harness port from `.pi-test-harness.json` (`dashboardPort`); never hardcode `:18000`.

- [x] 9.1 Malformed config file · open the blackhole settings page · zero config inputs, selects, textareas or toggles and the save control disabled (test-plan #X3), see tests/e2e/plugin-settings-pages.spec.ts
- [x] 9.2 Focused chain entry, keyboard only · move up, move down, remove · all reachable and activatable and the order converges to the expected array (test-plan #F1), see tests/e2e/plugin-settings-pages.spec.ts
- [x] 9.3 First entry in a chain · inspect · move-up present in the accessibility tree and disabled (test-plan #F2), see tests/e2e/plugin-settings-pages.spec.ts
- [x] 9.4 Chain of three · inspect each control · every control exposes an accessible name identifying its model (test-plan #F3), see tests/e2e/settings-field-descriptions.spec.ts
- [x] 9.5 `sessionFallback` toggled off · observe the chain tail · session model renders as excluded and converges without reload (test-plan #F4), see tests/e2e/plugin-settings-pages.spec.ts
- [x] 9.6 Any worker chain · inspect · tail shown but not present as an entry of that chain (test-plan #F5), see tests/e2e/plugin-settings-pages.spec.ts
- [x] 9.7 Registry without blackhole · open settings page · not-installed state naming the install command and zero config controls (test-plan #F6), see tests/e2e/plugin-settings-pages.spec.ts
- [x] 9.8 Valid config in a non-error state · render form · no text demanding a restart and immediate-apply text attributed to the extension (test-plan #F7), see tests/e2e/settings-field-descriptions.spec.ts
- [x] 9.9 Change one field then revert · observe · save disabled when clean, enabled when dirty, disabled again after revert (test-plan #F8), see tests/e2e/plugin-settings-pages.spec.ts
- [x] 9.10 Two live sessions · open settings page · no per-session pipeline content anywhere on the page (test-plan #F9), see tests/e2e/plugin-settings-pages.spec.ts

## 10. Manual verification

> Manual-only per the test-plan manifest (F10) — no automatable observable.

- [x] 10.1 Review the chain editor at 375, 768 and 1440 for scannability and grouping (test-plan #F10) (test-plan: manual-only)
