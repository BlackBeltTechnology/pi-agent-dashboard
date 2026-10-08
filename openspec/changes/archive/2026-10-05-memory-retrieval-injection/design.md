# Design — memory-retrieval-injection

> Revised after TWO doubt-driven-review cycles (single-model + cross-model GPT-5.5, repo
> read access each). Cycle 1 fixed factual errors (BM25 scores, `"user"` as a category).
> Cycle 2 corrected an over-correction: the dual-store "gap" is largely already closed by
> the memory tool layer, so write-through inside MemoryStore would DOUBLE-SYNC. Cycle 2
> also killed the original D9 (monolithic block render can't drop individual pins) and moved
> D2/D5/D7 to retrieval-specific variants instead of editing shared primitives.

## Context (verified against source)

`pi-hermes-memory` builds the injected block in `prompt-context.ts::buildPromptContext()`,
called from the `before_agent_start` handler in `index.ts:174`. Today:

- `memoryMode: "policy-only"` (default) → returns only the policy prompt; no entries.
- `memoryMode: "legacy-inject"` → `store.formatForSystemPrompt()` = whole store, unranked.

Two stores exist:
- **MemoryStore** (in-memory + markdown, `store/memory-store.ts`) — what
  `formatForSystemPrompt()` injects. `MemoryStore.add/replace/remove` write markdown ONLY.
- **SQLite superset** (`store/sqlite-memory-store.ts`) — what `searchMemories()` queries.
  Startup sync at `index.ts:74`. **Correction (cycle 2): the memory TOOL layer already
  write-through-syncs SQLite** after each store op (`tools/memory-tool.ts:98-102, 311-314,
  332-335` → `syncMemoryEntry`/`syncReplaceToSqlite`/`syncRemoveFromSqlite`), so entries
  added via the `memory` tool DO reach SQLite mid-session. `searchMemories()`
  `ORDER BY last_referenced DESC` — it does NOT select/return a BM25 score; relevance is a
  MATCH pass/fail filter only. Non-failure entries are synced with `category = NULL`
  (`memory-tool.ts:98-102`); category is populated only for failure-target lessons.

`before_agent_start` fires per turn with `event.prompt`, `event.systemPromptOptions.cwd`.
The handler currently ignores `event.prompt` and has NO try/catch.

## Goals

- Pull entries relevant to the current turn FROM THE SUPERSET into the bounded hot block.
- Keep standing facts (user profile, conventions) always present.
- Opt-in, reversible, no migration; never break or meaningfully delay a turn.

## Non-Goals

- Moving memory into the project `kb` (rejected: repo-scoped, git-committed, privacy leak).
- Tier-2 (pi TUI `SettingsList`) and Tier-3 (dashboard) toggles.
- A new search engine — reuse `searchMemories` (but extend its return shape, see D2).

## Decisions

### D1 — Hybrid with policy prompt (RESOLVED)
Inject pinned block → retrieved block → policy prompt. Retrieved block is a head start;
policy prompt keeps the `memory_search` escape hatch. Append to `event.systemPrompt`
(never rebuild from `systemPromptOptions`) so chained handlers (dashboard bridge injector)
are not clobbered. [Finding #12]

### D2 — Ranking via a retrieval-SPECIFIC ranked query (REVISED x2)
`searchMemories()` returns NO score and orders by `last_referenced DESC`; it is also the
engine for the `memory_search` tool, whose recency-first output is a contract. So DO NOT
mutate `searchMemories`/`SqliteMemoryEntry`. Instead add a **separate** retrieval query
(e.g. `searchMemoriesRanked`) returning a distinct ranked type that selects FTS5 `rank`
(BM25). Order = BM25 rank (primary) + per-category weight. **No recency term; do NOT bump
`last_referenced` on inject** (self-reinforcing loop). `last_referenced` keeps bumping only
on `replace`. [cycle1 #1/#8, cycle2 #5]

### D3 — Pinning: UNION of two selectors (REVISED x2)
`"user"` is a `target` column, not a `MemoryCategory`. An entry is pinned if
`target ∈ pinnedTargets` **OR** `category ∈ pinnedCategories` (UNION, never AND — combined
would match zero rows since non-failure entries have `category = NULL`). Defaults:
`pinnedTargets: ["user"]`, `pinnedCategories: ["convention"]`. NOTE: the `convention`
category exists only on failure-target lessons, so pinnedCategories pins convention
LESSONS, not arbitrary project conventions. Either set may be `[]`. [cycle1 #2, cycle2 #7]

### D4 — Dual-store: rely on EXISTING tool-layer sync (REVISED — cycle 1 over-corrected)
The memory TOOL layer already write-through-syncs SQLite after every store op
(`memory-tool.ts:98-102, 311-314, 332-335`), so SQLite already reflects current-session
tool writes. Adding a second sync inside `MemoryStore.add/replace/remove` would DOUBLE-SYNC
and trigger false "no matching SQLite row" warnings (`memory-tool.ts:127-128, 153-154`).
DECISION: do NOT add store-level sync. Keep the single owner (tool layer). Verify the two
non-tool write paths (auto-consolidation child, background-review) also route through the
tool/sync; add sync ONLY at a proven bypass. Injection formats retrieved SQLite rows
directly (not via `formatForSystemPrompt`). [cycle2 #2; cycle2 #8 race refuted — parent
awaits child + WAL]

### D5 — Scope = current project + global, via a retrieval-only option (REVISED x2)
The existing search does exact-project XOR global-only — not "current OR global". Add an
`includeGlobal` option on the NEW retrieval query (D2), matching
`project = <current> OR project IS NULL`; do NOT overload `searchMemories`/`memory_search`
semantics. `projectStore`/`projectName` are built once at registration (`index.ts:100-138`)
and the pinned/project blocks use them; to avoid a project-A-pinned / project-B-scoped
mismatch, **v1 uses the registration-time `projectName` for scope too**. Per-turn
`detectProject(cwd)` is deferred (needs a per-turn project store; out of v1 scope).
[cycle1 #5, cycle2 #3/#4]

### D6 — Hot-path latency bound (NEW)
Retrieval runs synchronously inside `before_agent_start`. Cap the query: truncate the
prompt to the first N chars (e.g. 400) before building the FTS query, and bound results by
`injectTopK`. Measure the added per-turn cost; if the synchronous SQLite call is material,
consider a timeout/deadline that falls back to pinned-only. [Finding #6]

### D7 — Retrieval-only NL sanitizer (REVISED — cannot reuse normalizeFts5Query)
`normalizeFts5Query` deliberately preserves uppercase `AND/OR/NOT/NEAR` and quoted phrases
(`fts-query.ts:26-38`), so it can't be reused. Add a retrieval-only sanitizer that quotes
every token and strips operator-significance so ordinary prompts (incl. code/quotes) don't
error or suppress retrieval. Truncate the prompt by CODEPOINT (not byte) to
`promptTruncateChars` to avoid splitting multibyte chars. [cycle1 #7, cycle2 #6, #9]

### D8 — Public fencing helper + per-entry render (REVISED)
`fenceBlock()` is private and `formatForSystemPrompt` renders monolithic blocks. Add a
public helper that renders the SELECTED individual rows (D9 selection) then applies the
`<memory-context>` fence ONCE, matching today's fence format. Do not fence per-entry.
[cycle1 #10, cycle2 #1]

### D9 — Select-then-render (REVISED — original was architecturally infeasible)
The original "drop lowest-priority pinned after formatting" is impossible —
`formatForSystemPrompt` emits one fenced string, not droppable entries
(`memory-store.ts:310-338`). DECISION: do ALL selection on individual SQLite rows BEFORE
rendering. Reserve `retrievedBudgetShare` of `injectCharBudget` for retrieved rows; pinned
fill the remainder; if pinned exceed their share, drop lowest-priority pinned ROWS pre-
render; then render+fence the final row set once (D8). [cycle2 #1]

## Budget & cold-start
- `injectTopK`, `injectCharBudget` bound the block (defaults TBD; e.g. 6 / 2000).
- No true cold start: `before_agent_start` fires post-submission. Empty/whitespace prompt →
  pinned-only + policy prompt.

## Fail-safe (whole handler)
The CURRENT handler has no try/catch — a throw drops even the policy prompt. Wrap the
ENTIRE `before_agent_start` body: on any error, fall back to the policy-only block; never
throw out of the handler. [Finding #4, latency #6 deadline path reuses this]

## Open items for implementation
- Concrete defaults: `injectTopK`, `injectCharBudget`, prompt-truncation N, pinned/retrieved
  budget split.
- Whether write-through sync (D4) is acceptable added latency on every memory write, or a
  cheaper "dirty flag re-sync before retrieval" is preferable.
