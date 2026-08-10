# Measurements — fix-e2e-harness-memory-exhaustion

Recorded during the worktree implementation phase. Raw probe samples live in
`measurements/*.json`; the pre-fix run log is `measurements/baseline-run.log`.

Probe: `node scripts/probe-harness-memory.mjs` (out-of-band, host-side
`docker exec`). Harness: one container, `MEM_LIMIT` 4 GiB, port read from
`.pi-test-harness.json` (18873 for this worktree). Host browser: `PW_CHANNEL=chrome`
(the bundled-Chromium download failed on this machine; the suite supports the
system-browser path first-class).

Chunk under test: the first 30 spec files alphabetically
(`anthropic-bridge-activation` … `kb-folder-slot`), identical in both runs.

## Group 1 — pre-fix baseline (tasks 1.3, 1.4)

Specs restored to the planning commit `1b4347d10` (importing `test` from
`@playwright/test`, so no reap fixture). Run stopped by the harness operator at
the 114-test mark; the numbers below are that sample, not a completed chunk.

| sample | `memory.current` | `pids.current` | resident `pi` | summed `pi` VmRSS |
|---|---|---|---|---|
| before | 290.9 MiB (7.1 % of cap) | 17 | 0 | 0 |
| after 114 tests | **2638.2 MiB (64.4 % of cap)** | **243** | **19** | 2863.3 MiB |

**Verdict: climbs monotonically.** This is the baseline the fix must flatten.

### Derivation inputs (task 1.4)

- **Per-session RSS:** 2863.3 MiB / 19 resident `pi` = **~150 MB average**,
  inside the 150–280 MB range `design.md` cites from the live mid-run sample.
- **Dashboard server RSS:** ~290 MiB at rest (the `before` sample, 0 sessions).
- **Concurrent-session ceiling:** (4096 − 290) / 150 ≈ **25 sessions** at the
  observed average; ≈ 13 at the 280 MB worst case. Both bracket `design.md`'s
  ~27 / ~12 estimate, so the residual budget of 8 keeps its headroom under
  either end.
- **Overcounting, stated explicitly:** summed VmRSS (3552.4 MiB across all
  processes) EXCEEDS the cgroup's own `memory.current` (2638.2 MiB) at the same
  instant, because forked `pi` processes share copy-on-write pages that VmRSS
  attributes to each process in full. `memory.current` is the authoritative
  figure; the sum is for per-process attribution only.

## Group 2 — post-fix (task 6.1) — **RETRACTED, DO NOT CITE**

> **This measurement is invalid.** In the run below, 112 of the 120 tests died at
> `browserType.launch` because `TMPDIR` pointed at a sandbox directory that had
> been reaped. Those tests never spawned a session, so the low memory and the
> single resident `pi` reflect *work not happening*, not the reap working. It is
> kept only as a record of the mistake.
>
> The honest post-fix picture is in **Group 3**, and it does NOT show a flat
> curve: see `SHIP_IT_BLOCKED.md`.

Same chunk, same container image, container restarted first so both runs start
from an equivalent clean state. Specs at the fixed tree (importing from
`./fixtures.js`).

| sample | `memory.current` | `pids.current` | resident `pi` |
|---|---|---|---|
| before | 328.5 MiB (8.0 %) | 17 | 0 |
| during (t≈45 s) | 1167.9 MiB (28.5 %) | 43 | **1** |
| after ~120 tests | **722.5 MiB (17.6 % of cap)** | **45** | **1** |

~~**Verdict: flat.**~~ Retracted — with 112/120 tests failing before they could
spawn anything, this shows only that tests which do not run consume no memory.

## Group 3 — post-fix, valid run (the one that counts)

Full 90-spec suite, merged tree, clean container, `PW_CHANNEL=chrome`,
`TMPDIR` fixed so browsers actually launch. Sampled every 60 s
(`measurements/acceptance-timeseries.jsonl`).

| sample | `memory.current` | `pids.current` | resident `pi` |
|---|---|---|---|
| t0 | 783.7 MiB (18.2 %) | 17 | 0 |
| t≈7 min (31 tests) | 1349.7 MiB (33.0 %) | 118 | 7 |
| t≈42 min (143 tests) | 2274.9 MiB (55.5 %) | 232 | 17 |
| t≈45 min | 2550.2 MiB (62.2 %) | 258 | 21 |

**Verdict: still climbs.** Budget breaches: 0. `HARNESS DOWN`: 0. The reap is
working perfectly at the record level and memory rises anyway.

The reason, captured at one instant (`measurements/tmux-leak-evidence.txt`):

```
tmux panes:      21
resident pi:     21
server records:  0
```

One pane per orphaned process, and the dashboard has forgotten all of them. The
harness runs `PI_SPAWN_STRATEGY=tmux`, and `handleShutdown`'s only kill paths
are headless-only — so the bus reap ends the session RECORD while the PROCESS
survives. Full analysis and the decision required: **`SHIP_IT_BLOCKED.md`**.

### Side-by-side (pre-fix vs the VALID post-fix run)

| metric | pre-fix @114 tests | post-fix @143 tests |
|---|---|---|
| `memory.current` | 2638.2 MiB | 2274.9 MiB |
| `pids.current` | 243 | 232 |
| resident `pi` | 19 | 17 |

Comparable, not fixed. What the change DOES deliver — per-test reaping of
session records, the import guard, the `tests/` typecheck gate — is real and
green; the memory guarantee is blocked on the tmux shutdown gap.

`memory.events max=0` throughout means no sample reached the hard cap: both runs
were stopped on the way up, so the cascade itself is inferred from the trend
plus `design.md`'s live 99.95 % observation, not re-reproduced to death here.

## Task 3.2 — teardown-hook audit

Five specs register their own teardown. Playwright runs `afterEach` BEFORE
test-scoped fixture teardown and `afterAll` AFTER it, so the question per hook
is whether it needs a live session.

| spec | hook | what it restores | needs a live session? | safe |
|---|---|---|---|---|
| `plugin-settings-pages.spec.ts` | `afterEach` | plugin state | no | yes — and runs while the session is still live anyway |
| `tool-created-files.spec.ts` | `afterEach` | fs state | no | yes |
| `uncommitted-indicator-commit.spec.ts` | `afterEach` | git state | no | yes |
| `gateway-url-action.spec.ts` | `afterAll` | `PUT /api/config` (gateways, CORS, trustedNetworks) | no — server-scoped | yes |
| `oauth-redirect-base.spec.ts` | `afterAll` | `PUT /api/config` (auth.redirectBaseUrl) | no — server-scoped | yes |

**No hook needs a live session in an `afterAll`.** Both `afterAll` hooks talk to
the server's config API, which is unaffected by session reaping.

**Correction to `design.md`:** it states "the two specs using `afterAll`
(`plugin-settings-pages`, `oauth-redirect-base`)". Measured on the tree, the
`afterAll` pair is `gateway-url-action` + `oauth-redirect-base`;
`plugin-settings-pages` uses `afterEach`. The conclusion is unchanged (neither
`afterAll` needs a live session) — which is exactly why the design asked for
this to be verified per hook rather than assumed.

## Environment note — concurrent harnesses

The Docker VM has **8 GB total** while each harness claims **4 GiB**, so two
worktree harnesses running at once saturate it. During this work a concurrent
session in `.worktrees/os-collapse-superseded-tool-execution-updates` had its
own harness up, and this worktree's container
(`pi-dash-test-719368873-pi-dashboard-1`) was destroyed mid-run between that
project's `down` and `up` (docker events `1786323863`). `docker/test-down.sh` is
correctly scoped to its CWD-derived project, so the cross-project destruction
comes from somewhere else. Filed separately; it makes any unattended multi-hour
acceptance run unreliable while a second harness is active.
