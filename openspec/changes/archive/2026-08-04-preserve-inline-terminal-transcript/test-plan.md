# Test Plan — preserve-inline-terminal-transcript

Stage: design   Generated: 2026-05-19

All clarifications resolved before generation (C1 `TOMBSTONE_CAP`=64 · C2 budget=75 % of ceiling → 15 000 B · C3 `released` TTL 60 s · C4 unsafe-config predicate `maxStringFieldSize*6 >= ceiling` · C5 marker `…[N chars hidden]…` · C6 close→frozen p95 < 500 ms). No open gaps.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Transcript size bound | BVA | L1 | automated | transcript serializing to exactly 15 000 B | `capTranscript(s, 15000)` | returned verbatim, no marker, byte size == 15 000 |
| E2 | Transcript size bound | BVA | L1 | automated | transcript serializing to 15 001 B | `capTranscript(s, 15000)` | result starts `…[N chars hidden]…\n`, serialized size ≤ 15 000, tail chars preserved |
| E3 | Transcript size bound | BVA | L1 | automated | 14 999 B ASCII transcript | `capTranscript` | verbatim, no marker |
| E4 | Transcript size bound (byte-vs-unit) | EP | L1 | automated | 15 000 CJK code units (~45 000 B serialized) | `capTranscript(s, 15000)` | serialized size ≤ 15 000 B — i.e. it truncates, proving unit is bytes not `length` |
| E5 | Transcript size bound (byte-vs-unit) | EP | L1 | automated | 8 000 code units of ESC-dense ANSI (~48 000 B serialized) | `capTranscript(s, 15000)` | serialized size ≤ 15 000 B |
| E6 | Transcript size bound | BVA | L1 | automated | empty string | `capTranscript` | returns `""`, no marker |
| E7 | Transcript size bound | BVA | L1 | automated | transcript one byte over budget where the marker itself is longer than the overflow | `capTranscript` | result including marker still ≤ budget (marker counted inside) |
| E8 | Transcript survives PTY exit — retention bounded | BVA | L1 | automated | 64 dead ephemeral terminals with retained transcripts | spawn+exit a 65th | oldest id's `getTranscript` returns `""`; newest 64 all return content |
| E9 | Transcript survives PTY exit — retention bounded | BVA | L1 | automated | exactly 64 dead ephemeral terminals | read all | all 64 return their content (no premature eviction) |
| E10 | Ephemeral-only retention | decision-table | L1 | automated | one ephemeral + one non-ephemeral terminal, both exit | `getTranscript` on each | ephemeral returns content; non-ephemeral returns `""` |
| E11 | Ephemeral-only retention | decision-table | L1 | automated | 100 non-ephemeral terminals spawn+exit, then 1 ephemeral spawn+exit | read the ephemeral id | returns content — tab churn did not consume retention capacity |
| E12 | Startup config validation | decision-table | L1 | automated | `maxStringFieldSize=0`, ceiling 20 000 | boot validation | passes |
| E13 | Startup config validation | BVA | L1 | automated | `maxStringFieldSize=3334`, ceiling 20 000 (3334×6=20 004 ≥ ceiling) | boot validation | fails with a diagnostic naming both values |
| E14 | Startup config validation | BVA | L1 | automated | `maxStringFieldSize=3333`, ceiling 20 000 (19 998 < ceiling) | boot validation | passes |
| E15 | Startup config validation | EP | L1 | automated | `maxEventDataSize=0` (size pass disabled) | boot + derive budget | budget == 0.75 × DEFAULT (15 000), not 0 |
| E16 | Untouched cards removed — client predicate | EP | L1 | automated | `inline_terminal_close` with `transcript:""` | reduce | no `inlineTerminal` row in `state.messages` |
| E17 | Untouched cards removed — client predicate | EP | L1 | automated | close with a transcript of a single ANSI-decorated prompt line (non-empty string) | reduce | row IS frozen — proves no text inspection is applied |
| E18 | Untouched cards removed — client predicate | EP | L1 | automated | close with `transcript:"   \n\n"` (whitespace only, non-empty) | reduce | row IS frozen — proves no whitespace analysis |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Close-to-frozen latency | tail-latency | L3 | automated | inline terminal with a full 256 KB scrollback buffer, close via ✕ | p95 < 500 ms from click to frozen read-only card rendered | 20 iterations |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Transcript survives PTY exit | state-transition | L3 | automated | inline terminal, user runs `ls`, then types `exit` | click ✕ after the shell has exited | card converges to frozen read-only showing the pre-exit scrollback — the flagship repro |
| F2 | Untouched cards removed | state-transition | L3 | automated | inline terminal opened via bare `!!`, nothing typed | click ✕ | no card remains in the chat stream; no "Terminal closed" placeholder |
| F3 | Untouched cards removed — multi-line prompt | state-transition | L3 | automated | shell configured with a 3-line prompt, nothing typed | click ✕ | card removed (line count is irrelevant to the predicate) |
| F4 | Untouched cards removed — single-line interaction | state-transition | L3 | automated | user types only `exit` | click ✕ | card frozen, NOT removed |
| F5 | Untouched cards removed — non-printing input | state-transition | L3 | automated | user presses only arrow keys / Tab | click ✕ | card frozen, NOT removed (input tracked, not inferred from text) |
| F6 | Untouched cards removed — resize is not input | state-transition | L1 | automated | terminal receives only a `{"type":"resize"}` control frame | close | treated as never-interacted; emitted transcript `""` |
| F7 | Empty close suppressed on replay | state-convergence | L3 | automated | session containing `open` + empty `close` | page reload | replayed chat contains no inline terminal card at that position |
| F8 | Closed terminal renders frozen on replay | state-convergence | L3 | automated | session containing `open` + non-empty `close` | page reload | card renders frozen with the stored transcript, at its original stream position |
| F9 | Live and replay payloads identical | state-convergence | L3 | automated | two browsers on one session; one stays connected, one reloads after the close | close the card | both reduce to identical card state and identical transcript bytes |
| F10 | Reattach live PTY (regression) | state-transition | L3 | automated | inline terminal live, PTY alive | page reload | card reconnects to `/ws/terminal/:id` and replays the ring buffer — unchanged by this change |
| F11 | Dead-PTY reattach (regression) | state-transition | L3 | automated | inline terminal never closed, PTY already dead | page reload | card shows the disconnected notice; no tombstone is consulted |
| F12 | Trim preserves the open/close pair | state-transition | L1 | automated | session buffer driven past `maxEventsPerSession` with an old inline `open`/`close` pair | trim runs | neither event dropped; reducing the trimmed buffer places the card at its original position |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Close event survives the store ceiling | fault-injection (oversize) | L1 | automated | scrollback far exceeding the ceiling, mixed CJK + emoji + ANSI | close → insert through a real `createMemoryEventStore` with production args (`maxStringFieldSize=0`, default `maxEventDataSize`) | stored event has `data.terminalId` intact, `data.transcript` non-empty, no `__truncated` field — **acceptance gate** |
| X2 | Dead-terminal removal semantics unchanged | state-transition | L1 | automated | ephemeral terminal | PTY exits | `list()` excludes id, `get(id)` undefined, `attach(id, ws)` throws, `options.onExit` invoked |
| X3 | Transcript survives PTY exit — kill fallback | fault-injection (delay) | L1 | automated | mock PTY that never fires `onExit` (Windows ConPTY failure mode) | `kill()`, wait past the 3 s fallback | retained transcript present and capped; removal semantics as X2 |
| X4 | Second exit path cannot resurrect | fault-injection (late event) | L1 | automated | killed terminal whose fallback completed, card then closed | late real `onExit` fires afterwards | no retained transcript exists for that id |
| X5 | Release suppression is order-independent | state-transition | L1 | automated | release requested while PTY still alive | PTY exits afterwards | no retained transcript written |
| X6 | Suppression outlives the fallback window | state-transition | L1 | automated | released id, clock advanced 59 s | late `onExit` | suppression still in force, no tombstone written |
| X7 | Suppression records self-drain | state-transition | L1 | automated | released id, clock advanced past 60 s TTL | sweep | record reclaimed; set does not grow unboundedly |
| X8 | Close idempotency | state-transition | L1 | automated | already-closed inline terminal | second `close_inline_terminal` | no second event emitted; first frozen card unaffected live and on replay |
| X9 | Close idempotency — concurrency | fault-injection (race) | L1 | automated | two browsers close the same card; second arrives while the PTY is still terminating (entry still live) | both closes | exactly one `inline_terminal_close` emitted; live transcript == replay transcript |
| X10 | Close for unknown terminal | fault-injection (bad input) | L1 | automated | close for a terminal id that never existed | close | nothing stored, nothing broadcast, no throw |
| X11 | Evicted tombstone degrades gracefully | fault-injection (eviction) | L1 | automated | retained transcript evicted before the card is closed | close | emits `inline_terminal_close` with `transcript:""`, does not throw; client removes the card |
| X12 | Client guard against destructive empty close | fault-injection (bad event) | L1 | automated | row already frozen with non-empty content | an `inline_terminal_close` with `transcript:""` for that id | frozen row retains its transcript (not removed) |
| X13 | Close after eviction + double close | fault-injection (combined) | L1 | automated | card closed, tombstone released, then a duplicate close | duplicate close | no event; card content preserved — guards compose |

---

## Coverage summary

- Requirements covered: 9/9 (transcript-survives-exit · ephemeral-only retention · retention bounded · release order-independence · close idempotency · transcript size bound · startup config validation · untouched-cards-removed · close-to-frozen latency; plus the two modified requirements: lifecycle events / store-safety / trim-essential, and reattach)
- Scenarios by class: edge 18 · perf 1 · frontend 12 · error 13
- Scenarios by level: L1 30 · L2 0 · L3 14
- Scenarios by disposition: automated 44 · manual-only 0

## New infra needed

None. L1 extends `packages/server/src/__tests__/terminal-manager.test.ts`, `inline-terminal-handler.test.ts`, `memory-event-store.test.ts`, and `packages/client/src/lib/__tests__/event-reducer.inline-terminal.test.ts`. L3 extends `tests/e2e/` against the docker harness on its derived `dashboardPort` from `.pi-test-harness.json` (never a hardcoded `:18000`). No L2 rows: nothing here is install/process/multi-OS in nature — the Windows ConPTY failure mode is covered deterministically at L1 (X3) via the existing mock-PTY pattern rather than needing a real Windows VM.
