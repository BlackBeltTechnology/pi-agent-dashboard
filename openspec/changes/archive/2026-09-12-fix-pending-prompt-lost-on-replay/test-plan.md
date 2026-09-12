# Test Plan — fix-pending-prompt-lost-on-replay

Stage: design   Generated: 2026-09-11

Requirement refs: **R1** pending-prompt delivery resists back-pressure · **R2** on-demand resync · **R3** unanswered prompts survive a client state reset · **R4** desync detector — all in `specs/pending-prompt-recovery/spec.md`; **R5** resync protocol message · **R6** pending-prompt replay exemption — `specs/interactive-ui-dialogs/spec.md`; **R7** refresh restores an unanswered prompt — `specs/chat-refresh/spec.md`.

Resolved gaps (from the HARD gate): per-delivery cap = **4 frames**; absolute exemption ceiling = **5 MB** (`MAX_WS_BUFFER` + 1 MB); detector grace period = **5 s**.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1, R6 | BVA (at cap) | L1 | automated | 4 tracked pending prompts; stub ws `bufferedAmount` = 4 MB + 1 B | pending-prompt replay runs | all 4 frames reach `ws.send`; blocking-drop counter = 0 |
| E2 | R1 | BVA (cap + 1) | L1 | automated | 5 tracked pending prompts; `bufferedAmount` = 4 MB + 1 B | pending-prompt replay runs | exactly 4 sent; 1 dropped; blocking-drop counter = 1; transcript counter unchanged |
| E3 | R1 | BVA (ceiling) | L1 | automated | 1 pending prompt; `bufferedAmount` = 5 MB exactly, then 5 MB + 1 B | replay runs once per value | at 5 MB → sent; at 5 MB + 1 B → not sent, blocking counter +1 |
| E4 | R1 | EP (nominal) | L1 | automated | 1 pending prompt; `bufferedAmount` = 1 MB | replay runs | sent via the ordinary path; no counter of either class increments |
| E5 | R1 | decision table (frame class × buffer state) | L1 | automated | transcript `event` frame; `bufferedAmount` = 4 MB + 1 B | live broadcast | dropped; transcript counter +1; blocking counter unchanged |
| E6 | R6 | decision table | L1 | automated | retained notify log (3 rows); `bufferedAmount` = 4 MB + 1 B | `replayNotifyLog` runs | all 3 dropped and counted as transcript; no exemption applied |
| E7 | R2, R5 | state-transition (non-consuming token) | L1 | automated | requester token recorded; bridge reply carrying 2 prompts with that token | both replies routed | both delivered to the recorded socket only; token still resolvable after the first |
| E8 | R5 | BVA (TTL 30 s) | L1 | automated | token recorded at t0 | reply at t0+29.9 s, then a second token at t0+30.1 s | first → unicast to requester; expired → ordinary fan-out |
| E9 | R5 | fault (requester gone) | L1 | automated | token recorded, then requester socket closed (`forget`) | reply arrives | falls back to fan-out; no throw; registry size returns to 0 |
| E10 | R2 | EP (empty set) | L1 | automated | bridge `PromptBus.pending` empty | `prompt_resync_request` received | zero frames emitted; no error logged |
| E11 | R3 | decision table (status × reset kind) | L1 | automated | requests in states pending / answered / dismissed / cancelled | each of the 5 reset sites | only `pending` entries and their `ui-<id>` rows survive; the rest are absent |
| E12 | R3 | state-transition (all reset sites) | L1 | automated | one pending request in state | `event_replay` (firstSeq 1), `session_state_reset`, `useSessionState` applyReplay + reset, refresh reset | request + row present after each; no duplicate row |
| E13 | R3 | pairing invariant | L1 | automated | carried request whose prompt carried `toolCallId` | replay rebuilds the tool card, then reorder runs | `derivePendingFreeFloating` resolves the `toolCallId`; exactly one `ui-<id>` row |
| E14 | R4 | decision table (5 flags) | L1 | automated | `currentTool` ∈ {ask_user, Read} × request {present, absent} × replay {in-flight, idle} × session {active, ended} × grace {elapsed, not} | pure selector evaluated per cell | affordance true in exactly one cell (ask_user · absent · idle · active · elapsed) |
| E15 | R4 | BVA (grace 5 s) | L1 | automated | desync condition established, fake timers | advance 4.9 s, then 5.1 s | no affordance at 4.9 s; affordance at 5.1 s |
| E16 | R2 | EP (no bridge) | L1 | automated | session with no bridge connection | `prompt_resync_request` received | request dropped; existing pending registry unchanged (size before == after) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | R1, R6 | invariant under saturating replay | L1 | automated | 2000-event replay driving a non-draining stub socket past 4 MB, 1 pending prompt | blocking-frame drops = 0 **and** prompt frame observed after the last batch | one replay |
| P2 | R1, R2 | soak (bound proof) | L1 | automated | 100 sequential resync deliveries to a stalled socket that never drains | `bufferedAmount` never exceeds 5 MB + one frame; exempted bytes ≤ 1 MB total | 100 iterations |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R7, R1 | state-convergence | L3 | automated | harness session with an unanswered `ask_user` select prompt + enough replay volume to saturate | click the header refresh button | converges to exactly one rendered dialog with the original question and options |
| F2 | R3, R7 | state-transition (race) | L3 | automated | resync reply delivered while the full replay is still applying | replay completes | exactly one dialog present; no duplicate `ui-` row in the transcript |
| F3 | R2 | idempotence | L3 | automated | dialog rendered, `input`-type prompt with half-typed text | click refresh twice | still one dialog; the typed text is still there |
| F4 | R4 | state-convergence | L3 | automated | client state cleared out-of-band while the server still tracks the prompt | wait past the 5 s grace | resync affordance appears; activating it converges to the rendered dialog and the affordance disappears |
| F5 | R2 | multi-client isolation | L3 | automated | two browser contexts subscribed to the same session; context A requests a resync | A's reply routes | A renders the dialog; B's rendered state is byte-identical before/after |
| F6 | R3 | state-transition (answered) | L3 | automated | prompt answered, then refresh | replay rebuilds | no dialog reappears; the answer row remains |
| F7 | R4 | illegal edge | L3 | automated | ended session whose `currentTool` still reads `ask_user` | view the session past the grace period | no affordance shown |
| F8 | R4 | visual/subjective | — | manual-only | the resync affordance in the session view | human looks at placement + wording | [judgment: reads as "needs you", not as an error — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R7 | fault-injection (send fails) | L1 | automated | the resync send throws / socket closed | `refreshChat` invoked | transcript refresh still completes (reset + subscribe still issued); no unhandled rejection |
| X2 | R5 | mixed-version (old bridge) | L1 | automated | bridge build without the resync handler | `prompt_resync_request` forwarded | no reply, no error; server registry unchanged |
| X3 | R5 | fault-injection (unknown token) | L1 | automated | reply carries a token never recorded | routing runs | delivered via ordinary fan-out to subscribers; no throw |
| X4 | R2 | race (answer vs resync) | L1 | automated | prompt answered while a resync is in flight | reply arrives for the resolved id | client holds no dialog for it (dismiss/answer wins); bridge ignores a late answer for an unknown id |
| X5 | R2 | fault-injection (bridge death) | L3 | automated | bridge process killed while a prompt is pending | user activates the resync affordance | no dialog appears; the session surfaces its disconnected state rather than hanging silently |
| X6 | R1 | fault-injection (closed socket) | L1 | automated | target ws `readyState` ≠ OPEN | pending-prompt replay runs | no send attempted; no counter corruption; no throw |

---

## Coverage summary

- Requirements covered: 7/7 (R1–R7)
- Scenarios by class: edge 16 · perf 2 · frontend 8 · error 6 (32 total)
- Scenarios by level: L1 24 · L2 0 · L3 7 · manual-only 1
- Scenarios by disposition: automated 31 · manual-only 1

No L2 rows: nothing in this change touches install, spawn, or multi-OS runtime behaviour.

## New infra needed

- **Saturation + large-session seeding for L3.** F1/F2 need a harness session with enough replay volume to push a real browser socket past 4 MB. `docker/test-up.sh` seeding does not currently produce that, and no existing spec forces back-pressure. Either a seeding helper (bulk event injection) or a test-only knob to lower `MAX_WS_BUFFER` for one harness run is required; prefer the knob, since it keeps the scenario fast and does not change production defaults. Decide during apply, before authoring F1.
- **Out-of-band client state clearing for F4.** The desync condition needs the client to lose `interactiveRequests` while the server keeps tracking. With the carry fix in place this no longer happens naturally, so F4 needs a deliberate hook (e.g. evaluate a state reset in the page context).
- Everything else extends existing suites (`packages/server/src/**/__tests__/`, `packages/client/src/**/__tests__/`, `packages/extension/src/**/__tests__/`, `tests/e2e/`).
