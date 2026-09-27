## Why

kb retrieval is lexical-only (BM25F + PRF/coverage/lane quota). Its paraphrase set is the tracked lexical ceiling (`markdown-knowledge-base` › "Paraphrase set tracks the lexical ceiling"), and nothing in the repo can retrieve non-markdown media (meeting recordings in `~/Movies` and recorder-export, footage, images, scanned PDFs) by meaning. `ATH-MaaS/Ovis-Omni-Embedding-3B` (Apache-2.0, weights on HF since 2026-09-20) embeds text, image, visual-document, audio and video into one 2048-d space and runs locally on Apple-silicon MPS. Research dossier: `docs/research/ovis-omni-embedding-kb-eval.md`.

The change builds that capability **in the kb engine, measured first, opt-in always**. The same golden-set harness that gated every prior ranking change decides whether the dense leg earns its cost. Model-facing tools are left alone because `unify-context-manager` is replacing `kb_search` with `context_search`; wiring follows that cutover.

## What Changes

- **New package `packages/omni-embed`** (`@blackbelt-technology/pi-dashboard-omni-embed`): a uv-managed Python sidecar (transformers + torch MPS).
  - Loads the Ovis-Omni Thinker only; Talker/token2wav are never materialised.
  - Serves `POST /embed` on loopback with a bearer token.
  - Commands: `serve`, `pull`, `validate` (per-modality recipe gate), `doctor`, `eval build-srt`.
  - The model id is pluggable, so `Qwen/Qwen3-Embedding-0.6B` can run as the cost control.
  - Inference only: it never writes storage.
- **Vector plane in `packages/kb`, pure node:sqlite**: a separate `<kbdb>.vec.db` with a BLOB vectors table keyed by model + unit + root + path + unit id, plus metadata (doc type, modality, time window).
  - Brute-force in-memory cosine kNN. No native addon, no new npm dependency.
  - Built by an explicit `kb embed` step. `kb index` stays embedding-free, as `add-kb-semantic-annotation-plane` requires.
- **Store-level hybrid fusion**: `store.search` accepts an optional precomputed dense-candidate list and fuses it (RRF) ahead of its existing, unchanged page steps (dedup, MMR, lane quota, parent expansion).
  - An async `hybridSearch` does the query embedding and kNN, with a timeout and BM25 fallback.
  - Exposed as `kb search --hybrid`. Default OFF.
- **Media in the engine + CLI**: `kb embed --media <dir> --set <name>` covers images, PDF pages, SRT-aligned audio windows and video clips. `kb omni-search` runs cross-modal queries over md and media.
- **Eval extension**:
  - `dense` / `hybrid` / `hybrid-small` variants (Q1).
  - An embedding-unit ablation: file, chunk, row, fused (Q2).
  - New golden sets: paraphrase ≥40 with zero lexical overlap; md→image from in-repo alt text; SRT→audio generated locally, never committed.
  - Cost metrics alongside quality.
  - Fixed adoption rules, honouring the existing R@K and duplicate-slot regression gates.
- **No model-facing tool change.** `kb_search` is byte-identical. There is no `omni_search`. A follow-up change adds hybrid to the `context_search` `docs` scope and a `media` scope after the unify cutover.

## Capabilities

### New Capabilities
- `omni-embedding-sidecar`: local inference service: model load, `/embed` contract, loopback + token + allowlist, one instance per state dir, per-modality validation gate, explicit weight pull.
- `kb-vector-plane`: separate node:sqlite vector store, `kb embed` build step, full-identity keying, per-model seeding, staleness, brute-force kNN with metadata filters.
- `kb-hybrid-search`: opt-in BM25+dense fusion via `kb search --hybrid`, config merge, latency budget, fallback.
- `omni-media-index`: media ingestion into the vector plane and cross-modal `kb omni-search`.

### Modified Capabilities
- `kb-fts5-search-store`: search accepts an optional dense-candidate list and fuses it (RRF) ahead of its unchanged page steps. Stale candidates are ignored. The store computes no embeddings.
- `kb-retrieval-eval`: dense/hybrid variants and unit ablation run through the same harness, plus new golden-set kinds (paraphrase, md→image, text→audio incl. private), cost metrics and adoption rules.
- `markdown-knowledge-base`: an opt-in dense leg outside the indexer, behind its own vector interface. The lexical pipeline is unchanged when it is disabled.

## Impact

- **Code**:
  - new `packages/omni-embed/` (Python + JS bin shim);
  - `packages/kb/src`: config (`omni` defaults, `NESTED_KEYS`, second-level `fusion` merge), `VectorStore`/`SqliteVectorStore`, `Embedder`/`HttpEmbedder`, `hybrid.ts`, the `SearchOpts.dense` fusion in `sqlite-store.ts`, `evaluateAsync`, and CLI `embed` / `search --hybrid` / `omni-search`;
  - `packages/kb/eval/`: variants, golden sets, cost metrics.
  - `packages/kb-extension` is untouched.
- **Dependencies**:
  - Python/torch runtime for `omni-embed`, optional and isolated, following the existing uv/pytest pattern of `music-production` (quick tier in CI, deep tier local only).
  - System `ffmpeg` for media windows.
  - `packages/kb` gains no dependency and no native addon.
  - The ~11 GB model is downloaded by explicit `pi-omni-embed pull` into `~/.pi/omni-embed/hf`.
- **Compatibility**:
  - Everything is default-OFF.
  - No kb schema change, since the vector plane is a separate DB file, and no index migration.
  - Tool surface is unchanged, so this does not collide with `unify-context-manager`.
- **Rollback**: set `omni.enabled=false` (or remove the block) to get pure BM25. Delete `<kbdb>.vec.db` and `~/.pi/omni-embed/` (weights, state, eval sets). The package can be removed without touching the kb index.
- **Privacy**: media and SRT golden sets stay local. The sidecar binds 127.0.0.1 only.

## Discipline Skills

- **`security-hardening`**: the sidecar is a local HTTP service that reads files, so it needs untrusted-input handling, path allowlisting, and the loopback token.
- **`performance-optimization`**: the query-embed timeout and brute-force kNN latency budget on the search path, plus large-media embedding throughput.
- **`observability-instrumentation`**: a new sidecar process and an external call need health, fallback counters and embed timings.
- **`doubt-driven-review`**: a new runtime language and dependency, and a store-level ranking change. Ran at planning (3 cycles).
- **`review-code`**: before commit.
