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

## Group 2 — post-fix (task 6.1)

Same chunk, same container image, container restarted first so both runs start
from an equivalent clean state. Specs at the fixed tree (importing from
`./fixtures.js`).

| sample | `memory.current` | `pids.current` | resident `pi` |
|---|---|---|---|
| before | 328.5 MiB (8.0 %) | 17 | 0 |
| during (t≈45 s) | 1167.9 MiB (28.5 %) | 43 | **1** |
| after ~120 tests | **722.5 MiB (17.6 % of cap)** | **45** | **1** |

**Verdict: flat.** Resident `pi` never exceeded 1 — the reap releases each
spec's sessions before the next spec starts.

### Side-by-side

| metric | pre-fix | post-fix | change |
|---|---|---|---|
| `memory.current` | 2638.2 MiB | 722.5 MiB | **−73 %** |
| `pids.current` | 243 | 45 | **−81 %** |
| resident `pi` | 19 | 1 | **−95 %** |
| `memory.events max` | 0 | 0 | no cgroup reclaim event in either sample |

`memory.events max=0` in both runs means neither sample reached the hard cap —
the pre-fix run was stopped at 64 % on its way up, so the cascade itself is
inferred from the trend plus `design.md`'s live 99.95 % observation, not
re-reproduced to death here.

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
