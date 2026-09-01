# Test Plan — reduce-subagent-details-payload

Stage: apply   Generated: 2026-08-15

## ✅ Clarifications RESOLVED (5/5)

Resolved by the user at ship-it time. These are now binding.

- [x] **C1** — D4 v1 cadence: **backoff scaled by timeline size**. Base 2 s,
      doubling per tick up to a 30 s ceiling, reset on entry growth. **F1**'s
      latency variant asserts convergence within one backoff window at the
      current step, not a fixed wall-clock number.
- [x] **C2** — **P3** soak gate: **(a) recorded number, no gate**. P3 reports
      heapUsed GC floor + avg bytes/event into `heap-evidence.md`; it never
      fails the build. The ≤ 2x per-tick bound (**P1**) is the only perf gate.
- [x] **C3** — **X3**: an evicted RUNNING agent's resync returns an explicit
      **`resyncNoop`**; the client keeps its last rendered state (never blanks,
      never corrupts). `maxAgents` stays 64, documented with a counter.
- [x] **C4** — **P5** kill switch: **abort the change if inspector-open share
      > 50 % of subagent runtime**.
- [x] **C5** — resync delivery becomes **requester-scoped** (in scope for this
      change). **P4** therefore measures **per-subscriber** bytes, and the
      "re-fattens the store for every viewer" risk shrinks to the requester.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | D5a type gate | BVA (at boundary) | L1 | automated | `subagent_started`, `details.entries` length **20**, serialized < 262 144 B | `insertEvent` | stored `entries` is an `Array` of 20 — the generic `>20` clobber does not fire at the boundary |
| E2 | D5a type gate | BVA (just above) | L1 | automated | same, `entries` length **21** | `insertEvent` | stored `entries` is an `Array` of 21. **Pre-fix this row FAILS** (value is the string `"[array truncated]"`) — it is the regression-documenting test |
| E3 | D5a + R-pull ceilings | BVA (over ceiling) | L1 | automated | `subagent_started`, `entries` serializing > 262 144 B (`DEFAULT_MAX_EVENT_DATA_SIZE`) | `insertEvent` | `entries` is reduced to head + `⋯ N steps hidden ⋯` sentinel + tail, still an `Array` — never a string, never dropped |
| E4 | D5a scope guard | decision-table (negative) | L1 | automated | an event whose type is NOT `subagent_*`/`tool_execution_*` but carries `details.entries` of 25 | `insertEvent` | `locateSubagentTimeline` does NOT match — shape alone must never match; the generic pass still applies |
| E5 | D2 strip predicate | decision-table (status × carrier) | L1 | automated | one frame per `AgentStatus` ∈ {queued, running, completed, failed, aborted, **stopped**} × both carriers | forward path | `queued`/`running` → `entries` absent; all others incl. **`stopped`** → `entries` intact (allowlist, not `!terminal`) |
| E6 | D2 idempotence | EP (repeat / empty) | L1 | automated | a frame with no `details`; a frame already thin; a frame stripped twice | strip helper | no throw; strip(strip(x)) ≡ strip(x); absent `details` is a pass-through |
| E7 | D2 clone-not-mutate | state (aliasing) | L1 | automated | running frame with `entries` length 12, buffered then forwarded | `buffer()` → forward | `buffer.resync(agentId)` still yields `entries.length === 12` — the retained snapshot is not aliased to the stripped copy |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | R-flat (spec bound) | threshold on growth curve | L1 | automated | one subagent, timeline grown 10 → 100 entries, ticks captured at both points | `bytes(tick@100) / bytes(tick@10) ≤ 2.0`, measured on the **serialized broadcast payload** (JSON string), not the in-memory object | per-tick |
| P2 | R-flat anti-vacuity | mutation | L1 | automated | same as P1 with the strip flag **OFF** | P1's assertion MUST fail (expected ratio ≈ 8–10x) | per-tick |
| P3 | proposal heap claim | soak (GC floor) | L2 | automated | docker harness, `MEM_LIMIT=6g`, `PI_E2E_SEED=1`, `[[faux:subagent-sustained]]`, 4 tmux sessions × 4 rounds | heapUsed GC floor + avg bytes/event vs pre-change baseline — **recorded, no gate (C2a)**: appended to `heap-evidence.md`, never fails the build | ≥ 60 s post-workload |
| P4 *(NOT MEASURED — deferred to `verify-subagent-pull-under-load`)* | D4 v1 cadence cost | rate comparison | L2 | automated | same workload with N inspectors held open | resync replies/s and **per-subscriber** reply bytes/s (requester-scoped, **C5**) vs the push bytes/s removed — must not exceed it; backoff schedule per **C1** | steady state |
| P5 *(signal built; representative share NOT measured — deferred)* | D1 kill switch | measurement | L2 | automated | representative session workload | inspector-open share of subagent runtime — **abort the change if > 50 % (C4)** | full run |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 *(cadence owned at L1; rendered convergence NOT verified — deferred)* | R-live | state-convergence | L3 | automated | subagent running, inspector mounted, timeline grows 5 → 30 entries | entries appended while the view stays open | rendered entry count **converges to 30** with no close/reopen, within one backoff window of the current step (**C1**: base 2 s, ×2 per idle tick, 30 s ceiling, reset on growth) |
| F2 | R-pull (late joiner) | state-transition | L3 | automated | subagent already running with 40 accumulated entries; browser opens the session fresh | user expands the subagent inspector | timeline populates (resync + head-tail budget) — does NOT stay empty. This is the case that is BROKEN today (>20 entries) |
| F3 | D4 v1 lifecycle | state-transition (teardown) | L1 | automated | cadence trigger active for a running subagent | view unmounts / subagent reaches terminal | interval cleared; zero further `subagent_resync_request` emitted |
| F4 | D4 v1 duplication | state-transition (illegal edge) | L3 | automated | same subagent open in BOTH the inline inspector and the popout route | both mounted simultaneously | resync requests are not double-fired per cadence tick |
| F5 | R-terminal / R-fold | golden comparison | L3 | automated | a completed run recorded pre-change and the same run post-change | page refresh → replay | rendered timeline is identical to the pre-change baseline (the `tool_execution_end` backfill path) |
| F6 | R-fold (old client) | state-transition | L3 | automated | client with open-time resync only (no cadence), opening an inspector whose timeline is **non-empty** | expand | freezes at the open-time snapshot — asserted as the DOCUMENTED degradation, not as correct convergence |
| F7 | D4 v1 perceived latency | visual/subjective | — | manual-only | live subagent with an open inspector | a human watches the timeline update | [judgment: "does the cadence feel laggy vs today's push?" — the D4 v2 escalation trigger; no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 *(NOT VERIFIED — deferred to `verify-subagent-pull-under-load`)* | R-crash | fault-injection (abort) | L3 | automated | pi process killed mid-run, no terminal frame emitted | session replayed afterward | scalar subagent state, no mid-run timeline, no corrupt/blank render — the documented REGRESSION, pinned |
| X2 | D4 / bridge liveness | fault-injection (unavailable) | L1 | automated | `sessionReady === false` or `isActive() === false` (`bridge.ts:980`) | resync request arrives | retryable no-op; never a wrong or permanently-empty render |
| X3 | D2 buffer bound | BVA (over capacity) | L1 | automated | 65 concurrent subagents against `maxAgents = 64` (drop-oldest) | resync for the EVICTED still-running agent | explicit **`resyncNoop`** (**C3**); the client keeps its last rendered state — never blank, never corrupt |
| X4 | R-thin (full-snapshot invariant) | fault-injection (drop) | L3 | automated | WS back-pressure drops a thin tick (`droppedFramesTotal`) | next tick arrives | state converges from the next full snapshot — a dropped thin tick leaves NO permanent hole |
| X5 | D2 placement (leak) | state-transition | L1 | automated | frames buffered while not ready, then drained by `flushPendingSubagentFrames` (`bridge.ts:2040-2050`) | flush | drained intermediate frames are **stripped** — a bus-path-only strip would leak them fat |
| X6 | D2 placement (over-strip) | state-transition (illegal edge) | L1 | automated | resync reply for a RUNNING agent, sent via `sendEventForward` directly (`bridge.ts:986`) | resync served | reply carries FULL `entries` — the pull model dies if the chokepoint strips its own reply |
| X7 | D2 buffer lifecycle | state-transition | L1 | automated | `reset()` on session change / bridge takeover (`bridge.ts:2743`, `:2826`) mid-run | reset with a running subagent tracked | the running subagent is not stranded without a recovery path (or the limitation is asserted explicitly) |
| X8 | R-pull ceilings | fault-injection (oversize) | L1 | automated | resync reply whose own timeline exceeds 262 144 B | resync served | head + sentinel + tail delivered; client renders the sentinel; no crash, no string-clobber |

---

## Coverage summary

- Requirements covered: **7/7** spec scenarios (flat tick, crash degradation,
  on-demand pull, open-inspector liveness, terminal fidelity, fold equivalence,
  producer compatibility) — plus 5 design invariants with no spec scenario of
  their own (D5a type gate, strip placement, clone-not-mutate, status allowlist,
  buffer bound).
- Scenarios by class: edge **7** · perf **5** · frontend **7** · error **8** (27)
- Scenarios by level: L1 **16** · L2 **3** · L3 **7** · manual-only **1**
- Scenarios by disposition: automated **26** · manual-only **1**

Note on R-producer: it has no dedicated row because this design satisfies it
**by construction** — the producer is unmodified and the reduction happens
downstream of it. E5 (every `AgentStatus` from the real producer enum) and F5
(golden replay) are its practical coverage.

## New infra needed

- **P5 (inspector-open share)** has no existing signal — nothing today records
  whether a detail view is mounted. Needs a client-side counter or telemetry
  hook before the kill-switch measurement is possible. This is a prerequisite
  for task 1.4, not an implementation detail of it.
- **P1/P2** need a serialization harness that captures the exact broadcast
  payload; asserting on the in-memory object would make the bound vacuous.
- Everything else routes to existing levels (vitest, `qa/`, Playwright vs the
  `docker/test-up.sh` hash-derived `dashboardPort` — never hardcode `:18000`).
