# Design — LLM whole-text correction fallback

## Problem restated

`parseLlmResult` maps the model's `suggestions[]` into `GrammarSuggestion[]`, dropping any whose
`original` is not an exact substring of the input (offsets are recomputed by locating `original`,
so a non-locatable one cannot be applied safely). The composer UI (`useGrammarCheck` →
`GrammarPanel`) shows corrections purely from `suggestions.length`. When the array ends up empty
but `correctedText` differs, the user sees "No issues found" despite a real correction.

## Options considered

1. **Fuzzy-relocate individual suggestions** (case-insensitive / whitespace-normalized search for
   `original`). Rejected: recomputed offsets could land on the wrong span and corrupt the draft on
   apply — exactly what the strict-substring guard exists to prevent. High risk, partial coverage.

2. **Trust model-supplied offsets when `original` is missing.** Rejected: the whole reason offsets
   are recomputed is that LLM offsets are unreliable.

3. **Whole-text fallback (chosen).** When no itemized suggestion survives but `correctedText`
   changed, surface one `GrammarSuggestion` spanning the entire input
   (`offset 0`, `length = text.length`, `original = input`, `replacement = correctedText`).

## Why the whole-text fallback is safe and sufficient

- **Never corrupts the draft.** `useGrammarCheck.accept` matches `text.slice(offset, offset+length)
  === original`; for the whole-text span that is the entire draft, so apply is exact. `applyAll`
  already uses `result.correctedText` directly and is unchanged.
- **Good UX for free.** `GrammarPanel` renders each suggestion via `diffTokens(original,
  replacement)` — a word-level diff — so a whole-text suggestion shows exactly what changed across
  the sentence, not an opaque blob.
- **One safety net covers both failure modes.** Empty `suggestions` *and* all-dropped
  non-substring suggestions both end at "zero surviving items + changed text" → the fallback fires.
- **No false positives.** The changed/unchanged test compares `correctedText.trim()` vs
  `text.trim()`, so pure trailing-whitespace diffs do not fire it; the guard also skips empty input.

## `<text>` wrapper stripping

The system prompt tells the model to return `correctedText` **without** the `<text>` tags that
wrap the input, but models sometimes echo them. `stripTextTags` removes a single balanced
leading/trailing `<text>…</text>` pair (case-insensitive, whitespace-tolerant, inner mentions
preserved) before the changed/unchanged comparison. This (a) stops the tags leaking into the draft
on apply, and (b) prevents a wrapper-only echo from being mistaken for a real change.

## Test-infra fix

`packages/grammar-plugin` was missing from the root `vitest.config.ts` `projects` array, so its 97
tests never ran under `npm test`. Registering it is the invariant fix that would have caught this
class of bug; the +128 edge-case tests then run in CI going forward.
