# Add a directory-based Markdown Knowledge Base (FTS5 + structural chunking + Tier-1 graph) queryable by LLM agents

> Full research with all external link traces: [`research.md`](./research.md).
> Design rationale and schemas: [`design.md`](./design.md).
> Implementation breakdown: [`tasks.md`](./tasks.md).

## Why

Agents working in this repo (and any markdown-heavy project) repeatedly need to
look up facts that are already written down — architecture decisions, API
patterns, prior fixes, conventions — but have no fast, local, structured way to
search a directory of markdown. Today the options are:

- **`grep`/`rg`** — no ranking, no relevance, no section awareness, returns
  whole-file noise. The agent must read full files to judge relevance, burning
  context tokens.
- **A vector DB** — requires an embedding model resident in memory, a second
  store to sync, a rebuild on every change, and an API/GPU cost. For a corpus of
  hundreds of heading-structured markdown files queried mostly by literal tokens
  (names, error codes, flags, function names), this is overkill: measured
  keyword precision for FTS5 BM25 is 93.5% vs vector 97.4%, not worth the cost
  (see [`research.md`](./research.md) §1.2).
- **context-mode (`ctx_index`/`ctx_search`)** — already ships FTS5 BM25 + Porter
  stemming + trigram + RRF + content-hash staleness, AND does heading-based
  structural chunking (empirically validated: 691 files → 8,600 sections, hits
  returned with heading breadcrumbs, code fences intact — [`research.md`](./research.md) §2.2).
  But it has three gaps for this use case:
  1. **No near-duplicate dedup** — tested against `doc-example/`, every result
     came back twice (template tree vs specialized tree); half the top-N slots
     were duplicates ([`research.md`](./research.md) §2.2).
  2. **No knowledge-graph layer** — no heading/​wikilink/​frontmatter traversal,
     so the agent cannot "find the note, then walk to related decisions."
  3. **No project/global config layering**, a manual `maxFiles` cap (default
     200, below this corpus's 691), and manual-only reindex.

There is no local, directory-based, change-aware, **graph-aware**, LLM-facing
markdown search with project/global configuration. This change adds one.

## What Changes

Add a new capability `markdown-knowledge-base`: a single-file SQLite knowledge
base over a directory of markdown, exposed to LLM agents as a pull tool, with
structural chunking, a Tier-1 deterministic graph, content-hash incremental
indexing, near-duplicate dedup, and project/global configuration.

- **SQLite + FTS5 store** (one `.db` file per indexed root, gitignored). Schema:
  a `chunks` FTS5 virtual table (`tokenize='porter unicode61'`, optional
  `trigram` companion), a `files` table (path, mtime, sha256) for change
  detection, and `nodes`/`edges` tables for the graph. Full schema in
  [`design.md`](./design.md).
- **Structural (heading) chunking** — split markdown at heading boundaries,
  carry the heading breadcrumb into the indexed body, keep fenced code blocks
  intact, frontmatter → metadata, merge tiny chunks, paragraph-split oversized
  leaf sections. Fallback to one-row-per-file for flat/structureless markdown.
- **Tier-1 knowledge graph** — `nodes`/`edges` populated in the same parse:
  heading nesting → `child_of`, `[[wikilinks]]` → `links_to`, markdown links →
  `references`, YAML frontmatter → typed entities + tags. Traversed via recursive
  CTEs. No LLM extraction (Tier-2 explicitly deferred — [`research.md`](./research.md) §4).
- **Incremental indexing** — layered mtime → sha256 → reindex over a directory
  walk; deletions purged; per-path chunk+edge replace on change. On-demand at
  search time (cheap for hundreds of files); no daemon.
- **Near-duplicate dedup** — content-hash collapse + configurable
  prefer-root ranking (the gap context-mode left), so duplicated trees do not
  flood top-N.
- **Retrieval-quality pipeline** ([`research.md`](./research.md) §8c,
  [`design.md`](./design.md) §6c) — staged, config-gated, all lexical by default:
  - *On by default (Tier A/B, no model deps):* BM25F field weighting (heading
    breadcrumb > body), proximity/in-order boost, **lexical MMR** diversity
    (suppresses near-duplicate sections beyond exact dedup), and **parent/child
    small-to-big** return (uses the heading graph we already store).
  - *Optional, OFF by default (Tier C, flagged):* **cross-encoder reranking** of
    BM25 top-k (`--rerank`; FTS5-compatible, no vector index, needs an optional
    reranker model) and **query expansion** (`--expand-query`; lexical PRF or
    agent reformulation).
  - *Deferred (Tier D):* hybrid BM25+vector via a **router** (not naive RRF
    blend — [`research.md`](./research.md) §1.2), behind the future vector
    `KbStore`.
- **Golden-set evaluation** — `kb eval` scores search against a
  `query → expected-section` set (Precision@K, Recall@K, MRR, nDCG@K) so ranking
  changes are measured and regressions gated ([`research.md`](./research.md)
  §8c Tier E).
- **Configuration layering** — `.pi/dashboard/knowledge_base.json` at project
  level; a global defaults file used when no project config exists. **No file
  cap by default.** Fields in [`design.md`](./design.md).
- **Index AGENTS.md + source-level markdown** ([`design.md`](./design.md) §6d) —
  `indexAgentsFiles` + `includeSourceMarkdown` pull `AGENTS.md`/`CLAUDE.md` and
  `*.md` scattered through source dirs into the index, tagged `doc_type`
  (`doc` | `agents` | `source-md`); `kb search --doc-type` filters by type so
  instruction files are findable without polluting prose search.
- **Optional directory-level AGENTS.md presentation** ([`design.md`](./design.md)
  §6d) — `directoryLevelAgents` (default OFF). Surfaces the **nearest applicable**
  `AGENTS.md` for a target path — the descendant half pi's native up-walk omits
  ([`research.md`](./research.md) §8d) — even for projects that never adopted a
  dox tree. `mode:"pull"` = a `kb agents <path>` tool (default, pull-aligned);
  `mode:"push"` = surface nearest on `tool_call` (opt-in); `fallbackManifest` =
  emit the KB-generated routing map when no AGENTS.md exists on the path. Makes
  the KB the deterministic engine for dox's "read the local contract before
  editing" without a hand-maintained tree.
- **DOX tree maintenance — `kb dox init` + `kb dox lint`** ([`design.md`](./design.md)
  §6d (4)/(5)). `kb dox init` scaffolds a tree on a treeless project (path rows
  seeded, purposes left for the LLM). `kb dox lint` is the on-demand/CI audit
  adapting the "Lint" operation from karpathy's LLM-maintained-wiki pattern
  (<https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>):
  deterministic (no LLM extraction), it reports stale/orphan/missing rows,
  missing `<file>.agent.md` companions, broken pointer-map links, and
  over-threshold areas, with `--json` for CI and a `--fix` that only does the
  deterministic subset (prune orphans, add path-only rows). It is the batch
  counterpart to the event-driven Phase-2 nudge — together they keep the dox tree
  drift-free per-edit and in bulk.
- **Pluggable external doc sources (`SourceResolver`)** — config generalized from
  filesystem-only `roots[]` to `sources[]` with a `kind` discriminator
  (`filesystem` | `npm` | `git` | `https`). A `SourceResolver` resolves each
  source to a local directory; the indexer is unchanged (always sees local
  dirs). Reuses pi's source model + the repo's `package-source-helpers.ts`
  (`parseSourceKind`/`computeIdentity`). **All four resolvers ship in this
  change.** Remote sources (npm/git/https) gated by a **TOFU trust** prompt on
  first fetch (`~/.pi/dashboard/kb-source-trust.json`, mirrors
  `worktree-init-trust`); KB **only reads markdown, never executes** source code.
  Supports **pinning** (git `@ref` / npm `@version`) + **refresh** policy
  (`on-index` | `manual` | TTL) + `kb index --refresh`. This is the "pluggable
  knowledge base": local docs + a team git handbook + a dependency's npm docs,
  all in one deduped, graph-aware index ([`research.md`](./research.md) §8b,
  [`design.md`](./design.md) §6b).
- **Pluggable storage backend (`KbStore`)** — the chunker, graph extractor, CLI,
  and SKILL talk to a small `KbStore` interface (`indexChunk`, `search`,
  `deleteByPath`, graph ops), not to SQLite directly. Default backend =
  `better-sqlite3` + FTS5 (proven on this machine; context-mode binding +
  `ctx_doctor` FTS5 PASS). This isolates the engine so a future
  **Turso Database (Limbo) + Tantivy FTS** backend can be swapped in without
  touching parsing/graph/CLI. Turso/Tantivy is genuinely more capable
  (transactional index, highlighting, hybrid-in-one-file) and proven in Rust
  tools (e.g. `v1cc0/aimem`), but is BETA with a beta Node binding and a
  non-FTS5 API — deferred, not adopted ([`research.md`](./research.md) §8).
- **Language/runtime** — TypeScript (repo-native ESM, `tsx`/jiti/bun available),
  `better-sqlite3` for SQLite/FTS5, `unified`/`remark` (mdast) for markdown
  parsing ([`research.md`](./research.md) §7). Final CLI-packaging details in
  design review (§9).
- **Delivery (phased):**
  - **Phase 1 — SKILL + CLI.** A `kb` CLI (`kb init`, `kb index`, `kb search`,
    `kb neighbors`, `kb backlinks`, `kb get`) + two pi SKILLs: `kb-search`
    (trigger-shaped `description` makes the agent retrieve-before-answering) and
    `kb-setup` (wraps `kb init` to scaffold + validate project/global config,
    satisfy remote-source trust, then index + smoke-search to verify). Zero
    pi-internals risk; ships and is testable against `doc-example/`.
  - **Phase 2 (also in this change) — native registered tool + background reindex hook.** Promote the
    mechanism to `pi.registerTool` (in-process, typed, dashboard-rendered) and
    add an **isolated** standalone pi extension hooking `tool_result` to
    reindex on `.md` edits. Built separately from `src/extension/bridge.ts`
    (which is a pi-version-footgun minefield — [`research.md`](./research.md) §5.2).
- **Retrieval is pull, not push** — the LLM invokes the tool; the system does
  NOT auto-inject search results via `input`/`tool_call` hooks ([`research.md`](./research.md) §5.3).

## Capabilities

### Added Capabilities

- `markdown-knowledge-base`: directory-based SQLite/FTS5 knowledge base with
  structural chunking, Tier-1 graph, content-hash incremental indexing,
  near-duplicate dedup, project/global config, exposed to LLM agents as a pull
  tool (SKILL+CLI in Phase 1, native registered tool + `tool_result` reindex
  hook in Phase 2).

## Impact

- **New publishable npm packages**: `@blackbelt-technology/pi-dashboard-kb`
  (`packages/kb`, `KbStore` + indexer/search library + `kb` bin) and
  `@blackbelt-technology/pi-dashboard-kb-extension` (`packages/kb-extension`,
  the isolated Phase-2 pi extension). They become the repo's **7th and 8th
  published packages** — the release pipeline (`npm publish -ws
  --include-workspace-root`) and `release-cut` version-bump set include them.
  Plus two SKILLs under `packages/kb/skill/kb-search/` and `.../kb-setup/`.
  No changes to `src/extension/bridge.ts`.
- **Setup is config-file + CLI, not a dashboard UI.** `kb init` (CLI) +
  `kb-setup` (SKILL) scaffold and validate `knowledge_base.json`; a dashboard
  settings panel / web graph view stays with the deferred server plugin.
- **New config files**: `.pi/dashboard/knowledge_base.json` (project) +
  `~/.pi/dashboard/knowledge_base.json` (global default). Schema-validated;
  absent project fields fall back to global. Design §7.
- **Index file**: one SQLite DB per project at `.pi/dashboard/kb/index.db`
  (spans all sources for cross-root dedup), gitignored (design §4, §7, §9).
- **Source cache + trust**: remote sources cached under
  `~/.pi/dashboard/kb/sources/`; trust map at
  `~/.pi/dashboard/kb-source-trust.json`. Network fetch for npm/git/https sources
  (read-only; no code execution). Still no Docker, no embedding model, no server.
- **Dependencies**: TypeScript; `better-sqlite3` (^12.x) + `@types/better-sqlite3`
  for SQLite/FTS5 (proven by context-mode's `ctx_doctor` — FTS5/SQLite PASS, with
  a `heal-better-sqlite3.mjs` rebuild precedent); `unified` + `remark-parse`
  (+ `remark-frontmatter`/`gray-matter`) for markdown AST parsing
  ([`research.md`](./research.md) §7). No Docker, no embedding model, no server
  (Phase 1/2).
- **Test corpus**: `doc-example/` (691 md files) is the verification fixture for
  chunking, dedup, graph traversal, and search precision.
- **Empirically validated** ([`research.md`](./research.md) §2.5): prototype over
  the real 691-file corpus — ~200 ms cold index, ~3 ms/query; **BM25F lifts P@1
  0.55→0.80**, **exact-content dedup lifts P@5 0.90→0.95** (23.2% of chunks are
  cross-tree dups). Paraphrase is the lexical ceiling: BM25F Recall@10 **0.11**
  on disjoint-vocabulary queries, recovered to **1.00** by query/synonym
  expansion (no model) — motivates the `queryExpansion` option now and vectors
  later (Tier D). Cross-encoder rerank is **not** a paraphrase fix (it can't
  rerank candidates BM25 never retrieved). Local embeddings/rerank couldn't run
  on this x64-mac host (no `darwin/x64` ONNX binary) — model deps stay optional.
- **Relationship to context-mode**: complementary, not a replacement. Projects
  needing only dir-search can keep using `ctx_index`; this capability adds the
  dedup + graph + config-layering + event-driven freshness that context-mode
  does not provide. The chunking edge-case rules are cross-validated against
  context-mode's observed behaviour ([`research.md`](./research.md) §2.2, §6).

## Non-goals

- **Vector / semantic embeddings** — explicitly out of scope for this change.
  FTS5 lexical only. Vectors + hybrid-RRF (Tier D) may be added later **behind a
  router** (never a reflexive RRF blend — see the regression in
  [`research.md`](./research.md) §1.2), as a separate proposal, only if a measured
  paraphrase-recall gap justifies it. Note: **cross-encoder reranking is NOT a
  vector feature** — it reranks lexical candidates with no vector index, and ships
  here as an optional default-off flag.
- **Tier-2 LLM entity/relation extraction** — deferred. Tier-1 deterministic
  graph only ([`research.md`](./research.md) §4.4).
- **Push auto-injection of context** via `input`/`tool_call` hooks — anti-pattern
  for retrieval ([`research.md`](./research.md) §5.3).
- **Dashboard server plugin** (cross-session shared KB, web-UI graph view) —
  possible (`ServerPluginContext`, [`research.md`](./research.md) §5.2) but deferred
  until multi-session-same-repo pressure exists.
- **Multi-user / replication / scale-out** — single-file, single-box by design.
  Infra (Neo4j/pgvector/Elasticsearch) is the wrong tool at this scale
  ([`research.md`](./research.md) §1.3, §4.1).
- **Modifying `src/extension/bridge.ts`** — the Phase-2 hook is a separate
  isolated extension.
