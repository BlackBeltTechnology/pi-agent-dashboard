# Tasks

> Scenario-design / `test-plan.md` orchestration was intentionally skipped for this scaffold
> (planning opted out). Test tasks below are hand-noted TDD steps; run `scenario-design`
> before the worktree boundary if this change is promoted to the full `plan-proposal` flow.
>
> Checkboxes reconciled against the tree on 2026-07-21. `[x]` = deliverable present in code
> and its tests pass; notes flag deviations from the literal task text.

## 1. Preconditions (read before writing)

- [x] 1.1 Read `packages/roles-plugin/package.json` + `packages/roles-plugin/src/index.tsx` + `RolesSettingsSection.tsx` — the client-only manifest shape, the `settings-section`/`general` claim, and the Save/Reload deferred-persistence UX this plugin mirrors.
- [x] 1.2 Read `packages/flows-anthropic-bridge-plugin/src/client.tsx` — confirm the relative `fetch("/api/...")` pattern a plugin uses to reach a core REST endpoint (no `getApiBase` import).
- [x] 1.3 Read `packages/dashboard-plugin-runtime/README.md` (manifest + claims + PluginContext API) and `packages/dashboard-plugin-runtime/src/vite-plugin/index.ts` — confirm auto-discovery + generated registry.
- [x] 1.4 Read `packages/server/src/routes/system-routes.ts` (`PUT /api/config`) + `packages/shared/src/config.ts` `parseGrammarConfig` — confirm the `{ grammar }` partial round-trips + clamp ranges.
- [x] 1.5 Read `packages/server/src/grammar/grammar-service.ts` `getGrammarHealth` + `packages/server/src/routes/grammar-routes.ts` — confirm the `GET /api/grammar/health` shape for the reachability indicator.
- [x] 1.6 Run `npm test 2>&1 | tee /tmp/grammar-settings-baseline.log` and capture the green baseline.

## 2. Package scaffold + manifest

- [x] 2.1 Create `packages/grammar-settings-plugin/package.json` with the `pi-dashboard-plugin` manifest (id `grammar-settings`, priority 100, `client: "./src/index.tsx"`, `i18nCatalog`, one `settings-section`/`general` claim; `private: true`; no `server`, no `configSchema`) — mirror `roles-plugin`.
- [x] 2.2 Create `packages/grammar-settings-plugin/src/index.tsx` — named export `GrammarSettings`.
- [x] 2.3 Add `tsconfig` / lint wiring consistent with `roles-plugin` (source-entry package, no build step). (matches `roles-plugin` — neither package ships a `tsconfig`)
- [x] 2.4 Verify discovery: dev/build regenerates `packages/client/src/generated/plugin-registry.tsx` with the `grammar-settings` entry and the `GrammarSettings` claim.

## 3. Settings component

- [x] 3.1 Create `packages/grammar-settings-plugin/src/GrammarSettings.tsx` — controls for `enabled`, `autoCheck`, `backend`, `debounceMs`, `minChars`, `maxChars`, `language`, `languagetool.url`, and conditional `llm.provider`/`llm.model`.
- [x] 3.2 Load: `GET /api/config` on mount → populate from `.grammar` (disabled defaults when absent). Only import from `dashboard-plugin-runtime` + `pi-dashboard-shared`; use relative `fetch`.
- [x] 3.3 Save: `PUT /api/config` with `{ grammar: <edited block> }`; re-sync from the reloaded config in the response. Reload: re-`GET /api/config`, discard local edits. Dirty marker gates Save/Reload (Decision 3A).
- [x] 3.4 Reachability: drive a healthy/unhealthy indicator from `GET /api/grammar/health` when `backend === "languagetool"`; add a re-probe ("Test") affordance.
- [x] 3.5 Surface UI hints for the server clamp ranges (debounce 300–10000, minChars 1–500, maxChars 100–20000) without trusting client-side clamping.

## 4. i18n

- [x] 4.1 Create `packages/grammar-settings-plugin/src/i18n/` en catalog for every string; wire via the manifest `i18nCatalog` + runtime `useT`. (shipped as a single `src/i18n.ts` file rather than an `i18n/` dir)
- [x] 4.2 Add the `hu` catalog with translations for all strings (match the parent feature's Hungarian coverage).

## 5. Tests (TDD)

- [x] 5.1 (TDD) Component test: mount → `GET /api/config` populates controls; absent `grammar` → disabled defaults. Verify red first.
- [x] 5.2 (TDD) Save test: editing `debounceMs` and clicking Save issues `PUT /api/config` with a `{ grammar }` partial containing the edit; other keys untouched; nested `languagetool`/`llm` preserved.
- [x] 5.3 (TDD) Clamp re-sync test: submitting `debounceMs: 50` re-syncs the form to the server-clamped `300` from the reload response (mock the endpoint).
- [x] 5.4 (TDD) Backend-conditional test: `llm` fields hidden for `languagetool`, shown for `llm`.
- [x] 5.5 (TDD) Reachability test: `health.languagetool.reachable` true/false drives the correct indicator.
- [x] 5.6 (TDD) Manifest/discovery test: a repo-lint-style assertion that the manifest declares the `settings-section`/`general` claim and resolves `GrammarSettings` (mirror any existing plugin-manifest test). (`src/__tests__/manifest.test.ts`)
- [x] 5.7 Run `npm test` green; run `npm run quality:changed` and clear new findings. (plugin suite green 2026-07-21: `GrammarSettings.test.tsx` + `manifest.test.ts`; `quality:changed` not re-run this pass)

## 6. Documentation

- [x] 6.1 Create `packages/grammar-settings-plugin/AGENTS.md` — one row per file (manifest, `index.tsx`, `GrammarSettings.tsx`, i18n), with `See change: add-grammar-settings-plugin`.
- [ ] 6.2 (DocScribe) Add a one-line pointer from the composer-grammar section of `docs/architecture.md` to the settings plugin (caveman style; delegated). — not done (the "Composer grammar check" section has no pointer to `grammar-settings-plugin`)

## 7. Verify + land

- [x] 7.1 `openspec validate add-grammar-settings-plugin --strict` passes.
- [ ] 7.2 Manual: enable the plugin, open Settings → General, toggle grammar on, change backend/URL, Save, confirm `~/.pi/dashboard/config.json#grammar` updated and `/api/grammar/health` reflects reachability. (test-plan: manual-only) — pending
- [ ] 7.3 (review-code) Non-trivial change + tests green → run the inline code review before commit. — pending

## Status — verification (2026-07-21)

Re-verified against the working tree; plugin suite green (`GrammarSettings.test.tsx`,
`manifest.test.ts`). Package `packages/grammar-settings-plugin/` present with manifest,
`GrammarSettings.tsx` (354 lines: all controls + LT reachability + `llm` model picker +
Save/Reload dirty gating), `i18n.ts` (en + hu), and `AGENTS.md`; auto-discovered into
`packages/client/src/generated/plugin-registry.tsx`.

DONE: §1–§5, §6.1, §7.1.

OUTSTANDING: §6.2 docs pointer, §7.2 manual smoke, §7.3 inline review; `quality:changed` re-run.
Also note: the package is not yet committed (untracked), and `packages/AGENTS.md` has no row
for the new plugin package.
