# Tasks

> Checkboxes reconciled against the tree on 2026-07-21 (see "Status — verification" at the
> bottom). `[x]` = deliverable present in code and its tests pass; notes flag superseded or
> deviated items.

## 1. Preconditions (read before writing)

- [x] 1.1 Read `packages/client/src/components/chat/CommandInput.tsx` — confirm the controlled `draft` / `onDraftChange` contract, the toolbar button pattern, `sessionStatus`, and the slash/`!` command interception (`DASHBOARD_LOCAL_COMMANDS`, `parseViewCommand`).
- [x] 1.2 Read `packages/client/src/components/session/QueuePanel.tsx` and its mount site in `packages/client/src/App.tsx` — this is the precedent for a panel rendered directly above the composer. Confirm where `GrammarPanel` mounts.
- [x] 1.3 Read `packages/shared/src/config.ts` — find `DashboardConfig`, `loadConfig()`, and the `parseOpenSpecPollConfig` validator/clamp pattern this change mirrors.
- [x] 1.4 Read `packages/server/src/server.ts` route-registration block and one existing route (`packages/server/src/routes/provider-routes.ts`) — confirm how new routes register under the auth chain.
- [x] 1.5 Read `packages/server/src/auth/provider-auth-handlers.ts` and the providers-test probe path — confirm how outbound provider calls resolve credentials server-side (the `llm` backend reuses this).
- [x] 1.6 Read `packages/client/src/lib/i18n/i18n.tsx` and `i18n-hu.ts` — confirm how to add + translate new strings.
- [x] 1.7 Run `npm test 2>&1 | tee /tmp/grammar-baseline.log` and capture the green baseline.

## 2. Shared types + config

- [x] 2.1 Add `GrammarIssueKind`, `GrammarSuggestion`, `GrammarCheckResult` to `packages/shared/src/` (exported for both client and server) per design Decision 3.
- [x] 2.2 Extend `DashboardConfig` in `packages/shared/src/config.ts` with the `grammar?` block.
- [x] 2.3 Add `parseGrammarConfig(raw)` with coercion/clamping + defaults (mirror `parseOpenSpecPollConfig`); wire into `loadConfig()`.
- [x] 2.4 (TDD) Write `packages/shared/src/__tests__/config-grammar.test.ts` first: missing-block default, numeric clamping, unknown-field ignore, invalid-backend fallback. Verify red, then green.

## 3. Server: grammar service + backends

- [x] 3.1 ~~Create `packages/server/src/grammar/grammar-types.ts` (re-export shared shapes; define the internal `GrammarBackend` interface).~~ **Superseded** — server imports shapes directly from `@blackbelt-technology/pi-dashboard-shared/grammar-types.js`; the service dispatches by `config.backend` without a separate `GrammarBackend` interface, so no server-side types file was needed.
- [x] 3.2 Create `packages/server/src/grammar/backends/languagetool.ts` — POST `<url>/v2/check`, map `matches` → suggestions (drop no-replacement matches), derive `correctedText` (non-overlapping, right-to-left), compute `summary` from kind counts. Honour the `AbortSignal`.
- [x] 3.3 Create `packages/server/src/grammar/backends/llm.ts` — structured-prompt call to `grammar.llm` provider/model (temperature 0), defensive JSON parse → `GrammarCheckResult`; never leak credentials or raw provider bodies. **Amended 2026-07-21**: credential/model resolution rewired off `providers.json` onto the OAuth/api_key-aware `LlmModelRegistry` + pi-ai `streamSimple` (see the proposal's "Amendment — 2026-07-21").
- [x] 3.4 Create `packages/server/src/grammar/grammar-service.ts` — `checkGrammar(text, opts)`: re-read config, clip to `maxChars` (set `truncated`), reject empty, dispatch by `backend`, map failures to typed error codes.
- [x] 3.5 (TDD) Unit tests: LanguageTool mapping + `correctedText` from fixtures; LLM malformed-JSON → safe result; maxChars clipping; empty-text rejection; backend-unreachable/timeout error codes (mock fetch/provider). (`grammar-languagetool.test.ts`, `grammar-llm.test.ts`, `grammar-service.test.ts`)

## 4. Server: routes

- [x] 4.1 Create `packages/server/src/routes/grammar-routes.ts`: `POST /api/grammar/check` (auth-gated; `409 grammar_disabled` when off; `400 empty_text`; `502 backend_unreachable`) and `GET /api/grammar/health`.
- [x] 4.2 Register the routes in `packages/server/src/server.ts` under the auth chain.
- [x] 4.3 Add one structured log line per check (backend, language, length, latency, suggestion count, error code) — NO draft text. (observability-instrumentation) (verified: log fields are `{backend, language, length, ms, suggestions, truncated}` / `{backend, length, ms, code}` — no text)
- [x] 4.4 (TDD) Route tests: auth-gate, disabled 409, empty 400, success shape, health probe (backend + LT reachability), error mapping. (`grammar-routes.test.ts`)

## 5. Client: check hook

- [x] 5.1 Create `packages/client/src/hooks/useGrammarCheck.ts` — manual + debounced-auto trigger, `AbortController` cancel-on-change, loading/error state, POST to `/api/grammar/check`. Skip auto-check while `streaming` and for `/`, `!`, `!!` drafts, and when draft < `minChars`.
- [x] 5.2 (TDD) Hook tests: debounce fires once after idle; new keystroke aborts + resets; below-minChars no-op; streaming skip; command/shell skip. (`useGrammarCheck.test.tsx`)

## 6. Client: panel + composer wiring

- [x] 6.1 Create `packages/client/src/components/chat/GrammarPanel.tsx` — diff-highlighted corrected sentences (struck/error original + success replacement), summary, per-suggestion Accept/Dismiss + message, Apply-all, close. Theme-aware, keyboard-navigable, a11y-labelled.
- [x] 6.2 Implement offset-safe apply helpers (accept-one with re-find/stale handling; apply-all = `correctedText`) editing the controlled `draft` via `onDraftChange`. Re-run check after accept-one (design Decision 4).
- [x] 6.3 Modify `CommandInput.tsx` — add the Check toolbar button + keyboard shortcut; feed `draft`/`sessionStatus` to `useGrammarCheck`; expose apply callbacks. All behind `grammar.enabled`.
- [x] 6.4 Mount `GrammarPanel` above the composer in `App.tsx` (sibling to `QueuePanel`); abort + hide on session switch / draft clear.
- [x] 6.5 (TDD) Component tests: panel renders suggestions/summary; Accept/Dismiss/Apply-all draft mutations; stale-suggestion disabled Accept; no-auto-send; disabled-feature renders nothing. (`GrammarPanel.test.tsx`)

## 7. Client + server: settings

- [x] 7.1 ~~Add a "Grammar & Spelling" settings section...~~ **Delivered as the sibling change `add-grammar-settings-plugin`** — a `settings-section` plugin (`packages/grammar-settings-plugin/`) editing `config.grammar` via `GET`/`PUT /api/config`, with the `GET /api/grammar/health` reachability indicator and an `llm` model picker. Not built as a core client+server section here.
- [x] 7.2 ~~(TDD) Settings tests...~~ **Delivered in the plugin package** (`packages/grammar-settings-plugin/src/__tests__/GrammarSettings.test.tsx`): persistence round-trip, clamp re-sync, backend-conditional fields, health-probe wiring.

## 8. i18n

- [x] 8.1 Add all new strings to `packages/client/src/lib/i18n/i18n.tsx`.
- [x] 8.2 Translate them in `packages/client/src/lib/i18n/i18n-hu.ts`.
- [x] 8.3 Add/adjust the i18n-completeness test if one exists. (i18n-lint clean)

## 9. Security & quality pass

- [x] 9.1 (security-hardening) Confirm: endpoint auth-gated + feature-gated; input capped; no draft text logged; provider creds never client-side; typed non-leaky errors. (all verified in code) Note the `llm`-backend privacy caveat (draft leaves the machine): present in `docs/architecture.md`; settings-help-text caveat belongs to the plugin change (`add-grammar-settings-plugin`).
- [x] 9.2 (performance-optimization) Confirm debounce + abort-on-keystroke + input cap bound latency and LLM token cost; auto-check off while streaming. (all present in `useGrammarCheck` + service `maxChars` clip)
- [x] 9.3 Run `npm run quality:changed` and the `review-code` inline pass. (Biome clean on changed files)

## 10. Docs

- [x] 10.1 (DocScribe, caveman style) `docs/architecture.md` — new "Composer grammar check" section: data flow (draft → debounce → `/api/grammar/check` → backend → panel → apply), opt-in + backend-switch config, LanguageTool self-host setup, `llm`-backend privacy note. (present at `docs/architecture.md` "Composer grammar check")
- [x] 10.2 Add directory `AGENTS.md` rows for every new file (client `chat/` + `hooks/`, server `grammar/` + `routes/grammar-routes.ts`, shared config/types), path-alphabetical.

## 11. Verification

- [ ] 11.1 `npm test 2>&1 | tee /tmp/grammar-after.log` — all green. (grammar + plugin suites verified green 2026-07-21: 13 files / 153 tests; a full-suite run is still pending)
- [ ] 11.2 E2E (Playwright, docker harness): misspelled draft → panel appears → Apply all → draft corrected → send; manual Check path; backend switch in settings. (Add specs under `tests/e2e/`, run via `docker/test-up.sh`.) — not added
- [ ] 11.3 Manual smoke: enable feature, run a local LanguageTool server, verify offline check; switch to `llm`, verify with a configured provider. — pending

## Status — verification (2026-07-21)

Re-verified against the working tree; grammar + plugin suites green (13 files / 153 tests).

DONE (in this change): §1–§6, §8, §9, §10.
- §3.1 superseded (server imports shared `grammar-types` directly; no `GrammarBackend` interface).
- §3.3 `llm` backend amended — OAuth credential rewire (see proposal "Amendment — 2026-07-21").

DELIVERED VIA SIBLING CHANGE `add-grammar-settings-plugin`: §7 (settings UI + its tests) — a
`settings-section` plugin rather than a core client+server section.

OUTSTANDING: §11.1 full-suite run, §11.2 Playwright E2E, §11.3 manual smoke.
