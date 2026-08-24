# heap-evidence — verify-subagent-pull-under-load

Recorded numbers for the four scenarios `reduce-subagent-details-payload`
shipped UNVERIFIED (F1, P4, P5, X1). Raw readings:
`openspec/changes/verify-subagent-pull-under-load/measurements.json`, written by
the specs themselves — this file transcribes, it does not restate from memory.

Cross-reference, NOT edited: the parent's archived evidence at
`openspec/changes/archive/2026-08-15-reduce-subagent-details-payload/heap-evidence.md`
§3 (inspector-open share, measured 0.0 % on an unwatched harness) and §4 (what
was not measured, and why). This change closes both gaps.

Environment: `docker/test-up.sh` all-in-one harness built from this worktree,
derived `dashboardPort` from `.pi-test-harness.json` (never `:18000`). Arm
`PI_E2E_SEED=1 PI_TEST_PEERS=both PI_SYNTH_AGENT_TICKS=1`; the push arm adds
`PI_DASHBOARD_SUBAGENT_STRIP=0` and is a SEPARATE harness start.

---

## 0. Substrate, and why it is not the real producer

`qa/fixtures/faux-agent-ticks.ext.ts` gained two additive, sentinel-gated
behaviours (`[[entries:<a>..<b>@<n>]]`, `[[bus:<ms>]]`): a timeline that grows
5 → 30 over ~3 s then PLATEAUS for ~9 s, and real `subagents:created/started/
completed` EventBus frames coalesced at 250 ms — the real producer's
`PROGRESS_THROTTLE_MS`.

The bus frames are the load-bearing part: the bridge's strip, its
`SubagentFrameBuffer`, and therefore the entire RESYNC path live on that
channel. A tick-only producer exercises none of it.

**Fidelity boundary.** This proves the bridge → server → client pull path. It
does NOT prove that `@blackbelt-technology/pi-dashboard-subagents` emits this
frame shape; that stays covered by the `subagent-spawn` faux scenario. The
boundary is stated in the fixture header too.

**Why not a real faux subagent:** a nested faux subagent dies after ~2 no-op
turns (its inner `createAgentSession` resolves a different faux core with an
empty response queue). Root-caused and written off upstream in
`reduce-bridge-tick-bandwidth`; the synthetic producer is that change's
established route-around.

---

## 1. F1 — a mounted inspector converges via the CADENCE

`tests/e2e/subagent-pull-under-load.spec.ts`. Inspector mounted before any entry
renders, never closed, no reload.

| observation | value |
|---|---|
| rendered count reached 30 **while the agent was still non-terminal** | yes |
| non-terminal PUSH frames observed | 102 |
| of those, carrying a timeline | **0** |
| resync REPLIES observed | 3 |
| outgoing `reason: "cadence"` requests | 2 |
| outgoing `reason: "open"` requests | 1 |
| max entries carried by ANY open-time reply | **5** (the timeline at mount) |
| max rendered entries at any sample | 30 (never exceeded) |
| terminal frame entry count | 30 |

**Anti-vacuity is by carrier exhaustion, not by a disable-run.** Four carriers
could have delivered 30 entries; three are excluded by measurement:

| carrier | excluded by |
|---|---|
| terminal frame (never stripped, always fat) | the assertion window closes while the agent is non-terminal — asserted, not assumed |
| fat push frames | 0 of 27 pushes carried a timeline (§1 table) |
| open-time resync (expand/popout + `App.tsx` subscribe — all three DO fire, since the RENDERED timeline is empty at mount) | excluded by CONTENT, not ordering: the open-time reply carried **5** entries — the timeline as it stood at mount — so it cannot explain a converged count of 30 |
| **cadence resync** | what remains — and asserted POSITIVELY: the converging reply's `__resyncRequestId` EQUALS a captured `reason: "cadence"` request id |

Token equality matters: mere ordering would be satisfied by a reconnect-driven
`open` reply.

A cadence-DISABLE falsifiability run was deliberately not used — no such knob
exists (`CADENCE_BASE_MS` is a module constant) and adding one is production
code this change is not allowed to write.

### F1 — observed, pinned, out of scope
On completion the finished Agent row is re-grouped into a tool-burst-group
header with **no reachable `Details` pill**, so the inline timeline unmounts.
That is grouping behaviour, not a timeline regression; F7 therefore asserts the
claim where it is decidable (terminal frame carries exactly 30; the rendered
count never exceeded 30) rather than asserting the grouping.

---

## 2. F4 — the anti-vacuity inversion (the arm that makes §1 mean anything)

Same workload, separate harness start, `PI_DASHBOARD_SUBAGENT_STRIP=0`:
non-terminal PUSH frames carry a timeline — **the §1 assertion inverts**.

Without this, "0 fat pushes" could equally mean "the fixture never produced a
timeline" or "the env switch is unwired and both arms are the same arm".

---

## 3. P4 — the cadence costs LESS than the push it replaced

All bytes read off the SAME browser `/ws` socket, per subscriber, classified by
`__resyncRequestId` (never by eventType — a reply and a pushed frame are both
`subagent_started`). N = 3 subscribers, 6 s window, `subagentTickThrottleMs`
identical in both arms.

| arm | quantity | median | spread |
|---|---|---|---|
| pull (strip ON) | resync-reply bytes/s | **1 059.8** | 9.7 |
| pull (strip ON) | its own stripped push bytes/s | 15 574.8 | 98.5 |
| push (strip OFF) | subagent-carrying push bytes/s, replies excluded | **53 229.2** | 425.5 |

**Bytes the strip actually removes** = 53 229 − 15 575 ≈ **37 654 B/s**.
**Pull cost** = **1 060 B/s**.

> **VERDICT: PASS — the pull path costs ~1/36th of the push traffic it removed.**
> Not inconclusive: the gap is ~36×, while the run-to-run spread is ≤ 425 B/s.
> The D4 v2 escalation is NOT triggered.

### 3a. Bus-cadence sensitivity — the verdict does not flip

The verdict is a function of how fast the PUSH carrier runs, so a single cadence
would report arithmetic on one fixture constant as if it were a property of the
pipeline. 250 ms is production-matched; 100/1000 ms are the flanks.

| bus interval | push removed (B/s) | pull (B/s) | ratio | verdict |
|---|---|---|---|---|
| 100 ms | 65 535 − 18 315 = 47 220 | 1 070 | 44× | pass |
| **250 ms (headline)** | 53 229 − 15 575 = 37 654 | 1 060 | **36×** | pass |
| 1000 ms | 47 337 − 14 372 = 32 965 | 1 050 | 31× | pass |

Pull cost is FLAT across the table (1 050–1 070 B/s) — as designed: the cadence is
one timer per subagent, not per frame. Reply rate held at 0.50/s in every arm.

### 3b. Harness ceiling (P1) — measured, not assumed

| subscribers | frames in a 6 s window |
|---|---|
| 1 | 145 |
| 3 | 143 |
| 5 | 143 |

Lossless to N = 5; the byte measurement ran at N = 3, comfortably inside it. A
saturated harness therefore cannot masquerade as a byte-rate result.

---

## 4. P5 — inspector-open share, WITH its watch pattern

The parent measured 0.0 % on a workload that never opened an inspector — the
unwatched arm by construction. A scripted harness cannot produce a
FIELD-representative number either: the share is whatever the pattern makes it.
So four patterns were run, each in its OWN browser context
(`__piSubagentInspectorTelemetry()` is a page-global cumulative aggregate and
`resetInspectorTelemetry` is not exposed on `globalThis`).

| arm | pattern | open / runtime | **realized share** |
|---|---|---|---|
| unwatched | never opened | 0 / 11 175 ms | **0.0 %** |
| glance | open at 25 % of runtime, hold 25 % | 3 055 / 17 292 ms | **17.7 %** |
| threshold | open at 25 % of runtime, hold 50 % | 6 071 / 20 311 ms | **29.9 %** |
| watched | open before the first entry, never closed | 12 003 / 12 051 ms | **99.6 %** |

Realized ≠ nominal for the two middle arms: the telemetry's denominator is the
subagent's WHOLE runtime, which the mount interaction itself extends (17.3 s and
20.3 s vs the fixture's 12 s). The realized figure is reported; the nominal one
would have been a fiction.

**C4 kill switch: NOT triggered.** No realistic watch pattern exceeded 50 %; only
the by-construction always-open arm did, at 99.6 %. What this run establishes is
that the signal is readable end-to-end and behaves monotonically across the watch
spectrum. **The field number still comes from the production counter** — this is
a harness reading, not a claim about real sessions.

---

## 5. X1 — killed mid-run with no terminal frame, then replayed

The parent's documented REGRESSION, previously unexercised anywhere.

Setup validity is asserted, not assumed: a resync reply is stored FAT (every
`event_forward` is persisted; replies are never stripped), so ONE resync during
the run would put a full timeline in the store and fail X1 for a reason unrelated
to the regression. The run is therefore UNWATCHED — no inspector, session never
selected (`App.tsx` resyncs every running empty-timeline subagent on subscribe).

| observation | value |
|---|---|
| outgoing resync requests before the kill | **0** |
| terminal frame observed before the kill | none |
| kill mechanism | `force_kill` (the container-level `SIGKILL` fallback was NOT needed) |
| replayed subagent frames | 8 |
| stored terminal frames for that agent | **0** |
| stored frames carrying a timeline | **0** |
| rendered timeline entries after replay | **0** |
| render blank or `subagent not found` | no |

`force_kill` closes the bridge WS BEFORE the signal, so socket silence proves
nothing; the assertions above are made on the STORED transcript the server
re-sends on subscribe (there is no list-events endpoint —
`GET /api/events/:sessionId/:seq` returns one event by exact seq).

**Pinned as observed:** the replayed card shows scalar state, no mid-run
timeline, and is neither blank nor error-rendered. This row pins CURRENT accepted
behaviour so it cannot drift silently; it does not claim the behaviour is
desirable.

*Known weak spot:* `lastObservedTickIndex` recorded −1 — the `(running… i)`
content is carried by the `tool_execution_update` carrier, which the replay
stream did not surface for this agent, so the tick index could not be recovered
post-kill. "The run had not reached its scripted end" therefore rests on the
pre-kill assertion that no terminal frame was seen plus the 0 stored terminal
frames, not on the index. Recorded rather than papered over.

---

## 6. What this change did NOT establish

- **Field-representative inspector-open share.** Structurally impossible from a
  scripted harness (§4). The production counter remains the only source.
- **Real-producer frame fidelity.** §0's boundary.
- **A pre-change baseline.** Not applicable — this change adds no production
  behaviour; both P4 arms are the same binary with one env var moved.

---

## 7. Transcription provenance

Every number above is transcribed from
`openspec/changes/verify-subagent-pull-under-load/measurements.json`, written by
the specs themselves. Medians and the push−pull subtraction are computed FROM
those rows, not restated from a console reading — an earlier revision of this
file was transcribed from a first run and then went stale when the specs were
re-run after review fixes, which a round-2 review caught. If the specs are re-run,
re-derive this file from the JSON rather than editing numbers in place.
