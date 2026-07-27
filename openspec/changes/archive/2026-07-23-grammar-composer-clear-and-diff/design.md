## Context

The composer grammar surface is fully plugin-contained (`packages/grammar-plugin`).
The client side is `useGrammarCheck` (hook: fetch/apply state) + `GrammarPanel`
(render) + `GrammarComposerPanel` (slot wrapper). The draft is owned by the
composer (`CommandInput`), passed down as `draft` with an `onApplyText` callback;
`handleSend` resets the draft to `""` after sending. Nothing keys off that reset,
and corrections render as whole-`original` / whole-`replacement` spans.

## Goals / Non-Goals

**Goals:**
- Clear the panel when the composer empties (Send or manual clear); no stale rows.
- Make a correction on a long sentence scannable — highlight only the delta.

**Non-Goals:**
- No change to the check request/response, backends, config, or offsets.
- No change to apply/accept semantics (still keyed on the whole `original`).
- No new slot-contract prop (the fix stays inside the plugin).

## Decisions

**D1 — Clear-on-empty-draft (Option A) over an explicit send signal.**
An effect in `useGrammarCheck` resets when `draft.trim() === ""` and `status !==
"idle"`. Rationale: "empty composer → nothing to correct" is a robust invariant
that covers Send *and* manual clear, and lives entirely in the plugin. The
`status` guard makes it a no-op once idle (no render loop). `reset()` (not
`dismissPanel()`) is used so an in-flight check is aborted — otherwise a check
that resolves after Send would re-open the panel.
*Alternatives:* threading an `onSent`/reset-key through the `composer-panel` slot
contract (more plumbing, touches shared types + shell); reacting to
`sessionStatus === "streaming"` (fragile — misses queued sends and manual clear).

**D2 — Word diff via jsdiff `diffWordsWithSpace`, not a hand-rolled token-LCS.**
Both were built and compared over representative cases. Tie on clean
whitespace-separated edits; jsdiff wins decisively when punctuation is fused to a
changed token because it splits punctuation from words:
- `it work.` → `it works.`: jsdiff highlights `work`→`works` (9 chars); LCS drags
  in the unchanged period (11).
- `hello(world)` → `hi(world)`: jsdiff highlights `hello`→`hi` (7 chars); LCS
  re-highlights the entire unchanged `(world)` (21 chars).
The LCS over-highlight is exactly the "correction not visible quickly" symptom we
are fixing, so jsdiff is chosen. Cost: one dependency — `diff@^8.0.3`, already
used by `packages/client` + `packages/server`, ships its own types.

**D3 — Rendering: single inline merged diff.** `GrammarPanel` maps `diffTokens`
segments to spans (equal neutral, delete struck-red, insert green) in one inline
row (`SuggestionDiff`), replacing the two full-string spans. jsdiff preserves
whitespace, so the sentence reads naturally.

## Risks / Trade-offs

- [Clear also fires on manual backspace-to-empty] → intended: an empty composer
  has nothing to correct.
- [New dependency in the plugin] → mitigated: `diff` is already a monorepo dep at
  the same version, tiny, and self-typed.
- [Diff is presentation-only, decoupled from apply] → acceptable: a mis-segmented
  diff can never corrupt the draft; apply still keys on the whole `original`.
