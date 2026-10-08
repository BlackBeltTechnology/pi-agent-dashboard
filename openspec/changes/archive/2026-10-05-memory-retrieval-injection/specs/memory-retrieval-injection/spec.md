# memory-retrieval-injection — delta

## ADDED Requirements

### Requirement: Opt-in retrieval injection mode
The extension SHALL support a `memoryMode: "retrieval"` value. It SHALL be opt-in: the
default SHALL remain `policy-only` with unchanged behavior, and enabling `retrieval` SHALL
require no data migration and SHALL be reversible by restoring the previous mode.

#### Scenario: Default is unchanged
- **WHEN** no `memoryMode` is set (or an unknown value is set) in `hermes-memory-config.json`
- **THEN** the resolved mode SHALL be `policy-only` and only the policy prompt SHALL be injected

#### Scenario: Retrieval mode is accepted and validated
- **WHEN** `hermes-memory-config.json` sets `"memoryMode": "retrieval"`
- **THEN** `loadConfig()` SHALL accept it alongside the existing `policy-only`/`legacy-inject` values

### Requirement: Query-aware hot block
In `retrieval` mode the `before_agent_start` handler SHALL pass the submitted prompt
(`event.prompt`) and working directory (`event.systemPromptOptions.cwd`) into the context
builder, which SHALL retrieve entries via the SQLite superset and inject a ranked,
char-budgeted block. It SHALL NOT dump the entire store. The prompt SHALL be sanitized to
natural-language FTS terms (uppercase AND/OR/NOT/NEAR and quotes neutralized) and truncated
to a bounded length before the query, so ordinary prompts do not suppress or error the
search.

#### Scenario: Prompt with FTS operators does not break retrieval
- **WHEN** the prompt contains uppercase `AND`/`OR` or code punctuation
- **THEN** retrieval SHALL still return relevance-matched entries (terms treated literally), not empty results

#### Scenario: Relevant entries surface for the current prompt
- **WHEN** the store holds entries about topics A, B, C and the user prompt concerns topic B
- **THEN** the injected block SHALL contain the topic-B entry ranked above unrelated A/C entries
- **AND** the block SHALL respect `injectTopK` and `injectCharBudget`

#### Scenario: Current-session entry is retrievable
- **WHEN** an entry is added via the `memory` tool during the session and a later prompt matches it
- **THEN** retrieval SHALL find it (the memory tool already write-through-syncs the SQLite superset per write; retrieval SHALL NOT add a second sync)

#### Scenario: Scope is global plus current project
- **WHEN** retrieval runs with a current project
- **THEN** the ranked query's `includeGlobal` option SHALL match entries where `project = <current>` OR `project IS NULL`, and SHALL NOT return other projects' entries

#### Scenario: Empty prompt falls back gracefully
- **WHEN** `event.prompt` is empty or whitespace
- **THEN** the handler SHALL inject the pinned block plus the policy prompt and SHALL NOT error

### Requirement: Pinning by target and category (union)
The extension SHALL always inject entries where `target ∈ pinnedTargets` OR
`category ∈ pinnedCategories`. `target` and `category` are distinct columns; the two sets
SHALL be combined as a UNION, never an intersection (non-failure entries have
`category = NULL`, so an AND of the two defaults would match zero rows). Defaults:
`pinnedTargets: ["user"]`, `pinnedCategories: ["convention"]`.

#### Scenario: Selectors are unioned, not intersected
- **WHEN** `pinnedTargets=["user"]` and `pinnedCategories=["convention"]`
- **THEN** both `target=user` entries (category NULL) AND `category=convention` lessons SHALL be pinned

#### Scenario: Pinned target always present
- **WHEN** `pinnedTargets` includes `user` and the prompt is unrelated to any user-profile entry
- **THEN** the user-profile entries SHALL still appear in the injected block

#### Scenario: Pinning never fully starves relevance
- **WHEN** pinned entries would consume the entire `injectCharBudget`
- **THEN** row selection (performed BEFORE rendering) SHALL reserve a minimum share of the budget for retrieved entries and drop lowest-priority pinned ROWS to preserve it

### Requirement: Hybrid with policy prompt
The retrieved/pinned block SHALL be injected in addition to the policy prompt so the agent
retains the ability to call `memory_search` for entries not in the hot block.

#### Scenario: Both blocks present
- **WHEN** `retrieval` mode is active and entries are injected
- **THEN** the system prompt SHALL contain the retrieved/pinned block AND the memory-usage policy prompt

### Requirement: Relevance ranking via BM25
A retrieval-SPECIFIC ranked query SHALL select and return the FTS5 `rank` (BM25) value; the
existing `searchMemories` primitive and the `memory_search` tool output SHALL remain
unchanged (their recency-first ordering is a contract). Candidate ordering SHALL use BM25
rank as the primary signal plus a per-category weight. Injecting an entry SHALL NOT bump its
`last_referenced` (doing so with a recency-ordered base query creates a self-reinforcing
loop); `last_referenced` continues to update only on `replace`.

#### Scenario: More relevant entry outranks a less relevant one
- **WHEN** two entries match the prompt with different BM25 rank
- **THEN** the higher-BM25 entry SHALL rank higher in the injected block

#### Scenario: Injection does not mutate ranking state
- **WHEN** an entry is injected into the hot block for a turn
- **THEN** its `last_referenced` SHALL be unchanged by the injection

### Requirement: Fail-safe injection
The ENTIRE `before_agent_start` handler body SHALL be wrapped so that a failure anywhere
(retrieval, DB, FTS5, formatting) SHALL NOT break the turn. On any error the handler SHALL
fall back to the policy-only block and SHALL NOT throw.

#### Scenario: Retrieval error degrades to policy-only
- **WHEN** the SQLite search throws during `before_agent_start`
- **THEN** the handler SHALL inject the policy-only block and the turn SHALL proceed normally
- **AND** the error SHALL be logged, not surfaced as a thrown exception

### Requirement: Context fencing preserved
Retrieved entries injected into the system prompt SHALL retain the extension's existing
context-fencing (`<memory-context>` tagging) so stored content cannot inject instructions
into the agent.

#### Scenario: Injected entries remain fenced
- **WHEN** a retrieved entry contains text resembling an instruction
- **THEN** it SHALL be emitted inside the context-fence markers, not as bare prompt text
