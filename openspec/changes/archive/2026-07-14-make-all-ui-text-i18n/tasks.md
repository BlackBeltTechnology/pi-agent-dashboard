## 1. i18n infrastructure (foundation)

- [x] 1.1 Add `hu` to `Language`, `LANGUAGE_OPTIONS` (`{ value: "hu", label: "Magyar" }`), and `normalizeLanguage` (`hu`, `hu-hu`, `hu-*`) in `packages/client/src/lib/i18n.tsx`.
- [x] 1.2 Define the structured-namespace taxonomy (D1) and add a `LEGACY_ALIASES` map so existing `auto.*`/flat keys keep resolving during migration.
- [x] 1.3 Add a catalog-parity dev script (D6): every key in the source set exists in `zh-CN` and `hu`; fail on gaps.
- [x] 1.4 Add an i18n lint (audit ripgrep patterns) that flags hardcoded JSX text / `placeholder|aria-label|title|alt` / user-facing `throw`/`message:` not wrapped in `t()`.
- [x] 1.5 Tests: unit-test `t()` fallback order (key → fallback → key), `normalizeLanguage("hu-HU")`, and interpolation for all three languages.

## 2. Zone 1 — client strings (~466)

- [x] 2.1 Migrate `auto.*` + flat legacy keys to structured keys (codemod + review); update call sites. (`LEGACY_ALIASES` kept populated as a robustness backstop rather than emptied — no `auto.*` remains in any dictionary; deviation noted.)
- [x] 2.2 Wrap zero-coverage files: 6 Gateway components, `PairLanding`, `OpenSpecStepper`, `OpenSpecActivityBadge` (96 keys, zh+hu).
- [x] 2.3 Wrap client hooks (`useInstalledPackages`, `useMessageHandler`, `useImagePaste`, `useMainSpecsReader`, +9 more) — 23 keys.
- [x] 2.4 Wrap `lib/` displayed strings (`format`, `session-status-visuals`, `themes`, `gateway-setup`, `gateway-api`, `editor-api`, `tool-summary`) — 36 keys.
- [x] 2.5 Wrap remaining leaks in i18n-aware components (`SettingsPanel`, `SessionCard`, `SpawnErrorBanner`, `WorktreeActionsMenu`, `SessionOpenSpecActions`) — 74 keys. (Other components with residual leaks flagged by lint remain follow-up.)
- [x] 2.6 i18n lint CLEAN under `packages/client/src` (0 hardcoded user-facing strings). Wrapped all residual real leaks; dev-only technical throws + proper-noun `<code>` identifiers excluded with rationale.

## 3. Zone 2 — per-plugin i18n contract (~180)

- [x] 3.1 Add optional `i18nCatalog?` (named export) + `PluginI18nCatalog` type to the plugin registration type (`packages/shared/src/dashboard-plugin/manifest-types.ts`); generated registry imports+wires it.
- [x] 3.2 Runtime: `registerPluginCatalog(id, catalog)` prefixes keys with `plugin.<id>.` into `dictionaries[lang]`; `t`+`language` on `PluginContextValue` (shell-wired); scoped `useT`/`useLanguage` hooks auto-prefix.
- [x] 3.3 Tests: plugin catalog merge + scoped useT (namespacing, no collision, language switch, missing-catalog fallback) — client i18n.test.ts + runtime plugin-i18n.test.tsx.
- [x] 3.4 Per-plugin catalogs authored + wired for ALL 7 plugins: roles(22), flows(35), automation(103), goal(80), kb(44), subagents(22), flows-anthropic-bridge(15) = 321 `plugin.<id>.*` keys (zh+hu). Each: src/i18n.ts `catalog` + `useT` wrapping + `i18nCatalog` manifest field + generated-registry wiring. (`dashboard-plugin-runtime` is the runtime host, not a catalog-plugin; its own UI chrome routes through core `t`.)
- [x] 3.5 i18n lint clean across all plugin packages (demo-plugin scaffold + documented dead code excluded with rationale). Parity validates all 7 plugin catalogs.

## 4. Zone 3 — server/extension code-mapping (~65)

- [x] 4.1 Shared: `code?`+`vars?` on resume_result, spawn_result, spawn_error, force_kill_result (`message?` retained as fallback).
- [x] 4.2 Client: `lib/server-error.ts` (`errKeyForCode` + `resolveServerMessage`); unknown code shows `serverMessage`, never a bare code (tested).
- [x] 4.3 Codes on `session-action-handler.ts` resume/force_kill sites + `err.resume.*` keys. `model-proxy-routes.ts` intentionally EXCLUDED: its errors are OpenAI/Anthropic API-format responses to external API clients (no dashboard-UI render path — verified via grep), so translating them would corrupt the API contract.
- [x] 4.4 `git-routes.ts`: 7 stable codes on UI-facing errors; `git-api.ts` threads `code` through `resolveServerMessage` so they translate. `provider-probe.ts`/`pi-core-updater.ts` deliberately skipped — their consuming routes drop the `code` field (tagging would be dead) and messages are fully dynamic; graceful English fallback applies.
- [x] 4.5 Authored `err.*` keys: spawn-failure codes, `err.resume.*`, `err.git.*` (7), `err.doctor.*` (33) — all zh+hu, parity-checked.
- [x] 4.6 `DoctorCheck` gains `code?`/`vars?`; 33 stable doctor messages tagged (doctor-core.ts + doctor-routes.ts) + `err.doctor.*` keys; `DiagnosticsSection` on-screen render goes through `resolveServerMessage`. Dynamic `detail` dumps (stderr/stacks) + pure data-readout `ok` rows left verbatim by design; copy-export paths unchanged for fidelity.
- [x] 4.7 Tests: server-error.test.ts — coded `{code,vars}` renders translated; un-mapped code falls back to English `message`.

## 5. Translations — completeness

- [x] 5.1 Filled every migrated/new key in `zh-CN` (reused `auto.*` zh values via the mapping + machine-seeded the rest).
- [x] 5.2 Authored full `hu` for the entire catalog (997 base + err.* + Zone-1 batch + roles plugin), machine-seeded via translation subagents, grouped by structured key.
- [x] 5.3 Parity check green: 0 missing keys across `zh-CN`/`hu` (1237 core keys) + roles plugin catalog.

## 6. Validation

- [x] 6.1 `npm test` green — full monorepo: 1041 files / 10181 tests pass, 0 failures (incl. new i18n/server-error/plugin-i18n/validator tests).
- [x] 6.2 Automated evidence: `i18n-language-switch.integration.test.tsx` switches language and asserts core `t()`, a registered plugin catalog, AND a Zone-3 server code all re-resolve in zh-CN + hu with no English leak. (Live visual sweep still recommended at QA, but the render path is proven end-to-end.)
- [x] 6.3 Parity green (`npm run i18n:parity`) across core (1300+) + all 7 plugin catalogs. Lint (`npm run i18n:lint`, `--strict` gate) is CLEAN repo-wide across shipped UI (dev-only throws / proper-noun `<code>` / scaffold / dead code excluded with rationale).
