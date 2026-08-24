# Fix: LLM grammar mode silently reports "no issues" on a clearly-wrong draft

## Why

With the `llm` grammar backend selected, a draft that clearly has spelling/grammar errors can
come back as **"No issues found"** — nothing highlighted, nothing to apply — even though the
model *did* correct the text. Reproduced against the real module
(`packages/grammar-plugin/src/server/backends/llm.ts`):

```
[PROBE-A] correctedText differs: true | suggestions: 0 | summary: "No issues found"
[PROBE-B] correctedText differs: true | suggestions: 0
```

Root cause in `parseLlmResult`: the result surfaces **only** the model's itemized
`suggestions`, and `mapRawSuggestion` drops any suggestion whose `original` is not an *exact*
substring of the input (an untrustworthy-offset guard). So two common real-world model
behaviours both collapse to an empty suggestion list — while the composer UI keys entirely on
`suggestions.length`:

1. The model returns a rewritten `correctedText` with an **empty** `suggestions` array
   (small / local / terse models do this).
2. The model returns suggestions whose `original` was normalized — added apostrophe/quote,
   trimmed, whitespace-collapsed — so **every** item is dropped.

In both cases `correctedText` proves the text was corrected, yet the user sees nothing.

**Why it shipped undetected:** `packages/grammar-plugin` was **never registered** in the root
`vitest.config.ts` `projects` list, so `npm test` skipped all 97 grammar tests. The bug lived
in code with tests that never ran in CI.

## What Changes

- **Fix `parseLlmResult`** (`llm.ts`): when the model changed the text (`correctedText` differs,
  ignoring surrounding whitespace) but **no** itemized suggestion survived, synthesize a single
  whole-text `GrammarSuggestion` spanning the entire input so the correction is always visible
  and applyable. LLM mode can no longer silently swallow a fix.
- **Add `stripTextTags`** (`llm.ts`): strip a single echoed `<text>…</text>` wrapper from
  `correctedText` (the wrapper the prompt tells the model to omit) — prevents both a corrupted
  apply (tags leaking into the draft) and a false "text changed" when the only diff is the
  wrapper.
- **Register `packages/grammar-plugin` in root `vitest.config.ts`** so `npm test` runs its
  suite — closing the invariant gap that let this bug ship.
- **Add 128 edge-case tests** (97 → 225) across every layer: LLM parsing/stream/prompt/timeout,
  the full config matrix, service dispatch, LanguageTool helpers, and routes.

Out of scope: fuzzy-relocating individual non-substring suggestions (the whole-text fallback
covers the observable symptom safely without ever applying a wrong offset); the pre-existing
`config.grammar.*` → `plugins.grammar.*` namespace wording in this spec (owned by
`make-grammar-fully-plugin-contained`); wiring `hermes-memory-plugin` into the root suite (a
separate, analogous gap — noted below).

## Deferred / related (found during this work — NOT fixed here)

Captured so they are not re-discovered; each is a separate change:

- **`hermes-memory-plugin` is also absent from the root `vitest.config.ts` projects list** — its
  tests never run in CI either. Same class of gap; fix analogously.
- **`extractJsonObject` is brace-naive.** It slices between the first `{` and last `}`, so prose
  containing braces *before* the JSON, or a top-level JSON array, yields `backend_bad_response`.
  Documented by two edge-case tests; a brace-matching parser would harden it.

## Discipline Skills

- `systematic-debugging` — root-caused the "no issues" symptom to `parseLlmResult` with a
  failing probe before changing code.
- `scenario-design` — derived the edge-case/error-handling scenarios folded into the +128 tests.
- `review-code` — non-trivial parsing change + test-infra change; run before commit.

(No auth/secrets/PII/migration triggers apply; the LLM output is untrusted and already wrapped
against prompt injection via `userPrompt`, unchanged here.)
