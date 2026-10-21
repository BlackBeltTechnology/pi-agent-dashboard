# unify-context-manager (umbrella)

> Supersedes `openspec/changes/consolidate-retrieval-planes`,
> `memory-retrieval-injection`, `distill-hermes-memory-into-skills` and
> `add-automatic-session-kb-index` (carry-overs: design, "Superseded proposals"). Evidence base:
> `docs/research/unified-context-manager-exploration.md` (§1–§20). This is an
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

Since pi 0.99 the core ships `codemode` (a QuickJS sandbox whose script output
is the only thing that reaches the model) and `tool_search`. That covers
context-mode's sandbox role, so nothing of context-mode needs re-implementing
(re-checked on pi 1.3.0, 2026-10-21).

The predecessor proposal chose "wrap, never absorb" and named the resulting shim
over third-party stores as its top risk. hermes and blackhole are MIT, so forking
them removes the shim. context-mode is Elastic-2.0 and is not forked: its
sandbox behaviour (97% of its calls) is replaced by pi's built-in `codemode`.

## What Changes

- **New `packages/context-manager`** pi extension. It is the single owner of
  every context hook: one capture tap, one store, one budgeted injection and one
  compaction path. It reuses the `packages/kb` engine (node:sqlite, BM25 +
  trigram) for all indexing.
- **Fork** pi-hermes-memory 0.9.10 and pi-blackhole 0.5.15 into it (MIT, notices
  kept). Their TUI settings frameworks, changelog screens, footer status bar,
  migrations and TUI commands are dropped (recounted at fork time, D1). The
  hermes and blackhole distillation pipelines stay separate.
- blackhole's deterministic compaction moves onto pi's public `turn_end` /
  `agent_before_settle` boundary API (`CompactionEntryDraft` + `continue:
  true`). The `AgentSession.compact` prototype monkeypatch (still present in
  blackhole 0.5.15) is retired. No pi floor change: the repo already requires
  pi ≥1.3.0.
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
- **BREAKING (tool surface):** four model-facing tools: `context_search`,
  `context_get`, `lesson`, `skill_manage`. The old names (`kb_search`,
  `kb_get`, `kb_neighbors`, `memory_*`, `session_search`, `recall`, `ctx_*`)
  stay callable for one release without being declared to the model, using
  pi 1.x tool exposure (`deferred` / `prepareLoadout` hidden declarations;
  the exact mechanism is decided by a spike, D6).
- **Sandbox execution = pi `codemode`:** the clean-room `exec` tool is dropped.
  The manager adds only `intent` auto-indexing of large `codemode` output into
  the `sessions` scope (D7).
- **Web tap:** pi-web-access remains the only fetcher. `fetch_content`,
  `web_search` and `source_check` results are indexed into a persistent `web`
  scope, including calls a `codemode` script makes (nested calls pass the same
  `tool_result` handlers). `ctx_fetch_and_index` is dropped.
- **Session index:** a single node:sqlite FTS index, including a message copy for
  speed, replaces hermes' better-sqlite3 `sessions.db`.
- **Git scope (absorbed, D13):** `add-kb-git-forge-scope` (shipped 2026-10-13)
  provides commits, PRs and issues as a `git` scope on today's kb. It covers one shared index
  per git common dir, a lazy and budgeted forge sync with a single owner, and
  untrusted marking of forge text. The manager registers it as a
  kb-extension-provided scope, searched only when named; it is not rebuilt.
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
2a. `context-manager-blackhole-fork`: blackhole 0.5.15 port, compaction on
   the boundary API, `recall`, live `session_compact` synthesis in the bridge.
2b. `context-manager-session-index`: the D9 session index on node:sqlite,
   `session_search` alias, `skill_manage` (from hermes 0.9.10).
3. `context-manager-lessons-and-cues`: lesson files, `lesson` tool, the three
   delivery tiers, trigger matcher and stats, and the hermes distillers
   (background-review, correction-detector, session-flush) ported to write
   lessons instead of MEMORY.md.
4. `context-manager-web-and-codemode`: web tap and `codemode` intent indexing.
5. `context-manager-lesson-miner`: miner, `import-hermes`, labelled dataset,
   System-1 adapter.
6. `context-manager-plugin-cutover`: the unified dashboard plugin, recommended
   extensions, uninstalling the old packages, doctrine update.

## Capabilities

This umbrella declares no spec deltas (`skip_specs: true`). Capabilities are
specified by the phase changes.

### New Capabilities (specced in phase changes)
- `context-capture-and-store`: single capture tap, unified index, scopes
  `docs|code|lessons|sessions|web|git`. `git` is specified by
  `add-kb-git-forge-scope` (`kb-git-forge-scope`); the kernel only registers it.
- `context-tool-surface`: the four tools and alias exposure.
- `lesson-files`: file format, locations, identity, lifecycle.
- `cue-delivery`: trigger vocabulary, channels, firing policy, stats.
- `boundary-compaction`: deterministic compaction on `turn_end`.
- `codemode-output-indexing`: `intent` auto-indexing of `codemode` output.
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
  - `packages/kb` gains the `lessons`, `sessions` and `web` scopes. The `git`
    scope arrives earlier via `add-kb-git-forge-scope`.
  - `packages/session-distiller` is reused.
  - hermes-memory-plugin, blackhole-plugin and kb-plugin are retired at cutover.
- **Dependencies:** removes better-sqlite3 (×2), the MCP SDK child and the
  third-party pi packages. Adds nothing mandatory. Von/Laya are optional
  external services.
- **pi:** peer `>=1.3.0`, already the repo-wide floor; no raise.
- **Data:** existing hermes, blackhole and context-mode stores are read-only
  sources for import and are never deleted by this change. Lessons from the
  812 existing entries are imported only through the miner's triage and review.
- **Prompts/doctrine:** AGENTS.md doctrine and skills that name `kb_search`
  etc. are updated at cutover. Aliases cover the gap for one release.
- **Security surface:** lesson files in the repo, indexed web content and
  forge PR/issue text (`git` scope) are delivered into model context, which makes
  them an injection vector. The shipped `add-untrusted-content-guard` /
  `harden-untrusted-content-ingestion` scanner is reused, not rebuilt.
- **Forge rate limits:** the `git` scope spends forge API quota. Its budget
  (single owner per repo, lazy sync, minimum interval, rate floor) is defined in
  `add-kb-git-forge-scope` and must survive the move behind `context_search`.

## Discipline Skills

- `doubt-driven-review`: the fork, the tool rename and the uninstall of three
  packages are irreversible for operators. Each phase change
  gets a review before it stands.
- `security-hardening`:
  - Team-shared lesson files and indexed web content reach the model (prompt
    injection via lessons or PRs).
  - The PII/secret scrub gates writes into the repo.
- `performance-optimization`: the cue matcher runs on every `tool_call` and
  `tool_result`, so it needs a latency budget and measurement. The memory/RSS
  claims must be re-measured after cutover.
- `observability-instrumentation`: `fired`/`followed` stats, per-lesson
  precision, and miner job progress and labels.
- `review-code`: every phase before commit.
- `code-simplification`: the fork must actually shed the ~12k LOC listed.
  The end state is judged against four tools, one injection and one store.
