## Context

See proposal.md › Why and `docs/research/ovis-omni-embedding-kb-eval.md` (model facts, feasibility, eval plan).

Current state that shapes the approach (verified in source):

- `KbStore.search(query, opts): KbHit[]` is **synchronous** (`packages/kb/src/sqlite-store.ts:342`). Its page steps — exact dedup, MMR, source dedup, `interleaveLanes`, rerank hook, parent expansion — are module-private to `sqlite-store.ts`.
- `evaluate(store, golden, opts)` is **synchronous** and calls `store.search` inline (`packages/kb/src/eval.ts:84,133`).
- `searchOptsFromConfig` is the ONE config→`SearchOpts` mapping shared by CLI, `kb_search`, and `eval/run-fixtures.ts`.
- `chunkId = sha(relPath).slice(0,8) + ":" + i` — unique only **within a root** (`chunker.ts:113-117`); store identity is `(root, chunkId)`. This repo configures 4 roots.
- `mergeConfig` deep-merges only top-level `NESTED_KEYS`, one level deep (`config.ts:183-208`).
- `kb_search` JSON output is a bare array (`kb-extension/src/extension.ts:230`); `kb search --json` likewise (`cli.ts:304`).
- `packages/kb` is "Zero runtime deps (node:sqlite)".
- **`unify-context-manager` (in flight)** replaces `kb_search`/`kb_get`/… with five tools (`context_search` fusing per-scope kb retrieval by RRF; `docs` scope keeps kb ranking) and sets the goal "one index engine (node:sqlite via `packages/kb`) and **no native SQLite addon**".
- `add-kb-semantic-annotation-plane` (in flight): indexer SHALL NOT invoke any LLM or embedding model.
- Ovis checkpoint = full `Qwen2_5OmniForConditionalGeneration` (Thinker+Talker+token2wav, ~11 GB bf16), ms-swift template `qwen2_5_omni_emb`, no reference encode snippet.

## Goals / Non-Goals

**Goals:**
- Engine-level dense + hybrid retrieval in `packages/kb`, measurable by the existing harness, reachable from the `kb` CLI.
- Zero new dependency and zero behaviour change for `packages/kb` users who do not opt in; no native SQLite addon.
- One vector space (per model) for md units and media so cross-modal queries work.
- Private media never leaves the machine.
- Shape the engine so `unify-context-manager`'s `context_search` can adopt hybrid (`docs` scope) and media (`media` scope) without engine changes.

**Non-Goals:**
- **Any model-facing tool change**: `kb_search` is untouched; no `omni_search` tool. Tool wiring is a follow-up change on `context_search` after the unify cutover.
- Default-ON hybrid (later, gated by this change's numbers).
- ANN indexing (only if measured brute-force latency demands it).
- CUDA / vLLM / MLX / GGUF paths; generative omni; elastic-dimension projection.

## Decisions

### D1 — Python sidecar for inference only; TypeScript owns all storage
Only `transformers` implements the Qwen2.5-Omni processor (NaViT, Whisper-style audio frontend, TMRoPE). → `packages/omni-embed/` (npm `@blackbelt-technology/pi-dashboard-omni-embed`, same library shape as `pi-dashboard-kb`) = uv project (`pyproject.toml` + `uv.lock`) + a tiny JS bin shim `pi-omni-embed` that execs `uv run`. Python commands: `serve`, `pull`, `validate`, `doctor`, `eval build-srt`. The sidecar decodes media and returns vectors; it **never writes the vector plane**.
Media decode deps pinned in the uv project (`pymupdf`, `soundfile`/`torchaudio`, Qwen processor video deps); system `ffmpeg` checked by `doctor`.
*Alternatives:* transformers.js / llama.cpp (no qwen2_5_omni embedding support); cloud API (violates local-only).

### D2 — Thinker-only load, recipe validation beyond smoke
Load `Qwen2_5OmniThinkerForConditionalGeneration` from the checkpoint with the `thinker.` state-dict prefix; Talker/token2wav tensors never materialised (asserted on loaded parameter names). bf16, `mps` → `cpu` fallback. Pooling = final-layer hidden state at last non-padding token, L2-normalised. Peak RSS **measured** in task group 1; ~9 GB is an estimate until then.
Weights under `HF_HOME=~/.pi/omni-embed/hf`; downloaded only by `pull`.
Validation (persisted `~/.pi/omni-embed/validated.json`, per model and **per modality**; echoed by `/health`):
1. **Template conformance** — rendered input for fixed fixtures equals a golden rendering derived from the ms-swift `qwen2_5_omni_emb` template source.
2. **Benchmark reproduction** — per modality the model will be used for: ≥1 small public task reproducing the publisher-reported score within ±3 points (Ovis: MMEB image, video, visual-document, audio tasks; text-only control Qwen3-Embedding-0.6B: two MTEB text-retrieval tasks).
3. **Smoke** — matched > mismatched cosine on ≥90% of pairs per modality.
A modality is usable only when validated; `kb embed --media` refuses unvalidated modalities, eval omits their rows.

### D3 — Sidecar contract, security, lifecycle
- Bind `127.0.0.1`, ephemeral port. **One instance per state dir** (`OMNI_EMBED_STATE_DIR`, default `~/.pi/omni-embed/run/`): `sidecar.json` (0600) `{port, token, pid, model, configHash}` + `sidecar.lock` (O_EXCL, stale-PID reap). Bearer token on every request.
- `POST /embed` `{ kind: "query"|"document", instruction?, items: [{ text } | { path, modality, window? }] }` → `{ model, dim, vectors }`.
- File items only under allowlisted roots (realpath, no symlink escape); per-item caps (defaults, configurable): file ≤ 1 GB, unwindowed audio ≤ 600 s, unwindowed video ≤ 300 s, text ≤ 128k chars → 413 above; unknown or unvalidated/unsupported modality → 400.
- `GET /health` → `{ ok, model, dim, device, loaded, validated: {<modality>: bool}, configHash }`.
- Client reuses an instance in its state dir only when `configHash` (model + allowlist + caps) matches; else restarts **that** instance. Idle shutdown after `omni.idleMinutes`.
- The eval harness uses its own state dir (`~/.pi/omni-embed/eval-run/`) with allowlist `mediaRoots ∪ {repoRoot}` — it never restarts or widens a user instance. Weights (`HF_HOME`) are shared read-only.

### D4 — Vector plane inside `packages/kb`, pure node:sqlite
`packages/kb` gains `VectorStore` (interface) + `SqliteVectorStore` (impl) and an `Embedder` interface + `HttpEmbedder` (plain `fetch`, spawns the sidecar via `omni.sidecarCommand`, default `pi-omni-embed serve`). No new npm dependency, no native addon.
- File: `<kbDbPath>.vec.db` (separate from the FTS5 DB).
- Table `vectors(model, unit, root, path, unit_id, doc_type, modality, media_set, start_s, end_s, label, content_hash, dim, vec BLOB)`, PK `(model, unit, root, path, unit_id)`. `unit_id`: chunk/fused → `chunkId`; file → `"file"`; row → `"row:" + sha8(rowFile)` (row keyed under its AGENTS file's `path`); media → `media_set` as root, file path as path, `"w:<start>-<end>"` / `"p:<page>"` / `"img"`.
- `vec_models(model, dim, validated_json)` meta.
- kNN = brute-force cosine over a lazily loaded `Float32Array` slab per `(model, unit)` with metadata pre-filter (`doc_type`, `root`, `modality`); dot product on normalised vectors. Budget target: ≤50 ms p95 for 25k × 2048 on the host (measured in eval; ANN deferred unless exceeded).
- Writes happen **only** in TS: `kb embed` (md units) and `kb embed --media <dir> --set <name>` (media; sends path items to the sidecar, stores returned vectors + window metadata). Re-embed keyed on `(model, unit, content_hash)` → a newly configured model seeds fully; orphans deleted.
*Alternatives:* sqlite-vec (native addon — conflicts with unify-context-manager goal, per-platform binaries); `.npy` files (no incremental upkeep).

### D5 — Split: async dense retrieval outside, sync fusion inside the store
1. Async `hybridSearch(store, embedder, vec, query, opts)` (`packages/kb/src/hybrid.ts`): embed query (bounded by `omni.queryTimeoutMs`, default 400 ms) → in-memory kNN top-K (`omni.candidateK`, default 50) with metadata filters → `DenseCandidate[] = {root, chunkId, rank}`.
2. Sync `store.search(q, { ...opts, dense })` — new optional `SearchOpts.dense`. `SqliteFtsStore.search` draws its BM25 pool as today, hydrates dense candidates from its own tables (dropping ones that no longer exist), RRF-fuses (`k`, `denseWeight`) **before** its existing page steps, then runs them unchanged: exact dedup → MMR → source dedup → lane quota → rerank hook → parent expansion. Every lexical page guarantee holds by construction. `dense` absent → byte-identical lexical path.
3. Timeout/error/unvalidated/unavailable → `store.search(q, opts)` without `dense`; fallback counted per process.
Latency: the timeout bounds embed + kNN; hydration + fusion run inside sync `store.search` and are covered by the existing search-latency measurement (`eval/measure-search-latency.ts`, extended with a hybrid row).
Status: `kb search --hybrid` prints one dense-status line to stderr; JSON/condensed bodies unchanged. (Tool-level `details` status is the follow-up change's job.)
`searchOptsFromConfig` gains the `omni` keys; `evaluateAsync(searchFn, golden, opts)` shares scoring code with `evaluate`, so eval runs the exact `hybridSearch` the CLI runs.
*Alternatives:* fusion wrapper after `store.search` (duplicates or loses MMR/lane/parent steps); Tier-C rerank hook (sync, BM25-only candidates); linear score blend (needs calibration).

### D6 — Embedding units (Q2 ablation)
- `chunk`: kb heading chunk + breadcrumb. `file`: chunks grouped by `(root, path)`, truncated to context.
- `row`: DOX rows parsed by the existing `dox.ts` table parser from indexed `AGENTS.md` / `*.AGENTS.md`; a row hit resolves to its AGENTS file chunk for fusion and scoring.
- `fused`: chunk prefixed by the DOX row naming its file (nearest ancestor via the existing agents-chain lookup); none → chunk alone.
Same-model units share one space and are comparable; different models never compared. CLI uses `omni.unit` (default `chunk`).

### D7 — Media: engine + CLI only
`kb embed --media <dir> --set <name>`: images, PDF pages (150 DPI), audio windows on SRT cue boundaries (target 30 s, clamped to [20, 40] s; no SRT → fixed 30 s windows), video clips (16 s windows sampled at 2 fps). `kb omni-search "<q>" [--modality m] [--set s]`: ranks same-model `chunk` + `media` vectors by cosine; prints `rank path[#t=start-end] :: modality/heading-or-label`. No agent tool — `context_search` gains a `media` scope in the follow-up change.

### D8 — Eval extension
- `run-fixtures.ts` variants `bm25`, `dense`, `hybrid`, `hybrid-small`; `--units` ablation; all via `evaluateAsync` + paired bootstrap.
- `golden.paraphrase-v2.json` (committed, ≥40); overlap rule enforced by a corpus-aware vitest.
- md→image: harness embeds the repo's referenced images into eval media set `eval-repo` through the eval sidecar instance (D3) and scores with a media matcher (`expect` = image path).
- text→audio: `pi-omni-embed eval build-srt` writes sets under `~/.pi/omni-embed/eval/`; test asserts the path resolves outside the repo root and is user-owned.
- Baselines: text sets — `bm25` / `hybrid` / `hybrid-small`; media sets — omni vs transcript/alt-text baselines (BM25 and small text embedder over SRT/alt text). Small text embedder never scored on raw media.
- Rows for unvalidated models/modalities omitted with reason.
- Report adds throughput per modality, vec DB bytes, kNN p50/p95, hybrid end-to-end p50/p95.

### D9 — Config surface
`DEFAULTS.omni = { enabled: false, model: "ATH-MaaS/Ovis-Omni-Embedding-3B", unit: "chunk", candidateK: 50, fusion: { k: 60, denseWeight: 1 }, queryTimeoutMs: 400, idleMinutes: 15, mediaRoots: [], sidecarCommand: "pi-omni-embed serve" }`. `omni` joins `NESTED_KEYS`; `mergeConfig` gains a second-level merge for `omni.fusion`. Validated in `validateConfig`. `kb search --hybrid` sets `enabled=true` for that call; other fields from the merged config.

### D10 — Test levels
- TS (kb engine, CLI, eval): vitest L1 under `packages/kb/src/__tests__/` with an in-memory fake `Embedder` (deterministic hash vectors).
- Python sidecar: pytest inside `packages/omni-embed/tests/`, **quick tier** only (fake embedding backend, no torch, no weights; loader key-selection tested on the vendored `model.safetensors.index.json`). Follows the existing convention: new `omni-pytest` CI job (astral-sh/setup-uv, `uv venv -p 3.14`, quick-tier requirements) + repo-lint vitest `packages/shared/src/__tests__/ci-omni-pytest.test.ts` modelled on `ci-music-pytest.test.ts`. Deep tier (torch + transformers) never installed in CI.
- Anything needing the real 11 GB model (benchmark reproduction, real MPS embeddings, RSS, throughput, real eval numbers) is **manual-only** on the Apple-silicon host; results recorded in the research dossier.

## Risks / Trade-offs

- [Subtly wrong encode recipe] → D2 three-part, per-modality gate; unvalidated modalities unusable.
- [Cold start 10–30 s] → query timeout → BM25; CLI prints fallback reason.
- [Memory: ~9 GB sidecar + vector slabs (~200 MB per 25k × 2048 fp32)] → Thinker-only load, idle shutdown, lazy per-(model,unit) slab load; int8 quantisation deferred until measured need.
- [Brute-force kNN too slow at media scale] → measured in eval; ANN is a follow-up only if p95 > budget.
- [Golden sets BM25-biased] → paraphrase-v2 + md→image not click-mined; per-set reporting.
- [Vectors stale between `kb index` and `kb embed`] → dropped at hydration; `kb embed` reports drift.
- [Private data leakage] → eval sets + weights under `~/.pi/omni-embed/`; logs carry counts/timings only; path-outside-repo test.
- [Local service reachable by other local processes] → loopback + token + allowlist + caps; configHash restart.
- [unify-context-manager lands first / changes kb engine APIs] → this change touches only engine-internal surfaces (`SearchOpts.dense`, new modules); rebase cost bounded; follow-up wires `context_search`.
- [Python toolchain / ffmpeg absent] → `pi-omni-embed doctor`; kb unaffected.

## Migration Plan

1. Land with `omni.enabled=false` → no behaviour change; no tool change.
2. `pi-omni-embed pull` + `validate`; run eval; record numbers in the research dossier.
3. Follow-up change (after unify cutover): hybrid in `context_search` `docs` scope, `media` scope.
Rollback: `omni.enabled=false` → pure BM25; delete `<kbdb>.vec.db` and `~/.pi/omni-embed/`. No kb schema or index migration either way.

## Open Questions

- Audio window target (30 s default) — may be retuned from text→audio eval within the [20, 40] s clamp.
- Idle-shutdown default — tuned from observed memory use.
