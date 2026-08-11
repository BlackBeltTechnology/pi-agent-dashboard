## Why

The composer grammar/spell feature carries two backends: the `llm` path (grammar
**+ style rewrite**, via the OAuth-aware model registry) and a `languagetool`
path — the "Java offline mode" that POSTs to a self-hosted LanguageTool HTTP
server for spelling/grammar only. LanguageTool is a second code path, a second
config surface, a second failure mode, and a bring-your-own-server dependency
(no Docker container for it ever shipped) for a checker that drops the style
rewrite that is the feature's whole point. The stated goal is spell/grammar
checking; the `llm` path already covers it. Collapsing to LLM-only removes ~1/3
of the plugin's surface with no loss of the intended capability.

Two follow-ons ride the same change: (1) users need to know **which models are
good** at grammar checking — the benchmark already exists in
`HANDOFF-grammar-writing.md §5` but is not documented or surfaced; and (2) the
grammar checker is useful in the OpenSpec **Explore** and **New Change** prose
fields, not just the chat composer — the checker is already a reusable
`composer-panel` slot, so wiring it into those dialogs is cheap.

## What Changes

- **REMOVE the LanguageTool backend** and its entire config/wire/UI surface:
  - Delete `packages/grammar-plugin/src/server/backends/languagetool.ts` and its
    two test files.
  - `grammar-service.ts` always dispatches to `checkWithLlm`; drop the LT
    dispatch branch, `probeLanguageTool`, and the LT reachability block from
    `getGrammarHealth` (which must set `backend: "llm"` as a literal once the
    config field is gone).
  - `grammar-config.ts` + `configSchema.json`: drop the `backend` and
    `languagetool` fields entirely. `parseGrammarConfig` **coerces legacy
    configs on read** — a persisted `backend`/`languagetool.*` is silently
    discarded, never throwing. Because the plugin config schema is
    `additionalProperties: false` (Ajv throws, does not strip), the
    server-entry migration additionally **prunes** any legacy key already
    persisted in `plugins.grammar` before it is validated/re-persisted.
  - `packages/shared/src/grammar-types.ts`: `GrammarBackendKind` collapses to the
    one-member `"llm"` (retained for the wire `GrammarCheckResult.backend`
    field); `GrammarHealth.languagetool?` removed.
  - `GrammarSettings.tsx`: remove the backend `<select>`, the LT-URL field, and
    the LT health dot; the LLM model picker becomes the sole control; when no
    model is set the section shows a "pick a model" prompt. Feature stays
    `enabled: false` by default with `llm` unset — no hardcoded vendor default.
  - Strip dead settings i18n keys (`backendLanguagetool`, `backendLlm`, `ltUrl`,
    backend/URL labels) from the plugin `i18n.ts`, and reword the one composer
    `backend_unreachable` error string that still names "LanguageTool" (English
    in `grammar-panel-chrome.tsx`, `hu` in the client `i18n-hu.ts`) — there are
    NO backend/URL config keys in the client catalog.
- **DOCUMENT model candidates.** Add a `docs/` page (caveman-style, via
  DocScribe) listing recommended grammar models with latency/quality/cost
  tradeoffs derived from the existing benchmark, plus a short inline hint + doc
  link in the GrammarSettings model picker. Rewrite `docs/architecture.md`
  §Composer grammar check for the LLM-only, `plugins.grammar.*` reality.
- **ADD grammar to the OpenSpec prose dialogs.** Mount the reusable
  `<ComposerPanelSlot draft onApplyText/>` under the freeform textarea in
  `ExploreDialog.tsx` and the `description` textarea in `NewChangeDialog.tsx`.
  ProposeDialog (single-line name input, no prose) is intentionally excluded.

## Capabilities

### New Capabilities

_None._ (All three surfaces extend existing capabilities.)

### Modified Capabilities

- `grammar-check-service`: the switchable backend collapses to a single LLM
  backend; health + typed-failure requirements drop their LanguageTool clauses.
- `grammar-settings-plugin`: the settings shape loses `backend` + `languagetool`;
  the LanguageTool reachability requirement is removed; the model picker is
  unconditional with a model-required prompt and a link to model guidance.
- `openspec-dialogs`: the Explore and New Change dialogs gain the composer
  grammar panel over their prose fields.

## Impact

- **Removed:** `backends/languagetool.ts` (+2 tests); the LT branches in
  `grammar-service.ts`; the `backend`/`languagetool` config + schema + wire
  fields; the settings backend picker/URL/health dot; dead i18n keys.
- **Modified:** `grammar-config.ts`, `configSchema.json`,
  `shared/src/grammar-types.ts`, `GrammarSettings.tsx` (incl. its own
  `FALLBACK_GRAMMAR` literal + `normalize()`, which reference the removed
  fields), the plugin server entry (`migrateLegacyConfig` prune), plugin
  `i18n.ts` + `grammar-panel-chrome.tsx` + client `i18n-hu.ts` (error-string
  reword), `grammar-service.ts`, plus the grammar-plugin config / service /
  routes (incl. `*-edgecases`) / settings tests that assert LT behaviour.
- **Added:** `ComposerPanelSlot` mounts in `ExploreDialog.tsx` +
  `NewChangeDialog.tsx`; a `docs/` model-guidance page; a settings hint/link.
- **Migration:** existing users with a persisted `backend: "languagetool"` (or
  any `languagetool.url`) parse cleanly to the LLM-only shape on read; the
  write/migrate path prunes those keys before Ajv (`additionalProperties:
  false`) validates, so an already-populated legacy namespace does not throw. If
  `llm` is unset the feature reports `backend_unconfigured` until a model is
  picked — the documented, opt-in default.
- **Not touched:** `docker/` (no LT container existed); the parallel
  `add-grammar-correction-eval` change (already LLM-only) stays independent.

## Discipline Skills

- `doubt-driven-review` — this removes a public config + wire-type surface
  (`backend`, `languagetool`, `GrammarBackendKind`) and adds a config migration;
  the removal + coercion decision is stress-tested before it stands.
- `code-simplification` — the change is a deliberate complexity-reduction pass
  (one backend, one code path); run it to confirm no dead scaffolding remains.
- `review-code` — non-trivial multi-file change; inline review before commit.
