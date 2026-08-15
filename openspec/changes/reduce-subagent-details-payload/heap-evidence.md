# heap-evidence — reduce-subagent-details-payload

Recorded numbers for D1 (measure first) and P3 (soak). Per **C2 (a)** the soak
is **recorded, not gated**: the only perf gate in this change is **P1**, the
≤ 2x per-tick growth bound asserted on the serialized broadcast payload.

Environment: `docker/test-up.sh` all-in-one harness, image `pi-dashboard:local`
built from this worktree, derived `dashboardPort` from `.pi-test-harness.json`
(never `:18000`). Workload: the `subagent-sustained` faux scenario driven
through the real UI by Playwright, 4 rounds, then a 60 s idle window.

---

## 1. Per-tick bytes — the A/B that matters (P1 / P2, deterministic)

Measured on the exact `event_forward` envelope the bridge puts on the wire
(`JSON.stringify` of the full message), timeline grown 10 → 100 entries.
Source: `packages/extension/src/__tests__/subagent-tick-growth.test.ts`.

| Arm | bytes(tick@100) / bytes(tick@10) | Verdict |
|---|---|---|
| strip ON (`PI_DASHBOARD_SUBAGENT_STRIP` unset) | **≤ 2.0** | meets R-flat |
| strip OFF (`=0`) | **> 5.0** (measured ≈ 8–10x) | P2 anti-vacuity holds |
| strip ON, 1000 entries | ≤ 2.0 | flat far past the measured window |
| TERMINAL frame, 10 → 100 | > 5.0 | terminal fidelity intact by construction |

The flag-OFF arm is what makes the flag-ON arm meaningful: the same assertion
fails without the strip, so P1 is not vacuous.

## 2. Harness soak — post-change (P3, recorded per C2a)

`/api/health` `server.heapUsed` / `server.rss` and the additive `storeTrim`
counters, sampled at baseline, after each round, and 60 s after the workload.

| Sample | heapUsed | rss | subagentTicks | subagentTickBytes | subagentFatTicks |
|---|---|---|---|---|---|
| baseline | 126 485 592 | 782 475 264 | 0 | 0 | 0 |
| round 1 | 99 421 984 | 604 188 672 | 16 | 9 427 | **0** |
| round 2 | 100 271 064 | 594 964 480 | 32 | 18 854 | **0** |
| round 3 | 101 420 880 | 596 013 056 | 47 | 27 900 | **0** |
| round 4 | 102 058 368 | 597 061 632 | 62 | 36 946 | **0** |
| +60 s (GC floor) | 102 128 680 | 386 555 904 | 62 | 36 946 | **0** |

Readings:

- **Mean stored subagent-tick size: 596 B** (36 946 B / 62 ticks). Every one of
  the 62 ingested subagent-carrying events was **thin** — `subagentFatTicks`
  never left zero, i.e. no intermediate frame carried a cumulative timeline.
- **heapUsed rises ~0.9 MB per round and flattens** (102.06 MB → 102.13 MB
  across the idle window): the workload leaves no growing retention behind.
  rss falls to 386 MB at the GC floor.
- `collapsedUpdates` moves in lockstep (28 over 4 rounds), so the retention
  collapse still engages on thin ticks — D5's claim, observed rather than
  argued.

## 3. Inspector-open share — the kill switch (P5 / C4)

Signal added by this change (task 1.5): nothing previously recorded whether a
detail view was mounted. Read out of the page via
`__piSubagentInspectorTelemetry()`.

- Measured share on the harness workload (no inspector opened): **0.0 %**.
- **C4 abort threshold: > 50 %.** Not reached → the change is NOT aborted.

Honest caveat: the harness's subagents complete in ~600 ms, so this run
exercises the "nobody is watching" arm only. The share for real human sessions
is what the counter now makes measurable in production; it was unmeasurable
before this change.

## 4. What was NOT measured, and why

- **A pre-change (develop) heap baseline.** Building the develop-side image
  failed on the shared docker host — `no space left on device`, caused by
  multi-GB `qa/output/**/*.vmem` artifacts in that checkout's build context.
  The A/B in §1 is therefore the flag-OFF arm of the SAME build, which is the
  stronger comparison anyway (one binary, one workload, one variable).
- **Mid-run open-inspector cost (P4).** The harness subagents finish in ~600 ms,
  so there is no mid-run window in which to hold N inspectors open. The cadence
  cost is bounded structurally instead: one timer per subagent (not per view),
  backoff to a 30 s ceiling while idle, and requester-scoped delivery (C5) so a
  reply is no longer multiplied by the number of viewers.

## 5. Correction to the proposal's framing

The proposal's "~55 MB" figure predates the retention collapse that has since
landed. On this workload the stored subagent-tick footprint is **596 B/tick**
with zero fat intermediate ticks; the win this change delivers is now primarily
**wire bytes per tick** (§1) rather than resident heap, and the proposal should
be read that way.
