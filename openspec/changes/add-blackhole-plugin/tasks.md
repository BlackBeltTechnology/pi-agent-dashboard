## 1. Package scaffold

- [ ] 1.1 Create `packages/blackhole-plugin/` with `package.json`, `tsconfig.json` (extends `../../tsconfig.base.json`, `jsx: react-jsx`, `noEmit`, DOM libs) and `vitest.config.ts` (react plugin, jsdom, `pool: forks`, globalSetup `@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts`), mirroring `packages/hermes-memory-plugin/`
- [ ] 1.2 Declare the `pi-dashboard-plugin` manifest: id `blackhole`, `displayName`, `priority`, `client`, `server`, `configSchema`, `i18nCatalog`, and `requires.piExtensions: ["pi-blackhole"]`
- [ ] 1.3 Declare the three claims: `settings-section`, `session-card-memory`, `content-view`
- [ ] 1.4 Write `src/__tests__/manifest.test.ts` asserting the manifest validates, the three claims are present, and no dependency section references `pi-blackhole` (spec: activation, no-dependency scenario)
- [ ] 1.5 Register the package in the workspace and confirm `pnpm install` resolves it

## 2. Shared config model (the validation boundary)

- [ ] 2.1 Write `src/shared/blackhole-config.ts`: re-declared `BlackholeConfig` and `ModelRef` interfaces with a `SOURCE-VERSION PIN: pi-blackhole@<version>` comment (design D1)
- [ ] 2.2 Add `FIELD_DESCRIPTORS` (kind, enum values, bounds, integer-ness) and `DEFAULTS` covering every managed key
- [ ] 2.3 Write the validator: reject unknown keys, enum violations, type violations, bound violations; reject atomically
- [ ] 2.4 Write `src/shared/__tests__/blackhole-config.test.ts` covering each rejection scenario plus atomicity (spec: validation is the security boundary)
- [ ] 2.5 Write a drift test asserting the known-key set still covers blackhole's published `example-config.json` (design risk: config drift)

## 3. Server — global config routes

- [ ] 3.1 Write `src/server/config-path.ts` resolving `<agentDir>/pi-blackhole/`, honouring `PI_CODING_AGENT_DIR`; test both branches (spec: config file location)
- [ ] 3.2 Write `src/server/config-io.ts`: read returning parsed config, resolved path, and unmanaged-key set; absent file returns defaults flagged as absent and creates nothing
- [ ] 3.3 Implement fail-closed parse handling — return a parse-error result carrying the parser message, never defaults (spec: unparseable config, design D6)
- [ ] 3.4 Implement read-modify-write on save: re-read, apply managed keys only, serialise merged (spec: writes preserve unmanaged keys, design D5)
- [ ] 3.5 Register `GET`/`PUT /api/plugins/blackhole/config` in `src/server/index.ts`, running validation before any write
- [ ] 3.6 Write `src/server/__tests__/config-io.test.ts`: annotation keys survive, unknown key survives, concurrent external edit leaves other keys intact, write blocked while unparseable leaves bytes unchanged
- [ ] 3.7 Write `src/server/__tests__/routes.test.ts` covering the `GET`/`PUT` contract and every rejection path

## 4. Server — per-session route

- [ ] 4.1 Write `src/server/session-state.ts` resolving `<agentDir>/pi-blackhole/<id>-pending.json` and reading `pi-blackhole-cooldown.json`
- [ ] 4.2 Validate `:id` against a canonical UUID shape before any filesystem access; reject separators and `..` (spec: id validated, traversal rejected)
- [ ] 4.3 Treat an absent file as no-recorded-activity, not an error (spec + design D8)
- [ ] 4.4 Treat an unparseable per-session file as no-recorded-activity, without surfacing an error (design risk: torn read)
- [ ] 4.5 Derive per-worker resolved model + reason by combining the config chain with active cooldown entries
- [ ] 4.6 Register `GET /api/plugins/blackhole/session/:id`; register no mutating handler
- [ ] 4.7 Write `src/server/__tests__/session-state.test.ts`: id validation, traversal rejection, absent file, torn file, cooldown-driven resolution, and an assertion that the per-session file's bytes and mtime are unchanged after a request (spec: read-only)

## 5. Client — global settings surface

- [ ] 5.1 Write `src/client/blackhole-api.ts` for the config `GET`/`PUT`
- [ ] 5.2 Write `src/client/field-groups.ts` — display copy and grouping only; control kind derives from `FIELD_DESCRIPTORS`
- [ ] 5.3 Build the scalar accordion groups (compaction behaviour, observational memory, thresholds, budgets, runtime), following `mockups/blackhole-settings/index.html`
- [ ] 5.4 Build the parse-error state: render the error, path, offending lines, and recovery actions, and render **no** config controls with save disabled (spec: no form on parse error)
- [ ] 5.5 Build the not-installed state naming `pi install npm:pi-blackhole`
- [ ] 5.6 State immediate-apply semantics in the non-error state; do not claim a restart is needed (spec: apply semantics)
- [ ] 5.7 Write `src/client/__tests__/BlackholeSettings.test.tsx` covering the three states and dirty/save/revert behaviour

## 6. Client — fallback chain editor

- [ ] 6.1 Build the per-worker chain component: ranked list, primary + fallbacks, expandable per-model fields (`provider`, `id`, `thinking`, `cooldownHours`, `contextWindow`)
- [ ] 6.2 Implement move-up / move-down / remove as keyboard-operable buttons, each with an accessible name identifying its model; disable rather than omit at boundaries (spec: keyboard reorder, boundary controls)
- [ ] 6.3 Map chain position to `<worker>Model` + `<worker>FallbackModels`, including promotion of a fallback to primary (spec: chain order, promotion)
- [ ] 6.4 Render the implicit `base model → session model` tail as non-editable, reflecting `sessionFallback` (spec: implicit tail, session-model tail)
- [ ] 6.5 Write empty `contextWindow` as absent rather than zero (spec: per-model fields)
- [ ] 6.6 Write `src/client/__tests__/ChainEditor.test.tsx` covering ordering, promotion, keyboard operation, boundary disabling, and the tail

## 7. Client — session-card subcard

- [ ] 7.1 Build the `session-card-memory` component: worker indicators, exact cursor lag, and the approximate proximity meter, following `mockups/blackhole-settings/session-card.html`
- [ ] 7.2 Give each worker indicator a textual identifier and an accessible name describing its state (spec: not colour alone, design D9)
- [ ] 7.3 Position meter threshold marks proportionally to their values (spec: proportional meter)
- [ ] 7.3a Render cursor lag as an exact figure, visually distinct from the approximate meter (spec: cursor lag is exact, exact figure alongside)
- [ ] 7.3b Mark the proximity meter as approximate in its visible label; render no exact token count or percentage for it; expose the explanation of why the two quantities differ (spec: approximation disclosed, no false precision — design D12/D13)
- [ ] 7.3c Omit the proximity meter when `contextTokens` or `compactAfterTokens` is unavailable, without hiding the rest of the subcard (spec: proximity omitted when inputs unavailable)
- [ ] 7.4 Implement the conditional advisory row for cooling-model and pending-batch states; keep the healthy state to one row (spec + design D10)
- [ ] 7.5 Implement the workers-off state without a progress meter
- [ ] 7.6 Implement the no-activity-yet state, visually distinct from workers-off and from not-installed (spec + design D8)
- [ ] 7.7 Make the detail-view affordance always available, not gated on the approximate proximity value; assert no automatic alert or status change is raised at any proxy threshold (spec: never drives an automatic alarm, detail view always reachable)
- [ ] 7.8 Write `src/client/__tests__/BlackholeMemorySubcard.test.tsx` covering all five states, the accessible-name assertions, the approximation-marking and no-false-precision rules, the missing-inputs case, and an assertion that no threshold on the proxy triggers an alert

## 8. Client — detail view

- [ ] 8.1 Build the `content-view` claim rendering per-worker cursors and resolved models
- [ ] 8.2 Label every value with its source file (spec: provenance, design D11)
- [ ] 8.3 Add the footer explaining that observations and reflections live in the session transcript
- [ ] 8.4 Write a test asserting no observation/reflection counts, in-flight flags, or last-error strings are rendered (spec: in-memory-only values absent)
- [ ] 8.5 Attribute compaction proximity to the dashboard's own token accounting and state that blackhole measures a different, unpersisted quantity (spec: proximity carries its caveat)

## 9. Cross-cutting checks

- [ ] 9.1 Add `src/configSchema.json` and `src/i18n.ts` with the catalog export
- [ ] 9.2 Write a repo-lint test asserting `packages/shared/src/dashboard-plugin/slot-types.ts` and `slot-props.ts` are unmodified by this change (spec: no shared slot definitions change)
- [ ] 9.3 Write a test asserting the settings surface renders no per-session pipeline state (spec: detail view is session-scoped)
- [ ] 9.4 Add `AGENTS.md` rows for `packages/blackhole-plugin/` and each `src/` subdirectory per the Documentation Update Protocol
- [ ] 9.5 Write `packages/blackhole-plugin/README.md` describing the two surfaces, the files read/written, and the no-dependency decision

## 10. Verification

- [ ] 10.1 Run `npm test` and confirm the suite is green
- [ ] 10.2 Run `npm run quality:changed` and clear new findings
- [ ] 10.3 Install `pi-blackhole` locally and verify the settings surface end to end: edit a scalar, edit a chain, confirm the file on disk, confirm annotation keys survived
- [ ] 10.4 Manually corrupt the config file and verify the parse-error state blocks editing and leaves the file unchanged
- [ ] 10.5 Verify the subcard against a real session: confirm the per-session file path matches `session.id`, and confirm the no-activity-yet state before any worker has run
- [ ] 10.5a With blackhole running, compare the rendered proximity against `/blackhole-memory status` in the same session and record the observed divergence in the change notes — evidence for whether the approximation is useful enough to keep, and input to the upstream ask in design.md Open Questions
- [ ] 10.6 Verify both surfaces in studio and light themes for contrast and keyboard operability
