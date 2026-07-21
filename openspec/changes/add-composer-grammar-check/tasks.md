# Tasks

## 1. Preconditions (read before writing)

- [ ] 1.1 Read `packages/client/src/components/chat/CommandInput.tsx` — confirm the controlled `draft` / `onDraftChange` contract, the toolbar button pattern, `sessionStatus`, and the slash/`!` command interception (`DASHBOARD_LOCAL_COMMANDS`, `parseViewCommand`).
- [ ] 1.2 Read `packages/client/src/components/session/QueuePanel.tsx` and its mount site in `packages/client/src/App.tsx` — this is the precedent for a panel rendered directly above the composer. Confirm where `GrammarPanel` mounts.
- [ ] 1.3 Read `packages/shared/src/config.ts` — find `DashboardConfig`, `loadConfig()`, and the `parseOpenSpecPollConfig` validator/clamp pattern this change mirrors.
- [ ] 1.4 Read `packages/server/src/server.ts` route-registration block and one existing route (`packages/server/src/routes/provider-routes.ts`) — confirm how new routes register under the auth chain.
- [ ] 1.5 Read `packages/server/src/auth/provider-auth-handlers.ts` and the providers-test probe path — confirm how outbound provider calls resolve credentials server-side (the `llm` backend reuses this).
- [ ] 1.6 Read `packages/client/src/lib/i18n/i18n.tsx` and `i18n-hu.ts` — confirm how to add + translate new strings.
- [ ] 1.7 Run `npm test 2>&1 | tee /tmp/grammar-baseline.log` and capture the green baseline.

## 2. Shared types + config

- [ ] 2.1 Add `GrammarIssueKind`, `GrammarSuggestion`, `GrammarCheckResult` to `packages/shared/src/` (exported for both client and server) per design Decision 3.
- [ ] 2.2 Extend `DashboardConfig` in `packages/shared/src/config.ts` with the `grammar?` block.
- [ ] 2.3 Add `parseGrammarConfig(raw)` with coercion/clamping + defaults (mirror `parseOpenSpecPollConfig`); wire into `loadConfig()`.
- [ ] 2.4 (TDD) Write `packages/shared/src/__tests__/config-grammar.test.ts` first: missing-block default, numeric clamping, unknown-field ignore, invalid-backend fallback. Verify red, then green.

## 3. Server: grammar service + backends

- [ ] 3.1 Create `packages/server/src/grammar/grammar-types.ts` (re-export shared shapes; define the internal `GrammarBackend` interface).
- [ ] 3.2 Create `packages/server/src/grammar/backends/languagetool.ts` — POST `<url>/v2/check`, map `matches` → suggestions (drop no-replacement matches), derive `correctedText` (non-overlapping, right-to-left), compute `summary` from kind counts. Honour the `AbortSignal`.
- [ ] 3.3 Create `packages/server/src/grammar/backends/llm.ts` — structured-prompt call to `grammar.llm` provider/model (temperature 0), defensive JSON parse → `GrammarCheckResult`; never leak credentials or raw provider bodies.
- [ ] 3.4 Create `packages/server/src/grammar/grammar-service.ts` — `checkGrammar(text, opts)`: re-read config, clip to `maxChars` (set `truncated`), reject empty, dispatch by `backend`, map failures to typed error codes.
- [ ] 3.5 (TDD) Unit tests: LanguageTool mapping + `correctedText` from fixtures; LLM malformed-JSON → safe result; maxChars clipping; empty-text rejection; backend-unreachable/timeout error codes (mock fetch/provider).

## 4. Server: routes

- [ ] 4.1 Create `packages/server/src/routes/grammar-routes.ts`: `POST /api/grammar/check` (auth-gated; `409 grammar_disabled` when off; `400 empty_text`; `502 backend_unreachable`) and `GET /api/grammar/health`.
- [ ] 4.2 Register the routes in `packages/server/src/server.ts` under the auth chain.
- [ ] 4.3 Add one structured log line per check (backend, language, length, latency, suggestion count, error code) — NO draft text. (observability-instrumentation)
- [ ] 4.4 (TDD) Route tests: auth-gate, disabled 409, empty 400, success shape, health probe (backend + LT reachability), error mapping.

## 5. Client: check hook

- [ ] 5.1 Create `packages/client/src/hooks/useGrammarCheck.ts` — manual + debounced-auto trigger, `AbortController` cancel-on-change, loading/error state, POST to `/api/grammar/check`. Skip auto-check while `streaming` and for `/`, `!`, `!!` drafts, and when draft < `minChars`.
- [ ] 5.2 (TDD) Hook tests: debounce fires once after idle; new keystroke aborts + resets; below-minChars no-op; streaming skip; command/shell skip.

## 6. Client: panel + composer wiring

- [ ] 6.1 Create `packages/client/src/components/chat/GrammarPanel.tsx` — diff-highlighted corrected sentences (struck/error original + success replacement), summary, per-suggestion Accept/Dismiss + message, Apply-all, close. Theme-aware, keyboard-navigable, a11y-labelled.
- [ ] 6.2 Implement offset-safe apply helpers (accept-one with re-find/stale handling; apply-all = `correctedText`) editing the controlled `draft` via `onDraftChange`. Re-run check after accept-one (design Decision 4).
- [ ] 6.3 Modify `CommandInput.tsx` — add the Check toolbar button + keyboard shortcut; feed `draft`/`sessionStatus` to `useGrammarCheck`; expose apply callbacks. All behind `grammar.enabled`.
- [ ] 6.4 Mount `GrammarPanel` above the composer in `App.tsx` (sibling to `QueuePanel`); abort + hide on session switch / draft clear.
- [ ] 6.5 (TDD) Component tests: panel renders suggestions/summary; Accept/Dismiss/Apply-all draft mutations; stale-suggestion disabled Accept; no-auto-send; disabled-feature renders nothing.

## 7. Client + server: settings

- [ ] 7.1 Add a "Grammar & Spelling" settings section: enable + auto-check toggles, backend select, debounce, `minChars`/`maxChars`, language, LanguageTool URL (+ reachability via `/api/grammar/health`), LLM provider/model. Persist via the existing config-write path.
- [ ] 7.2 (TDD) Settings tests: persistence round-trip; health-probe wiring; backend switch reflected.

## 8. i18n

- [ ] 8.1 Add all new strings to `packages/client/src/lib/i18n/i18n.tsx`.
- [ ] 8.2 Translate them in `packages/client/src/lib/i18n/i18n-hu.ts`.
- [ ] 8.3 Add/adjust the i18n-completeness test if one exists.

## 9. Security & quality pass

- [ ] 9.1 (security-hardening) Confirm: endpoint auth-gated + feature-gated; input capped; no draft text logged; provider creds never client-side; typed non-leaky errors. Note the `llm`-backend privacy caveat (draft leaves the machine) in settings help text + docs.
- [ ] 9.2 (performance-optimization) Confirm debounce + abort-on-keystroke + input cap bound latency and LLM token cost; auto-check off while streaming.
- [ ] 9.3 Run `npm run quality:changed` and the `review-code` inline pass.

## 10. Docs

- [ ] 10.1 (DocScribe, caveman style) `docs/architecture.md` — new "Composer grammar check" section: data flow (draft → debounce → `/api/grammar/check` → backend → panel → apply), opt-in + backend-switch config, LanguageTool self-host setup, `llm`-backend privacy note.
- [ ] 10.2 Add directory `AGENTS.md` rows for every new file (client `chat/` + `hooks/`, server `grammar/` + `routes/grammar-routes.ts`, shared config/types), path-alphabetical.

## 11. Verification

- [ ] 11.1 `npm test 2>&1 | tee /tmp/grammar-after.log` — all green.
- [ ] 11.2 E2E (Playwright, docker harness): misspelled draft → panel appears → Apply all → draft corrected → send; manual Check path; backend switch in settings. (Add specs under `tests/e2e/`, run via `docker/test-up.sh`.)
- [ ] 11.3 Manual smoke: enable feature, run a local LanguageTool server, verify offline check; switch to `llm`, verify with a configured provider.

## Status — apply pass 1 (implemented + tested)

DONE (65 tests green, `tsc` clean for grammar, Biome clean on changed files):
- §1 preconditions (read); §2 shared types + `grammar` config + `parseGrammarConfig` (10 tests);
- §3 server service + LanguageTool + LLM backends + shared `withTimeoutSignal` (grammar-service/languagetool/llm tests);
- §4 `POST /api/grammar/check` + `GET /api/grammar/health`, registered in `server.ts`, structured `[grammar]` logging (route tests);
- §5 `useGrammarCheck` hook (debounce/abort/gating/apply, 12 tests);
- §6 `GrammarPanel` + composer wiring (Check button + ⌘G in `CommandInput`, mounted above composer in `App.tsx`) (8 tests);
- §8 i18n (`grammar.*` + `command.grammarCheck`; en via fallback, hu in `huCatalog`; i18n-lint clean);
- §9.3 Biome clean on changed files.
- §10.2 directory `AGENTS.md` rows added (shared, server/grammar[new], routes, hooks, chat) + CommandInput sidecar note.

DEFERRED (follow-up):
- §7 Settings UI — for "local for me first" the feature is enabled via `~/.pi/dashboard/config.json` `grammar.enabled=true`; the server re-reads config per request so no restart needed. A Settings section is a follow-up.
- §10.1 `docs/architecture.md` "Composer grammar check" section — delegated to DocScribe.
- §11.2 Playwright E2E — needs the docker harness; add specs under `tests/e2e/`.
- §11.3 manual smoke (run a local LanguageTool server / configure an llm provider).
- §11.1 full `npm test` — targeted grammar + regression suites run green; a full-suite run is pending.
