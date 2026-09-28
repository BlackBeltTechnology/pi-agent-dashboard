# Test Plan — add-omni-embedding-retrieval

Stage: design   Generated: 2026-09-27

Level legend (this change): **L1** = vitest under `packages/*/**/__tests__/` (kb engine/CLI/eval, fake `Embedder` with deterministic hash vectors). **L1-py** = pytest in `packages/omni-embed/tests/` (quick tier: fake embedding backend, no torch, no weights), run by a new `omni-pytest` CI job and guarded by a repo-lint vitest mirroring `packages/shared/src/__tests__/ci-music-pytest.test.ts`. **manual-only** = needs the real 11 GB model on the Apple-silicon host; results go to `docs/research/ovis-omni-embedding-kb-eval.md`.

Clarifications resolved at the design-stage hard gate (2026-09-27): caps (file 1 GB, audio 600 s, video 300 s, text 128k chars); segmentation (audio cue windows target 30 s clamp [20,40] s, no-SRT fixed 30 s; video 16 s @ 2 fps; PDF 150 DPI); Python harness (existing convention: `omni-pytest` CI job + repo-lint vitest; quick tier without torch); real-model scenarios manual-only.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | sidecar › Local-only | decision-table | L1-py | automated | running fake sidecar | POST /embed with no `Authorization`; then with wrong token | both 401; fake-model forward-call count stays 0 |
| E2 | sidecar › Local-only | state check | L1-py | automated | sidecar started with temp state dir | read `sidecar.json` stat + bound socket | file mode `0600`; socket host `127.0.0.1` |
| E3 | sidecar › File inputs scoped | EP | L1-py | automated | allowlist `/tmp/a`; files `/tmp/a/x.png`, `/tmp/a/../b/y.png`, `/tmp/a/link.png`→`/tmp/b/z.png` | embed each as image item | 200 / 403 / 403; file-open spy never called for the two rejects |
| E4 | sidecar › File inputs bounded | BVA | L1-py | automated | synthetic wav headers 600.0 s and 600.1 s, no window; 601 s wav with window 30 s | embed as audio | 200 / 413 / 200 |
| E5 | sidecar › File inputs bounded | BVA | L1-py | automated | synthetic video metadata 300.0 s and 300.1 s, no window | embed as video | 200 / 413 |
| E6 | sidecar › File inputs bounded | BVA | L1-py | automated | text items of 128000 and 128001 chars | embed | 200 / 413 |
| E7 | sidecar › File inputs bounded | BVA | L1-py | automated | sparse files of exactly 1 GiB and 1 GiB + 1 byte under allowlist | embed as image | size check passes for first (fails later on decode is acceptable, not 413) / 413 for second, file never opened |
| E8 | sidecar › Embed contract | EP | L1-py | automated | batch `[text, {modality:"hologram"}]` | embed | 400 body names item index 1; fake-model forward-call count 0 |
| E9 | sidecar › Pluggable model | decision-table | L1-py | automated | fake text-only model loaded | embed image item | 400 "modality unsupported by loaded model" |
| E10 | sidecar › Per-modality gate | decision-table | L1-py | automated | validated.json marks image true, video false | embed video item; embed image item | 400 naming missing video validation / 200 |
| E11 | sidecar › Embed contract | EP | L1-py | automated | batch `[text "a", image fixture]` | embed | 2 vectors in input order; `len == dim` reported; each L2 norm within 1±1e-3 |
| E12 | sidecar › Pluggable model | state-transition | L1-py | automated | fresh sidecar | GET /health | `loaded:false`; model-load spy count 0 |
| E13 | sidecar › Explicit weight mgmt | fault (absent) | L1-py | automated | empty `HF_HOME`, `HF_HUB_OFFLINE` unset | embed text | error text contains `pi-omni-embed pull`; download fn spy count 0 |
| E14 | sidecar › Pluggable model | state check | L1-py | automated | vendored real `model.safetensors.index.json` fixture (thinker/talker/token2wav keys) | loader key-selection function | selected keys all start `thinker.`; zero `talker.` / `token2wav.` keys; count equals thinker key count (real load verified by P3) |
| E15 | sidecar › Per-modality gate (a) | golden compare | L1-py | automated | vendored `chat_template.jinja` fixture + fixed text/image/audio inputs | render model input | rendered string equals pinned golden file byte-for-byte |
| E16 | sidecar › Per-modality gate | state-transition | L1-py | automated | fake scorer: template pass, bench pass, smoke 95% for image; smoke 85% for audio | run `validate`, restart sidecar, GET /health | health `validated:{image:true,audio:false}` before and after restart |
| E17 | hybrid › opt-in; kb-fts5 › dense fusion | golden compare | L1 | automated | bundled fixture index, no `omni` block, 20 fixture queries | `kb search` (condensed + `--json`) | output byte-identical to pre-change snapshot; embedder spy 0 calls; `.vec.db` never opened (fs spy) |
| E18 | hybrid › opt-in | decision-table | L1 | automated | (a) global `omni.model=M`, project `{enabled:true}`; (b) project only `{fusion:{k:100}}` | load merged config | (a) enabled true, model M, fusion `{k:60,denseWeight:1}`; (b) fusion `{k:100,denseWeight:1}` |
| E19 | hybrid › opt-in | BVA | L1 | automated | `omni.candidateK` 1, 0; `fusion.denseWeight` 0, -0.1; `queryTimeoutMs` 1, 0 | `validateConfig` | first of each pair accepted; second throws naming the key path |
| E20 | hybrid › opt-in | decision-table | L1 | automated | no `omni` block | `kb search --hybrid q` | hybrid runs with DEFAULTS (fake embedder called once); config file unchanged |
| E21 | kb-fts5 › dense fusion | EP | L1 | automated | dense list with one chunk that has zero BM25 match at dense rank 1 | `store.search(q,{dense})` | that chunk appears on page with same field set as a lexical hit (keys equal) |
| E22 | kb-fts5 › dense fusion | fault (stale) | L1 | automated | dense list containing `(root,"deadbeef:0")` absent from index | `store.search` | no throw; id absent from page; other candidates fused |
| E23 | hybrid › page guarantees | invariant | L1 | automated | dense + lexical pools where 3 chunks of one file rank top | hybrid search limit 5 | ≤5 distinct `path`s, each once; `suppressedSections` counts collapsed siblings |
| E24 | hybrid › page guarantees | golden compare | L1 | automated | subsection chunk reachable lexically and densely | hybrid vs lexical search | hybrid hit `parent.headingPath` equals lexical hit's |
| E25 | hybrid › doc_type; vector-plane › filtered lookup | EP | L1 | automated | vec plane: 100 `doc` vectors nearer than 30 `agents` vectors | dense lookup `doc_type:"agents"`, K=20 | 20 candidates, all `agents` |
| E26 | vector-plane › keying | EP | L1 | automated | two roots each with `AGENTS.md` | `kb embed`, then dense search matching both | two distinct rows; each hit resolves to its own root |
| E27 | vector-plane › keying | EP | L1 | automated | one AGENTS.md with 12 DOX rows | `kb embed --unit row` | 12 row vectors under that path, unique `unit_id`s |
| E28 | vector-plane › keying | EP | L1 | automated | fake embedders A (dim 8) and B (dim 4) | `kb embed` for A then B; search with model A | both stored; every ranked vector has model A |
| E29 | vector-plane › embed step | state-transition | L1 | automated | embedded fixture corpus; edit one md file; reindex | `kb embed` | only that file's units re-embedded (embed spy input set); report counts added/updated/removed/unchanged match |
| E30 | vector-plane › embed step | state-transition | L1 | automated | embedded corpus; delete one md; `kb index` | `kb embed` | that file's vectors gone; `removed` count = its unit count |
| E31 | vector-plane › embed step | state-transition | L1 | automated | corpus embedded for model A | switch config to model B; `kb embed` with no content change | every unit embedded for B |
| E32 | vector-plane › separate | invariant | L1 | automated | `omni.enabled:true`, fake embedder | `kb index` | embedder spy 0 calls; `.vec.db` absent/mtime unchanged |
| E33 | vector-plane › separate | golden compare | L1 | automated | embedded corpus | delete `.vec.db`; lexical `kb search` over 20 queries | results identical to before deletion |
| E34 | vector-plane › interface | substitution | L1 | automated | in-memory fake embedder, no sidecar | `kb embed` + `kb search --hybrid` | both succeed; zero HTTP calls |
| E35 | vector-plane › no dependency | static check | L1 | automated | `packages/kb/package.json` + built dist | inspect deps + dist imports | no new `dependencies`; no `loadExtension` / native module import in kb src |
| E36 | hybrid › tools unchanged; media › no agent tool | golden compare | L1 | automated | `omni.enabled:true`, media vectors present | call registered `kb_search` handler over 20 queries | output identical to lexical snapshot; every hit path ends `.md`; tool list unchanged (no `omni_search`) |
| E37 | hybrid › eval scores CLI routine | spy | L1 | automated | project config with omni block | run eval `hybrid` variant and `kb search --hybrid` | same hybrid function invoked; options objects deep-equal |
| E38 | media › ingestion | BVA | L1 | automated | 95 s audio + SRT with cues ending at 12, 31, 50, 58, 77, 95 s | segment | every window cue-aligned and within [20,40] s; windows cover [0,95] |
| E39 | media › ingestion | BVA | L1 | automated | 95 s audio, no SRT; 15 s audio, no SRT | segment | 30 s fixed windows covering [0,95]; single [0,15] window |
| E40 | media › ingestion | BVA | L1 | automated | 50 s video | segment | 4 windows ≤16 s covering [0,50]; frame sampling 2 fps passed to sidecar |
| E41 | media › ingestion | EP | L1 | automated | 3-page PDF | `kb embed --media` | 3 items `unit_id p:1..p:3`, labels carry page numbers; raster DPI 150 passed |
| E42 | media › ingestion | state-transition | L1 | automated | media dir indexed once | rerun unchanged | 0 items embedded (fake embedder spy) |
| E43 | media › ingestion | decision-table | L1 | automated | health: video unvalidated | `kb embed --media` over dir with mp4 + png | png embedded; mp4 reported `skipped-unvalidated` |
| E44 | media › ingestion | EP | L1 | automated | dir outside `omni.mediaRoots` | `kb embed --media` | exit ≠0; stderr names `omni.mediaRoots` |
| E45 | media › cross-modal CLI | EP | L1 | automated | mixed md + audio + image vectors | `kb omni-search q --modality audio` | every hit modality audio; hits print `#t=start-end` |
| E46 | media › cross-modal CLI | decision-table | L1 | automated | `omni.enabled` false | `kb omni-search q` | exit ≠0, one-line enable hint; sidecar spawn spy 0 |
| E47 | media › private | canary | L1 | automated | SRT containing canary `ZX-CANARY-7731` | `kb embed --media` with log capture | captured logs lack canary; contain counts + timings |
| E48 | eval › variants | report shape | L1 | automated | fake embedder, bundled sets | run harness dense variants | rows carry P@1,P@5,R@10,MRR,dupShare; non-baseline rows carry ΔMRR, ΔR@10, CI, W/L/T |
| E49 | eval › variants | decision-table | L1 | automated | validated.json text:false | run harness | dense/hybrid rows omitted; report states "not validated" |
| E50 | eval › unit ablation | report shape | L1 | automated | fake embedder, 2 sets | `--units` | 4 unit rows × 2 sets; `row` hits scored against AGENTS paths |
| E51 | eval › non-click-mined | EP | L1 | automated | fixture paraphrase item whose query shares token "tunnel" with target heading | corpus-aware overlap check | fails naming that item |
| E52 | eval › non-click-mined | invariant | L1 | automated | committed `golden.paraphrase-v2.json` | overlap check over real repo index | passes; item count ≥40 |
| E53 | eval › non-click-mined | EP | L1 | automated | `omni.mediaRoots: []`, repo with image refs | md→image run | set scored (n>0) via eval state dir; user state dir files untouched |
| E54 | eval › private sets | EP | L1 | automated | no `~/.pi/omni-embed/eval/` | harness | text→audio reported `skipped`, not zero metrics |
| E55 | eval › private sets | EP | L1-py | automated | `HOME` pointed inside the repo checkout | `pi-omni-embed eval build-srt` | refuses: output path resolves inside repo root; nothing written |
| E56 | eval › adoption rules | decision-table | L1 | automated | synthetic metric rows: (paraphrase sig ✓/✗) × (click-mined MRR or R@10 sig loss ✓/✗) × (dupShare sig rise ✓/✗) | compute recommendation | only (✓,✗,✗) → "hybrid: recommended"; every other combo "not recommended" naming the failing condition |
| E57 | eval › adoption rules | decision-table | L1 | automated | rule-2 and rule-3 synthetic rows; media set with text-only model | compute | omni-vs-small only on text sets; no small-embedder row on raw media sets |
| E58 | eval › cost metrics | report shape | L1 | automated | fake embedder run | report | throughput, vec bytes, kNN p50/p95, hybrid p50/p95 all non-empty |
| E59 | sidecar › one instance per state dir | state-transition | L1 | automated | live fake sidecar, then allowlist changed in config | next client file-item request | old pid gone, new pid, request served by new instance |
| E60 | sidecar › one instance per state dir | concurrency | L1 | automated | no instance; two clients same state dir | both `ensure()` concurrently | exactly one spawn; both get same port |
| E61 | sidecar › one instance per state dir | isolation | L1 | automated | user instance live in state dir A | eval client with state dir B + wider allowlist | A's pid + configHash unchanged; B started |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | vector-plane › brute-force kNN (design D4 budget) | tail-latency | L1 | automated | 25,000 random unit vectors × 2048-d, slab preloaded, 200 queries, doc_type filter 50% | p95 ≤ 50 ms | 200 queries after 20 warm-up |
| P2 | hybrid › latency budget | tail-latency | L1 | automated | fake embedder 5 ms, fixture index, 100 queries | hybrid p95 − lexical p95 ≤ 60 ms | 100 queries |
| P3 | sidecar real model | measurement | — | manual-only | real Ovis on Apple-silicon host | peak RSS after Thinker-only load recorded; Talker absent | one load |
| P4 | eval › cost metrics (real) | measurement | — | manual-only | real Ovis: text, image, PDF page, 30 s audio, 16 s video batches | throughput per modality + query-embed p50/p95 recorded in dossier | 100 items per modality |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | hybrid › fallback | fault (abort) | L1 | automated | sidecar port closed | `kb search --hybrid q` | lexical page returned; exit 0; stderr `dense: fallback:unreachable`; counter +1 |
| X2 | hybrid › fallback | fault (delay) | L1 | automated | fake HTTP embed delays 5 s; `queryTimeoutMs` 400 | `kb search --hybrid q` | returns within lexical time + 500 ms; stderr `fallback:timeout` |
| X3 | hybrid › fallback | fault (abort) | L1 | automated | fake embed returns 500 | hybrid search | lexical page; `fallback:error` |
| X4 | hybrid › fallback | fault (state) | L1 | automated | health `loaded:false`, embed never answers | hybrid search | returns ≤ timeout + 100 ms; `fallback:timeout` |
| X5 | hybrid › fallback | decision-table | L1 | automated | validated text:false | hybrid search | `fallback:unvalidated`; embed call count 0 |
| X6 | vector-plane › separate | fault (corrupt) | L1 | automated | `.vec.db` overwritten with random bytes | `kb search --hybrid`; `kb embed` | search → lexical page, `fallback:vector-plane`; embed exits ≠0 naming the file |
| X7 | sidecar › one instance | fault (stale) | L1 | automated | `sidecar.json` + lock with dead pid | client `ensure()` | stale lock reaped; one new instance; new pid recorded |
| X8 | vector-plane › embed step | fault (abort mid-run) | L1 | automated | fake embedder throws on batch 3 of 5 | `kb embed`, then rerun healthy | first run exits ≠0 with batches 1–2 committed; rerun embeds only remaining units |
| X9 | sidecar lifecycle / doctor | fault (absent tool) | L1 | automated | `PATH` without `uv` | run `pi-omni-embed` JS bin shim (`doctor`) | shim exits ≠0 printing the uv install step; no Python spawned |
| X10 | media › ingestion | fault (absent tool) | L1 | automated | `ffmpeg` missing (PATH stub) | `kb embed --media` over png + mp3 | png embedded; mp3 reported failed with `doctor` hint; exit ≠0 summarising failures |

### Manual-only (real model)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | sidecar › per-modality gate (real) | benchmark reproduction | — | manual-only | real Ovis weights; MMEB image, video, visual-doc, audio tasks | `pi-omni-embed validate` | per-modality verdicts + scores within ±3 of reported, recorded in dossier |
| M2 | eval › Q1/Q2/Q3 (real) | full run | — | manual-only | real Ovis + Qwen3-Embedding-0.6B, repo index | `run-fixtures.ts --omni --units` | report + recommendations recorded in dossier |
| M3 | eval › private sets (real) | full run | — | manual-only | `~/Movies` SRTs | `eval build-srt` + harness | text→audio metrics recorded; `git status` shows no new files |

---

## Coverage summary

- Requirements covered: 30/30 (every ADDED requirement across the 7 deltas has ≥1 row)
- Scenarios by class: edge 61 · perf 4 · frontend 0 · error 10 · manual 3
- Scenarios by level: L1 56 · L1-py 17 (folded as L1) · L2 0 · L3 0 · — 5
- Scenarios by disposition: automated 73 · manual-only 5

## New infra needed

- New `omni-pytest` job in `.github/workflows/ci.yml` (astral-sh/setup-uv, `uv venv -p 3.14`, quick-tier requirements only, never torch/weights) + repo-lint vitest `packages/shared/src/__tests__/ci-omni-pytest.test.ts` (pattern: `ci-music-pytest.test.ts`).
- Fake embedding backend for the Python quick tier (deterministic hash vectors, no torch).
- Fake `Embedder` + fake HTTP sidecar helpers for kb L1 tests.
