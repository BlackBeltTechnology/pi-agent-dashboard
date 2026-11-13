# Test Plan — collapse-streaming-replay-snapshots

Stage: design   Generated: 2026-11-13

Reference windows declare old-policy survivors with explicit fixture sequence lists, then retain every unfinished-tail snapshot.
Do not derive reference survivors from the candidate compactor.
Compare complete reducer states without normalization.
P1 checks event/byte counts over one complete fixture, not a latency target.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Adjacent snapshots; still-streaming tail | BVA | L1 | automated | Unfinished runs with 0, 1, or 2 eligible snapshots | Compact without a supplied boundary | Snapshot counts are 0, 1, or 1; the survivor is the original final object |
| E2 | Adjacent snapshots; design D1 | Decision table | L1 | automated | Three adjacent updates; vary the middle snapshot between string, empty string, empty array, text-only array, mixed text/thinking/tool/image array, non-assistant role, and missing full message | Compact each unfinished window | Eligible middle snapshots allow all three to collapse to the last; each ineligible middle event separates two singleton runs and all three survive |
| E3 | Adjacent snapshots; design D1 | Decision table | L1 | automated | Three otherwise eligible snapshots; middle metadata is absent, text_start, text_delta, text_end, thinking_start, or an unsupported type | Compact each unfinished window | Absent and the three text types permit one survivor; thinking and unsupported types preserve all three events |
| E4 | Original adjacency; design D2 | Decision table | L1 | automated | Two eligible snapshots separated by each thinking, tool-start/end, message-start/end, custom/plugin, stats, and session-compact event | Compact with explicit boundary 0, keeping this entire fixture non-superseded | All three original event objects survive in order; no run crosses the separator |
| E5 | Finalized-message policy; exemptions | State-transition | L1 | automated | A finalized assistant message with thinking and pre-tool text, followed by an unfinished 12-snapshot run | Compact using the derived boundary | Prefix survivors equal the fixture's explicit old-policy sequence list; thinking and tool-flush seeds survive; the tail retains only its final update |
| E6 | Explicit supersession boundary | BVA | L1 | automated | Five events: text a, text ab, thinking_start, text b, text bc; seqs 1 through 5 | Compact with boundary omitted, 0, 2, or 5 | Surviving seqs are respectively [2,3,5], [2,3,5], [3,5], and [3]; all boundary decisions use original indices |
| E7 | Idempotence; design D2 | State-transition | L1 | automated | No-boundary tail, tail with separators, and finalized-prefix plus tail fixtures | Compact twice in derived-boundary mode | Second output equals first output, including ordered seqs and original survivor references |
| E8 | Stored-data immutability; sequence ordering | Invariant | L1 | automated | Frozen input arrays/events for the unfinished cases and the existing seqs 1..100 finalized fixture with non-exempt updates 3..98 | Compact and inspect input plus survivors | Input values stay unchanged; survivors retain object identity, seq and relative order; finalized fixture remains [1,2,99,100] |
| E9 | Generated adjacency, original coordinates and immutability; design D2/D4 | Seeded property-based | L1 | automated | Bounded annotated runs and separators, payload/metadata eligibility partitions, sequence gaps, and omitted or explicit original-index boundaries | Compact frozen generated inputs; repeat derived-boundary cases | Original survivor references form an ordered subsequence; generated non-superseded tail matches the independent run annotations; input stays unchanged; derived-boundary mode is idempotent |
| E10 | Generated consumer equivalence; design D4 | Seeded property-based | L1 | automated | Coherent generated unfinished streams from valid empty/nonempty/flushed initial states, including growing, shrinking and empty snapshots | Reduce raw and compacted streams through the real reducer, then identical live continuation and message_end | Complete states agree at corresponding retained boundaries and after continuation; independent final-text and tool-lifecycle expectations hold |

### Performance

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| P1 | Repeated-payload reduction; design D5 | Deterministic work count | L1 | automated | 100 adjacent unfinished snapshots of 1 through 100 KiB | Compact once and serialize raw and compacted event arrays using the same replay encoding | Exactly one update remains, with the final payload; serialized bytes decrease; real reducer final state equals raw |
| P2 | Shared four-way performance acceptance; design D5 | Controlled factorial comparison | L1 | automated | Identical raw workloads and initial states across baseline, collapse-only, copy-on-write-only and both, using the shared comparison contract in test-plan.md | Execute the same benchmark harness against all four pinned disposable source variants | All four cells report phase timings, replay counts/bytes and core map work; complete state equals baseline and fixture expectations; performance acceptance remains open until the complete comparison exists |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| F1 | Complete unfinished-state equivalence; design D4 | State-transition | L1 | automated | Coherent unfinished text runs from empty/nonempty state and streamingTextFlushed=true, including abcdef then ab then a final empty string or empty text array | Reduce raw and compacted windows, then the same live text update and eventual message_end | Final survivor is the original final snapshot, including empty replacements; real reducer text is empty for the decreasing-to-empty fixture; complete states match before/after live continuation and message_end; flushed text is not repopulated |
| F2 | Retained-event equivalence; design D4 | State-transition | L1 | automated | Finalized prefix plus unfinished runs separated by thinking, tool lifecycle and registered subagent events | Reduce candidate and independently declared old-policy reference windows from identical initial state | Complete states match at each tail-run end and intervening tail event, including row ids/order, timestamps, tools and plugin-owned state |
| F3 | Replay-only storage; raw high-water cursor | State-convergence | L1 | automated | Stored message_start at seq 1 and 100 eligible updates at seqs 2..101 | Subscribe through the existing handler fixture | Replay retains seqs [1,101], raw store remains unchanged, and the handler passes raw cursor 101 to clearReplaying |
| F4 | Backfill boundary and loaded-history splice | State-convergence | L1 | automated | A middle range serving a previously untracked tool start reported open by the server, with no map entry in the loaded tail; separate variant serves an empty superseded slice | Check the server backfill response, then feed it through the existing client history-gap hook harness | Server prefix matches the old-policy reference; client adds the previously untracked running tool; servedFrom/gap credit advances for the empty-slice variant; loaded transcript matches the reference splice |
| F5 | Rendered replay non-regression | State-convergence | L3 | automated | A completed faux coalesce-multiparagraph session with eight numbered paragraphs | Reopen in a second browser context with empty IndexedDB using the docker harness | Each paragraph marker and coalesce stream complete appears once; no settled live-text bubble remains |

### Error-handling

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Conservative eligibility; design D1 | Invalid partitions | L1 | automated | Eligible snapshots separated by content containing null/non-text/missing-text blocks, null metadata, string metadata, or metadata with non-string type | Compact each unfinished window | Malformed middle event passes through unchanged without a compactor exception and prevents cross-event collapse |

## Generated-case contract (E9/E10)

Use ordinary Vitest assertions and a local seeded generator, following `packages/electron/src/lib/__tests__/peer-address-properties.test.ts`.
Do not add a PBT dependency or a shared generation framework.
Run at least 200 reproducible seeds per property with at most 64 generated events per seed.
Construct required partitions directly; record executed class counts rather than relying on rejection filters.
Failures report seed and full input; reduce failures manually and retain the reduced case as an example regression.

E9 constructs annotated eligible runs and separators before serializing events.
Expected tail survivors come from those annotations and the original boundary, not the candidate's eligibility helper.
Cover zero/single/multiple snapshots; string/text-array/empty replacements; supported/absent/unsupported/malformed metadata; mixed-content and non-assistant lookalikes; every separator family in E4; and boundaries at zero, end and inside a run.
Assert exact non-superseded-tail survivor indices, sequence gaps, original references and unchanged input values.
Assert idempotence only in derived-boundary mode.
Existing E5/E6 retain independent finalized-prefix and explicit-boundary expected sequences.

E10 generates coherent unfinished streams by construction rather than feeding malformed E9 cases into the reducer.
Use valid initial states produced by fixture preludes, including already-flushed text.
Generate text growth, shrinkage, empty replacement and later regrowth; interleave coherent thinking/tool segments and registered subagent cases.
Compare complete real-reducer states at corresponding retained run ends and separator boundaries, then after identical live continuation and finalization.
Also assert generator-annotated final text and tool outcomes so equality cannot pass solely because both sides omit a required update.
Retain existing fixed examples alongside generated checks.

## Shared four-way comparison (P2)

Canonical contract and measured results: [shared comparison](../../streaming-performance-comparison.md#shared-four-way-comparison-p2).

## Coverage summary

- Requirements covered: 7/7 replay delta requirements.
- Replay pass and exemptions: E5, F2, F3.
- Unfinished reconstruction: E1, F1.
- Sequences/order: E8, F3.
- Client-state equivalence: F1, F2, F4, F5.
- Explicit boundaries: E6, F4.
- Adjacent eligible snapshots: E1–E4, E7, X1.
- Input immutability and payload reduction: E8, P1, F3.
- Generated structural/consumer properties: E9, E10.
- Shared four-way comparison: P2.
- Scenarios by class: edge 10 · performance 2 · frontend 5 · error 1.
- Scenarios by level: L1 17 · L3 1.
- Scenarios by disposition: automated 18 · manual-only 0.

## Harness routing

- `packages/server/src/__tests__/replay-compaction.test.ts`: E1, E2, E3, E4, E5, E6, E7, E8, E9, X1.
- `packages/server/src/__tests__/replay-compaction-equivalence.test.ts`: P1, P2, E10, F1, F2.
- `packages/server/src/__tests__/subscription-handler-compaction.test.ts`: F3.
- `packages/server/src/__tests__/subscription-handler-backfill.test.ts` and `packages/client/src/hooks/__tests__/useMessageHandler.history-gap.test.tsx`: F4.
- `tests/e2e/coalesced-streaming.spec.ts`: F5.

## New infra needed

No new runtime infrastructure or dependency.
Extend existing fixture builders, Vitest suites and docker-backed Playwright specs.
Use temporary source variants and the same benchmark harness for P2; keep benchmark instrumentation outside the uninstrumented timing pass.
Use the harness-derived dashboard URL; do not target a running personal Dashboard.
