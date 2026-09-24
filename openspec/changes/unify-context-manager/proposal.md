# unify-context-manager (umbrella)

> Supersedes `openspec/changes/consolidate-retrieval-planes`. Evidence base:
> `docs/research/unified-context-manager-exploration.md` (§1–§18). This is an
> **umbrella**: it fixes the target architecture and the phase split. Each
> phase ships as its own change that carries the behavioural spec deltas.

## Why

Four context extensions run in every pi session: pi-hermes-memory, pi-blackhole,
context-mode and our kb-extension. Each has its own capture, store, prompt
injection, compaction hook and search tool. The model gets three session-search
tools (`session_search`, `recall`, `ctx_search`) and three per-turn injections.
Three extensions contend for `session_before_compact`, and two rewrite `context`.
Four pipelines each re-read the same pi session JSONL.

The durable memory is effectively write-only:
- 461 memory writes against 66 reads across 504 conversations.
- hermes runs in `policy-only` mode, so 272 KB of project `MEMORY.md` and 408 KB
  of `failures.md` never reach the model.
- Research agrees that storage is not the bottleneck; delivery is. Voluntary
  memory use is near zero, and deterministic harness injection works
  (arXiv 2607.20972, 2607.08716). Retrieval quality dominates write
  sophistication (arXiv 2603.02473).

context-mode also runs 16 MCP child processes (616 MB RSS) on this host.

The predecessor proposal chose "wrap, never absorb" and named the resulting shim
over third-party stores as its top risk. hermes and blackhole are MIT, so forking
them removes the shim. context-mode is Elastic-2.0 and is not forked: only its
sandbox behaviour (97% of its calls) is re-implemented cleanly.

## What Changes

- **New `packages/context-manager`** pi extension. It is the single owner of
  every context hook: one capture tap, one store, one budgeted injection and one
  compaction path. It reuses the `packages/kb` engine (node:sqlite, BM25 +
  trigram) for all indexing.
- **Fork** pi-hermes-memory 0.9.9 and pi-blackhole 0.5.6 into it (MIT, notices
  kept). Their TUI settings frameworks, changelog screens, migrations and TUI
  commands are dropped (~12k LOC). The hermes and blackhole distillation
  pipelines stay separate.
- **BREAKING (pi floor 0.87.0):** blackhole's deterministic compaction moves onto
  pi's public `turn_end` / `agent_before_settle` boundary API
  (`CompactionEntryDraft` + `continue: true`). The `AgentSession.compact`
  prototype monkeypatch is retired.
- **Lessons become one file per lesson:** markdown with YAML frontmatter
  (`kind`, `scope`, `card`, `triggers`, `severity`).
  - Project lessons live in `<repo>/.pi/lessons/` and are team-shared by default.
  - Global lessons live in `~/.pi/agent/lessons/`.
  - Project identity is the git common dir, so worktrees share the parent's
    lessons.
  - `fired`/`followed` stats live in a disposable node:sqlite DB.
  - `MEMORY.md`, `USER.md` and `failures.md` stop being written.
- **Harness-owned delivery in three tiers:**
  - pinned (≤ ~2 KB, stable, cache-safe);
  - cue-fired (path, command, error, tool, symbol, prompt, event and behaviour
    triggers delivered as a `tool_result` append, a `tool_call` block, or a
    per-turn message; silent by default, budgeted, once per compaction epoch);
  - pull.
- **BREAKING (tool surface):** five model-facing tools: `context_search`,
  `context_get`, `lesson`, `skill_manage`, `exec`. The old names (`kb_search`,
  `kb_get`, `kb_neighbors`, `memory_*`, `session_search`, `recall`, `ctx_*`)
  remain as deactivated aliases for one release.
- **`exec`:** clean-room sandbox execution (code or file, optional `intent`
  auto-index), written from behaviour contracts rather than from context-mode
  source.
- **Web tap:** pi-web-access remains the only fetcher. `fetch_content`,
  `web_search` and `source_check` results are indexed into a persistent `web`
  scope. `ctx_fetch_and_index` is dropped.
- **Session index:** a single node:sqlite FTS index, including a message copy for
  speed, replaces hermes' better-sqlite3 `sessions.db`.
- **Retrospective lesson miner:** `/lessons mine` and `/lessons import-hermes`,
  dry-run by default.
  - Pipeline: `packages/session-distiller` candidates → triage → card writing
    by parallel subagents under the existing `maxConcurrentSubagents` gate →
    trigger replay gate → semantic dedupe → PII/secret scrub → verify →
    staged files.
  - Items above a confidence threshold are auto-accepted; the rest go to review.
  - Triage decisions are persisted as a labelled dataset.
- **Optional System-1 triage tier:** one `/v1/systemone` adapter supporting a
  remote endpoint, a dashboard-managed local server (Von or Laya) and in-process
  `laya-ts`. With no endpoint configured, triage uses the selected LLM. In a
  measured bake-off, zero-shot Von and Laya were not viable for triage (AUC
  0.43 / 0.62 vs the LLM's 0.95), so the tier is opt-in.
- **New `packages/context-manager-plugin`** replaces hermes-memory-plugin,
  blackhole-plugin and kb-plugin in the dashboard.
- **BREAKING (operator):** `npm:pi-hermes-memory`, `npm:pi-blackhole` and
  `npm:context-mode` are removed from pi settings at cutover. context-mode
  leaves the recommended-extensions list.

### Phase changes (created later, in order)

1. `context-manager-kernel`: package, capture tap, store, single injection
   owner, `context_search`/`context_get`, tool aliasing.
2. `context-manager-forks`: hermes and blackhole port, compaction on the
   boundary API, pi floor 0.87.
3. `context-manager-lessons-and-cues`: lesson files, `lesson` tool, the three
   delivery tiers, trigger matcher and stats.
4. `context-manager-exec-and-web`: `exec` sandbox and web tap.
5. `context-manager-lesson-miner`: miner, `import-hermes`, labelled dataset,
   System-1 adapter.
6. `context-manager-plugin-cutover`: the unified dashboard plugin, recommended
   extensions, uninstalling the old packages, doctrine update.

## Capabilities

This umbrella declares no spec deltas (`skip_specs: true`). Capabilities are
specified by the phase changes.

### New Capabilities (specced in phase changes)
- `context-capture-and-store`: single capture tap, unified index, scopes
  `docs|code|lessons|sessions|web`.
- `context-tool-surface`: the five tools and alias deactivation.
- `lesson-files`: file format, locations, identity, lifecycle.
- `cue-delivery`: trigger vocabulary, channels, firing policy, stats.
- `boundary-compaction`: deterministic compaction on `turn_end`.
- `sandbox-exec`: clean-room execution contract.
- `web-result-indexing`: web-access tap.
- `lesson-miner`: retrospective mining, triage, review gate, dataset.
- `system-one-triage`: `/v1/systemone` adapter, modes, LLM fallback.
- `context-manager-plugin`: unified dashboard surface.

### Modified Capabilities (specced in phase changes)
- `bundled-recommended-extensions`: context-mode removed.
- `hermes-memory-settings`, `blackhole-plugin-settings`,
  `kb-plugin-settings`: folded into `context-manager-plugin`.
- `kb-read-discipline`, `kb-doctrine-injection`: doctrine names the new tools.
- `compaction-boundary-replay`: compaction entries now come from the boundary
  API.

## Impact

- **Code:**
  - New `packages/context-manager` and `packages/context-manager-plugin`.
  - `packages/kb` gains the `lessons`, `sessions` and `web` scopes.
  - `packages/session-distiller` is reused.
  - hermes-memory-plugin, blackhole-plugin and kb-plugin are retired at cutover.
- **Dependencies:** removes better-sqlite3 (×2), the MCP SDK child and the
  third-party pi packages. Adds nothing mandatory. Von/Laya are optional
  external services.
- **pi:** peer floor rises to 0.87.0.
- **Data:** existing hermes, blackhole and context-mode stores are read-only
  sources for import and are never deleted by this change. Lessons from the
  812 existing entries are imported only through the miner's triage and review.
- **Prompts/doctrine:** AGENTS.md doctrine and skills that name `kb_search`
  etc. are updated at cutover. Aliases cover the gap for one release.
- **Security surface:** lesson files in the repo and indexed web content are
  delivered into model context, which makes them an injection vector. This
  interacts with `add-untrusted-content-guard`.

## Discipline Skills

- `doubt-driven-review`: the fork, the tool rename, the pi floor raise and the
  uninstall of three packages are irreversible for operators. Each phase change
  gets a review before it stands.
- `security-hardening`:
  - Team-shared lesson files and indexed web content reach the model (prompt
    injection via lessons or PRs).
  - `exec` runs code.
  - The PII/secret scrub gates writes into the repo.
- `performance-optimization`: the cue matcher runs on every `tool_call` and
  `tool_result`, so it needs a latency budget and measurement. The memory/RSS
  claims must be re-measured after cutover.
- `observability-instrumentation`: `fired`/`followed` stats, per-lesson
  precision, and miner job progress and labels.
- `review-code`: every phase before commit.
- `code-simplification`: the fork must actually shed the ~12k LOC listed.
  The end state is judged against five tools, one injection and one store.
