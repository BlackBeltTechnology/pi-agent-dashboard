# Test Plan — copy-tool-state-on-write

Stage: design   Generated: 2026-11-13

The acceptance oracle is unchanged event behavior plus isolation of retained maps, entries and nested arrays.
Assert concrete fixture values independently of the candidate, preserving existing text-flush and lifecycle guards.
P1 measures core ownership work only; independently allocating plugins remain supported.
P2 records timing and copy counts without a machine-dependent speed threshold.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | No-write sharing; design D1/D5 | BVA + decision table | L1 | automated | Tool maps of sizes 0 and 100; assistant text snapshots with streamingTextFlushed false and true; plugins absent or returning input | Reduce one text update | Map reference and entries remain unchanged; unflushed text updates, flushed text stays unchanged; prior state stays unchanged |
| E2 | Top-level lifecycle; design D1/D3 | State-transition | L1 | automated | 100 completed map entries and a read tool t1 with partial result partial and final result done | Apply tool_execution_start, update, and end separately, retaining every prior map and entry | Start and end create independent maps with t1 running then complete; ordinary partial update shares the map and changes the message-row result to partial; final row result is done; all earlier maps and entries remain unchanged |
| E3 | Per-invocation ownership; design D1/D2 | State-transition | L1 | automated | A tool-start result followed by a read-only text event and a later tool_execution_end for that tool | Retain all states while reducing the three events | Text event shares the start result's map; end creates a complete entry without changing either published running map or its entries |
| E4 | Nested writers; design D3 | State-transition | L1 | automated | Root codemode call, child and grandchild nested calls, retained root entry and nested arrays | Apply nested starts/updates/ends, root end, and a late real nested end using existing fixtures | Children attach to the root without top-level entries; expected nested statuses/results match existing fixtures; all earlier root records and arrays remain unchanged |
| E5 | Standalone seeding; design D3 | Decision table | L1 | automated | An empty map, an already-running call, and an elided row reported open by the server | Call seedRunningToolCall directly and through backfill seeding | Existing no-op cases retain identity; changed cases return an independent map with the running call; input map and row stay unchanged |
| E6 | Generic terminal handling; design D3/D4 | State-transition | L1 | automated | Running Agent row with missing/declining plugin and already-terminal tool/subagent fixtures | Apply agent_settled and session_ended heals | Expected neutral row heals and idle transition occur; real terminal outcomes remain unchanged; retained input maps/entries remain unchanged |
| E7 | Generated lifecycle/snapshot isolation; design D1–D3 | Seeded property-based | L1 | automated | Bounded valid generated tool lifecycles, nested calls, no-write events and allowed late heal/revive controls with annotated outcomes | Reduce each sequence while retaining every published map, entry and nested array | Independent lifecycle/row expectations hold after each action; prior snapshots stay unchanged; core no-write actions with absent/read-only plugins retain the input map |
| E8 | Generated callback/publication isolation; design D2/D4 | Seeded property-based | L1 | automated | Generated Agent completion/revive sequences and registered enabled, disabled, declining, read-only and independently map-copying finalizer partitions | Run real registered callbacks and synchronous opts.reduce re-entry, retaining callback inputs and returned maps through later events | Expected completion/revive outcomes and callback selection hold; nested and later writes cannot change retained views; independent plugin allocation remains allowed |

### Performance

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| P1 | Core allocation removal; design D5 | Deterministic work count | L1 | automated | Historical maps sized 0, 100, 1000, and 10000; fixed 1000-event text/thinking/no-op mix; plugins absent or returning input | Fold all events with scoped tool-map copy/iteration observation | Each fixture event retains its map reference; core ownership performs zero map copies and zero full-map enumerations; complete values match independent fixture expectations |
| P2 | Write-heavy comparison; design D5 | Paired measurement | L1 | automated | 10000 completed historical entries plus 1000 alternating start/end events for fresh read calls t1 through t500, with results done-1 through done-500 | Measure pre-change and candidate reductions on the same workload/environment, retaining the input and selected checkpoint maps | Record copy counts and elapsed time for both; final map has 10500 entries with t500 complete and row result done-500; retained input/checkpoint maps stay unchanged; apply no one-copy-per-event ceiling |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| F1 | Synchronous re-entry; design D2 | State-transition | L1 | automated | Registered subagent slice/finalizer; running Agent tool tc linked to ag-1 | Reduce subagent_completed with result R, retaining the outer input map and the map passed to opts.reduce | Outer input and callback view still show tc running; nested/returned tool map shows tc complete; completion result and plugin state match existing behavior |
| F2 | Revive undo and independent plugin maps; design D3/D4 | State-transition | L1 | automated | Elided or session-ended Agent row and terminal/nonterminal subagent fixtures from existing revive tests | Apply a live update through the registered finalizer | Allowed revives reopen; terminal-subagent finalizer return undoes false revive, including seeded-entry removal; prior and plugin-returned maps remain unchanged by later reductions |
| F3 | Plugin callback contract; design D4 | Decision table | L1 | automated | Enabled/disabled, declining/read-only and independently map-copying finalizers; live and replay modes | Reduce matching session/tool events and retain callback inputs, prior and return maps | Callback order/filtering/isLive/prior/return selection match existing expectations; read-only callbacks add no core ownership copy; plugin allocation remains allowed |
| F4 | Replay/live fold equivalence; verification baseline | State-transition | L1 | automated | Extend the existing mixed text/thinking/read burst with Agent tc-agent linked to ag-fold and subagent_completed with result R; retain legal batch split points | Fold in one pass and split passes, with live/replay options where existing semantics agree | Complete states equal a reviewed pre-change fixture, with tc-agent complete and ag-fold terminal with result R; whole/split folds agree and retained earlier maps/nested entries stay unchanged |
| F5 | Rendered backfill-to-live integration | State-convergence | L3 | automated | Existing faux subagent-long-stream-hold scenario with Agent start outside the replay window | Load earlier history, receive live progress and completion in the docker harness | Prove start arrived in backfill; card stays running rather than elided, then completes once; final transcript contains long stream hold complete once |

### Error-handling

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Late/invalid lifecycle guards; design D3/D4 | Illegal transitions | L1 | automated | Existing completed tool/subagent states and malformed/missing tool-name fixtures | Deliver late session_ended heals, late updates, and the existing malformed-name cases | Existing non-clobber/fallback outcomes remain unchanged; input maps and reachable entries remain unchanged |

## Generated-case contract (E7/E8)

Use ordinary Vitest assertions and a local seeded generator, following `packages/electron/src/lib/__tests__/peer-address-properties.test.ts`.
Do not add a PBT dependency or a shared generation framework.
Run at least 200 reproducible seeds per property with at most 64 actions and 64 initial completed tools per seed; bound nested depth to three.
Construct valid ids, parents and lifecycle transitions directly.
Deliberately include empty/nonempty maps, no-write streaks, writes after sharing, nested completion, allowed heal/revive paths and late real terminal events.
Record executed partition counts; do not discard most generated cases with validity filters.
Failures report seed and full input; reduce failures manually and retain the reduced case as an example regression.

For E7, annotate expected tool status, parent/nested membership and message-row result independently when constructing actions.
Check those values after each action as well as deep snapshots of all earlier maps and reachable entries/arrays.
Do not derive expected state from the candidate or substitute whole-fold/split-fold agreement for a lifecycle oracle.
Restrict input-map identity assertions to verified core no-write paths with absent or read-only plugins.
Retain the existing fixed full-state fixture in F4.

For E8, construct coherent variants of the registered callback/re-entry fixtures already used by F1–F3.
Vary tool/subagent ids, prior running/elided/terminal states, result payloads and callback partitions.
Retain outer input maps, maps passed to `opts.reduce`, and independently returned plugin maps, including their entries and nested arrays.
Check annotated completion/revive values and existing callback selection/order rules, then apply later events to expose stale ownership.
Do not impose a zero-copy rule on independently allocating plugins.

## Shared performance acceptance

The [replay plan's P2 comparison](../../streaming-performance-comparison.md#shared-four-way-comparison-p2) is required here as well.
It owns the baseline/collapse-only/copy-on-write-only/both matrix, common workloads, metrics and result metadata.
Keep this plan's P1/P2 local allocation and write-heavy checks; they do not replace that matrix.
Both source candidates must be available before performance acceptance closes, without requiring either to merge first.
Reference the same recorded result rather than duplicating the benchmark or its contract.

## Coverage summary

- Design decisions covered: 5/5.
- Local copy-on-write: E1–E3, P1.
- Publication and re-entry isolation: E3, F1, F2.
- Direct/indirect writers and nested entries: E2, E4–E6, F2, X1.
- Plugin contracts: E6, F1–F3.
- Performance acceptance: P1, P2 and the linked shared four-way comparison.
- Generated lifecycle/publication properties: E7, E8.
- Replay/render integration: F4, F5.
- Scenarios by class: edge 8 · performance 2 · frontend 5 · error 1.
- Scenarios by level: L1 15 · L3 1.
- Scenarios by disposition: automated 16 · manual-only 0.

## Harness routing

- `packages/client/src/lib/__tests__/event-reducer-streaming-text-flush.test.ts`: E1.
- `packages/client/src/lib/__tests__/event-reducer.test.ts`: E2, E3, E7, P1, P2.
- `packages/client/src/lib/__tests__/event-reducer.nested-tool-calls.test.ts`: E4.
- `packages/client/src/lib/__tests__/event-reducer.revive-elided.test.ts`: E5, F2.
- `packages/client/src/lib/__tests__/event-reducer.session-ended-heal.test.ts`: E6, X1.
- `packages/client/src/lib/__tests__/event-reducer.subagent-stream.test.ts`: E8, F1, F3.
- `packages/client/src/lib/__tests__/event-reducer.batch-fold-invariant.test.ts`: F4.
- `tests/e2e/replay-live-tool-not-orphaned.backfill.spec.ts`: F5.

## New infra needed

None.
Extend existing fixture builders, Vitest suites and docker-backed Playwright specs.
Use the harness-derived dashboard URL; do not target a running personal Dashboard.
