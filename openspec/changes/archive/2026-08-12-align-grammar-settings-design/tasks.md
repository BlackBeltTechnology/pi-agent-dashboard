## 1. Host Save Bar integration

- [x] 1.1 `GrammarSettings.tsx`: adopt `useSettingsDraftSource({ id:"plugin:grammar", isDirty, commit, reset })`. `commit` = `POST /api/config/plugins/grammar` (current body) + reload; `reset` = reload. `isDirty` = draft ≠ loaded. **`commit` MUST throw/reject on `!res.ok`** (the runtime contract keeps the source dirty + retryable; `SettingsPanel` reports success only for fulfilled commits). The current `save()` has no `res.ok` check — add one (mirror `blackhole-api.ts` `putConfig` which throws on `!res.ok`).
- [x] 1.2 Remove the section's own Save/Reload buttons + the `grammar-dirty` "unsaved" chip (host bar owns them). Drop the now-dead `saving`/`loading` local button state.

## 2. Theme-token restyle (no inline styles)

- [x] 2.1 Replace every inline `style={{}}` (23 today) with theme-token Tailwind classes matching the `blackhole`/`hermes` idiom; keep `focus-ring` on every interactive control; no `#hex`/`rgba()`/`hsl()` literal.
- [x] 2.2 Preserve every SURVIVING `data-testid` (removed: `grammar-save`, `grammar-reload`, `grammar-dirty`): section root `grammar-settings`, `grammar-enabled`, `grammar-autocheck`, `grammar-correction-view`, `grammar-capitalize`, `grammar-debounce`, `grammar-minchars`, `grammar-maxchars`, `grammar-language`, `grammar-llm-model-selector`, `grammar-llm-model-selector-unavailable`, `grammar-model-required`, `grammar-model-hint`, `grammar-model-guidance-link`.
- [x] 2.3 Scope any "no inline style in the section" assertion to elements the PLUGIN owns — exclude the host-injected `ui:model-selector` primitive subtree (`[data-testid="grammar-llm-model-selector"]` descendants), which carries its own inline `style` (`ModelSelector.tsx` dropdown) the plugin cannot control.

## 3. Accordion grouping

- [x] 3.1 Wrap fields in `<details>`/`<summary>` groups (General · Model · Advanced), theme-token classes, `motion-reduce`-guarded caret. Add `focus-ring` (or an explicit visible focus style) to each `<summary>` — blackhole/hermes summaries have NO focus affordance, so do NOT copy that; the a11y scenario requires focusable summaries to show a visible indicator. Presentation-only; testids unchanged.

## 4. Recommended-models disclosure

- [x] 4.1 Add a collapsed-by-default `<details>` by the model picker (testid `grammar-recommended-models`) listing a short static curated set from the OpenRouter competition: `openai/gpt-4.1-nano` (recommended) + `qwen/qwen3-30b-a3b-2507`, `amazon/nova-lite-v1`, `openai/gpt-4o-mini`; note avoid reasoning models (deepseek-v4-flash), `ministral-8b` (78% recall), retired `gemini-2.0-flash-001/-lite-001`. Localized labels. **Place the `<details>` OUTSIDE the model-picker `<label>`** (a `<details>` inside a `<label>` is invalid HTML + a `<summary>` click would toggle the label's control) — restructure the current single `<label>` (picker + hint + link + prompt) so the disclosure is a sibling, and give the `<summary>` a `focus-ring`.
- [x] 4.2 Keep the existing inline hint + `grammar-model-guidance-link` to `docs/grammar-model-guidance.md` (disclosure complements, does not replace).

## 5. i18n

- [x] 5.1 `src/i18n.ts`: add accordion group titles + recommended-model list labels/note (en inline + `hu`); remove the now-unused `save`/`reload`/`saving`/`unsaved` keys the host bar owns, AND the already-orphaned `loading` key (no call site).

## 6. Docs

- [x] 6.1 Update `packages/grammar-plugin/AGENTS.md`: the `GrammarSettings.tsx` row (host Save Bar via `useSettingsDraftSource`, accordion groups, recommended-models disclosure, no inline styles, no own Save/Reload) AND the stale `GrammarSettings.test.tsx` row ("save/clamp" wording) AND the `i18n.ts` row (key-set change). See change: align-grammar-settings-design.
- [x] 6.2 Rewrite the `GrammarSettings.tsx` module docblock (lines 1–19): it currently asserts the OPPOSITE of reality — "edits the CORE `config.grammar` block", "reads/persists via GET/PUT /api/config", "local Save/Reload … NOT the shared settings-draft context". Replace with: reads/writes `plugins.grammar.*` via `GET /api/config` + `POST /api/config/plugins/grammar`, persisted through the host Save Bar (`useSettingsDraftSource`).

## 7. Verify

- [x] 7.1 `npm run lint` (tsc) clean; grammar-plugin vitest green; rebuild client + restart; confirm the grammar section renders at Settings ▸ Plugins ▸ Grammar & Spelling with the host Save Bar (no own Save/Reload), accordions, and the recommended-models disclosure; editing a field arms the host Save Bar, Save persists, and a failed commit keeps the section dirty.

## 8. Tests (folded from test-plan.md — 14 automated + 1 manual-only)

All L1 in `packages/grammar-plugin/src/__tests__/GrammarSettings.test.tsx` (rework). Draft-source cases wrap render in the settings-draft provider — see `packages/client/src/components/__tests__/RetrySettingsSection.test.tsx`.

- [x] 8.1 (test-plan #E1) Save-Bar registration: loaded section · edit a control then revert · registers `useSettingsDraftSource` id `plugin:grammar`; `isDirty` true after edit, false after revert.
- [x] 8.2 (test-plan #E2) Commit POSTs plugin endpoint: dirty draft · host commit · `POST /api/config/plugins/grammar` with edited body, not `PUT /api/config`.
- [x] 8.3 (test-plan #E3) Reset reloads: edited draft · `reset()` · draft returns to loaded values.
- [x] 8.4 (test-plan #E4) Model picker required: `llm` unset vs set · render · unset→`grammar-model-required` present, set→absent; no backend selector/URL either case.
- [x] 8.5 (test-plan #E5) Persisted LT renders LLM-only: config with `backend`/`languagetool` · mount · no `grammar-backend`/`grammar-lt-url`; LLM controls render.
- [x] 8.6 (test-plan #E6) Correction-view persists: set `list` · host commit · POST body `correctionView:"list"`.
- [x] 8.7 (test-plan #E7) Accordion grouping + testids: render · inspect · `<details>` groups present; surviving testids present; `grammar-save`/`grammar-reload`/`grammar-dirty` absent.
- [x] 8.8 (test-plan #E8) Recommended-models disclosure: expand `grammar-recommended-models` · lists `openai/gpt-4.1-nano` (recommended) + others; collapsed by default; not a `<label>` descendant.
- [x] 8.9 (test-plan #E9) Guidance hint+link + target exists: render · inspect + resolve href · hint present, `grammar-model-guidance-link` present, href resolves to an existing `docs/*.md`.
- [x] 8.10 (test-plan #X1) Failed save stays dirty: `POST /api/config/plugins/grammar` → 500 · host commit · `commit` rejects; source stays dirty; no success path.
- [x] 8.11 (test-plan #F1) No plugin-owned inline styles: scan `[style]` excluding `[data-testid="grammar-llm-model-selector"]` descendants · render · zero; no `#hex`/`rgba()`/`hsl()` literal in section.
- [x] 8.12 (test-plan #F2) No LT marker: render · query · `grammar-lt-health` null.
- [x] 8.13 (test-plan #F3) Focus indicators: render · inspect · each surviving control AND each `<summary>` carries `focus-ring`/visible focus.
- [x] 8.14 (test-plan #F4) Theme-token usage: render · inspect classes · colors reference `var(--…)` only, no hardcoded literal.
- [ ] 8.15 (test-plan: manual-only) Visual consistency: view the section in Settings ▸ Plugins ▸ Grammar & Spelling · confirm accordion + Save-Bar + spacing read as the same design language as blackhole/hermes. _(deferred: manual post-merge)_
