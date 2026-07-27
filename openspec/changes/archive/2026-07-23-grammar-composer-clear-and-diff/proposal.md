## Why

Two composer grammar UX defects: (1) after Send, the corrections panel keeps
showing the previous draft's suggestions (now stale) because nothing resets the
panel when the composer clears; (2) a correction on a long sentence renders the
whole `original` struck-through beside the whole `replacement`, so the actual
change is impossible to spot at a glance.

## What Changes

- The corrections panel clears (and aborts any in-flight check) as soon as the
  composer draft goes blank — which is exactly what Send does when it resets the
  draft to `""`. Also covers a manual clear. No lingering stale suggestions.
- Each correction renders as a **word-level inline diff**: unchanged words stay
  neutral, the deletion is struck-through red, the insertion is green — so the
  fix is scannable even inside a long sentence. Replaces the old
  whole-original / whole-replacement two-span rendering.
- Adds the `diff` (jsdiff) dependency to `grammar-plugin` for the word diff
  (`diffWordsWithSpace`); already used by `packages/client` + `packages/server`.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `composer-grammar-check`: the corrections panel SHALL clear when the composer
  draft becomes empty; corrections SHALL be presented as a word-level inline
  diff rather than whole-original/whole-replacement spans.

## Impact

- `packages/grammar-plugin/src/useGrammarCheck.ts` — clear-on-empty-draft effect.
- `packages/grammar-plugin/src/GrammarPanel.tsx` — inline-diff rendering
  (`SuggestionDiff`).
- `packages/grammar-plugin/src/grammar-diff.ts` (new) — `diffTokens` word diff.
- `packages/grammar-plugin/package.json` — adds `diff@^8.0.3`.
- Presentation-only for the diff; the apply/offset logic still keys on the whole
  `original` string. No server, protocol, or config changes.

## Discipline Skills

- `review-code`: non-trivial client change; review before commit.
