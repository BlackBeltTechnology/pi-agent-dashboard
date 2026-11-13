# Shared streaming-performance comparison

**Browser acceptance remains open.** Both F5 browser scenarios are implemented but unexecuted: Docker’s forwarded build service was unavailable. No build VM was provisioned, deployment performed, or publication attempted.

The shared P2 four-way comparison is complete. These are synthetic in-process timings, not network, rendering, or phone reconnect measurements.

## Method and pinned sources

Run: 2026-11-13. Runtime: Node v24.16.0; linux/x64; AMD Ryzen 7 7700X 8-Core Processor; 8 available CPU threads.

Baseline module bytes match `develop@upstream` at `e78b4c2c0474a8ab04941e76942e5a5b9d92c2d6`. Source SHA-256 values below pin the measured baseline, optimized modules and harness independently of temporary workspace revision IDs. Each PR contains one optimized production module; both contain this record and the same test-only comparison harness.

| Source | Candidate SHA-256 |
|---|---|
| `packages/server/src/session/replay-compaction.ts` | `e24dfb41ab9f61115f28d920640412c5fac975a0de381f363397157b18f39963` |
| `packages/client/src/lib/chat/event-reducer.ts` | `7ce66f46ee16588da1693d4f2577843d1626af705d05c9c2355b6a1e763c0e74` |
| `packages/server/src/__tests__/replay-performance.test.ts` | `e2382acb13fc00e3c004a2cbba836d20cf75a26d19cade64bdc7e0ea97f76941` |

Baseline compactor SHA-256: `5699f43e8d72b2b9c7b2d447169f80cc4fb3394e622247003cc0c6b50a6721a0`.
Baseline reducer SHA-256: `d9d79adaad38bc366e8b790c19d207f30f449a7e5e146ea547e3e125b760d2c6`.

| Variant | Compactor source | Reducer source |
|---|---|---|
| baseline | baseline revision | baseline revision |
| collapse-only | measured candidate | baseline revision |
| copy-on-write-only | baseline revision | measured candidate |
| both | measured candidate | measured candidate |

All other production modules match baseline. Baseline retains existing finalized-prefix compaction. No runtime feature flags or duplicate production modules were added.

One untimed correctness pass precedes 2 warm-up repetitions and 7 timed repetitions per cell. First variant rotates each repetition. Initial-state construction is outside the timers. Each phase and total reports its own median; phase medians need not sum to median total. Copy counters run separately from timing.

Historical tool maps contain 0, 1000, or 10000 completed calls. Every initial transcript has 0 rows. Fixtures use fixed timestamps and deterministic values. Plugins are registered, but these timing workloads contain no plugin-owned events or Agent tools; counters exclude independently allocating plugin work.

Workloads:
- `text`: 100 adjacent snapshots, payloads 1 through 100 KiB; eligible-run lengths `[100]`.
- `interleaved`: eligible-run lengths `[12,1,12]`, retained stats/thinking/tool events, and 12 mixed snapshots.
- `write-heavy`: 500 fresh read tools, 1000 alternating starts/ends, no eligible adjacent text run.

Every cell checks complete state against baseline plus independent text/tool/thinking expectations, then applies identical live continuation and finalization. Equality includes map entries and plugin fields without normalization. Generated correctness suites separately exercise registered subagent state and callback re-entry.

## Largest-map comparison

Median total milliseconds, 10000 historical tools:

| Workload | baseline | collapse-only | copy-on-write-only | both |
|---|---:|---:|---:|---:|
| text | 104.876 | 1.892 | 13.545 | 0.222 |
| interleaved | 43.141 | 24.039 | 1.862 | 1.820 |
| write-heavy | 910.094 | 911.317 | 894.002 | 910.143 |

Text and interleaved workloads improve substantially in this environment. Write-heavy work remains essentially unchanged; no write-heavy speedup is claimed.

## Replay shape and serialized bytes

Bytes count JSON-serialized `StoredEvent[]`, not complete WebSocket traffic or compressed wire bytes. Shape is identical across historical-map sizes.

| Workload | Variant | Raw events | Raw bytes | Retained events | Serialized bytes |
|---|---|---:|---:|---:|---:|
| text | baseline | 101 | 5187732 | 101 | 5187732 |
| text | collapse-only | 101 | 5187732 | 2 | 102703 |
| text | copy-on-write-only | 101 | 5187732 | 101 | 5187732 |
| text | both | 101 | 5187732 | 2 | 102703 |
| interleaved | baseline | 46 | 9103 | 46 | 9103 |
| interleaved | collapse-only | 46 | 9103 | 24 | 5276 |
| interleaved | copy-on-write-only | 46 | 9103 | 46 | 9103 |
| interleaved | both | 46 | 9103 | 24 | 5276 |
| write-heavy | baseline | 1001 | 168602 | 1001 | 168602 |
| write-heavy | collapse-only | 1001 | 168602 | 1001 | 168602 |
| write-heavy | copy-on-write-only | 1001 | 168602 | 1001 | 168602 |
| write-heavy | both | 1001 | 168602 | 1001 | 168602 |

## All phase timings and measured map work

Milliseconds, rounded to 3 decimals. `Visited` counts entries traversed by core map-copy constructions in the separate instrumented pass.

| Workload | Historical tools | Variant | Compact | Serialize | Parse | Reduce | Total | Copies | Visited |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| text | 0 | baseline | 0.004 | 12.598 | 1.259 | 0.083 | 14.405 | 101 | 0 |
| text | 0 | collapse-only | 0.026 | 0.197 | 0.066 | 0.003 | 0.296 | 2 | 0 |
| text | 0 | copy-on-write-only | 0.005 | 13.206 | 3.142 | 0.076 | 16.004 | 0 | 0 |
| text | 0 | both | 0.028 | 0.163 | 0.030 | 0.003 | 0.220 | 0 | 0 |
| interleaved | 0 | baseline | 0.002 | 0.030 | 0.040 | 0.018 | 0.093 | 46 | 13 |
| interleaved | 0 | collapse-only | 0.006 | 0.011 | 0.023 | 0.010 | 0.070 | 24 | 13 |
| interleaved | 0 | copy-on-write-only | 0.002 | 0.022 | 0.046 | 0.017 | 0.091 | 2 | 1 |
| interleaved | 0 | both | 0.007 | 0.014 | 0.023 | 0.009 | 0.055 | 2 | 1 |
| write-heavy | 0 | baseline | 0.013 | 0.695 | 0.632 | 9.365 | 10.695 | 1001 | 250000 |
| write-heavy | 0 | collapse-only | 0.019 | 0.677 | 0.639 | 9.245 | 10.572 | 1001 | 250000 |
| write-heavy | 0 | copy-on-write-only | 0.014 | 0.695 | 0.632 | 9.299 | 10.640 | 1000 | 250000 |
| write-heavy | 0 | both | 0.025 | 0.692 | 0.650 | 9.445 | 10.810 | 1000 | 250000 |
| text | 1000 | baseline | 0.002 | 12.091 | 1.166 | 3.716 | 16.936 | 101 | 101000 |
| text | 1000 | collapse-only | 0.022 | 0.165 | 0.029 | 0.088 | 0.304 | 2 | 2000 |
| text | 1000 | copy-on-write-only | 0.003 | 12.208 | 1.171 | 0.042 | 13.436 | 0 | 0 |
| text | 1000 | both | 0.011 | 0.152 | 0.025 | 0.002 | 0.194 | 0 | 0 |
| interleaved | 1000 | baseline | 0.001 | 0.020 | 0.038 | 1.655 | 1.717 | 46 | 46013 |
| interleaved | 1000 | collapse-only | 0.002 | 0.012 | 0.023 | 0.878 | 0.915 | 24 | 24013 |
| interleaved | 1000 | copy-on-write-only | 0.001 | 0.022 | 0.039 | 0.103 | 0.165 | 2 | 2001 |
| interleaved | 1000 | both | 0.002 | 0.012 | 0.023 | 0.084 | 0.122 | 2 | 2001 |
| write-heavy | 1000 | baseline | 0.012 | 0.652 | 0.736 | 51.695 | 53.104 | 1001 | 1251000 |
| write-heavy | 1000 | collapse-only | 0.017 | 0.659 | 0.739 | 51.934 | 53.332 | 1001 | 1251000 |
| write-heavy | 1000 | copy-on-write-only | 0.012 | 0.659 | 0.731 | 51.851 | 53.367 | 1000 | 1250000 |
| write-heavy | 1000 | both | 0.016 | 0.648 | 0.743 | 51.399 | 52.787 | 1000 | 1250000 |
| text | 10000 | baseline | 0.002 | 12.610 | 1.171 | 91.288 | 104.876 | 101 | 1010000 |
| text | 10000 | collapse-only | 0.034 | 0.170 | 0.042 | 1.651 | 1.892 | 2 | 20000 |
| text | 10000 | copy-on-write-only | 0.002 | 12.306 | 1.170 | 0.043 | 13.545 | 0 | 0 |
| text | 10000 | both | 0.027 | 0.162 | 0.032 | 0.006 | 0.222 | 0 | 0 |
| interleaved | 10000 | baseline | 0.004 | 0.034 | 0.054 | 43.047 | 43.141 | 46 | 460013 |
| interleaved | 10000 | collapse-only | 0.010 | 0.032 | 0.052 | 23.946 | 24.039 | 24 | 240013 |
| interleaved | 10000 | copy-on-write-only | 0.006 | 0.044 | 0.066 | 1.753 | 1.862 | 2 | 20001 |
| interleaved | 10000 | both | 0.007 | 0.024 | 0.040 | 1.745 | 1.820 | 2 | 20001 |
| write-heavy | 10000 | baseline | 0.010 | 0.629 | 0.726 | 908.691 | 910.094 | 1001 | 10260000 |
| write-heavy | 10000 | collapse-only | 0.014 | 0.653 | 0.725 | 909.942 | 911.317 | 1001 | 10260000 |
| write-heavy | 10000 | copy-on-write-only | 0.010 | 0.645 | 0.725 | 892.619 | 894.002 | 1000 | 10250000 |
| write-heavy | 10000 | both | 0.014 | 0.636 | 0.724 | 908.782 | 910.143 | 1000 | 10250000 |

## Ratios for every cell

Each ratio is reference median total / row median total. Values above 1 mean the row is faster. Unchanged and worse cells remain included.

| Workload | Historical tools | Variant | baseline / row | collapse-only / row | copy-on-write-only / row |
|---|---:|---|---:|---:|---:|
| text | 0 | baseline | 1.000 | 0.021 | 1.111 |
| text | 0 | collapse-only | 48.679 | 1.000 | 54.081 |
| text | 0 | copy-on-write-only | 0.900 | 0.018 | 1.000 |
| text | 0 | both | 65.587 | 1.347 | 72.866 |
| interleaved | 0 | baseline | 1.000 | 0.756 | 0.981 |
| interleaved | 0 | collapse-only | 1.322 | 1.000 | 1.298 |
| interleaved | 0 | copy-on-write-only | 1.019 | 0.771 | 1.000 |
| interleaved | 0 | both | 1.706 | 1.290 | 1.674 |
| write-heavy | 0 | baseline | 1.000 | 0.988 | 0.995 |
| write-heavy | 0 | collapse-only | 1.012 | 1.000 | 1.006 |
| write-heavy | 0 | copy-on-write-only | 1.005 | 0.994 | 1.000 |
| write-heavy | 0 | both | 0.989 | 0.978 | 0.984 |
| text | 1000 | baseline | 1.000 | 0.018 | 0.793 |
| text | 1000 | collapse-only | 55.709 | 1.000 | 44.196 |
| text | 1000 | copy-on-write-only | 1.260 | 0.023 | 1.000 |
| text | 1000 | both | 87.094 | 1.563 | 69.095 |
| interleaved | 1000 | baseline | 1.000 | 0.533 | 0.096 |
| interleaved | 1000 | collapse-only | 1.876 | 1.000 | 0.180 |
| interleaved | 1000 | copy-on-write-only | 10.400 | 5.545 | 1.000 |
| interleaved | 1000 | both | 14.039 | 7.485 | 1.350 |
| write-heavy | 1000 | baseline | 1.000 | 1.004 | 1.005 |
| write-heavy | 1000 | collapse-only | 0.996 | 1.000 | 1.001 |
| write-heavy | 1000 | copy-on-write-only | 0.995 | 0.999 | 1.000 |
| write-heavy | 1000 | both | 1.006 | 1.010 | 1.011 |
| text | 10000 | baseline | 1.000 | 0.018 | 0.129 |
| text | 10000 | collapse-only | 55.418 | 1.000 | 7.157 |
| text | 10000 | copy-on-write-only | 7.743 | 0.140 | 1.000 |
| text | 10000 | both | 472.589 | 8.528 | 61.036 |
| interleaved | 10000 | baseline | 1.000 | 0.557 | 0.043 |
| interleaved | 10000 | collapse-only | 1.795 | 1.000 | 0.077 |
| interleaved | 10000 | copy-on-write-only | 23.169 | 12.910 | 1.000 |
| interleaved | 10000 | both | 23.704 | 13.208 | 1.023 |
| write-heavy | 10000 | baseline | 1.000 | 1.001 | 0.982 |
| write-heavy | 10000 | collapse-only | 0.999 | 1.000 | 0.981 |
| write-heavy | 10000 | copy-on-write-only | 1.018 | 1.019 | 1.000 |
| write-heavy | 10000 | both | 1.000 | 1.001 | 0.982 |

## Verification and remaining acceptance

| Check | Result |
|---|---|
| Independent replay PR affected run | 52 files, 1012 tests passed, `--no-cache`; reducer remains byte-identical to upstream |
| Independent reducer PR affected run | 53 files, 1013 tests passed, `--no-cache`; compactor remains byte-identical to upstream |
| Generated replay checks | E9 and E10: 240 bounded cases each; seed and complete input on failure |
| Generated reducer checks | E7 and E8: 200 seeds each; lifecycle/plugin partitions and retained snapshots checked |
| Core TypeScript | Pre-split candidate passed. Fresh PR checkout checks remain uncertified: missing generated workspace package outputs prevent module resolution |
| Independent strict OpenSpec validation | Each PR change passed with its counterpart plan absent |
| Independent changed TypeScript Biome | 0 errors; replay PR: 1 inherited warning; reducer PR: 55 inherited warnings; shared harness: 0 diagnostics |
| E2E static checks | Pre-split TypeScript passed; fixture-import lint passed independently in both PRs |
| Pre-split production client build | Passed with guest-only `--max-old-space-size=4096`; no server restart or deployment |
| Independent code review | No concrete contract violation; final correction/benchmark/browser-test review: no findings |
| Repository-wide quality dependencies | Team-app typecheck: 8 errors; z-layer check: 10 diagnostic entries. Candidate output byte-identical to unchanged baseline |
| Broad repository test run | Partial only; interrupted with exit 130 after overlong Unix-socket paths in deeply nested temporary storage; real-process phase never started |
| Rendered replay/backfill F5 checks | Not run; Docker build service unavailable |

Replay E1–E9/P1/X1 live in `replay-compaction.test.ts`; F1/F2/E10 and payload reduction live in `replay-compaction-equivalence.test.ts`; F3 uses `subscription-handler-compaction.test.ts`; F4 connects the real server backfill response to `useMessageHandler.history-gap.test.tsx`. Reducer E1–E8/P1/P2/F1–F4/X1 live in `event-reducer.copy-on-write.test.ts` with independent lifecycle fixtures and the reviewed pre-change full-state snapshot.

P2 performance evidence is complete for the pair of optimized source modules. Each independent PR preserves only its own scenarios and task statuses. Rendered acceptance and baseline-only repository quality failures remain open. Neither change is archived or landed.

## Reproduction and artifacts

Run comparisons only in an owned disposable workspace. Restore both baseline modules from the pinned baseline revision as siblings named `replay-compaction.baseline.ts` and `event-reducer.baseline.ts`. Restore the optimized compactor from `perf/collapse-streaming-replay-snapshots` as `replay-compaction.candidate.ts`; restore the optimized reducer from `perf/copy-tool-state-on-write` as `event-reducer.candidate.ts`. Verify all source hashes above. Four explicit copies keep comparison independent of the feature present in the current checkout.

Use isolated short HOME/TMPDIR paths and run the checked-in `replay-performance.test.ts` through normal Vitest discovery with `--no-cache --maxWorkers=1`, `REPLAY_PERFORMANCE_COMPARE=1`, and `REPLAY_PERFORMANCE_OUTPUT` pointing to an owned disposable JSON path. Missing output paths fail the comparison. Remove all four temporary siblings afterward. Without comparison mode, the test checks current fixture values with production modules only; either optimization or neither may be present. Exact feature behavior remains covered by its own tests. Normal mode neither requires the other PR nor writes a result file.

Local supplementary artifact: `target/streaming-performance-prs/four-way.json` contains all 36 cells and 7 raw samples per cell. All median values, ratios, workloads and source hashes needed for review remain in this shared record.


## Shared four-way comparison (P2)

This section owns the shared comparison for both optimization plans.
Execute it before closing either plan's performance acceptance.
Both source candidates must exist; neither must merge first.
Use disposable source variants, not production feature flags or a personal Dashboard.

| Variant | Replay compactor | Reducer ownership |
|---------|------------------|-------------------|
| Baseline | Existing implementation | Existing eager copying |
| Collapse-only | Adjacent-tail compaction candidate | Existing eager copying |
| Copy-on-write-only | Existing implementation | Copy-on-write candidate |
| Both | Adjacent-tail compaction candidate | Copy-on-write candidate |

Pin source revisions and run the same fixture/benchmark harness in every variant.
Baseline includes existing finalized-prefix compaction; it is not an unprocessed raw-event path.
Hold raw events, initial state, plugins, replay encoding, runtime version and machine constant.
Use fixed timestamps and seeded fixture values.
Cover historical tool-map sizes 0, 1000 and 10000 with each of:
- An unfinished 100-snapshot text run with payloads from 1 through 100 KiB.
- A coherent interleaved thinking/tool/text workload containing adjacent text runs and singleton runs separated by retained events.
- A write-heavy workload with 1000 alternating starts/ends for 500 fresh tools and no eligible adjacent text run.

Record input counts, payload sizes and eligible-run distribution for every workload.
Record identical warmup/repetition counts and run ordering for all four cells.
Report median uninstrumented times for compaction, serialization, parsing, reduction and their total.
The total is the in-process pipeline, not network, rendering or phone reconnect latency.
Report retained event count and serialized event-array bytes.
Count core tool-map copies and entries enumerated in a separate instrumented pass; exclude independently allocating plugin work.
Record every cell, including unchanged or worse timings, with ratios against baseline and the other single-change variants.
Do not infer a measured speedup from deterministic count reductions.
Compare complete state values, including map entries and plugin fields, against baseline and independent fixture expectations, then after the same live continuation.
Store the comparison table with revision/environment/workload metadata in the change's maintained implementation evidence before marking P2 complete.
Both changes reference the same result; do not run duplicate comparisons merely to fill two task lists.
No machine-dependent speedup threshold is imposed.
