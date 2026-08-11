# Design — grammar-llm-only-with-explore

## Context

The grammar plugin (`packages/grammar-plugin/`) is fully self-contained: client
composer UI (`composer-panel` slot), server route + backends (server entry), and
config (`plugins.grammar.*`). Two backends exist behind
`grammar-service.ts#checkGrammar`, selected by `config.backend`. This change
removes the LanguageTool backend, documents model choice, and reuses the
existing slot in two OpenSpec dialogs. No new runtime mechanism is introduced —
the design work is entirely about a clean removal + a graceful migration.

## Decisions

### D1 — Full collapse of the backend surface (not a pinned enum)

`backend` and the `languagetool` block are removed from the config type, the
JSON schema, and the shared wire types. `GrammarBackendKind` collapses to the
single-member `"llm"` rather than being deleted, because
`GrammarCheckResult.backend` is on the wire and clients/tests read it; keeping a
one-member type documents intent and keeps the field non-breaking.

- **Rejected:** keep `backend` pinned to `"llm"`. It preserves a dead choice
  point in the schema and the settings UI, contradicting the simplification
  goal and inviting future "add another backend" drift.

### D2 — Migration: read-time coercion PLUS a write-boundary prune

`parseGrammarConfig` is the clamp/validation authority. It gains no new field;
any `backend` or `languagetool.*` in a persisted config is simply not read —
unknown keys are dropped as they already are for `secret`/`nonsense` in the
edge-case tests. Read-time coercion therefore **never throws** and needs no
migration script.

**But read-time coercion is not the whole story** (caught in doubt-review). The
plugin config schema is `additionalProperties: false`, and `validatePluginConfig`
(Ajv, `allErrors`) *throws* a `ValidationError` on an unknown key — it does not
strip. So an existing user whose **persisted `plugins.grammar` already holds**
`backend`/`languagetool` (they used the plugin with LanguageTool after the
containment change) would hit a throw the next time that config is validated on
write. The absent-namespace migration path is safe — `migrateLegacyConfig`
already routes the legacy core block through `parseGrammarConfig` before
`updatePluginConfig`, so it writes a clean object — but the already-populated
namespace is not. The fix is a **write-boundary prune** (D6), not merely
read-time ignore. The proposal's migration claim is scoped accordingly:
*read never throws; the write/migrate path prunes legacy keys before Ajv sees
them.*

- **Consequence:** a LanguageTool-only user who never configured an `llm` model
  will get `backend_unconfigured` on the next check. This is the intended,
  documented opt-in posture (feature default is `enabled: false`); the settings
  section shows a "pick a model" prompt rather than silently failing.

### D3 — Model choice stays user-owned; no hardcoded vendor default

`enabled` stays `false` and `llm` stays unset by default. The benchmark
recommends `claude-haiku-4-5`, but seeding a vendor-specific default into every
install is inappropriate (not every deployment has Anthropic credentials, and
`/api/models` already varies per credential). Guidance lives in docs + a settings
hint; the picker is the single source of the choice.

### D4 — Reuse `ComposerPanelSlot`, do not fork the grammar UI into dialogs

`ComposerPanelSlot({draft, language?, sessionId?, sessionStatus?, onApplyText})`
already renders every `composer-panel` claim below an input and forwards a
bounded `onApplyText`. Mounting it in `ExploreDialog` (`draft={text}`,
`onApplyText={setText}`) and `NewChangeDialog` (`draft={description}`,
`onApplyText={setDescription}`) reuses the entire feature — trigger, redline
panel, apply/accept/dismiss — with zero plugin changes. `sessionId`/
`sessionStatus` are omitted; the slot's auto-check runs (no streaming guard to
trip) and the health fetch is same-origin.

- **ProposeDialog excluded:** it has only a single-line name/description
  `<input>` (kebab-case change name). Grammar-checking that is noise; the slot is
  designed to sit under a prose field.

### D5 — Docs are prose + a link, not a spec of model rankings

The `docs/` page is authored by DocScribe in caveman style and derived from
`HANDOFF-grammar-writing.md §5` (Anthropic `claude-haiku-4-5` best; opus/sonnet
slower/pricier; Gemini `flash-latest` acceptable, `flash-lite` too weak — returns
typos unchanged; ~2 s LLM latency floor). The spec asserts only that the guidance
exists and is linked from Settings — not the specific rankings, which will age.

### D6 — Prune persisted legacy keys at the write boundary

Because the schema is `additionalProperties: false` and Ajv throws (not strips),
a persisted `plugins.grammar.{backend,languagetool}` must be actively removed
before any validate/persist. `migrateLegacyConfig` (or a one-time load-time
prune) strips those keys from an already-populated namespace so a subsequent
`updatePluginConfig`/`validatePluginConfig` cannot throw an `additionalProperties`
error. The settings UI already emits a clean LLM-only body on save, so the only
residual risk is the server-side merge re-surfacing on-disk keys — the prune
closes that. Covered by the ADDED `grammar-check-service` scenario "A persisted
legacy key never breaks config validation".

## Risks / Trade-offs

- **Losing the offline/deterministic option.** Accepted: it dropped the style
  rewrite and required a self-hosted Java server nobody ran. The
  `add-grammar-correction-eval` harness (LLM-only) remains the quality signal.
- **Non-JSON responses from weak models.** Already handled by
  `parseLlmResult`'s whole-text fallback + the "never silently swallow"
  requirement; unchanged here. The docs steer users away from weak models.
- **Wire back-compat.** `GrammarCheckResult.backend` still exists (always
  `"llm"`); no client parsing breaks. `GrammarHealth.languagetool?` removal is
  additive-safe (optional field going away; consumers already null-guard it).

## Migration

1. No data migration script. Read-time: `parseGrammarConfig` drops
   `backend`/`languagetool` (D2, never throws). Write-time: a prune strips any
   legacy key already persisted in `plugins.grammar` before Ajv validation, since
   the schema is `additionalProperties: false` and Ajv throws on unknown keys
   (D6).
2. Users relying on LanguageTool must pick an LLM model in Settings; the section
   prompts for it and links the model-guidance doc.

## Open questions

_None — all scope locked during exploration (backend collapse, docs placement,
dialog set = Explore + New Change, single change)._
