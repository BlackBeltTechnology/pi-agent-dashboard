## 1. i18n infrastructure (foundation)

- [x] 1.1 Add `hu` to `Language`, `LANGUAGE_OPTIONS` (`{ value: "hu", label: "Magyar" }`), and `normalizeLanguage` (`hu`, `hu-hu`, `hu-*`) in `packages/client/src/lib/i18n.tsx`.
- [x] 1.2 Define the structured-namespace taxonomy (D1) and add a `LEGACY_ALIASES` map so existing `auto.*`/flat keys keep resolving during migration.
- [x] 1.3 Add a catalog-parity dev script (D6): every key in the source set exists in `zh-CN` and `hu`; fail on gaps.
- [x] 1.4 Add an i18n lint (audit ripgrep patterns) that flags hardcoded JSX text / `placeholder|aria-label|title|alt` / user-facing `throw`/`message:` not wrapped in `t()`.
- [x] 1.5 Tests: unit-test `t()` fallback order (key → fallback → key), `normalizeLanguage("hu-HU")`, and interpolation for all three languages.

## 2. Zone 1 — client strings (~466)

- [x] 2.1 Migrate `auto.*` + flat legacy keys to structured keys (codemod + review); update call sites. (`LEGACY_ALIASES` kept populated as a robustness backstop rather than emptied — no `auto.*` remains in any dictionary; deviation noted.)
- [ ] 2.2 Wrap zero-coverage files: 6 Gateway components, `PairLanding`, `OpenSpecStepper`, `OpenSpecActivityBadge`.
- [ ] 2.3 Wrap all 14 hooks (`useInstalledPackages`, `useMessageHandler`, `useImagePaste`, `useMainSpecsReader`, …) — `setError`/`throw`/toast strings.
- [ ] 2.4 Wrap `lib/` displayed strings (`tool-summary`, `session-status-visuals`, `format` time units, `themes` names, `gateway-setup`, `*-api` error fallbacks).
- [ ] 2.5 Wrap remaining leaks in i18n-aware components (`SettingsPanel` 29, `SessionCard` 27, `SpawnErrorBanner` 17, `WorktreeActionsMenu`, `SessionOpenSpecActions`, …).
- [ ] 2.6 Verify no lint (1.4) hits remain under `packages/client/src`.

## 3. Zone 2 — per-plugin i18n contract (~180)

- [ ] 3.1 Add optional `i18n?: { catalog }` to the plugin registration type (`packages/shared/src/dashboard-plugin/*`).
- [ ] 3.2 Runtime: `mergePluginCatalog(id, catalog)` prefixes keys with `plugin.<id>.` into `dictionaries[lang]`; expose `t` + `language` on `SlotContextValue`; provide auto-prefixing scoped `t`.
- [ ] 3.3 Tests: plugin catalog merge (namespacing, no collision, language switch re-merge, missing-catalog fallback to source).
- [ ] 3.4 Author `zh-CN` + `hu` catalog and wrap strings per plugin: `flows-plugin` (22 files, largest), `automation-plugin`, `goal-plugin`, `kb-plugin`, `roles-plugin`, `subagents-plugin`, `dashboard-plugin-runtime`, `flows-anthropic-bridge-plugin`.
- [ ] 3.5 Verify lint (1.4) clean across all plugin packages.

## 4. Zone 3 — server/extension code-mapping (~65)

- [ ] 4.1 Shared: add `code?: string` + `vars?` to user-facing error/result/status shapes (retain `message?` as fallback).
- [ ] 4.2 Client: `err.<domain>.<code>` map + resolver `t(errKey, vars, serverMessage)`; unknown code → show `serverMessage`, never a bare code.
- [ ] 4.3 Add codes to high-visibility emit sites first: `browser-handlers/session-action-handler.ts` (10), `model-proxy-routes.ts` (5).
- [ ] 4.4 Add codes to `git-operations.ts`, `provider-probe.ts`, `pi-core-updater.ts`, extension emit sites.
- [ ] 4.5 Author `err.*` keys for the ~34% that already ship codes (`auth-gate`, `spawn-preflight`, `process-manager`, `git-routes`).
- [ ] 4.6 (Deferred/optional) tag `doctor-core.ts` (25 message/detail) — developer panel, lower priority.
- [ ] 4.7 Tests: a Zone-3 emitted `{code,vars}` renders translated in `zh-CN`/`hu`; un-mapped code falls back to English `message`.

## 5. Translations — completeness

- [ ] 5.1 Fill every migrated/new key in `zh-CN` (reuse existing `auto.*` zh values via the mapping).
- [ ] 5.2 Author full `hu` for the entire catalog (client + `plugin.<id>.*` + `err.*`), grouped for review.
- [ ] 5.3 Run parity check (1.3): 0 missing keys across `zh-CN`/`hu`/plugin catalogs.

## 6. Validation

- [ ] 6.1 `npm test` green (i18n unit tests + existing suite).
- [ ] 6.2 Manual: switch language to `hu` and `zh-CN`; walk client + each plugin surface + trigger a Zone-3 error (bad git op, model-proxy failure) — confirm no raw English leaks.
- [ ] 6.3 Lint (1.4) clean repo-wide; parity check (1.3) green in CI.
