# Tasks

> Server-only change in `packages/grammar-plugin/src/server/backends/llm.ts` (+ its test).
> Rebuild path: server → `POST /api/restart` (jiti, no build) per the `implement` skill.
> Investigation followed `systematic-debugging`: reproduce → read the model's own summaries →
> isolate one variable → verify empirically.

## 1. Reproduce and isolate (evidence before code)

- [x] 1.1 Reproduce against the live endpoint: `POST /api/grammar/check` with the reported draft
  returned HTTP 200, `correctedText` identical to the input, `suggestions: []`, summary
  "No changes were made to preserve the exact text as requested."
- [x] 1.2 Confirm the whole-text fallback was correctly inert (it requires
  `correctedText.trim() !== text.trim()`), so the defect is upstream of parsing.
- [x] 1.3 Read the `[grammar]` server-log lines: `suggestions:0` on long drafts, `2`/`3` on short
  ones — matches the reported "not consistent" behaviour.
- [x] 1.4 Reject the first hypothesis ("command-shaped drafts trigger the injection guard") — a
  command-shaped draft with plain-English typos DID get 5 suggestions, so command shape is not the
  variable.
- [x] 1.5 Isolate the real variable: toggle ONLY `capitalizeFirstWord` (restoring config
  afterwards). `false` → 0/0/0 suggestions; `true` → 4/5/5. Clause identified as the cause.

## 2. Fix the prompt (TDD)

- [x] 2.1 (TDD) Add a regression test in `__tests__/grammar-llm.test.ts` via the existing
  `capturingStream` helper: the system prompt keeps `Do NOT change the capitalization`, does NOT
  contain `exactly as written`, and matches `/MUST still correct every/i`. Watched it fail red.
- [x] 2.2 Reword the `caps` clause in `systemPrompt` as a narrow exception that restates the
  correction mandate and forbids preserving a misspelling. Record the observed failure mode in a
  module comment so the wording is not "simplified" back.
- [x] 2.3 Keep the marker substring `Do NOT change the capitalization` verbatim — three existing
  tests (`grammar-llm.test.ts` ×2, `grammar-service-edgecases.test.ts` ×1) assert its
  presence/absence as the toggle's behavioural contract. First wording attempt used lowercase
  "do NOT" and broke all three; fixed by restructuring the sentence rather than weakening the
  tests.

## 2b. Second clause: "code or URLs verbatim" (TDD)

- [x] 2b.1 After fix 2.2 the jargon-heavy draft was STILL 0/5. Captured the model's own
  justification: *"No changes were made … in order to preserve the exact spelling of
  'functional-specificatio'"* and *"… due to the constraint …"* — it was citing the
  "preserve … any code or URLs verbatim" clause and classifying hyphenated jargon as code.
- [x] 2b.2 Ruled out truncation as an alternative explanation: `MAX_OUTPUT_TOKENS = 8192`,
  responses were well-formed JSON, and `temperature: 0` is sent.
- [x] 2b.3 (TDD) Added a regression test asserting the prompt contains `is NOT code` and
  `never leave a misspelling`. Watched it fail red.
- [x] 2b.4 Scoped the clause to `code, file paths, or URLs` and appended an explicit counter-rule
  with a concrete before/after example. Green.

## 3. Verify

- [x] 3.1 `npx vitest run` in `packages/grammar-plugin` → 18 files / **259** tests pass. Full
  monorepo `npm test` → 11556 passed, 1 failed: `pi-gateway-bind-host` "binds all interfaces",
  verified PRE-EXISTING and environmental (server package unmodified vs HEAD; the test picks the
  first non-loopback IPv4 and this host exposes `en0` + a VM bridge + a Tailscale `utun`, so the
  chosen interface resets the connection). Not caused by this change; flagged, not fixed.
- [x] 3.2 Restart the server (`POST /api/restart`) and re-check live with the user's actual
  `capitalizeFirstWord: false`: the plain-English draft went **0 → 5** suggestions, and a
  lowercase-start draft was corrected while keeping its lowercase start (guard intact).
- [x] 3.3 Measured detection rate at n=5 per cell on `gemini-flash-lite-latest`: draft A
  0/5 → 0/5 → **4/5**, draft D 0/5 → 4/5 → **5/5** across the two prompt fixes. Lowercase-start
  guard verified intact. RETRACTED an earlier n=1 claim that `gemini-flash-latest` was a clear
  upgrade — at n=5 it scored only 2/5 on both drafts, so no model swap is recommended.
- [x] 3.3b Verified the running server executes THIS working tree
  (`packages/server/src/cli.ts` via jiti, single `llm.ts` on disk, no `~/.pi` shadow copy), so the
  live measurements reflect the edited prompt.
- [x] 3.4 Confirm error reporting is already correct: an unreachable model returns HTTP 502 with
  `code: "backend_unreachable"`, not a silent "no issues" success. (Retracts an earlier suspicion
  that an empty `correctedText` was being reported as success.)
- [x] 3.5 Verify every diagnostic config mutation was restored (`capitalizeFirstWord`, `llm.model`)
  — final state byte-identical to the original.
- [x] 3.6 Biome on the touched files + `openspec validate --strict`. (Biome: 1 warning, verified
  pre-existing at `llm.ts:87` in `googleToOpenAiCompat` — identical count on the HEAD version, and
  the diff is confined to lines 109-123. openspec: valid.)

## 4. Docs

- [x] 4.1 Amend the `src/server/backends/llm.ts` row in `packages/grammar-plugin/AGENTS.md` to
  record the reworded clause and why. `See change: fix-grammar-llm-preserves-mistakes`.

## 5. Follow-ups (not in this change)

> Recorded as prose, NOT checkboxes: these are downstream decisions for the user, not deliverables
> of this change, so they must not count against its task total.

- 5.1 For fully deterministic checking, consider `backend: languagetool` — verified REACHABLE
  at `http://localhost:8081` (HTTP 200 on `/v2/languages`). Rule-based, offline, repeatable, no
  model nondeterminism. User configuration — awaiting decision.
- 5.2 Residual LLM nondeterminism (~1/5 misses on jargon drafts at `temperature: 0`) is model
  capability. If it matters, evaluate a stronger model with n>=5 per candidate — single-shot
  comparisons are misleading, as this investigation demonstrated.
