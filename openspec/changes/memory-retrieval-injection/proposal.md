# Query-aware retrieval injection for hermes memory

> **SUPERSEDED (2026-09-24) by `openspec/changes/unify-context-manager`.**
> Its target, `pi-hermes-memory`, is forked and retired by the umbrella (D1),
> and query-aware injection becomes the manager's cue tier (D2, D5). Tier R
> measured the distilled memory store as the weakest retriever (7% helpful vs
> 34% raw session search; research doc §19), so ranking injection over it is
> not the lever.
>
> **Carried over:**
> - category pinning → the pinned tier (D2), phase 1 `context-manager-kernel`;
> - "injection bumps a used signal" → `fired`/`followed` stats (D4/D5), phase 3;
> - prompt sanitising and length-bounding before FTS → `prompt` triggers (D5),
>   phase 3;
> - fail-safe to no injection → the chassis fail-open rule (kernel K3).
>
> Kept for history; do not implement.

## Scope & Target (read first)

**Implementation target is the external `pi-hermes-memory` npm package**, NOT this
repository. `pi-hermes-memory` is a separately-published pi extension installed globally
at `~/.pi/agent/npm/node_modules/pi-hermes-memory` ("Ported from Hermes agent"). It is
not a workspace package, not vendored, and not a declared dependency of pi-agent-dashboard.

This change is authored here because this repo is the available OpenSpec workspace. It is
a **design spec intended for upstream contribution** (or a fork/vendored copy) to
`pi-hermes-memory`. All file paths in tasks/spec are relative to that package's `src/`.
The only work that could land in THIS repo is the optional Tier-3 dashboard toggle
(explicitly out of scope below).

## Why

The extension's default `memoryMode: "policy-only"` injects **zero memory entries** into
the system prompt — it injects only a usage policy and relies on the agent to call
`memory_search` on demand. The alternative, `legacy-inject`, dumps the **entire** store
verbatim up to the char limit with **no ranking**. Neither puts the entries most relevant
to the current task in front of the model:

- policy-only: relevant entries are reachable but never proactively present; the agent
  must remember to search, and often doesn't for standing facts.
- legacy-inject: as the store grows, the hot block is a query-blind dump — the most
  relevant entry for *this* turn competes for space with everything else.

The hook needed to fix this already exists and is already subscribed. `before_agent_start`
fires **per user turn, after the prompt is submitted**, exposing `event.prompt` and
`event.systemPromptOptions.cwd`. The extension's own handler (`index.ts`) receives this
event but **discards the prompt**, calling `buildPromptContext()` with no query. The
BM25/FTS5 retrieval primitive (`searchMemories`, `normalizeFts5Query`) also already ships.
The fix is to stop discarding the query.

## What Changes

- **New `memoryMode: "retrieval"`** (opt-in; `policy-only` stays the default — zero change
  for anyone who does not opt in, no data migration).
- In retrieval mode, the `before_agent_start` handler passes `event.prompt` (+ project/cwd)
  into `buildPromptContext()`, which retrieves from the SQLite superset and injects a
  **top-K, char-budgeted, ranked** hot block instead of the whole store. This requires
  closing a **dual-store gap**: MemoryStore (markdown, what is injected today) and the
  SQLite superset (what search reads) only sync at startup, so mid-session writes are
  invisible to search — `add/replace/remove` must write through to SQLite (see `design.md`
  D4). The prompt is sanitized + length-bounded before the FTS query (D6, D7).
- **Category pinning**: a configurable `pinnedCategories` set is always injected regardless
  of BM25 score (standing facts must apply every turn). Default `["user", "convention"]`
  (see `design.md` D3).
- **Hybrid**: the retrieved block is injected **in addition to** the policy prompt, so the
  agent still has the escape hatch to `memory_search` for more.
- **Ranking**: candidates ordered by BM25 + recency boost (`last_referenced`) + per-category
  weight. Injecting an entry **bumps its `last_referenced`**, so "used" stops being
  conflated with "edited" (fixes the existing LRU-signal gap).
- **Fail-safe**: any retrieval error falls back to the existing policy-only block; a turn is
  never broken by memory injection.
- **Switchability**: Tier-1 config toggle in `hermes-memory-config.json` (the native
  settings surface). Tier-2 (pi TUI `SettingsList`) and Tier-3 (dashboard Settings panel)
  are **out of scope** here — they change how the switch is flipped, not what it does.

## Discipline Skills

- `security-hardening` — retrieved stored memory is injected into the system prompt; must
  preserve the extension's existing context-fencing (`<memory-context>` tags) against
  prompt-injection through stored content.
- `performance-optimization` — the retrieval runs on the per-turn `before_agent_start` hot
  path; the added DB query must stay within a small latency budget.
- `observability-instrumentation` — the injected set is otherwise invisible; emit what was
  retrieved/pinned/dropped so behavior is diagnosable.

## Capabilities

### New Capabilities

- `memory-retrieval-injection`: opt-in `memoryMode: "retrieval"` that builds a query-aware,
  ranked, char-budgeted hot memory block from `before_agent_start.prompt`, with category
  pinning, hybrid policy coexistence, recency-aware ranking, and fail-safe fallback.

## Impact

- **Target package** (`pi-hermes-memory`, external/upstream):
  - `types.ts` — add `"retrieval"` to `memoryMode`; add `retrievalInjection` config
    (`injectTopK`, `injectCharBudget`, `pinnedCategories`, ranking weights).
  - `config.ts` — accept + validate the new mode and fields (same pattern as existing
    `memoryMode` validation and `DEFAULT_CONFIG` merge).
  - `prompt-context.ts` — `buildPromptContext()` gains `query`/`cwd`; dedicated retrieval
    branch (must not fall through to legacy-inject) formats the ranked top-K + pinned entries.
  - `index.ts` (~line 174) — pass `event.prompt` and `event.systemPromptOptions?.cwd` into
    `buildPromptContext()`.
  - `store/memory-store.ts` — write-through SQLite upsert on `add/replace/remove` (D4);
    public `<memory-context>` fencing helper (D8, `fenceBlock` is currently private).
  - `store/sqlite-memory-store.ts` — extend `searchMemories` to return FTS5 `rank` (D2) and
    scope `project = <current> OR project IS NULL` (D5); the current query returns no score
    and orders by `last_referenced DESC`.
  - Whole `before_agent_start` handler wrapped in try/catch (it currently has none).
- **This repo (pi-agent-dashboard)**: no changes in scope. Optional future Tier-3 dashboard
  toggle (`SettingsPanel.tsx` + config bridge) is a separate follow-up change.
- **Coexistence**: pi chains `before_agent_start` handler results. This handler already
  coexists with the archived `inject-session-context-into-agent` bridge handler and the
  bridge's pass-through forwarder — the retrieval block is one more chained SP contribution.
- **Default behavior**: unchanged. `policy-only` remains the default; `retrieval` is opt-in
  and reversible with no migration.
- **Token cost**: bounded by `injectCharBudget` (opt-in); zero when not enabled.
