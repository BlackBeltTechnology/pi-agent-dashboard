# Stop the LLM grammar prompt from instructing the model to preserve mistakes

## Why

The composer grammar check reported **"No issues found"** on a draft containing at least three
obvious misspellings (`functional-specificatio`, `functianal`, `specifican`). The check returned
HTTP 200 with `correctedText` byte-identical to the input and `suggestions: []`.

The existing whole-text fallback in `parseLlmResult` (change:
`fix-grammar-llm-swallowed-corrections`) could not help: it only synthesizes a correction when
the model **changed** the text but no itemized suggestion survived. Here the model deliberately
changed nothing, so the fallback was correctly inert.

Root cause was the **prompt**, specifically the sentence-start clause that `systemPrompt` adds
only when `capitalizeFirstWord` is off (the default):

> `Do NOT change the capitalization of the first letter at the start of sentences; leave
> lowercase sentence starts exactly as written.`

Weak models over-generalize `leave … exactly as written` from "that one letter's case" to "the
whole text". The models said so themselves:

- *"The input text was returned unchanged to strictly preserve the exact spelling mistakes
  ('functianal', 'specifican') and maintain the original lowercase sentence start, **as required
  by the system instructions**."*
- *"…left unchanged in accordance with the requirement to **preserve the exact spelling, grammar,
  and punctuation mistakes**."*
- *"The input text contains **deliberate** spelling errors and was preserved with zero changes."*

Measured against the live backend with `google/gemini-flash-lite-latest`, toggling only that one
flag flipped every failing draft:

| `capitalizeFirstWord` | draft A | draft B | draft D |
|---|---|---|---|
| `false` (default) | 0 | 0 | 0 |
| `true` (clause absent) | 4 | 5 | 5 |

Measured detection rate on `google/gemini-flash-lite-latest` at `capitalizeFirstWord: false`
(n=5 per cell, identical drafts):

| Draft | Before | After capitalization fix | After code-clause fix |
|---|---|---|---|
| A (hyphenated jargon typos) | 0/5 | 0/5 | **4/5** |
| D (plain-English typos) | 0/5 | 4/5 | **5/5** |

A lowercase-start draft is still corrected while keeping its lowercase first letter, so the
feature the clause exists for is intact.

### Assumptions (please correct)

- **The clause must stay** — suppressing sentence-start capitalization is a real feature
  (`capitalizeFirstWord: false` is the default, and the LanguageTool backend honours it via
  `disabledRules=UPPERCASE_SENTENCE_START`). This change **rewords** it; it does not remove it.
- **The marker phrase `Do NOT change the capitalization` is a behavioural contract.** Three
  existing tests assert its presence/absence to prove the toggle reaches the prompt, so the new
  wording keeps that substring verbatim.
- **Residual nondeterminism is model capability, not prompt.** After both fixes
  `gemini-flash-lite-latest` reaches 4/5 and 5/5 but is not perfectly repeatable at
  `temperature: 0`. A larger sample also showed `gemini-flash-latest` is NOT a straightforward
  upgrade (2/5 on both drafts at n=5), so no model recommendation is encoded here. Users needing
  deterministic behaviour should prefer the rule-based `languagetool` backend.

## What Changes

- **MODIFIED** `packages/grammar-plugin/src/server/backends/llm.ts` — reword the `caps` clause in
  `systemPrompt` from a blanket "leave … exactly as written" into a **narrow, self-limiting
  exception** that immediately re-asserts the correction mandate: it now states the exception
  covers that single letter's case ONLY, that the model MUST still correct every spelling,
  grammar, and punctuation mistake elsewhere in the text (including in the same sentence), and
  that it must never preserve a misspelling. A module comment records the observed failure mode
  so the wording is not "simplified" back later.
- **MODIFIED (second clause, same bug class)** the general preservation sentence said "preserve
  … any code or URLs verbatim". Models cited it to keep misspelled hyphenated jargon — *"No
  changes were made … in order to preserve the exact spelling of 'functional-specificatio'"* — so a
  jargon-heavy draft stayed at 0/5 detection even after the capitalization fix. The clause is now
  scoped (`code, file paths, or URLs`) and followed by an explicit counter-rule with a concrete
  example: an unusual/hyphenated/technical-looking WORD in ordinary prose is NOT code; if
  misspelled, correct it; never leave a misspelling because it looks like jargon, a domain term,
  or a file name; never treat a mistake as intentional.
- **TESTS** `packages/grammar-plugin/src/__tests__/grammar-llm.test.ts` — two regression tests:
  the prompt keeps the narrow capitalization marker, no longer contains `exactly as written`, and
  re-asserts the correction mandate; and it states that jargon-looking prose words are not code
  (`is NOT code`, `never leave a misspelling`).
- **DOCUMENTATION** `packages/grammar-plugin/AGENTS.md` — amend the `llm.ts` row.

## Capabilities

### Modified Capabilities

- `grammar-check-service` — the LLM backend prompt SHALL NOT contain wording that a model can
  read as an instruction to preserve spelling, grammar, or punctuation mistakes; the
  sentence-start capitalization exception SHALL be scoped to that letter's case only and SHALL
  restate the correction mandate.

### New Capabilities

- _None._ No config, endpoint, or wire-type change.

## Out of Scope

- **Which model is configured** — `plugins.grammar.llm` stays user configuration. The evidence
  that `gemini-flash-lite-latest` is too weak for jargon-heavy drafts is recorded here as a
  finding, not fixed in code.
- **Retry / self-verification passes** — no second model call is added when the first returns
  zero changes; that doubles cost and latency for an unreliable gain.
- **Summary-sniffing heuristics** — detecting "the model admitted it saw errors but preserved
  them" by parsing prose would be fragile; the fix targets the cause, not the symptom.
- **Error reporting** — verified already correct: an unreachable/failed model returns HTTP 502
  with a `GrammarErrorCode` (e.g. `backend_unreachable`), not a silent success.
- **The `<text>` wrapper and injection guard** — unchanged; a model hallucinating "text was not
  provided" is a capability symptom, not a prompt defect.

## Discipline Skills

systematic-debugging (evidence-first: reproduce against the live endpoint, read the model's own
summaries, isolate the single variable by toggling `capitalizeFirstWord`, and confirm the fix
empirically rather than by inspection); review-code (prompt wording is load-bearing behaviour —
review the diff and the regression test before commit).
