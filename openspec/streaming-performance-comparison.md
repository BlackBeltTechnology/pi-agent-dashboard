# Shared streaming-performance comparison

**Full replay acceptance remains open.** Completed and unfinished cold-browser replay scenarios and both live-tool backfill scenarios pass on the host.
An existing mid-turn reconnect scenario instead reaches the sign-in page; its cause and baseline behavior remain unverified.
No phone or network speedup is measured.

The shared P2 four-way comparison is complete. These are synthetic in-process timings, not network, rendering, or phone reconnect measurements.

## Method and pinned sources

Run: 2026-11-13. Runtime: Node v24.16.0; linux/x64; AMD Ryzen 7 7700X 8-Core Processor; 8 available CPU threads.

Baseline module bytes match `develop@upstream` at `e78b4c2c0474a8ab04941e76942e5a5b9d92c2d6`. Source SHA-256 values below pin the measured baseline, optimized modules and harness independently of temporary workspace revision IDs. Each PR contains one optimized production module; both contain this record and the same test-only comparison harness.

| Source | Candidate SHA-256 |
|---|---|
| `packages/server/src/session/replay-compaction.ts` | `e24dfb41ab9f61115f28d920640412c5fac975a0de381f363397157b18f39963` |
| `packages/client/src/lib/chat/event-reducer.ts` | `7ce66f46ee16588da1693d4f2577843d1626af705d05c9c2355b6a1e763c0e74` |
| `packages/server/src/__tests__/replay-performance.test.ts` | `c4dafc3f898b2eabe4076b14ac3e319ee88f613523a6a84962cad1fcd71f5f93` |

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

Every cell checks complete state against baseline plus independent text/tool/thinking expectations, then applies identical live continuation and finalization.
The corrected continuation adds a thinking start/delta/end and requires its row to have `streamedLive: true`.
Both candidate and reference folds explicitly pass `{ isLive: true }`; omitting the option makes the regression fail.
All 36 cells and the timing tables are rerun with this corrected harness on 2026-11-13. Equality includes map entries and plugin fields without normalization. Generated correctness suites separately exercise registered subagent state and callback re-entry.

## Largest-map comparison

Median total milliseconds, 10000 historical tools:

| Workload | baseline | collapse-only | copy-on-write-only | both |
|---|---:|---:|---:|---:|
| text | 111.824 | 2.015 | 14.454 | 0.262 |
| interleaved | 44.786 | 21.093 | 1.907 | 1.833 |
| write-heavy | 956.471 | 965.137 | 948.073 | 954.641 |

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
| text | 0 | baseline | 0.006 | 14.141 | 2.005 | 0.096 | 17.292 | 101 | 0 |
| text | 0 | collapse-only | 0.047 | 0.230 | 0.067 | 0.007 | 0.346 | 2 | 0 |
| text | 0 | copy-on-write-only | 0.006 | 13.231 | 3.358 | 0.079 | 16.670 | 0 | 0 |
| text | 0 | both | 0.046 | 0.193 | 0.053 | 0.006 | 0.298 | 0 | 0 |
| interleaved | 0 | baseline | 0.002 | 0.029 | 0.049 | 0.031 | 0.116 | 46 | 13 |
| interleaved | 0 | collapse-only | 0.006 | 0.015 | 0.027 | 0.021 | 0.083 | 24 | 13 |
| interleaved | 0 | copy-on-write-only | 0.003 | 0.022 | 0.049 | 0.022 | 0.121 | 2 | 1 |
| interleaved | 0 | both | 0.006 | 0.014 | 0.023 | 0.010 | 0.055 | 2 | 1 |
| write-heavy | 0 | baseline | 0.029 | 0.899 | 0.806 | 12.225 | 13.811 | 1001 | 250000 |
| write-heavy | 0 | collapse-only | 0.035 | 0.848 | 0.807 | 11.494 | 13.147 | 1001 | 250000 |
| write-heavy | 0 | copy-on-write-only | 0.031 | 0.887 | 0.775 | 11.460 | 13.197 | 1000 | 250000 |
| write-heavy | 0 | both | 0.037 | 0.898 | 0.778 | 11.546 | 13.651 | 1000 | 250000 |
| text | 1000 | baseline | 0.003 | 13.287 | 1.306 | 4.037 | 18.676 | 101 | 101000 |
| text | 1000 | collapse-only | 0.036 | 0.192 | 0.040 | 0.098 | 0.364 | 2 | 2000 |
| text | 1000 | copy-on-write-only | 0.003 | 13.482 | 1.332 | 0.058 | 15.028 | 0 | 0 |
| text | 1000 | both | 0.033 | 0.182 | 0.034 | 0.005 | 0.249 | 0 | 0 |
| interleaved | 1000 | baseline | 0.001 | 0.027 | 0.043 | 1.800 | 1.860 | 46 | 46013 |
| interleaved | 1000 | collapse-only | 0.002 | 0.017 | 0.029 | 0.967 | 1.016 | 24 | 24013 |
| interleaved | 1000 | copy-on-write-only | 0.001 | 0.024 | 0.043 | 0.104 | 0.173 | 2 | 2001 |
| interleaved | 1000 | both | 0.002 | 0.015 | 0.028 | 0.087 | 0.134 | 2 | 2001 |
| write-heavy | 1000 | baseline | 0.016 | 0.708 | 0.787 | 58.428 | 59.941 | 1001 | 1251000 |
| write-heavy | 1000 | collapse-only | 0.020 | 0.708 | 0.781 | 60.426 | 61.899 | 1001 | 1251000 |
| write-heavy | 1000 | copy-on-write-only | 0.014 | 0.731 | 0.809 | 57.497 | 59.032 | 1000 | 1250000 |
| write-heavy | 1000 | both | 0.018 | 0.697 | 0.796 | 55.891 | 57.373 | 1000 | 1250000 |
| text | 10000 | baseline | 0.004 | 12.996 | 1.283 | 97.775 | 111.824 | 101 | 1010000 |
| text | 10000 | collapse-only | 0.039 | 0.179 | 0.044 | 1.739 | 2.015 | 2 | 20000 |
| text | 10000 | copy-on-write-only | 0.005 | 13.072 | 1.278 | 0.053 | 14.454 | 0 | 0 |
| text | 10000 | both | 0.042 | 0.176 | 0.037 | 0.008 | 0.262 | 0 | 0 |
| interleaved | 10000 | baseline | 0.005 | 0.033 | 0.058 | 44.682 | 44.786 | 46 | 460013 |
| interleaved | 10000 | collapse-only | 0.011 | 0.032 | 0.055 | 20.995 | 21.093 | 24 | 240013 |
| interleaved | 10000 | copy-on-write-only | 0.007 | 0.043 | 0.069 | 1.792 | 1.907 | 2 | 20001 |
| interleaved | 10000 | both | 0.009 | 0.028 | 0.043 | 1.759 | 1.833 | 2 | 20001 |
| write-heavy | 10000 | baseline | 0.014 | 0.707 | 0.741 | 955.013 | 956.471 | 1001 | 10260000 |
| write-heavy | 10000 | collapse-only | 0.019 | 0.715 | 0.756 | 963.634 | 965.137 | 1001 | 10260000 |
| write-heavy | 10000 | copy-on-write-only | 0.015 | 0.700 | 0.737 | 946.612 | 948.073 | 1000 | 10250000 |
| write-heavy | 10000 | both | 0.019 | 0.698 | 0.739 | 953.167 | 954.641 | 1000 | 10250000 |

## Ratios for every cell

Each ratio is reference median total / row median total. Values above 1 mean the row is faster. Unchanged and worse cells remain included.

| Workload | Historical tools | Variant | baseline / row | collapse-only / row | copy-on-write-only / row |
|---|---:|---|---:|---:|---:|
| text | 0 | baseline | 1.000 | 0.020 | 0.964 |
| text | 0 | collapse-only | 50.011 | 1.000 | 48.213 |
| text | 0 | copy-on-write-only | 1.037 | 0.021 | 1.000 |
| text | 0 | both | 58.064 | 1.161 | 55.976 |
| interleaved | 0 | baseline | 1.000 | 0.717 | 1.049 |
| interleaved | 0 | collapse-only | 1.395 | 1.000 | 1.463 |
| interleaved | 0 | copy-on-write-only | 0.954 | 0.684 | 1.000 |
| interleaved | 0 | both | 2.090 | 1.499 | 2.192 |
| write-heavy | 0 | baseline | 1.000 | 0.952 | 0.956 |
| write-heavy | 0 | collapse-only | 1.050 | 1.000 | 1.004 |
| write-heavy | 0 | copy-on-write-only | 1.046 | 0.996 | 1.000 |
| write-heavy | 0 | both | 1.012 | 0.963 | 0.967 |
| text | 1000 | baseline | 1.000 | 0.019 | 0.805 |
| text | 1000 | collapse-only | 51.349 | 1.000 | 41.318 |
| text | 1000 | copy-on-write-only | 1.243 | 0.024 | 1.000 |
| text | 1000 | both | 74.912 | 1.459 | 60.277 |
| interleaved | 1000 | baseline | 1.000 | 0.546 | 0.093 |
| interleaved | 1000 | collapse-only | 1.831 | 1.000 | 0.171 |
| interleaved | 1000 | copy-on-write-only | 10.724 | 5.856 | 1.000 |
| interleaved | 1000 | both | 13.856 | 7.567 | 1.292 |
| write-heavy | 1000 | baseline | 1.000 | 1.033 | 0.985 |
| write-heavy | 1000 | collapse-only | 0.968 | 1.000 | 0.954 |
| write-heavy | 1000 | copy-on-write-only | 1.015 | 1.049 | 1.000 |
| write-heavy | 1000 | both | 1.045 | 1.079 | 1.029 |
| text | 10000 | baseline | 1.000 | 0.018 | 0.129 |
| text | 10000 | collapse-only | 55.505 | 1.000 | 7.175 |
| text | 10000 | copy-on-write-only | 7.736 | 0.139 | 1.000 |
| text | 10000 | both | 427.125 | 7.695 | 55.210 |
| interleaved | 10000 | baseline | 1.000 | 0.471 | 0.043 |
| interleaved | 10000 | collapse-only | 2.123 | 1.000 | 0.090 |
| interleaved | 10000 | copy-on-write-only | 23.487 | 11.062 | 1.000 |
| interleaved | 10000 | both | 24.432 | 11.507 | 1.040 |
| write-heavy | 10000 | baseline | 1.000 | 1.009 | 0.991 |
| write-heavy | 10000 | collapse-only | 0.991 | 1.000 | 0.982 |
| write-heavy | 10000 | copy-on-write-only | 1.009 | 1.018 | 1.000 |
| write-heavy | 10000 | both | 1.002 | 1.011 | 0.993 |

## Verification and remaining acceptance

| Check | Result |
|---|---|
| Independent replay PR affected run | 52 files, 1012 tests passed, `--no-cache`; reducer remains byte-identical to upstream |
| Independent reducer PR affected run | 53 files, 1013 tests passed, `--no-cache`; compactor remains byte-identical to upstream |
| Generated replay checks | E9 and E10: 240 bounded cases each; seed and complete input on failure |
| Generated reducer checks | E7 and E8: 200 seeds each; lifecycle/plugin partitions and retained snapshots checked |
| Core TypeScript | Pre-split candidate passed. Fresh independent core checks remain uncertified; the latest attempt exits 1 without diagnostics. Local workspace dependency links are required before broader suites can collect |
| Independent strict OpenSpec validation | Each PR change passed with its counterpart plan absent |
| Plugin-boundary regression | COW test imports use the existing test-support bridge; check passes with 25 existing allowed edges and no new allowlist row |
| Independent changed TypeScript Biome | 0 errors; replay PR: 1 inherited warning; reducer PR: 55 inherited warnings; shared harness: 0 diagnostics |
| E2E static checks | Pre-split and review-fix replay TypeScript pass; fixture-import lint passes independently in both PRs |
| Pre-split production client build | Passed with guest-only `--max-old-space-size=4096`; no server restart or deployment |
| Independent code review | No concrete contract violation; final correction/benchmark/browser-test review: no findings |
| Repository-wide quality dependencies | Team-app typecheck: 8 errors; z-layer check: 10 diagnostic entries. Candidate output byte-identical to unchanged baseline |
| Broad repository test run | Partial only; interrupted with exit 130 after overlong Unix-socket paths in deeply nested temporary storage; real-process phase never started |
| Original host replay browser suite | `coalesced-streaming.spec.ts`: 5 passed, 1 failed; completed cold-browser F5 passed |
| Review-fix cold-browser checks | Completed F5 and unfinished F6 pass; unchanged compactor fails F6 at the superseded-sequence assertion |
| Host reducer browser suite | `replay-live-tool-not-orphaned.backfill.spec.ts`: F15 and F16 passed; both verify a backfilled live Agent remains running, then completes once |

Replay E1–E9/P1/X1 live in `replay-compaction.test.ts`; F1/F2/E10 and payload reduction live in `replay-compaction-equivalence.test.ts`; F3 uses `subscription-handler-compaction.test.ts`; F4 connects the real server backfill response to `useMessageHandler.history-gap.test.tsx`. Reducer E1–E8/P1/P2/F1–F4/X1 live in `event-reducer.copy-on-write.test.ts` with independent lifecycle fixtures and the reviewed pre-change full-state snapshot.

P2 performance evidence is complete for the pair of optimized source modules.
Each independent PR preserves only its own scenarios and task statuses.
The broader replay reconnect failure, fresh-checkout typecheck and baseline-only repository quality failures remain open.
Neither change is archived or landed.

### Host browser acceptance, 2026-11-13

Replay source: `3c5bfb4be5defd79733ac8d972d271de8d1c7ad0`; reducer source: `386cfeebf2187466059ee3c4825131a594bf50a8`.
Their feature-module hashes match the table above; later PR commit-message changes do not change these patches.
Host runtime: Node 24.21.0, Chromium 156.0.8078.79, Docker Engine 29.8.0, Compose 5.7.1.
Both PR images build from their own source in separate disposable checkouts.
A temporary config imports the unchanged Playwright config and selects its first project's device settings, clears `channel`, and sets `launchOptions.executablePath=/usr/bin/chromium`.
`PW_CHANNEL=chromium` enables system-browser preflight mode.

The replay suite passes F1, new F5, F2, F3 and X4.
F4 at `tests/e2e/coalesced-streaming.spec.ts:250` waits 180 seconds for `coalesce stream complete` after `dropSocket(page)`.
Its captured page contains `Sign in to pi-dashboard` and `No sign-in method installed` instead.
No unchanged-baseline browser control was run; the failure is not attributed to compaction.
The reducer suite passes both dashboard-restart F15 and browser-reload F16 scenarios in `tests/e2e/replay-live-tool-not-orphaned.backfill.spec.ts`.
Both prove the Agent start arrives through backfill, preserve running status and finish with one completion.

Managed setup passes `--build` to `docker/test-up.sh`; it does not reuse an unbuilt candidate.
Replay uses foreground attach mode after its managed harness reaches health, with ports 18045/19045 and project `pi-dash-test-1112965045`.
The attach run sets `PW_E2E_USE_RUNNING=1`, `PW_E2E_PORT`, `PW_GATEWAY_PORT` and `PW_E2E_PROJECT`; an EXIT trap invokes scoped teardown from the owning temporary workspace.
Reducer runs in foreground managed mode with `PW_E2E_BOOT_TIMEOUT_MS=900000`, project `pi-dash-test-4061708999`.
Each run removes its own container, volumes, network and image; scoped Docker listings confirm no remaining test containers.
Supplementary logs/screenshots live under `target/streaming-performance-prs/host-browser/`; this section preserves the decisive facts without those artifacts.

### Review corrections, 2026-11-13

The COW fixture imports real Agent finalizers through the existing test-support bridge, preserving the 25-edge plugin-boundary baseline without adding an exception.
Normal discovery after local workspace dependency linking passes 53 files / 1013 tests for COW and 52 files / 1012 tests for replay.
The live-continuation regression first fails with `streamedLive: false`; both corrected folds pass and the complete 36-cell comparison is rerun.

The new F6 browser scenario uses the existing detached RPC-session technique, not a tmux pane: tmux resumes stopped pane processes.
It observes adjacent eligible live snapshots, pauses the owned Pi process, and verifies that the actual cold replay contains no completion for that assistant response.
Deferred user-message ends remain allowed; the assertion distinguishes message roles.
Cold replay must omit the superseded original sequence, retain a later eligible snapshot, and render the frozen partial text once.
After resuming the process, the response completes once without a ghost bubble.
A negative control swaps only the compactor inside the disposable container to the unchanged implementation; F6 fails at the superseded-sequence assertion.
Restoring the candidate makes F5 and F6 pass; cleanup resumes and terminates the owned RPC group and removes the harness.
The existing broader F4 sign-in failure is not repaired by these test-only corrections.

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
