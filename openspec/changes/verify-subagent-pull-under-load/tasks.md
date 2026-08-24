## 1. Substrate — a watchable, growing subagent timeline (design V1)

- [ ] 1.1 Add an `[[entries:<start>..<end>]]` sentinel to
      `qa/fixtures/faux-agent-ticks.ext.ts` growing `details.entries` across the
      tick plan, each frame a FULL snapshot. Entry payloads fixed-size and small
      so the serialized snapshot stays far under the store's ~256 KiB
      `maxEventDataSize`.
- [ ] 1.2 Add a `[[bus:<intervalMs>]]` sentinel emitting `subagents:created`
      once, `subagents:started` coalesced at the interval (DEFAULT 250 ms, to
      match the real producer's `PROGRESS_THROTTLE_MS`), and
      `subagents:completed` at the end, via `pi.events.emit`. The bus cadence is
      decoupled from the tick interval.
- [ ] 1.3 Pin the run shape for F1: the timeline plateaus at the end count and
      the agent keeps emitting RUNNING frames for ≥ 3 cadence intervals
      (≥ ~6 s at `CADENCE_BASE_MS = 2000`) before the terminal frame. Tick
      interval, growth span and plateau hold are explicit fixture numbers.
- [ ] 1.4 Add the `subagent-watched-growth` faux scenario to
      `qa/fixtures/faux-scenarios.ts` driving the extended producer.
- [ ] 1.5 Add a `PI_DASHBOARD_SUBAGENT_STRIP` passthrough to
      `docker/compose.test.yml` and `docker/test-entrypoint.sh`; update
      `docker/AGENTS.md`.
- [ ] 1.6 Generalize `collectAgentTicks` (`tests/e2e/helpers/index.ts`):
      classify `subagent_*` frames, capture `__resyncRequestId`, capture
      OUTGOING frames via `ws.on("framesent")` (with their `reason` +
      `requestId`), and attribute bytes PER FRAME rather than per event inside a
      batch (today's `payload.length` per event over-counts batches N×). Keep
      the existing `TickSample` / `agentRate` contract intact for
      `subagent-tick-throttle.spec.ts`.

## 2. L1 — fixture contract (test-plan E1–E6)

Exemplar for all of §2: `packages/server/src/__tests__/faux-agent-ticks.unit.test.ts`.

- [ ] 2.1 E1: no `[[entries:]]` sentinel · parse the growth plan · plan absent
      and every frame carries `entries: []`, byte-identical to today
      (test-plan #E1).
- [ ] 2.2 E2: `[[entries:5..30]]`, `0..0`, `30..5`, malformed, absurdly large ·
      parse · 5..30 accepted, 0..0 always-empty, start>end and malformed fall
      back to no-growth, count clamps with no unbounded loop (test-plan #E2).
- [ ] 2.3 E3: each emitted bus frame (`created`/`started`/`completed`) · frame
      construction · top-level `data.id === details.agentId` on all three (the
      key `SubagentFrameBuffer.agentIdOf` reads) (test-plan #E3).
- [ ] 2.4 E4: the `subagents:created` frame · frame construction ·
      `details.entries` empty, because `"created"` is not in
      `NON_TERMINAL_STATUSES` and a fat `created` frame would forward unstripped
      (test-plan #E4).
- [ ] 2.5 E5: the full frame sequence for `[[entries:5..30]]` · replay it · every
      `entries` is a FULL snapshot and a prefix-superset of its predecessor —
      no delta encoding leaked in (test-plan #E5).
- [ ] 2.6 E6: `[[bus:]]` absent / `250` / `0` / out-of-range · parse · default
      250 ms, clamped bounds, interval independent of the tick interval
      (test-plan #E6).

## 3. L3 — substrate guard, the pull path is what runs (test-plan E7, F2–F4)

Exemplar for all of §3–§6: `tests/e2e/subagent-tick-throttle.spec.ts` (same
`PI_SYNTH_AGENT_TICKS=1` gated arm, same harness bring-up + derived port).

- [ ] 3.1 New `tests/e2e/subagent-pull-under-load.spec.ts`, self-skipping unless
      `PI_SYNTH_AGENT_TICKS=1`, with the harness bring-up documented in the
      header.
- [ ] 3.2 E7: the existing `synthetic-agent-ticks` scenarios (no new sentinels) ·
      run `subagent-tick-throttle.spec.ts` unchanged · every row still passes and
      no `subagents:*` bus traffic is observed — the emission is fully
      sentinel-gated (test-plan #E7).
- [ ] 3.3 F2: the watched run · every `/ws` frame for the watched `agentId`
      WITHOUT `__resyncRequestId` while non-terminal · carries no or empty
      `entries` (test-plan #F2).
- [ ] 3.4 F3: the watched run · at least one `/ws` frame WITH
      `__resyncRequestId` · carries a NON-empty `entries` (test-plan #F3).
- [ ] 3.5 F4: the same run on a SEPARATE harness start with
      `PI_DASHBOARD_SUBAGENT_STRIP=0` · same observation as F2 · the assertion
      INVERTS (pushes fat). Do not record any §4–§6 measurement until this
      inverts (test-plan #F4).

## 4. L3 — F1 convergence with carrier attribution (test-plan F1, F5–F7)

- [ ] 4.1 F1: `[[entries:5..30]]` with the inspector mounted before any entry
      renders and never closed · timeline grows to 30 then plateaus · the
      RENDERED count reaches 30 while the agent is still non-terminal, no
      close/reopen, no reload (test-plan #F1).
- [ ] 4.2 F5: outgoing frames via `framesent` · the cadence fires while mounted ·
      ≥ 1 request with `reason: "cadence"`, and the reply carrying ≥ 30 entries
      has `__resyncRequestId` EQUAL to that request's `requestId` — token
      equality, not ordering (test-plan #F5).
- [ ] 4.3 F6: the `reason: "open"` requests (expand/popout + `App.tsx`
      subscribe — all three DO fire, the rendered timeline is empty at mount) ·
      the last `open` request on `framesent` · the DOM passes a count strictly
      greater than the timeline could hold at that request's bridge-handling
      time, with one bus interval + RTT slack (test-plan #F6).
- [ ] 4.4 F7: the same run allowed to complete · terminal `subagents:completed`
      after the plateau · the rendered count stays 30, no regression or
      duplication (test-plan #F7).

## 5. L3 — X1, killed mid-run and replayed (test-plan X1–X4)

- [ ] 5.1 X2: setup validity · the run is driven via the API with the session
      NEVER selected in the client · ZERO outgoing `subagent_resync_request` for
      that `agentId` before the kill (a stored FAT reply would fail X1 for the
      wrong reason) (test-plan #X2).
- [ ] 5.2 X1: pi killed mid-run · `force_kill` while the tick plan is
      unexhausted, then replay · scalar state renders, NO mid-run timeline, card
      neither blank nor error-rendered; the observed badge/finalize state is
      recorded on the first run and pinned as the baseline (test-plan #X1).
- [ ] 5.3 X3: the post-kill replay stream · subscribe after the kill · no
      `subagent_completed` / `subagent_failed` / `tool_execution_end` and no
      stored `entries`-bearing frame for that `agentId`; the tick index is read
      from the replayed `(running… i)` content, not live (test-plan #X3).
- [ ] 5.4 X4: `force_kill` flushes a terminal frame · X3 fails · escalate to a
      container-level `SIGKILL` of the pi PID and record the mechanism used
      (test-plan #X4).

## 6. L3 — measurement (test-plan P1–P4)

- [ ] 6.1 P1: N browser contexts on one session, N increasing · added contexts ·
      the largest N at which frame delivery does not degrade — the harness
      ceiling, measured not assumed (test-plan #P1).
- [ ] 6.2 P2: `[[entries:5..30]][[bus:250]]` with N inspectors open, 2 separate
      harness starts (strip ON / OFF), ≥ 3 runs each · measure · per-subscriber
      `__resyncRequestId` bytes/s ≤ subagent-carrying bytes/s across BOTH
      carriers excluding `__resyncRequestId` frames, median of ≥ 3 with spread
      (test-plan #P2).
- [ ] 6.3 P3: P2 repeated at a faster and a slower `[[bus:]]` interval · measure ·
      the pull/push ratio as a function of bus cadence; a verdict that flips
      across the table is itself the finding (test-plan #P3).
- [ ] 6.4 P4: four arms in four SEPARATE browser contexts (never-opened;
      open@25 % hold 25 %; open@25 % hold 50 %; open-before-first-entry
      never-closed) · read `__piSubagentInspectorTelemetry()` · shares ≈ 0 / 25 /
      50 / 100 %, each recorded with its pattern and run length (test-plan #P4).
- [ ] 6.5 Apply the verdict rules: P2 exceeding its bound → file the D4 v2
      escalation as a FOLLOW-UP change (never a cadence tweak here); P2 inside
      the spread → record INCONCLUSIVE and ship; P4 > 50 % → report as the C4
      kill-switch condition together with its pattern.

## 7. Evidence + close-out

- [ ] 7.1 Write `openspec/changes/verify-subagent-pull-under-load/heap-evidence.md`:
      substrate proof, F1 carrier-exhaustion verdict, X1 pinned baseline, P2/P3
      sensitivity table with medians and spread, P4 four-arm curve — cross-
      referencing the archived parent's `heap-evidence.md` §3/§4 by path. Do NOT
      edit the archived file.
- [ ] 7.2 Manual verification of the replayed X1 card beyond the automated
      checks — a human confirms it is not visually corrupt
      (test-plan: manual-only, #X5).
- [ ] 7.3 Manual review of the finished `heap-evidence.md` — every number
      reported with its watch pattern / bus cadence / arm, the synthetic
      substrate's fidelity boundary stated, the archived evidence referenced and
      unedited (test-plan: manual-only, #M1).
- [ ] 7.4 Update the per-file rows in `qa/fixtures/AGENTS.md`,
      `tests/e2e/AGENTS.md`, `docker/AGENTS.md`, and the row for every other
      file touched; delegate any `docs/` prose to DocScribe.
- [ ] 7.5 Full test pass (`npm test`) plus the gated E2E arm; then run
      `review-code` on the diff before shipping.
