## 1. Package scaffold + CI

- [ ] 1.1 Scaffold `packages/omni-embed/` (npm `@blackbelt-technology/pi-dashboard-omni-embed`, `pyproject.toml` + `uv.lock` quick tier without torch, `requirements` deep tier with torch/transformers 5.3, JS bin shim `pi-omni-embed` exec'ing `uv run`, `AGENTS.md`, `README.md`); verify `pnpm install` succeeds and `pi-omni-embed --help` prints commands
- [ ] 1.2 Write repo-lint vitest `packages/shared/src/__tests__/ci-omni-pytest.test.ts` (see `packages/shared/src/__tests__/ci-music-pytest.test.ts`): ci.yml defines `omni-pytest` job · job parsed · uses setup-uv, `uv venv -p 3.14`, quick-tier install, runs `pytest packages/omni-embed/tests`, never installs torch/deep tier; verify it fails first
- [ ] 1.3 Add `omni-pytest` job to `.github/workflows/ci.yml`; verify 1.2 passes
- [ ] 1.4 Write L1 test (test-plan #X9) — see `packages/deck3d/src/check/__tests__/x5-check-timeout.test.ts`: `PATH` without `uv` · run `pi-omni-embed doctor` shim · exits ≠0 printing the uv install step, no Python spawned; then implement the shim check until green

## 2. Sidecar (Python, quick tier)

- [ ] 2.1 Write L1-py test (test-plan #E1) — see `packages/music-production/tests/test_edit.py`: running fake sidecar · POST /embed without / with wrong token · both 401, fake-model forward count 0
- [ ] 2.2 Write L1-py test (test-plan #E2) — see `packages/music-production/tests/test_edit.py`: sidecar on temp state dir · stat `sidecar.json` + bound socket · mode 0600, host 127.0.0.1
- [ ] 2.3 Write L1-py test (test-plan #E3) — see `packages/music-production/tests/test_edit.py`: allowlist `/tmp/a`; direct file, `..` escape, symlink escape · embed as image · 200/403/403, open-spy never called on rejects
- [ ] 2.4 Write L1-py test (test-plan #E4) — see `packages/music-production/tests/test_edit.py`: wav 600.0 s, 600.1 s unwindowed; 601 s with 30 s window · embed audio · 200/413/200
- [ ] 2.5 Write L1-py test (test-plan #E5) — see `packages/music-production/tests/test_edit.py`: video metadata 300.0 s, 300.1 s unwindowed · embed video · 200/413
- [ ] 2.6 Write L1-py test (test-plan #E6) — see `packages/music-production/tests/test_edit.py`: text 128000 / 128001 chars · embed · 200/413
- [ ] 2.7 Write L1-py test (test-plan #E7) — see `packages/music-production/tests/test_edit.py`: sparse files 1 GiB / 1 GiB+1 B · embed image · size check passes / 413 without opening file
- [ ] 2.8 Write L1-py test (test-plan #E8) — see `packages/music-production/tests/test_edit.py`: batch `[text, {modality:"hologram"}]` · embed · 400 naming index 1, forward count 0
- [ ] 2.9 Write L1-py test (test-plan #E9) — see `packages/music-production/tests/test_edit.py`: fake text-only model · embed image · 400 modality unsupported by loaded model
- [ ] 2.10 Write L1-py test (test-plan #E10) — see `packages/music-production/tests/test_edit.py`: validated image true / video false · embed video, embed image · 400 naming missing validation / 200
- [ ] 2.11 Write L1-py test (test-plan #E11) — see `packages/music-production/tests/test_edit.py`: batch `[text, image fixture]` · embed · 2 vectors in order, len = reported dim, L2 norm 1±1e-3
- [ ] 2.12 Write L1-py test (test-plan #E12) — see `packages/music-production/tests/test_edit.py`: fresh sidecar · GET /health · `loaded:false`, load-spy count 0
- [ ] 2.13 Write L1-py test (test-plan #E13) — see `packages/music-production/tests/test_edit.py`: empty `HF_HOME` · embed text · error names `pi-omni-embed pull`, download-spy count 0
- [ ] 2.14 Write L1-py test (test-plan #E14) — see `packages/music-production/tests/test_edit.py`: vendored real `model.safetensors.index.json` · loader key-selection · only `thinker.` keys, zero `talker.`/`token2wav.`, count = thinker key count
- [ ] 2.15 Write L1-py test (test-plan #E15) — see `packages/music-production/tests/test_edit.py`: vendored `chat_template.jinja` + fixed text/image/audio inputs · render model input · equals pinned golden byte-for-byte
- [ ] 2.16 Write L1-py test (test-plan #E16) — see `packages/music-production/tests/test_edit.py`: fake scorer image pass / audio smoke 85% · `validate`, restart, GET /health · `validated:{image:true,audio:false}` before and after restart
- [ ] 2.17 Write L1-py test (test-plan #E55) — see `packages/music-production/tests/test_edit.py`: `HOME` inside repo checkout · `pi-omni-embed eval build-srt` · refuses (output inside repo root), nothing written
- [ ] 2.18 Implement sidecar HTTP server (`serve`): loopback bind, token, state dir + 0600 state file, `/embed` contract, `/health`, allowlist realpath check, caps (1 GB / 600 s / 300 s / 128k chars), modality + validation checks, pluggable backend (fake for tests, transformers Thinker-only for real); verify 2.1–2.13 pass
- [ ] 2.19 Implement Thinker-only loader (key selection from index, bf16, mps→cpu) and template rendering from the ms-swift `qwen2_5_omni_emb` source; verify 2.14–2.15 pass
- [ ] 2.20 Implement `validate` (template conformance, per-modality benchmark reproduction ±3, smoke ≥90%) with persisted per-modality `validated.json`; `pull` into `~/.pi/omni-embed/hf`; `doctor` (uv, ffmpeg, weights, validation); verify 2.16 passes
- [ ] 2.21 Implement `eval build-srt` (SRT → text→audio golden set under `~/.pi/omni-embed/eval/`, refuse paths inside repo root); verify 2.17 passes

## 3. kb config + interfaces

- [ ] 3.1 Write L1 test (test-plan #E18) — see `packages/kb/src/__tests__/config-doctrine.test.ts`: (a) global `omni.model=M` + project `{enabled:true}`; (b) project `{fusion:{k:100}}` · load merged config · (a) enabled, model M, fusion defaults; (b) `{k:100,denseWeight:1}`
- [ ] 3.2 Write L1 test (test-plan #E19) — see `packages/kb/src/__tests__/config-doctrine.test.ts`: candidateK 1/0, denseWeight 0/-0.1, queryTimeoutMs 1/0 · `validateConfig` · first accepted, second throws naming key path
- [ ] 3.3 Write L1 test (test-plan #E35) — see `packages/kb/src/__tests__/engine-fingerprint.test.ts`: `packages/kb/package.json` + src · inspect deps/imports · no new `dependencies`, no `loadExtension`/native module import
- [ ] 3.4 Add `DEFAULTS.omni`, `omni` in `NESTED_KEYS`, second-level `omni.fusion` merge, `validateConfig` rules, `omni` keys in `searchOptsFromConfig`; define `Embedder`, `VectorStore`, `DenseCandidate` types; verify 3.1–3.3 pass

## 4. Vector plane + `kb embed`

- [ ] 4.1 Write L1 test (test-plan #E26) — see `packages/kb/src/__tests__/kb.test.ts`: two roots each with `AGENTS.md` · `kb embed` + dense search · two distinct rows, each resolves to its root
- [ ] 4.2 Write L1 test (test-plan #E27) — see `packages/kb/src/__tests__/kb.test.ts`: AGENTS.md with 12 DOX rows · `kb embed --unit row` · 12 vectors, unique `unit_id`
- [ ] 4.3 Write L1 test (test-plan #E28) — see `packages/kb/src/__tests__/kb.test.ts`: fake embedders A (dim 8), B (dim 4) · embed A then B, search A · both stored, ranked vectors all model A
- [ ] 4.4 Write L1 test (test-plan #E29) — see `packages/kb/src/__tests__/index-atomicity.test.ts`: embedded corpus, one md edited + reindexed · `kb embed` · only that file's units re-embedded, counts added/updated/removed/unchanged correct
- [ ] 4.5 Write L1 test (test-plan #E30) — see `packages/kb/src/__tests__/index-atomicity.test.ts`: md deleted + `kb index` · `kb embed` · its vectors gone, `removed` = its unit count
- [ ] 4.6 Write L1 test (test-plan #E31) — see `packages/kb/src/__tests__/kb.test.ts`: corpus embedded for A · switch to B, `kb embed` no content change · every unit embedded for B
- [ ] 4.7 Write L1 test (test-plan #E32) — see `packages/kb/src/__tests__/index-atomicity.test.ts`: `omni.enabled:true`, fake embedder · `kb index` · embedder 0 calls, `.vec.db` absent/unchanged mtime
- [ ] 4.8 Write L1 test (test-plan #E33) — see `packages/kb/src/__tests__/retrieval-quality.test.ts`: embedded corpus · delete `.vec.db`, lexical search 20 queries · identical to before
- [ ] 4.9 Write L1 test (test-plan #E34) — see `packages/kb/src/__tests__/kb.test.ts`: in-memory fake embedder, no sidecar · `kb embed` + `kb search --hybrid` · both succeed, zero HTTP calls
- [ ] 4.10 Write L1 test (test-plan #E25) — see `packages/kb/src/__tests__/lane-lead.test.ts`: 100 near `doc` vs 30 `agents` vectors · dense lookup `doc_type:"agents"` K=20 · 20 candidates all `agents`
- [ ] 4.11 Write L1 test (test-plan #X6) — see `packages/kb/src/__tests__/index-atomicity.test.ts`: `.vec.db` overwritten with random bytes · `kb search --hybrid`; `kb embed` · lexical page + `fallback:vector-plane`; embed exits ≠0 naming file
- [ ] 4.12 Write L1 test (test-plan #X8) — see `packages/kb/src/__tests__/index-atomicity.test.ts`: fake embedder throws on batch 3/5 · `kb embed` then healthy rerun · first exits ≠0 with batches 1–2 committed; rerun embeds only remaining
- [ ] 4.13 Write L1 timed test (test-plan #P1) — see `packages/kb/src/__tests__/retrieval-quality.test.ts`: 25,000 × 2048 random vectors preloaded, 50% doc_type filter · 200 queries after 20 warm-up · p95 ≤ 50 ms
- [ ] 4.14 Implement `SqliteVectorStore` (node:sqlite BLOB table, PK `(model,unit,root,path,unit_id)`, metadata columns, `vec_models` meta, lazy Float32 slab per (model,unit), filtered brute-force cosine) and unit enumeration (`chunk`, `file`, `row` via `dox.ts`, `fused` via agents-chain); verify 4.1–4.3, 4.10, 4.13 pass
- [ ] 4.15 Implement `kb embed` CLI (incremental on `(model,unit,content_hash)`, orphan removal, batch commits, counts report, corrupt-file error); verify 4.4–4.9, 4.11–4.12 pass

## 5. Store fusion + hybrid search

- [ ] 5.1 Write L1 test (test-plan #E17) — see `packages/kb/src/__tests__/retrieval-quality.test.ts`: fixture index, no `omni` block, 20 queries · `kb search` condensed + `--json` · byte-identical to pre-change snapshot, embedder 0 calls, `.vec.db` never opened
- [ ] 5.2 Write L1 test (test-plan #E20) — see `packages/kb/src/__tests__/search-opts.test.ts`: no `omni` block · `kb search --hybrid q` · hybrid runs with DEFAULTS (embedder called once), config file unchanged
- [ ] 5.3 Write L1 test (test-plan #E21) — see `packages/kb/src/__tests__/kb.test.ts`: dense rank-1 chunk with zero BM25 match · `store.search(q,{dense})` · on page with same key set as a lexical hit
- [ ] 5.4 Write L1 test (test-plan #E22) — see `packages/kb/src/__tests__/kb.test.ts`: dense list with absent `(root,"deadbeef:0")` · `store.search` · no throw, id absent, others fused
- [ ] 5.5 Write L1 test (test-plan #E23) — see `packages/kb/src/__tests__/kb.test.ts`: 3 top chunks of one file · hybrid limit 5 · ≤5 distinct paths each once, `suppressedSections` counts siblings
- [ ] 5.6 Write L1 test (test-plan #E24) — see `packages/kb/src/__tests__/kb.test.ts`: subsection reachable lexically and densely · hybrid vs lexical · equal `parent.headingPath`
- [ ] 5.7 Write L1 test (test-plan #E36) — see `packages/kb-extension/src/__tests__/kb-search-tool.test.ts`: `omni.enabled:true`, media vectors present · registered `kb_search` handler, 20 queries · identical to lexical snapshot, all hits `.md`, tool list has no `omni_search`
- [ ] 5.8 Write L1 test (test-plan #E37) — see `packages/kb/src/__tests__/search-opts.test.ts`: project config with omni block · eval `hybrid` variant and `kb search --hybrid` · same hybrid function invoked, options deep-equal
- [ ] 5.9 Write L1 test (test-plan #X1) — see `packages/deck3d/src/check/__tests__/x5-check-timeout.test.ts`: sidecar port closed · `kb search --hybrid q` · lexical page, exit 0, stderr `dense: fallback:unreachable`, counter +1
- [ ] 5.10 Write L1 test (test-plan #X2) — see `packages/deck3d/src/check/__tests__/x5-check-timeout.test.ts`: fake embed delays 5 s, timeout 400 ms · hybrid search · returns within lexical + 500 ms, stderr `fallback:timeout`
- [ ] 5.11 Write L1 test (test-plan #X3) — see `packages/deck3d/src/check/__tests__/x5-check-timeout.test.ts`: fake embed returns 500 · hybrid search · lexical page, `fallback:error`
- [ ] 5.12 Write L1 test (test-plan #X4) — see `packages/deck3d/src/check/__tests__/x5-check-timeout.test.ts`: health `loaded:false`, embed never answers · hybrid search · returns ≤ timeout + 100 ms, `fallback:timeout`
- [ ] 5.13 Write L1 test (test-plan #X5) — see `packages/kb/src/__tests__/search-opts.test.ts`: validated text:false · hybrid search · `fallback:unvalidated`, embed 0 calls
- [ ] 5.14 Write L1 timed test (test-plan #P2) — see `packages/kb/src/__tests__/retrieval-quality.test.ts`: fake embedder 5 ms, fixture index, 100 queries · hybrid vs lexical · p95 delta ≤ 60 ms
- [ ] 5.15 Implement `SearchOpts.dense` in `SqliteFtsStore.search` (hydrate + drop stale, RRF before existing page steps; absent → untouched path); verify 5.1, 5.3–5.6 pass
- [ ] 5.16 Implement `hybrid.ts` (`hybridSearch`: timeout-bounded embed + kNN, fallback reasons + per-process counter) and `HttpEmbedder` (state-dir client, configHash, spawn via `omni.sidecarCommand`); wire `kb search --hybrid` stderr status; verify 5.2, 5.7–5.14 pass

## 6. Sidecar client lifecycle (TS)

- [ ] 6.1 Write L1 test (test-plan #E59) — see `packages/deck3d/src/check/__tests__/x5-check-timeout.test.ts`: live fake sidecar, allowlist changed · next file-item request · old pid gone, new pid serves request
- [ ] 6.2 Write L1 test (test-plan #E60) — see `packages/deck3d/src/check/__tests__/x5-check-timeout.test.ts`: no instance, two clients same state dir · concurrent `ensure()` · exactly one spawn, same port
- [ ] 6.3 Write L1 test (test-plan #E61) — see `packages/deck3d/src/check/__tests__/x5-check-timeout.test.ts`: user instance in state dir A · eval client state dir B wider allowlist · A pid + configHash unchanged, B started
- [ ] 6.4 Write L1 test (test-plan #X7) — see `packages/deck3d/src/check/__tests__/x5-check-timeout.test.ts`: `sidecar.json` + lock with dead pid · `ensure()` · stale lock reaped, one new instance, pid recorded
- [ ] 6.5 Implement O_EXCL lock + stale-PID reap + configHash restart + idle shutdown handshake in `HttpEmbedder`; verify 6.1–6.4 pass

## 7. Media ingestion + `kb omni-search`

- [ ] 7.1 Write L1 test (test-plan #E38) — see `packages/kb/src/__tests__/kb.test.ts`: 95 s audio + SRT cues ending 12/31/50/58/77/95 s · segment · windows cue-aligned within [20,40] s covering [0,95]
- [ ] 7.2 Write L1 test (test-plan #E39) — see `packages/kb/src/__tests__/kb.test.ts`: 95 s and 15 s audio, no SRT · segment · 30 s windows covering [0,95]; single [0,15] window
- [ ] 7.3 Write L1 test (test-plan #E40) — see `packages/kb/src/__tests__/kb.test.ts`: 50 s video · segment · 4 windows ≤16 s covering [0,50], 2 fps passed to sidecar
- [ ] 7.4 Write L1 test (test-plan #E41) — see `packages/kb/src/__tests__/kb.test.ts`: 3-page PDF · `kb embed --media` · `unit_id p:1..p:3`, page labels, 150 DPI passed
- [ ] 7.5 Write L1 test (test-plan #E42) — see `packages/kb/src/__tests__/index-atomicity.test.ts`: media dir indexed once · rerun unchanged · 0 items embedded
- [ ] 7.6 Write L1 test (test-plan #E43) — see `packages/kb/src/__tests__/kb.test.ts`: video unvalidated · `kb embed --media` over mp4 + png · png embedded, mp4 `skipped-unvalidated`
- [ ] 7.7 Write L1 test (test-plan #E44) — see `packages/kb/src/__tests__/kb.test.ts`: dir outside `omni.mediaRoots` · `kb embed --media` · exit ≠0 naming `omni.mediaRoots`
- [ ] 7.8 Write L1 test (test-plan #E45) — see `packages/kb/src/__tests__/render.test.ts`: md + audio + image vectors · `kb omni-search q --modality audio` · all hits audio, printed `#t=start-end`
- [ ] 7.9 Write L1 test (test-plan #E46) — see `packages/kb/src/__tests__/render.test.ts`: `omni.enabled` false · `kb omni-search q` · exit ≠0 one-line hint, spawn-spy 0
- [ ] 7.10 Write L1 test (test-plan #E47) — see `packages/kb/src/__tests__/kb.test.ts`: SRT with canary `ZX-CANARY-7731` · `kb embed --media` with log capture · logs lack canary, carry counts + timings
- [ ] 7.11 Write L1 test (test-plan #X10) — see `packages/deck3d/src/check/__tests__/x5-check-timeout.test.ts`: `ffmpeg` missing · `kb embed --media` png + mp3 · png embedded, mp3 failed with doctor hint, exit ≠0 summary
- [ ] 7.12 Implement media segmentation (SRT cue windows target 30 s clamp [20,40], fixed 30 s fallback, video 16 s @ 2 fps, PDF 150 DPI), `kb embed --media <dir> --set <name>` (mediaRoots check, validated modalities only, unchanged-file skip, content-free logs); verify 7.1–7.7, 7.10–7.11 pass
- [ ] 7.13 Implement `kb omni-search` (same-model chunk + media ranking, modality/set filters, disabled message); verify 7.8–7.9 pass

## 8. Eval extension

- [ ] 8.1 Write L1 test (test-plan #E48) — see `packages/kb/src/__tests__/sweep-rows.test.ts`: fake embedder, bundled sets · dense variants run · rows carry P@1/P@5/R@10/MRR/dupShare; non-baseline ΔMRR, ΔR@10, CI, W/L/T
- [ ] 8.2 Write L1 test (test-plan #E49) — see `packages/kb/src/__tests__/eval-guard.test.ts`: validated text:false · harness run · dense/hybrid rows omitted, "not validated" stated
- [ ] 8.3 Write L1 test (test-plan #E50) — see `packages/kb/src/__tests__/sweep-rows.test.ts`: fake embedder, 2 sets · `--units` · 4 unit rows × 2 sets, `row` hits scored vs AGENTS paths
- [ ] 8.4 Write L1 test (test-plan #E51) — see `packages/kb/src/__tests__/eval-golden.test.ts`: paraphrase item sharing token "tunnel" with target heading · corpus-aware overlap check · fails naming item
- [ ] 8.5 Write L1 test (test-plan #E52) — see `packages/kb/src/__tests__/eval-golden.test.ts`: committed `golden.paraphrase-v2.json` · overlap check over real repo index · passes, ≥40 items
- [ ] 8.6 Write L1 test (test-plan #E53) — see `packages/kb/src/__tests__/eval-roots.test.ts`: `omni.mediaRoots: []`, repo image refs · md→image run · set scored n>0 via eval state dir, user state dir untouched
- [ ] 8.7 Write L1 test (test-plan #E54) — see `packages/kb/src/__tests__/eval-guard.test.ts`: no `~/.pi/omni-embed/eval/` · harness · text→audio `skipped`, not zero
- [ ] 8.8 Write L1 test (test-plan #E56) — see `packages/kb/src/__tests__/sweep-rows.test.ts`: synthetic rows over (paraphrase sig) × (click-mined MRR/R@10 loss) × (dupShare rise) · compute recommendation · only (✓,✗,✗) recommended; others name failing condition
- [ ] 8.9 Write L1 test (test-plan #E57) — see `packages/kb/src/__tests__/sweep-rows.test.ts`: rule-2/rule-3 synthetic rows, text-only model on media set · compute · omni-vs-small only on text sets, no small-embedder row on raw media
- [ ] 8.10 Write L1 test (test-plan #E58) — see `packages/kb/src/__tests__/sweep-rows.test.ts`: fake embedder run · report · throughput, vec bytes, kNN p50/p95, hybrid p50/p95 non-empty
- [ ] 8.11 Implement `evaluateAsync(searchFn, …)` sharing scoring with `evaluate`; `run-fixtures.ts` variants `dense`/`hybrid`/`hybrid-small`, `--units`, cost metrics, adoption-rule report; extend `measure-search-latency.ts` with hybrid row; verify 8.1–8.3, 8.8–8.10 pass
- [ ] 8.12 Author `golden.paraphrase-v2.json` (≥40, zero-overlap) + corpus-aware overlap check; md→image set generator + eval-scoped media set via eval state dir; private-set discovery/skip; verify 8.4–8.7 pass

## 9. Docs + DOX

- [ ] 9.1 Add/extend DOX rows: `packages/omni-embed/AGENTS.md` (new), `packages/kb/src/AGENTS.md` (vector store, hybrid, config, eval changes), `packages/kb/eval/AGENTS.md` rows, `packages/shared/src/__tests__` row; verify `kb dox lint` clean
- [ ] 9.2 Delegate to DocScribe: update `docs/research/ovis-omni-embedding-kb-eval.md` (final design pointers) and kb README usage (`kb embed`, `--hybrid`, `omni-search`, config block); verify docs mention default-OFF + rollback

## 10. Manual verification (real model, Apple-silicon host)

- [ ] 10.1 Real-model peak RSS after Thinker-only load; Talker absent — record in dossier (test-plan: manual-only, #P3)
- [ ] 10.2 Real throughput per modality + query-embed p50/p95 — record in dossier (test-plan: manual-only, #P4)
- [ ] 10.3 `pi-omni-embed validate` on real Ovis: per-modality verdicts + scores within ±3 — record in dossier (test-plan: manual-only, #M1)
- [ ] 10.4 Full eval run Q1/Q2/Q3 with Ovis + Qwen3-Embedding-0.6B; recommendations recorded in dossier (test-plan: manual-only, #M2)
- [ ] 10.5 Build text→audio set from `~/Movies` SRTs and score; confirm `git status` shows no new files (test-plan: manual-only, #M3)
