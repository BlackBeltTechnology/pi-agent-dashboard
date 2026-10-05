# Tasks

> Target package: external `pi-hermes-memory` (paths relative to its `src/`). This repo has
> no in-scope code changes. Revised after doubt-driven-review: pinning split into
> `pinnedTargets: ["user"]` + `pinnedCategories: ["convention"]`; BM25 must be added to the
> search; dual-store write-through required. See design.md D2–D9.

## 1. Config surface (`types.ts`, `config.ts`)

- [ ] 1.1 Add `"retrieval"` to the `memoryMode` union in `types.ts`.
- [ ] 1.2 Add a `retrievalInjection` config block to `MemoryConfig`: `injectTopK`, `injectCharBudget`, `pinnedTargets: string[]`, `pinnedCategories: string[]`, `categoryWeights: Record<string, number>`, `promptTruncateChars`, `retrievedBudgetShare`. (NOTE: `pinnedTargets` and `pinnedCategories` are SEPARATE — `target` and `category` are distinct SQLite columns; `"user"` is a target, `"convention"` a category.)
- [ ] 1.3 In `config.ts`, accept `memoryMode === "retrieval"` (extend the existing validation) and merge/validate each `retrievalInjection` field over defaults in `DEFAULT_CONFIG` (per-field whitelist, same pattern as existing fields).
- [ ] 1.4 Test: `loadConfig` accepts `retrieval` + fields; rejects malformed values and falls back to defaults; unknown `memoryMode` still resolves to `policy-only`.

## 2. Signature plumbing (`prompt-context.ts`)

- [ ] 2.1 Extend `buildPromptContext()` signature with `query` + `cwd`; add a dedicated `else if (memoryMode === "retrieval")` branch that does NOT fall through to legacy-inject. (Callsite wiring is §5.1.)
- [ ] 2.2 Empty/whitespace `query` → pinned-only + policy prompt (no throw).

## 3. Search primitives (retrieval-SPECIFIC — do not mutate shared ones)

- [ ] 3.1 **Verify tool-layer sync covers all write paths** (cycle2 #2): the memory tool already syncs SQLite (`memory-tool.ts:98-102, 311-314, 332-335`). Do NOT add sync inside `MemoryStore`. Confirm the auto-consolidation child and background-review paths also route writes through the tool/sync; add sync ONLY at a proven bypass.
- [ ] 3.2 **New ranked query** (cycle1 #1, cycle2 #5): add `searchMemoriesRanked()` returning a distinct type that SELECTs FTS5 `rank` (BM25). Leave `searchMemories`/`SqliteMemoryEntry`/`memory_search` output UNCHANGED (recency-first is their contract).
- [ ] 3.3 **Current-project OR global scope** (cycle1 #5, cycle2 #3): add an `includeGlobal` option on `searchMemoriesRanked` matching `project = ? OR project IS NULL`. Use the registration-time `projectName` for v1 (per-turn `detectProject(cwd)` deferred — cycle2 #4).
- [ ] 3.4 **Retrieval-only NL sanitizer** (cycle1 #7, cycle2 #6): new function (do NOT reuse `normalizeFts5Query`, which preserves operators) that quotes every token and strips operator-significance; truncate prompt by CODEPOINT to `promptTruncateChars` (cycle2 #9).
- [ ] 3.5 **Public render+fence helper** (cycle1 #10, cycle2 #1): expose a function that renders a SELECTED set of individual rows then applies the `<memory-context>` fence ONCE, matching `formatForSystemPrompt`'s fence format. Do not fence per-entry.

## 4. Selection + assembly (select rows BEFORE rendering)

- [ ] 4.1 Rank candidates from `searchMemoriesRanked` by BM25 `rank` (primary) + `categoryWeights[category]`. No recency term; do NOT bump `last_referenced` on inject (cycle1 #8).
- [ ] 4.2 Pin an entry if `target ∈ pinnedTargets` OR `category ∈ pinnedCategories` (UNION, never AND — non-failure rows have `category = NULL`, cycle2 #7).
- [ ] 4.3 Select ROWS to a budget BEFORE rendering (cycle2 #1): reserve `retrievedBudgetShare` of `injectCharBudget` for retrieved rows; pinned fill remainder; if pinned exceed their share, drop lowest-priority pinned ROWS; cap by `injectTopK`.
- [ ] 4.4 Render the final row set + fence once via the 3.5 helper. Specify injection order (pinned → retrieved → policy) to keep a stable prompt-cache prefix (cycle2 #9).

## 5. Hybrid + fail-safe + plumbing

- [ ] 5.1 In `index.ts` `before_agent_start`, pass `event.prompt` + `event.systemPromptOptions?.cwd` into `buildPromptContext` (branch defined in §2.1).
- [ ] 5.2 In the `retrieval` branch, append pinned+retrieved block AND the policy prompt to `event.systemPrompt` (D1 hybrid; keep the append form so chained handlers are not clobbered — Finding #12).
- [ ] 5.3 Wrap the ENTIRE handler body in try/catch: on any error, log and return the policy-only block; never throw (Finding #4 — current handler has no guard).

## 6. Observability

- [ ] 6.1 Emit a debug summary per injection: `{ query, pinnedCount, retrievedCount, droppedForBudget, chars, ms }`.
- [ ] 6.2 Measure added per-turn latency of the synchronous SQLite retrieval; if material, add a deadline that falls back to pinned-only (Finding #6).

## Tests

- [ ] T.1 Relevant entry for the prompt outranks unrelated entries and appears in the block (Requirement: Query-aware hot block).
- [ ] T.2 Pinned `target=user` present when prompt is unrelated; a reserved budget share still admits the prompt-relevant entry (Requirement: Pinning by target and category).
- [ ] T.3 Both retrieved block and policy prompt present (Requirement: Hybrid).
- [ ] T.4 Higher-BM25 entry outranks lower; injection does NOT change `last_referenced` (Requirement: Relevance ranking via BM25).
- [ ] T.5 SQLite search throwing anywhere in the handler degrades to policy-only, turn proceeds, error logged (Requirement: Fail-safe).
- [ ] T.6 Injected entries remain inside `<memory-context>` fences (Requirement: Context fencing preserved).
- [ ] T.7 Default mode unchanged: no config → policy-only, zero entries injected.
- [ ] T.8 Entry added mid-session via the `memory` tool is retrievable on a later matching prompt (write-through sync, Finding #4).
- [ ] T.9 Scope: retrieval returns current-project + global entries, excludes other projects (Finding #5).
- [ ] T.10 Prompt containing uppercase `AND`/code does not empty or error retrieval (Finding #7).

## Validate

- [ ] V.1 `openspec validate memory-retrieval-injection --strict` passes.
- [ ] V.2 Manual: set `"memoryMode": "retrieval"` in `hermes-memory-config.json`, run a session, confirm a topic-relevant entry appears in the injected block and toggling back to `policy-only` restores prior behavior.

## Out of scope (follow-up changes)

- [ ] Tier-2 pi TUI `SettingsList` toggle for `memoryMode`.
- [ ] Tier-3 dashboard Settings panel toggle (`SettingsPanel.tsx` + config bridge) — the only piece that would touch this repo.
