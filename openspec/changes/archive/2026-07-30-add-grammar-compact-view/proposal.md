# Add a compact inline-redline view for composer grammar corrections

## Why

Today the composer corrections panel (`GrammarPanel`) has exactly **one** presentation: a
vertical **list** of stacked rows, one per suggestion. For a short draft with a few fixes that
list is taller than the sentence it corrects, and it divorces each fix from the words around it
— you read the fix in isolation, not in context. Users asked to *see the whole draft on one
line with the wrong and the good in place*, apply fixes one-by-one or all at once, and pick
their preferred presentation.

This change adds a second, **default** presentation — an **inline redline** rendered over the
draft — keeps the list as the alternative (redesigned to aligned before→after columns so it
scans faster), and adds a setting to choose between them. The correction **data model and apply
engine are unchanged**: `GrammarCheckResult` already carries `correctedText` +
`suggestions[]{ original, replacement, kind, message, offset, length }`, and `useGrammarCheck`
already exposes offset-safe `accept(id)` / `applyAll()` / `dismiss(id)`. This is a
**presentation + one setting**, not a protocol change.

Design was explored interactively; the approved direction is captured in `mockups/final.html`
(grounded in the real theme tokens, verified dark + light).

### Assumptions (please correct)

- **`correctionView` default is `redline`** — existing users with no key get the redline view
  on next load (an intended presentation change on upgrade). The list view remains one setting
  toggle away.
- **The redline sub-mode is a client view preference, not a grammar setting.** It persists in
  `localStorage` (`grammar.correctionMode`), NOT server config — it is a per-browser lens, and
  writing config on every toggle would be heavy. `correctionView` (redline vs list) IS a real
  persisted setting.
- **Kind → colour is presentation-only** (spelling·red, grammar·blue, punctuation·orange,
  style·purple, from existing `--accent-*` tokens). It never changes apply behaviour.
- **The redline renders over the live draft** (locating each suggestion's `original` the same
  offset-first / `indexOf`-fallback way `accept` does). Suggestions that no longer locate are
  dropped from the redline, exactly as the list marks them stale.

## What Changes

- **NEW** redline segment builder `packages/grammar-plugin/src/grammar-redline.ts` —
  `buildRedlineSegments(draft, suggestions)` locates each suggestion's `original` in the draft
  (offset-first, `indexOf` fallback), drops unlocatable/overlapping spans, and returns an
  ordered list of `unchanged` text runs interleaved with `change` segments. Presentation-only;
  the four redline modes all derive from this one function. Unit-tested.
- **NEW** `packages/grammar-plugin/src/GrammarRedlinePanel.tsx` — the inline panel: a remembered
  segmented **mode toggle** `Redline · Compact · Original · Corrected`, the summary, per-change
  apply, Apply-all, and close.
  - **Redline** (default) — issues dotted-underlined by kind with the fix shown inline as a
    green ghost `→ fix`; click / Enter a change applies only that one.
  - **Compact** — a denser wavy kind-coloured squiggle; hover/focus a change → a popover with
    **Apply / Ignore**.
  - **Original / Corrected** — read-only before/after previews (changed spans tinted red / green).
  - The chosen mode is remembered in `localStorage` (`grammar.correctionMode`, default
    `redline`, invalid value → `redline`).
- **MODIFIED** `packages/grammar-plugin/src/GrammarPanel.tsx` — the **list** view is redesigned
  from stacked rows to aligned **before → after** columns carrying **kind** (a coloured pill)
  and **message**, keeping per-row Accept / Dismiss + Apply-all.
- **MODIFIED** `packages/grammar-plugin/src/GrammarComposerPanel.tsx` — renders
  `GrammarRedlinePanel` when `correctionView === "redline"`, else `GrammarPanel`.
- **MODIFIED** config: add `correctionView: "redline" | "list"` (default `"redline"`) to
  `configSchema.json`, the `GrammarConfig` type + `DEFAULT_GRAMMAR` + `parseGrammarConfig`
  (`grammar-config.ts`), and surface it on `GrammarHealth` (`packages/shared/src/grammar-types.ts`)
  + the `GET /api/grammar/health` builder so the composer picks the view from one fetch.
- **MODIFIED** `GrammarSettings.tsx` — a segmented **Correction view** control (Redline / List),
  loaded from `data.plugins.grammar`, saved via `POST /api/config/plugins/grammar`.
- **i18n** — mode labels, Apply / Ignore, per-change aria labels, and the setting label/options
  added to the plugin catalog (English inline + `hu`).
- **DOCUMENTATION** — `packages/grammar-plugin/AGENTS.md` rows for the new/changed files.

## Capabilities

### Modified Capabilities

- `composer-grammar-check` — the corrections panel gains a second, default **inline redline**
  presentation with a remembered mode toggle (Redline / Compact / Original / Corrected) and
  per-change + apply-all actions; the **list** presentation is redesigned to aligned
  before→after columns carrying kind + message; a new `correctionView` setting picks between them.
- `grammar-settings-plugin` — the settings section gains a **Correction view** control writing
  `plugins.grammar.correctionView`.

### New Capabilities

- _None._ No new endpoint or wire type; `GrammarCheckResult` / the apply engine are unchanged.

## Out of Scope

- **Changing what gets corrected** — the backends, prompt, `correctedText`, and `suggestions[]`
  are untouched; this is purely how corrections are presented and applied.
- **Syncing the sub-mode across devices** — it is a per-browser `localStorage` preference by
  design. (`correctionView` is synced because it is real config.)
- **A severity/confidence signal** — the model already carries `kind` + `message`; no new field.
- **Rich in-textarea highlighting** — the composer stays a plain `<textarea>`; all highlighting
  lives in the panel above it (unchanged constraint).
- **LanguageTool-vs-LLM differences** — both backends already return the same result shape; the
  redline treats them identically.

## Discipline Skills

doubt-driven-review (the `buildRedlineSegments` placement is subtle — offset-first vs
`indexOf` fallback, overlapping/adjacent/multi-word spans, and the round-trip invariant
`unchanged+original == draft` must be stress-tested before the four renderers trust it);
review-code (a non-trivial multi-file UI change — inline review before commit once tests pass).
