# pr-status.ts — index

Exports `createPrStatusScheduler(deps)`, `PrStatusScheduler`, `PrStatusSchedulerDeps`, `PrGeneration`, `handleGitInfoRefresh(msg, sched)`. Async `gh` probe off the tick: first observe immediately, ≥120 s cadence, back-off 120→600 s, 20 s timeout. Generation = sessionId+cwd+branch; branch change → all-null + probe, session/cwd change → unknown; stale results discarded. Forced ≤1 start / 30 s, coalesced (never dropped, `pr` wins); `pr` retries +5/+15 s while absent. One failure log + one recovery log. `alive()` false → self-dispose. Branch-change probes start ≤ 1 / 30 s, latest wins. See change: redesign-composer-session-strip, optimize-polling-hot-paths.

Branch-change throttle: generation changes caused by a branch change start a probe ≤ 1 / 30 s, latest branch wins; session/cwd changes unthrottled. See change: optimize-polling-hot-paths.
