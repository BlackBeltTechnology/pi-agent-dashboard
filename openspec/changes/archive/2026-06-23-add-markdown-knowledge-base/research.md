# Research dossier — Markdown Knowledge Base (FTS5 + structural chunking + graph)

> Companion to [`proposal.md`](./proposal.md). Captures the full research that
> justifies the design decisions. Every external claim is link-traced so a
> future reader can verify it. Findings here are evidence; the proposal is the
> decision.

## 0. Question being answered

> "Best way to index hundreds of markdown files, FTS5-indexed, able to track
> markdown changes, queryable by an LLM as a search tool. Directory-based.
> Not a Docker service. SQLite viable. Drivable as a pi SKILL."

Refined across the conversation into four sub-questions:

1. Lexical (FTS5) vs vector vs hybrid for an agent/dev markdown corpus?
2. Structural (heading) chunking — possible and worth it?
3. Incremental indexing — how to detect + apply markdown changes?
4. Knowledge-graph layer — worth organizing the DB for it?
5. Delivery — SKILL vs registered tool vs extension; reuse pi hooks / dashboard?

---

## 1. Lexical (FTS5/BM25) vs vector vs hybrid

### 1.1 Core FTS5 references

- SQLite FTS5 extension (authoritative): <https://sqlite.org/fts5.html>
  - Tokenizers `unicode61` (default), `ascii`, `porter` (stemming), `trigram`
    (substring) — §4.3.
  - External-content / contentless tables — §4.4
    (<https://sqlite.org/fts5.html> §4.4; draft mirror
    <https://www2.sqlite.org/draft/fts5.html>).
  - `bm25()` ranking, `snippet()`, `MATCH` query syntax (phrase / prefix /
    boolean).
- FTS5 in practice (ranking, weighted fields, patterns):
  <https://thelinuxcode.com/sqlite-full-text-search-fts5-in-practice-fast-search-ranking-and-real-world-patterns/>
- FTS5 vs `LIKE` (why inverted index wins):
  <https://longdatadevlog.com/blog/2025/07/30/full-text-search-much-better-with-fts5/>
- Runnable SQLite FTS docs: <https://coddy.tech/docs/sqlite/full-text-search>
- Full-text search in SQLite with FTS5 (inverted index explainer):
  <https://www.hisqlboy.com/blog/sqlite-full-text-search-fts5>
- FTS5 pattern wiki (virtual table + triggers idiom):
  <https://wiki.r-that.com/patterns/sqlite-fts5-search/>
- BM25 relevance ranking discussion:
  <https://stackoverflow.com/questions/7272019/sqlite-full-text-search-relevance-ranking>
- Real-time site search over a markdown docs corpus with FTS5:
  <https://blog.sqlite.ai/real-time-full-text-site-search-with-sqlite-fts5-extension>
- Single-file FTS engine (contentless table + triggers):
  <https://www.bswanson.dev/blog/sqlite-full-text-search/>

### 1.2 Closest-fit prior art — FTS5 agent memory over a markdown directory

- **AutoKaam: "I Gave My AI Agents a Memory With SQLite FTS5 (No Vector DB)"** —
  <https://autokaam.com/tutorials/fts5-bm25-memory-for-ai-agents-markdown/>
  - Directory walk → FTS5 table `(path UNINDEXED, body, tokenize='porter unicode61')`.
  - Query: `bm25(docs)` ascending (lower = more relevant) + `snippet()`.
  - Index rebuilds on each call unless told to skip → on-demand freshness.
  - **Benchmark (≈2k notes, precision/hit@3):**

    | Retriever | Keyword (p@3) | Paraphrase (hit@3) |
    |---|---|---|
    | FTS5 BM25 | 93.5% | 38% |
    | Vector (bge-m3) | 97.4% | 50% |

  - **Key lesson:** naive RRF fusion **regressed below both** when one ranker was
    strong on both axes. Shipped a **router** (regex detects lexical query →
    FTS5; else → vector), not a blend. Pure vector almost never returns zero
    hits, so an exact-ID query gets plausible neighbours instead of the correct
    file — the lexical fallback closes that gap.
  - **Cost argument:** FTS5 = zero embedding model, zero tokens, sub-second,
    one file. "A retrieval you can call freely is a retrieval the agent will
    actually use."
  - Inspired by OpenClaw memory: <https://github.com/jacklevin74/openclaw-memory>

### 1.3 Hybrid local tools (FTS5 + sqlite-vec + RRF) — superset alternatives

- mdindex (BM25 + sqlite-vec + LLM re-rank + RRF, markdown):
  <https://github.com/mikewaters/mdindex>
- qmd — Query Markup Documents (BM25 + vec + LLM re-rank, node-llama-cpp):
  <https://github.com/tobi/qmd>
- vannevar (BM25 FTS5 + HNSW vectors + RRF, markdown notes):
  <https://briansunter.com/projects/vannevar>
- knowshelf (parent/child chunks, FTS5/gse + sqlite-vec + RRF + rerank, MCP):
  <https://github.com/hi-horan/knowshelf>
- jeff-markdown-semantic-retriever (Obsidian vault, BM25 + Model2Vec, MCP):
  <https://github.com/jeffery-jefferson/jeff-markdown-semantic-retriever>
- MindGraph (BM25 + sqlite-vec + RRF **+ typed `[[link]]` graph**, one file):
  <https://github.com/camerontjs-dot/MindGraph>
- sqlite-rag (SQLite AI + SQLite Vector + RRF):
  <https://github.com/sqliteai/sqlite-rag>
- lotl (search + memory + knowledge graph, BM25 + vec + RRF + LLM rerank):
  <https://github.com/tanarchytan/lotl>
- sqlite-memory (extension; markdown-aware chunking, hybrid, llama.cpp embed,
  content-hash sync): <https://github.com/sqliteai/sqlite-memory/blob/main/README.md>
- vstash (arXiv; local-first hybrid, adaptive RRF + per-query IDF weighting):
  <https://arxiv.org/html/2604.15484>
- veclite (local SQLite + vectors, BM25 + hybrid + rerank):
  <https://github.com/lucasastorian/veclite>
- SQLRite (embedded SQLite retrieval engine, `SEARCH(...)` operator):
  <https://github.com/zavora-ai/sqlrite>

### 1.4 Verdict

For an agent/dev corpus where queries are mostly literal tokens (names, error
codes, config flags, function names, file slugs), **FTS5 BM25 wins** on the
dominant query type and on cost. Vectors earn their place only where measured
paraphrase recall matters. Adopt vectors **later, behind a router**, never as a
reflexive hybrid blend (§1.2 regression).

---

## 2. Structural (heading) chunking

### 2.1 Prior art

- TreeSearch — structure-aware retrieval, **no chunk splitting**, indexes the
  heading tree; markdown requires headings (depth ≥ 1):
  - PyPI: <https://pypi.org/project/pytreesearch/>
  - GitHub: <https://github.com/shibing624/TreeSearch>
- dnomia-knowledge — heading-based markdown + AST code chunking, FTS5 + sqlite-vec:
  <https://github.com/ceaksan/dnomia-knowledge>
- knowshelf — parent/child chunks (one md = one "book"):
  <https://github.com/hi-horan/knowshelf>
- mdindex — markdown-aware chunking preserving semantic boundaries:
  <https://github.com/mikewaters/mdindex>

### 2.2 Empirical validation (this repo, 2026-06-23)

Indexed `doc-example/` (691 md files extracted from
`~/Documents/compsych-letter-demo2.zip`) via context-mode `ctx_index`:

- **691 files → 8,600 sections** (~12.4 chunks/file) → confirms heading-level
  chunking, not one-row-per-file.
- Search returns sections **with full heading breadcrumb**, e.g.
  `Operation Call Interceptors Guide > Advanced Interceptor Patterns >
  Decoupled Service Creation (CQRS-like Pattern)`.
- **Code fences kept intact** — Java `@Component` interceptor blocks returned
  whole inside their section.
- **BM25 precision high** — "JQL escape hatch" → exact TRANSIENT-attribute
  pattern; "denormalize CQRS" → Decoupled Service Creation; "batch processing
  update" → Example 3. No whole-file noise.
- **Wrinkle found: near-duplicate corpus.** Every hit appeared twice — once from
  `agent-docs/...`, once from `judo-blueprint/agent-docs/...` (template vs
  specialized copy, `judo.model.name=webshop` vs `=compsychletter`). Half the
  top-N slots were duplicates. context-mode does **not** dedup.

### 2.3 Edge-case rules (the parts naive splitters get wrong)

- Never split inside a fenced code block (` ``` ` / `~~~` state machine; `#`
  inside code is not a heading).
- Carry the heading breadcrumb into the **indexed body** so a leaf section still
  matches parent-only terms.
- YAML frontmatter → metadata (tags/entities), not a chunk.
- Merge tiny chunks (single-line heading) up into parent; split oversized leaf
  sections by paragraph as fallback.

### 2.4 Verdict

Structural chunking is **worth it** for heading-rich corpora (validated above):
section-precise retrieval, token economy, better per-section BM25 math, free
breadcrumb context, and the heading nesting **is** the `child_of` graph (§4).
Degenerates on flat/structureless markdown — keep a one-row-per-file / paragraph
fallback.

### 2.5 Prototype benchmark (this repo, 2026-06-23)

Throwaway TS prototype (bun:sqlite FTS5, mirrors design §3 chunker + §6c
ranking) over `doc-example/`. Two golden sets (paraphrased NL queries → expected
file-subpath; matched root-agnostically so dedup is measurable). Method =
`kb eval` seed (tasks §4b.7). Scripts preserved at
[`./prototype/`](./prototype/) (`bench.ts`, `bench2.ts`, `README.md`).

**Indexing performance** — 691 files → **6,493 chunks** (9.4/file) in **~85 ms**
parse+chunk + **~115 ms** FTS5 build = **~200 ms cold**; corpus 4.58 MB; search
**~3 ms/query**, deterministic. Structural chunking is effectively instant.

**Normal golden set (20q first run, 8q focused run):**

| Variant | P@1 | P@5 | Recall@10 | MRR | nDCG@10 |
|---|---|---|---|---|---|
| Baseline BM25 (breadcrumb-in-body) | 0.55 | 0.85 | 0.95 | 0.65 | 0.72 |
| **BM25F (heading-weighted 8/4/1)** | **0.80** | 0.90 | 0.95 | **0.83** | **0.86** |
| **BM25F + exact-content dedup** | 0.80 | **0.95** | 0.95 | 0.85 | 0.87 |

- **BM25F lift validated**: P@1 +25 pts (0.55→0.80), MRR +0.19, nDCG +0.14.
  Highest-ROI Tier-A feature, free. (§8c)
- **Dedup validated**: **23.2% of chunks are exact cross-tree duplicates**;
  collapsing them lifts P@5 0.90→0.95 (frees top-N slots). Quantifies §2.2.
- Proximity boost + lexical MMR did **not** move precision on the small normal
  set (queries already rank well; MMR's value is redundancy reduction, already
  shown via the 23% dup stat, not first-hit rank). Keep, don't oversell.
- Golden labels are **conservative** (single-target). One scored "miss" returned
  `keycloak-jit-user-provisioning.md` for "provision user on first login" — a
  *better* answer than the label. True precision ≥ measured.

**HARD paraphrase set (9q, vocabulary deliberately disjoint from targets):**

| Method | P@1 | Recall@10 | MRR | nDCG@10 |
|---|---|---|---|---|
| BM25F | 0.00 | **0.11** | 0.06 | 0.07 |
| + trigram | 0.00 | 0.11 | 0.04 | 0.06 |
| + PRF (pseudo-relevance feedback) | 0.11 | 0.11 | 0.11 | 0.11 |
| **+ synonym/query expansion** | **0.56** | **1.00** | 0.69 | 0.77 |

- **Pure lexical FAILS on paraphrase** — Recall@10 **0.11** (1/9 found). Hard,
  quantitative confirmation of §1.2 (~38% paraphrase) and the reason vectors
  matter for the semantic case. Validates the Tier-D deferral *rationale* with
  data, not assertion.
- **trigram doesn't help paraphrase** (substring/typo only). **PRF barely helps**
  (can't bootstrap from a wrong initial result set). Negative results — don't
  bother for paraphrase.
- **Query/synonym expansion recovers it**: Recall 0.11→**1.00**, P@1 0→0.56,
  **no model**. Caveat: the map was domain-curated (knew targets) → optimistic;
  in production paraphrase needs one of: (a) curated domain glossary, (b)
  **LLM-driven query reformulation** (cheap here — the consumer IS an LLM; the
  SKILL's "reformulate once" instruction has real teeth), or (c) embeddings
  (Tier D). This is the empirical case for the "queryExpansion" config (§6c).
- **Cross-encoder rerank is NOT a paraphrase fix** — it rescores BM25
  candidates; if Recall@10 is 0.11 the target isn't in the pool to rerank. Rerank
  improves precision on *already-retrieved* candidates only.

**Platform finding** — local embeddings/cross-encoder could **not** run on this
**x64 macOS** host: `onnxruntime-node` ships no `darwin/x64` napi binary, and
`@huggingface/transformers` v4 hard-requires it (WASM fallback non-trivial). So
Tier-C cross-encoder rerank and Tier-D vectors both need a runtime story
(WASM, a service, or arm64) — reinforces lexical-first + LLM-driven expansion as
the default, model deps strictly optional.

**Net:** core design validated on real data — fast index, Recall@10 0.95
(normal), BM25F + dedup deliver P@1 0.80 / P@5 0.95, pure lexical, no embeddings.
Paraphrase is the known lexical ceiling; mitigate with LLM/synonym query
expansion now, vectors later (Tier D, behind KbStore + router).

---

## 3. Incremental indexing (track markdown changes)

### 3.1 Prior art — layered change detection

- cartog — layered pipeline (git → mtime → hash → reindex), each layer prunes
  more aggressively:
  <https://github.com/jrollin/cartog/blob/main/docs/architecture/incremental-indexing.md>
- markdown-vault-mcp — `ChangeTracker.detect_changes()` builds rel-path → sha256
  map, diffs against stored state:
  - tracker: <https://github.com/pvliesdonk/markdown-vault-mcp/blob/637560c2/src/markdown_vault_mcp/tracker.py>
  - design issue #6: <https://github.com/pvliesdonk/markdown-vault-mcp/issues/6>
- mdvault — `incremental_reindex()` with `FileChange` enum + `classify_change()`,
  `--force` for full rebuild:
  <https://github.com/agustinvalencia/mdvault/commit/cf6d6a6dd08ec71d4076f0dd6c48c2a849dfa8b9>
- markdown-vdb — filesystem watcher PRD (debounce, content-hash skip,
  incremental reindex):
  <https://github.com/geckse/markdown-vdb/blob/main/docs/prds/phase-8-file-watching.md>
- coregraph — epochs + stale nodes + on-demand healing freshness model:
  <https://github.com/simplecore-inc/coregraph/blob/main/docs/change-tracking.md>

### 3.2 FTS5 sync mechanics

- External-content / contentless tables §4.4: <https://sqlite.org/fts5.html>
- Sync triggers (copy-paste, AFTER INSERT/UPDATE/DELETE):
  <https://wiki.r-that.com/snippets/sqlite-fts5-triggers-verbatim/>
- Contentless / external read-back caveats:
  <https://stackoverflow.com/questions/71748748/sqlite3-fts5-contentless-or-content-external-table-how-store-and-read-a-non-fts>
- Documented external-content trigger pattern in Go:
  <https://github.com/go-again/sqlite/blob/v0.8.0/fts/triggers.go>

**Note:** FTS5 triggers keep an index in sync with another **SQLite table**.
Here the source of truth is **files on disk**, so triggers do not apply — use
mtime → hash → reindex over the directory walk instead.

### 3.3 Verdict

Layered detection: (1) mtime cheap-check → skip unread; (2) sha256 → skip
unchanged content (handles touch/rename); (3) changed → delete that path's
chunks+edges, re-insert; (4) deletions → paths in state but not on disk → purge.
Run on-demand at search time (cheap for hundreds of files) and/or event-driven
via a pi `tool_result` hook (§5.2). No daemon required.

---

## 4. Knowledge-graph layer

### 4.1 Prior art — SQLite as graph DB

- "SQLite as a Graph Database: Recursive CTEs, Semantic Search, and Why We
  Ditched Neo4j" — nodes/edges + recursive CTE traversal + FTS5 + vec:
  <https://dev.to/rohansx/sqlite-as-a-graph-database-recursive-ctes-semantic-search-and-why-we-ditched-neo4j-1ai>
- ra-h_os schema (nodes / edges with explanation+context, source chunks, FTS,
  vec): <https://github.com/bradwmorris/ra-h_os/blob/main/docs/2_schema.md>
- hiyenwong/sqlite-knowledge-graph (Rust; typed entities, weighted relations,
  graph traversal, vec): <https://github.com/hiyenwong/sqlite-knowledge-graph>

### 4.2 Tier 1 — structural extraction (cheap, deterministic, no LLM)

- kaygee — flat SQLite KG from YAML frontmatter + `[[wikilinks]]`, types
  self-organize, backlinks automatic: <https://pypi.org/project/kaygee/>
- MindGraph — typed `[[link]]` document graph extracted at ingest:
  <https://github.com/camerontjs-dot/MindGraph>
- markedup — KG from YAML frontmatter (entities, relations, temporal), files
  are the source of truth: <https://github.com/Clarit-AI/markedup>

### 4.3 Tier 2 — semantic extraction (LLM triples; costly, brittle)

- kgmd — extracts entities/relations via LLM (litellm), entity resolution via
  embeddings + LLM verify, induced schema, single SQLite:
  <https://github.com/johncarpenter/kgmd> (PyPI
  <https://pypi.org/project/kgmd/0.1.0/>)
- kg-extract — entities/relations/properties from PDF/MD/text, evidence spans,
  export Neo4j Cypher / JSON-LD: <https://github.com/dakshjain-1616/kg-extract>
- graphforge-ai — GraphRAG-style entity/relationship extraction (NetworkX,
  FastAPI, SQLite): <https://github.com/Jibran-7/graphforge-ai>

### 4.4 Verdict

Organize the DB for graph **now**, but **Tier-1 only**: `nodes`/`edges` tables
beside FTS5, populated from heading nesting (`child_of`), wikilinks (`links_to`),
frontmatter (typed entities/tags), and markdown links (`references`) during the
same incremental parse. Free, deterministic, self-maintaining. Traverse with
recursive CTEs. Defer Tier-2 LLM extraction until a measured cross-doc-linking
gap — its real cost is edge drift + re-verification, not storage.

---

## 5. Delivery — SKILL vs registered tool vs extension; pi/dashboard reuse

### 5.1 pi hook/event surface (verified)

Source: `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`.

- `pi.on("tool_result", ...)` — fires after any tool finishes; `event.toolName`,
  `event.input.path`. → **auto-reindex on `.md` edit** (Tool Events §672).
- `pi.on("tool_call", ...)` — before a tool runs, can block/mutate
  (`{ block, reason }`); `isToolCallEventType` for typed input.
- `pi.on("input", ...)` — user input before skill/template expansion; can
  transform/handle.
- `pi.registerTool(definition)` — native in-process tool, typed schema, no MCP
  process (ExtensionAPI §1220).
- `pi.appendEntry(customType, data?)` — inject a custom entry the model sees.
- `ctx.cwd`, `ctx.sessionManager` — per-project scope, session state.

Precedents in this repo / ecosystem:
- `packages/image-fit-extension/src/extension.ts` — standalone pi extension
  hooking `tool_call` on `read` (clean isolation precedent).
- context-mode itself = pi extension + bun sidecar (auto-capture via hooks);
  its `ctx_index`/`ctx_search` already do heading chunking + Porter stemming +
  trigram + RRF + content-hash staleness.
- `packages/extension/src/retry-tracker.ts` — documents that pi ExtensionAPI
  does NOT expose every event (`auto_retry_*`), tracked at
  <https://github.com/badlogic/pi-mono/discussions/2073>. → verify each hook
  exists before relying on it (`tool_result`/`tool_call` confirmed).

### 5.2 pi-dashboard reuse surface (verified)

Source: `src/server/server.ts`, `docs/file-index-server.md`,
`docs/file-index-extension.md`.

- Server plugin system — `ServerPluginContext` with `registerPiHandler(type,
  handler)`, `onEvent(handler)`, `sendToSession(sessionId, text)`. Precedents:
  goal-continuation-plugin, automation-plugin.
- Plugin config + activation REST — `src/server/routes/plugin-config-routes.ts`,
  `packages/server/src/routes/plugin-activation-routes.ts` (config schema,
  enable/disable, broadcast `plugin_config_update`).
- Settings precedent — `.pi/settings.json#worktreeInit` parsed by
  `packages/server/src/worktree-init.ts` (project-level settings + TOFU trust).
- Extension UI surface — `src/extension/ui-modules.ts` (modals/decorators) →
  render KB/graph in the web client.
- **Caution:** do NOT put KB logic in `src/extension/bridge.ts` — pi-version
  footguns (captured `pi`/`ctx` invalidation after session replacement,
  `setTimeout(0)` ordering, RPC-mode `ctx.ui.custom` no-op). Build isolated like
  image-fit.

### 5.3 Verdict — pull tool + background hook, not push

- Retrieval = **pull** (LLM-invoked registered tool). The model is the best
  judge of when the step needs info; token-efficient; composable
  (search → neighbors → get).
- **Do not auto-inject** search via `input`/`tool_call` hooks — push spends
  tokens every turn, adds latency, fights the model's judgment.
- The one job that must be a hook = `tool_result` → **silent background
  reindex** (never LLM-facing).
- Native `pi.registerTool` beats MCP for in-pi use (in-process, typed,
  dashboard-rendered); MCP only if non-pi agents must reuse it.
- SKILL carries the procedure + trigger reflex; registered tool carries the
  mechanism. Ship SKILL+CLI first (zero pi-internals risk), promote to
  registered tool once search logic is proven.

---

## 6. Comparison summary (matrix)

| Capability | context-mode (tested) | Custom KB (proposed) |
|---|---|---|
| Structural heading chunking | ✅ confirmed | ✅ |
| Breadcrumb heading-path | ✅ confirmed | ✅ |
| Code-fence integrity | ✅ confirmed | ✅ |
| BM25 precision | ✅ confirmed | ✅ |
| Porter stemming + trigram + RRF | ✅ | ✅ (config) |
| Content-hash staleness flag | ✅ | ✅ |
| Near-duplicate dedup | ❌ duplicates in results | ✅ planned |
| Graph traversal (child_of/wikilinks) | ❌ | ✅ Tier-1 |
| Project/global config layering | ❌ (own config) | ✅ `.pi/dashboard/knowledge_base.json` |
| Auto-reindex on edit (`tool_result`) | ❌ manual | ✅ planned |
| No file cap | ⚠️ `maxFiles` default 200 | ✅ uncapped default |

**Decision rule:** need *only* dir-search inside pi → use context-mode
(`ctx_index path:<dir>`, raise `maxFiles`). Need dedup + graph + config layering
+ event-driven freshness → build the custom KB (this proposal).

---

## 7. TypeScript runtime + SQLite/FTS5 binding (environment-verified)

Probed on this machine (2026-06-23):

- **Node v24.15.0**, repo is ESM (`"type":"module"`), `tsx` available, jiti via
  pi, **bun on PATH** (`/usr/local/bin/bun`). TS runs natively.
- **Repo has zero SQLite deps today** → clean slate.
- **context-mode uses `better-sqlite3` ^12.6.2** + `@types/better-sqlite3`, with a
  `heal-better-sqlite3.mjs` native-rebuild script; `ctx_doctor` reports
  **FTS5/SQLite PASS** → the TS↔FTS5 binding is already proven here.
- **Repo client already depends on `remark-gfm` / `remark-math`** → the
  `unified`/`remark`/`mdast` AST ecosystem is in-tree.

**Verdict:** TypeScript is repo-native and the better choice.
- Binding → **`better-sqlite3`** (proven here, synchronous API ideal for a CLI
  indexer + transactions, `@types` present, heal-script precedent). Alternatives:
  `node:sqlite` (Node 24 built-in but experimental, FTS5 depends on bundled
  build) and `bun:sqlite` (ships FTS5 but ties to bun).
- Markdown parse → **`unified` + `remark-parse` (mdast)** instead of a hand-rolled
  fence state machine: AST gives heading depth, `code` nodes (structurally never
  split a fence), and `link` nodes for free; `remark-frontmatter`/`gray-matter`
  for YAML; small wikilink pass. Simplifies design §3.

---

## 8. Limbo / Turso Database evaluation (deferred backend)

User asked whether the engine could be Limbo, and whether any KB/memory tool
uses Turso's search engine (with proof). Evaluated 2026-06-23.

### 8.1 Critical distinction — libSQL vs the rewrite

Two separate Turso projects, from the same team
(<https://github.com/tursodatabase/libsql>):

- **libSQL** — Turso's *C fork of SQLite*. Production-ready, powers Turso Cloud.
  Full-text = **SQLite FTS5** (it's a SQLite fork). Native vector.
- **Turso Database** (formerly **Limbo**) — clean-room *Rust rewrite*. **BETA**
  ("use caution with production data"). Repo moved `tursodatabase/limbo` →
  `tursodatabase/turso`; latest tag `v0.7.0-pre.10`. Full-text = a NEW
  **Tantivy-powered FTS engine**, NOT FTS5.
  - Repo: <https://github.com/tursodatabase/turso>
  - Overview: <https://dev.to/arshtechpro/turso-a-rust-rewrite-of-sqlite-setup-guide-and-whether-its-worth-your-time-16lk>

Most "Turso memory" projects in the wild run on **libSQL** (vector + FTS5), not
the rewrite. "Uses Turso" ≠ "uses the new engine."

### 8.2 The new Turso FTS engine (what it is)

- Built on **Tantivy** — Apache-Lucene-class Rust engine, same lib behind
  ParadeDB and Quickwit: tokenizers, BM25 ranking, phrase/prefix queries,
  segment merges, battle-tested on-disk format.
  <https://turso.tech/blog/beyond-fts5>
- SQL surface: `USING fts` index; **`fts_match`** (filter), **`fts_score`**
  (weighted BM25), **`fts_highlight`** (match highlighting — FTS5 needs
  `snippet()` gymnastics). <https://docs.turso.tech/sql-reference/functions/fts>
- **Transactional**: Tantivy files stored *inside* the `.db` as a BTree index →
  ACID with the data (FTS5's external index can desync).
  <https://github.com/tursodatabase/turso/pull/4593>
- **Experimental** — requires `fts` feature flag at compile time.
  <https://github.com/tursodatabase/turso/blob/main/docs/manual.md>
- v0.5.0 shipped it ("experimental full-text search with Tantivy"):
  <https://turso.tech/blog/turso-0.5.0>
- Native vector in the same file → hybrid BM25+vector without sqlite-vec.
  <https://docs.turso.tech/guides/vector-search>
- Node binding `@tursodatabase/database` (BETA, v0.5.x, native + WASM, async
  `connect()`): <https://www.npmjs.com/package/@tursodatabase/database>

### 8.3 PROOF — projects on libSQL (FTS5 / vector), stable

- spences10/mcp-memory-libsql — MCP memory, libSQL, vector + ranked text search:
  <https://github.com/spences10/mcp-memory-libsql>
- gregpriday/memory-mcp — MCP semantic memory, Turso(libSQL) + vector:
  <https://github.com/gregpriday/memory-mcp>
- kuruusuniku/engram — MCP memory, **hybrid FTS5 + vector + RRF**, A-MEM:
  <https://github.com/kuruusuniku/engram>
- Mastra framework — default storage libSQL + vector:
  <https://turso.tech/blog/building-ai-agents-that-remember-with-mastra-and-turso-vector>

### 8.4 PROOF — projects on the NEW engine + Tantivy FTS

**`v1cc0/aimem`** — Rust-first local memory + **knowledge graph** + hybrid search
+ MCP. Source verified in clone (`/tmp/pi-github-repos/v1cc0/aimem`):

- `Cargo.toml`: `turso = { version = "0.6.1", features = ["fts"] }` → the rewrite,
  fts enabled.
- `crates/aimem-core/src/db.rs`:
  `CREATE INDEX idx_drawers_fts ON drawers_fts USING fts(search_text);`
  → the NEW Tantivy FTS index, not FTS5.
- `crates/aimem-core/src/search.rs`:
  `fts_score(search_text, ?1) ... WHERE fts_match(search_text, ?1)`; LIKE
  fallback when FTS unavailable.
- `lib.rs`: "| Full-text search | Turso FTS / Tantivy (`fts_match`, `fts_score`) |"
- Ships keyword-only vs hybrid benchmarks (`benchmarks/`).
- Repo: <https://github.com/v1cc0/aimem>

Other proof:
- codemogger — code search "entire thing runs on top of Turso's native vector
  and full-text search":
  <https://turso.tech/blog/building-a-code-search-engine-with-turso>
- Turso code-indexing guide (FTS + vector, single file):
  <https://docs.turso.tech/guides/code-indexing>
- Turso AI-memory guide: <https://docs.turso.tech/guides/ai-memory>
- Turso agent-skills `turso-db` SKILL (vector + FTS + CDC + MVCC):
  <https://github.com/tursodatabase/agent-skills/blob/main/skills/turso-db/SKILL.md>

### 8.5 Is the engine better? — verdict

On paper **yes**: Tantivy is a more capable engine than FTS5 (highlighting,
phrase/prefix, advanced tokenizers), **transactional** (no index desync), and
hybrid BM25+vector in one file. Proven in real Rust tools (AiMem).

But **disqualifying for now**: engine is BETA (data-loss warning); `fts` is
experimental + compile-time-flagged; **Node binding is beta** and its FTS
maturity is far less proven than the Rust crate; API is **not FTS5-compatible**
(`fts_match`/`fts_score` vs `MATCH`/`bm25()`), so adopting it means rewriting the
search layer. AiMem proves it works **in Rust**, not in the TS binding.

**Decision:** ship on `better-sqlite3`/FTS5 now; keep Turso/Tantivy as a
documented future backend behind the `KbStore` abstraction (design §2.5), with
AiMem as the reference implementation and the FTS5→`fts_*` API delta as the
porting work. Re-evaluate when `@tursodatabase/database` exits beta and its FTS
is documented stable.

---

## 8b. Pluggable external doc sources (filesystem / npm / git / https)

User asked to index external doc repos from filesystem, git, npm — "pluggable
knowledge base." Maps onto pi's existing source model; no new invention.

### Prior art / precedent (this repo + pi)

- pi package sources — three kinds, same syntax we reuse: `npm:@scope/pkg@1.2.3`,
  `git:github.com/user/repo@v1`, `https://...`. User installs → `~/.pi/agent/npm/`,
  project → `.pi/npm/`. `pi update` reconciles pinned git refs.
  `node_modules/@earendil-works/pi-coding-agent/docs/packages.md`.
- `packages/server/src/package-source-helpers.ts` — `SourceKind = "npm" | "git"
  | "https" | "abs-path" | "rel-path"`; `parseSourceKind(source)`,
  `computeIdentity(source, settingsDir?)`; unit-tested
  (`__tests__/package-source-helpers.test.ts`). Reuse for source-string parsing
  + identity (dedup key).
- `packages/server/src/package-manager-wrapper.ts` — resolves npm/git/https/path
  sources (install, identity preflight). Model for npm/git resolvers.
- TOFU trust precedent — `packages/server/src/worktree-init-trust.ts`: trust map
  at `~/.pi/dashboard/worktree-init-trust.json`, keyed by
  `sha256(canonical(config))`, untrusted until recorded. Mirror as
  `~/.pi/dashboard/kb-source-trust.json` for remote sources.

### Design verdict

Generalize `roots[]` → `sources[]` (`kind` discriminator) + a `SourceResolver`
that resolves each source to a local dir; indexer unchanged (design §6b). Same
separation-of-concerns as `KbStore` (§8 / design §2.5). Cross-root dedup +
priority work identically once each source is a prioritized "root."

**Security:** lower risk than pi packages — KB **only reads markdown, never
executes** source code (pi warns its packages run arbitrary code,
`docs/packages.md` L20). Network fetch + arbitrary content still warrant TOFU
trust-on-first-use. Pin git `@ref` / npm `@version` + `refresh` policy for
reproducibility. All four resolvers (filesystem/npm/git/https) in scope.

---

## 8c. Retrieval-quality techniques (reliability of search)

Features from other systems that improve which-result-surfaces reliability,
split by FTS5-compatibility. Tiers map to design §6c + proposal.

### Tier A — lexical, cheap, FTS5-native (add now)

- **BM25F field weighting** — boost `heading`/`heading_path` over `body` via
  `bm25(chunks, w1, w2, ...)`. Canonical multi-field relevance fix.
  - Robertson/Zaragoza PRF framework:
    <https://www.khoury.northeastern.edu/home/vip/teach/IRcourse/IR_surveys/robertson_foundations.pdf>
  - BM25/BM25F in Lucene: <https://arxiv.org/pdf/0911.5046>
  - Elastic combined_fields/BM25F:
    <https://opensourceconnections.com/blog/2021/06/30/better-term-centric-scoring-in-elasticsearch-with-bm25f-and-the-combined_fields-query/>
  - BM25F from scratch: <https://softwaredoug.com/blog/2025/09/18/bm25f-from-scratch.html>
  - FTS5 weighted bm25: <https://sqlite.org/fts5.html>
- **Proximity / phrase / order boosting** — BM25 ignores order; boost near/
  in-order matches. FTS5 `NEAR()` native; APSW `subsequence` aux ranker.
  - <https://rogerbinns.github.io/apsw/_modules/apsw/fts5aux.html>
  - <https://jamesg.blog/2024/11/18/search-word-proximity>
- **Query operators** — phrase `"..."`, prefix `term*`, `NEAR`, column filters,
  AND/OR/NOT. Native FTS5 (<https://sqlite.org/fts5.html>).
- **Trigram companion** — substring/typo recall; context-mode does this; config
  flag (§1.1 trigram).
- **MMR diversity dedup** — penalize near-duplicate sections in top-N (beyond
  exact-content dedup §6). Lexical variant (token-overlap/Jaccard) needs no
  vectors. Directly addresses duplicate-heavy `doc-example/` (§2.2).
  - Carbonell & Goldstein SIGIR 1998:
    <http://www.cs.cmu.edu/afs/.cs.cmu.edu/Web/People/jgc/publication/MMR_DiversityBased_Reranking_SIGIR_1998.pdf>
  - Elastic: <https://www.elastic.co/search-labs/blog/maximum-marginal-relevance-diversify-results>
  - Qdrant: <https://qdrant.tech/blog/mmr-diversity-aware-reranking/>

### Tier B — structural / graph (add now; data already stored)

- **Parent/child small-to-big** — search at section granularity, return parent
  section/file for context. "Highest-leverage" chunking technique. We already
  store `parent_chunk_id` + `child_of` edges.
  - LangChain ParentDocumentRetriever:
    <https://github.com/langchain-ai/langchain/blob/master/libs/langchain/langchain_classic/retrievers/parent_document_retriever.py>
  - zeroentropy: <https://zeroentropy.dev/concepts/parent-document-retrieval/>
- **Graph expansion** — after a hit pull `neighbors`/`backlinks` (GraphRAG-lite);
  we have the graph (§4).

### Tier C — optional, query-side, FTS5-compatible (config-gated)

- **Cross-encoder reranking** — rescore BM25 top-k with a small local
  cross-encoder; **no vector index required** (reranks lexical candidates).
  Cited as highest-ROI RAG add, +5–15 NDCG@10. Cost: ~small CPU model.
  - FlashRank (lite, ms-marco-MiniLM): <https://github.com/PrithivirajDamodaran/FlashRank>
  - <https://towardsdatascience.com/advanced-rag-retrieval-cross-encoders-reranking/>
  - <https://localaimaster.com/blog/reranking-cross-encoders-guide>
- **Query expansion / PRF** — lexical RM3/Rocchio (re-query with terms from top
  BM25 hits, no model) or agent-driven reformulation. HyDE routes to vectors.
  - <https://arxiv.org/html/2511.19349v1> (Revisiting Feedback Models for HyDE)
  - <https://arxiv.org/html/2603.11008v1> (PRF with LLMs)

### Tier D — needs deferred vector backend (future, behind KbStore + router)

- **Hybrid BM25+vector + RRF** — `1/(60+rank)` fusion. **Router, not naive blend**
  (AutoKaam regression §1.2).
  - Azure: <https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking>
  - Elastic RRF: <https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion>
  - OpenSearch: <https://opensearch.org/blog/building-effective-hybrid-search-in-opensearch-techniques-and-best-practices/>
  - Apache Doris RRF (k=60 SQL): <https://doris.apache.org/docs/dev/key-features/reciprocal-rank-fusion/>
  - MongoDB: <https://www.mongodb.com/docs/vector-search/hybrid-search/hybrid-search-overview/>
- **HyDE** — hypothetical-answer embedding search. Needs vectors.

### Tier E — measurement (prerequisite for tuning all above)

- **Golden-set + retrieval metrics** — fixed `query → expected-section` set;
  Precision@K, Recall@K, MRR, nDCG@K, context-recall. Gate changes; tune BM25F
  weights + proximity; decide router-vs-blend (AutoKaam decided via p@3/hit@3).
  - Cohere: <https://docs.cohere.com/page/rag-evaluation-deep-dive>
  - IBM: <https://www.ibm.com/think/architectures/rag-cookbook/result-evaluation>
  - eRAG: <https://arxiv.org/pdf/2404.13781>
  - golden dataset how-to: <https://www.codersarts.com/post/building-a-golden-dataset-and-evaluating-retrieval-quality>

### Verdict

Add Tier A + B + E now (all lexical/structural, no model deps). Cross-encoder
rerank + PRF (Tier C) ship **behind config flags** (default off; rerank needs an
optional model dep). Tier D deferred behind the vector backend + router. The two
highest-ROI additions — golden-set measurement (E) and cross-encoder rerank (C)
— are both compatible with the lexical/no-vector stance today; rerank is the
surprise (it reranks lexical candidates, no vector index needed).

---

## 8d. dox evaluation — file-index splits vs dox vs KB

User asked whether to inject dox into the system prompt, replace the current
doc-index with dox, and (theoretically) whether dox could beat the file-index.

### What dox is

`agent0ai/dox` (<https://github.com/agent0ai/dox>) — pure-Markdown convention,
no runtime. Hierarchy of `AGENTS.md`: root holds project rules + a "Child DOX
Index"; each durable folder gets its own `AGENTS.md` + sub-index. Agent walks
root→target reading every `AGENTS.md` on the path before editing, updates after.
Style rule: "document stable contracts, not diary entries; delete stale notes."
Injection = trivial: dox IS `AGENTS.md` content; pi loads project `AGENTS.md`
into the system prompt every turn. Child docs read on demand (walk / nested load).

**pi's native AGENTS.md loading (verified, the gap dox/KB fill):** pi loads
`AGENTS.md`/`CLAUDE.md` at startup by **walking UP from cwd** + global
`~/.pi/agent/AGENTS.md` (`usage.md` L96-101, `quickstart.md` L100-101, `sdk.md`
L351 "AGENTS.md walking up from cwd"). `--no-context-files`/`-nc` disables it;
extensions receive loaded docs via `.contextFiles` (`extensions.md` L483). pi
does **NOT** surface *descendant* / nearest-to-target `AGENTS.md` as the agent
works deeper in a subtree — only the cwd→root chain at startup. dox fills this
with a manual root→target walk; the KB can fill it deterministically (design
§6d).

**Two KB features added from this (design §6d, opt-in):**
- Index `AGENTS.md`/`CLAUDE.md` + source-tree `*.md`, tagged `doc_type`
  (`doc`|`agents`|`source-md`), filterable in search — pure upside.
- `directoryLevelAgents` (default OFF): `kb agents <path>` returns the nearest
  applicable AGENTS.md chain (pull) or surfaces it on `tool_call` (push); falls
  back to the KB-generated manifest when none exists. Closes pi's descendant gap
  for projects that never adopted a dox tree, without hand-maintaining one.

### Current system (measured 2026-06-23)

- Root `AGENTS.md`: 340 lines / ~20 KB, lean, loaded every turn.
- `docs/file-index-*` splits: 8 files, ~366 KB, **719 per-file rows**.
- Per-file history: **830 `See change:` annotations** / **173 distinct changes**.
- Discovery: index-first + **subagent harvest** (splits too big for main context).
- Granularity: **per-file** (file-level contracts/invariants/footguns).
- Nested `AGENTS.md` already exist only for vendored `pi-flows`.

### Decision matrix

| Axis | file-index splits (current) | dox (nested AGENTS.md) | KB (this proposal) |
|---|---|---|---|
| Co-location | central `docs/` | next to code | index spans sources |
| Drift resistance | low (distant edits) | medium (proximity pressure) | high (auto-reindex) |
| Context cost | lean root + on-demand subagent harvest | root + nested auto-load (risk if eager) | thin manifest + pull search |
| Granularity | per-file (719) | per-folder boundary | per-section chunk |
| History | curated per-file ledger (830) | discarded (→ git) | git + index, not prose |
| Self-splitting | manual (>50 KB rule) | automatic by tree | n/a (DB) |
| Manual indexing | high | medium | **eliminated** (search) |
| Searchable | no (grep) | no | yes (BM25F) |

### Verdict

**Do NOT replace splits with dox.** Replacing per-file + history-rich +
subagent-harvested with per-folder + history-discarding + auto-loaded is a
regression dressed as simplification: loses file-level precision (719 rows),
destroys the 830-annotation ledger (dox's "no diary" rule is opposed), high
migration + retrain cost, and risks main-context bloat the repo engineered away
from (107 KB AGENTS.md lesson).

**In theory dox CAN beat the splits — iff three conditions hold:**
- (A) harness auto-loads the *nearest relevant* `AGENTS.md` cheaply/selectively
  (not ancestors eagerly) — load-bearing assumption;
- (B) team reframes the 830 `See change:` annotations as git's job (duplication,
  not asset) — dox's "no diary" is arguably the healthier cure for the
  AGENTS.md-ballooning disease;
- (C) granularity moves per-file → per-durable-boundary, the per-file gap filled
  by *searchable code* not prose rows.

**Meta-insight:** dox and the KB cure the *same disease* (hand-maintained,
centralized, per-file, history-annotated index = wrong shape, maintenance sink).
dox cures by **distributing + pruning** (still hand-maintained markdown); the KB
cures by **making it searchable** (no manual indexing). The strongest case for
dox is therefore the strongest case for skipping to the KB: dox is the right
direction but a half-measure — it reaches "less manual indexing," the KB reaches
"no manual indexing."

**Recommendation:** keep splits as the per-file backbone; add the KB for search;
**borrow dox's one good idea** — the in-prompt routing map — as a
**KB-generated manifest** (proposed, not yet specced), not a hand-built dox tree.
Inject at system-prompt level via `AGENTS.md`: retrieve-reflex (on) + compact
source/area/tag manifest (token-budgeted), never the full index. If adopted,
add a `kb manifest` command + opt-in injection as a follow-up feature.

---

## 9. Local-source references (this repo / install)

- pi extensions API: `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
  (Tool Events §672, `pi.on` §1216, `pi.registerTool` §1220, `pi.appendEntry`
  §1322).
- context-mode tools: `ctx_index`, `ctx_search`, `ctx_doctor`, `ctx_stats`
  (installed `/Users/robson/.pi/agent/npm/node_modules/context-mode`,
  content store `/Users/robson/.pi/context-mode/content`).
- Dashboard plugin wiring: `src/server/server.ts`, `docs/file-index-server.md`.
- Bridge footgun reference: `docs/file-index-extension.md` (bridge.ts row),
  `packages/extension/src/retry-tracker.ts`.
- Settings precedent: `packages/server/src/worktree-init.ts`
  (`.pi/settings.json` parse + TOFU trust).
- Test corpus: `doc-example/` (691 md, from
  `~/Documents/compsych-letter-demo2.zip`).
