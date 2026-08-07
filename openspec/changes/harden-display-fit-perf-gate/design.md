# Design — harden-display-fit-perf-gate

## D1 — The budget is derived, not chosen

The gate's only load-bearing number is the event-loop lag budget. It is fixed by
three measured anchors, all on the same 16-CPU host, `startLagMonitor(10)`:

| anchor | value | where it comes from |
|---|---|---|
| healthy worker lag | 1.1–11.9 ms | worker pool, single + burst workloads |
| worst observed contention | 62.9 ms | the failing full-suite `npm test` run |
| smallest regression signal | 349 ms | in-process, single 2400×1600 (P1's workload) |

The budget must sit **above** contention and **below** the smallest regression.
That window is `(62.9, 349)`. Its geometric centre is ~148 ms; **200 ms** is
chosen inside it, biased toward the regression end because a false *fail* costs
more than a slightly late catch:

- margin over worst observed contention: **3.2×**
- margin under smallest regression signal: **1.75×**

The old 50 ms value had a margin of **0.8×** over contention — it was below the
noise floor it had to clear, which is precisely why it flaked.

**Re-derivation rule.** If this gate flakes again, do not nudge the number.
Re-measure all three anchors (procedure in D3) and check the window is still
non-empty. A window that has closed means contention now overlaps the regression
signal, and the gate needs a different observable — not a bigger budget.

## D2 — Why an absolute budget beats a comparative ratio

A comparative form (worker lag vs in-process lag in one test) was designed and
rejected on arithmetic.

`startLagMonitor` returns the **maximum** sample (`event-loop-lag.ts`:
`if (lag > maxLag) maxLag = lag`), not a mean. So each window reports
`max(work blocking, worst background spike)` and contention is **additive on a
max** — it does not cancel between numerator and denominator:

```
ratio = max(T, B_w) / max(J, B_in)
  J   ≈ 350 ms  in-process jimp block
  T   ≈ 1.5 ms  worker-path transfer
  B_*           worst contention spike inside that window
```

At the observed 62.9 ms contention the ratio is `63/350 = 0.18` and passes a 0.6
threshold — but only because `J` dominates the denominator, not because anything
cancels. The ratio false-fails once `B_w > J × 0.6 ≈ 210 ms`, which is
statistically the **same ceiling** as a 200 ms absolute budget.

So the ratio buys no flake resistance, while costing:

- ~2× runtime (both paths run),
- a threshold that itself needs tuning,
- a pool-size fidelity trap (D4),
- and it is **weaker**: a worker path blocking 100 ms passes `100 < 350×0.6` yet
  violates today's budget.

Its one theoretical advantage — the ceiling scaling with fixture size — cuts both
ways: a faster host or a smaller fixture *shrinks* `J`, lowering the ceiling and
making it flakier, the opposite of the robustness claimed for it.

## D3 — Measurement procedure (reproducible)

Every number above was produced outside the test runner, because the runner is
the noise source under investigation:

1. Build the fixture with the test's own `photoLikePng` generator (gradient +
   `x ^ y` high-frequency detail — a flat fill compresses to nothing and makes
   the measurement meaningless).
2. **Warm the pool** with a small fit first; worker spawn and jiti compile are
   paid once at boot in production, so folding them into the measured window
   measures the wrong thing.
3. `startLagMonitor(10)` → run the workload → `stop()`.
4. Repeat 3× and report the range, not a single figure.

Both paths must be driven through `createFitWorkerPool` so the comparison is
like-for-like: `useWorker: false` still routes through the pool's
fallback-admission machinery, which a bare `jimp` call would bypass.

## D4 — Regression fidelity: the fallback runs at `size`, not size 1

A silent offload regression in production is `workersDisabled = true` after a
spawn failure, which runs **`size` concurrent on-loop decodes**. Production
constructs the pool with `size: 2` (`server.ts:717`), but `fit-worker-pool.ts`
defaults to `size: 1` (`const size = Math.max(1, opts.size ?? 1)`).

The existing skipped P2 builds its in-process baseline as
`createFitWorkerPool({ useWorker: false })` — default size 1 — while its worker
pool is `size: 2`. That is not a faithful model of the regression.

**Any verification that this gate still fails on a fallback MUST use
`{ useWorker: false, size: 2 }`.** Verifying against size 1 anchors the check to
a workload production never runs.

## D5 — Corrigendum to archived D4 ("Resize runs off the event loop")

`openspec/changes/archive/2026-08-05-fit-attachments-for-display/design.md` D4 is
**wrong on one line**, and it is left in place because the archive is an
immutable historical record. The correction lives here.

It claims *"jimp v1's async API yields, so in-process fitting blocks the loop for
~0 ms"* and tabulates `in-process | ~1710 ms | 0 ms`.

Re-measured on that exact 5 × 1600×1200 burst with current code, 3 runs:

| path | wall | max lag |
|---|---|---|
| in-process | 1419–2170 ms | **1409–2160 ms** |
| worker (2) | 1164–1259 ms | 1.1–11.9 ms |

The **wall times reproduce**, which confirms the workload matches; only the lag
column does not. The cause is identified rather than assumed:
`event-loop-lag.ts` `stop()` carries a fix whose comment states that without a
final sample, *"work that blocks the loop from start() until stop() prevents
every tick from running, and the monitor reports 0"*. A continuously-blocking
in-process burst is exactly that degenerate case, so the recorded `0 ms` is a
pre-fix measurement artifact that was never re-run after the fix landed.

**Therefore: jimp v1 does not yield.** Archived-D4's "rationale CORRECTED" is
itself incorrect, and the *original* rationale it discarded — an inline resize
stalls the event loop — was right all along. The worker pool is justified by
loop-blocking, not merely by throughput and CPU-share isolation.

This corrigendum exists because that single stale figure misled both the drafting
of this change and its independent reviewer into concluding the lag gate was
vacuous. The disproven recommendation it carries — "assert THROUGHPUT … and
measure it outside vitest" — is also void: for a single image the worker path is
*slower* in wall time (449–459 ms vs 359–426 ms), because parallelism only pays
across a burst while transfer cost is paid always.

## D6 — Scenario coverage restored

`attachment-storage` has two scenarios under "Fitting SHALL NOT block the
server". Today P1 covers the first and P2 (`it.skip`) covers the second, so the
concurrent-paste scenario has **no automated coverage at all**.

With a derived absolute budget, the burst case needs no in-process baseline —
assert the worker-path burst stays under the same budget. Healthy is
1.1–11.9 ms against a 1409–2160 ms regressed reading, a ~100× margin, so the
same 200 ms line serves both scenarios without a second threshold.

The requirement's other clause — "other sessions' events SHALL continue to be
processed" — is exactly what the lag monitor measures: event-loop availability is
the mechanism by which other sessions' events get processed. No separate
multi-session harness is warranted.
