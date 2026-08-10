## Why

The browser-E2E harness cannot survive a full 80+ spec run: it reaches `(unhealthy)` mid-run, its daemon dies, and every remaining spec fails in ~400 ms — a cascade that reads like mass regression but is just the harness being down (issue #433, second problem). Until the harness survives a full run, **no E2E result is trustworthy** and the 10 red specs in #433 cannot be honestly triaged.

The cause is now measured, not hypothesised. Sampled from a live harness container mid-run (`pi-dash-test-1228013722`, `HOST_CWD=.worktrees/os-unify-folder-status-capsule`):

| Probe | Value |
|---|---|
| `/sys/fs/cgroup/memory.max` | `4294967296` (4 GiB — from `docker/compose.yml:72`, `MEM_LIMIT:-4g`) |
| `/sys/fs/cgroup/memory.current` | `4292702208` — **99.95 % of the cap** |
| `/sys/fs/cgroup/memory.events` | `max 1130` — the cgroup hit its ceiling 1130 times; `oom_kill 0` (not yet) |
| `pids.current` | `401` |
| live `pi` processes | **41** — 5131 MB summed RSS, **~125 MB average**, top talkers 150–280 MB |
| dashboard server (`node`, pid 269) | 629 MB RSS |
| total RSS | 5760 MB across 42 processes (summed RSS overcounts shared pages; the cgroup's own accounting is the 4 GiB figure above) |
| `/home/pi/.pi` tmpfs (2 GB) | **19 MB used** |

Two findings follow directly:

1. **The accumulator is spawned `pi` sessions, not disk or tmpfs.** The RAM-backed `pi-state` tmpfs — the obvious suspect, since it is sized 2 GB — is 1 % used. Recorded so the next investigator does not chase it.
2. **Almost nothing reaps them.** `tests/e2e` spawns from **138 call sites across 62 of the 87 specs** (`spawnFreshGitSession(` ×111, `ensureGitSession(` ×27). Exactly one spec ends a session it created — `notify-channel.spec.ts:108` force-kills over a throwaway browser socket, and only because the *assertion* needs an ended session, not as cleanup. Five specs carry `afterEach`/`afterAll` hooks (`gateway-url-action`, `oauth-redirect-base`, `plugin-settings-pages`, `tool-created-files`, `uncommitted-indicator-commit`); every one restores config, git or plugin state and none touches a session. So essentially every session a spec spawns stays resident for the rest of the run in the one shared container.

The budget arithmetic makes the failure deterministic, not load-dependent: `(4096 MB − 630 MB server − tmux/node overhead) / ~125 MB average per session ≈ **27 sessions**` — and as few as **12** if the run's sessions sit at the 280 MB end of the observed range. A full run spawns far more, so the ceiling is reached partway through — which is exactly why chunking ~30 specs with a harness restart between chunks works around it, and why the death looks like it "depends on host load" when it does not.

> ## Scope narrowed during implementation
>
> The acceptance run disproved a premise this proposal was built on. Reaping a
> session over the bus releases its **record** but does not terminate its
> **process**: the harness runs `PI_SPAWN_STRATEGY=tmux`, and `handleShutdown`'s
> only kill paths are headless-only. Measured mid-run: **21 tmux panes = 21
> resident `pi` = 0 session records**, memory climbing regardless of a correct
> reap.
>
> So the memory guarantee — and the `docker-test-harness` spec delta that carried
> it — **moved to `fix-tmux-session-shutdown-leak`** (issue #452), together with
> test-plan rows P1/P3/P4 and the acceptance run.
>
> **This change now claims exactly what it delivers and verifies:** per-test
> release of session *records*, the residual-session budget, the fail-loud
> harness-down latch, the import guard, and the `tests/` typecheck gate. The
> "Why" below is unchanged and still accurate — session accumulation is real and
> is the cause of the harness death; it simply turns out that bounding it needs
> the shutdown fix as well as this reap.
>
> See `SHIP_IT_BLOCKED.md` for the full evidence and the decision taken.

## What Changes

- **Specs reap the sessions they spawn.** A shared teardown helper terminates every session a spec created, over the same browser WebSocket path the UI uses (`handleShutdown` in `packages/server/src/browser-handlers/session-action-handler.ts`: clears the liveness marker with `closedReason:"manual"`, then SIGTERM → 2 s → SIGKILL). Registered centrally so a new spec inherits it without opting in. Reaping is delta-based — only sessions that appeared during the test — so the pre-existing `PI_E2E_INDEPENDENT_SESSION` session that `faux-ask.spec.ts` needs survives without any opt-out list.
- **The harness fails LOUD instead of cascading.** When the dashboard daemon dies mid-run, the suite reports *"harness down"* once and stops, rather than emitting ~70 fast phantom failures that are indistinguishable from product regressions. This is the property that let #433 sit undiagnosed.
- **Live footprint is observable.** An out-of-band probe reads the container's own `memory.current` / `pids.current`, and a residual-session budget fails at the point of breach so reap-regressions surface there rather than as a mystery collapse 40 specs later. *(The probe and the L2 memory script land here; the assertion that memory actually stays flat moves to `fix-tmux-session-shutdown-leak`, since it is unreachable while shutdown orphans the process.)*
- **NOT in scope, and why:**
  - *Raising `MEM_LIMIT` above 4 GiB.* A band-aid that also does not fit: the Docker VM has 8 GB total (`MemTotal: 8025168 kB`) and one harness already claims 4 GiB, so a second worktree's harness cannot coexist. Unbounded accumulation against a larger cap still ends in the same place, just later.
  - *Triaging the 10 red specs (#433 part 1) and the CI-trigger decision (#433 part 2).* Deliberately deferred: triage against a harness that dies mid-run produces unreliable verdicts. Those parts get their own change once this one lands, with the nightly-on-`develop` trigger as the working assumption.
  - *`playwright.config.ts` `globalTimeout: 15 * 60_000`.* Recorded as a real second obstacle to a full 87-spec run — 15 minutes cannot cover it — but it is a one-line config decision that belongs with the part-1/2 change that actually needs a green full run. Consequence, stated plainly: after this change an unattended `npm run test:e2e` still cannot finish the suite; the acceptance run here overrides the timeout on the command line.
  - *The REST/WS shutdown divergence.* `POST /api/session/:id/shutdown` performs the same user action as the WS `shutdown` message but omits the `setLiveness({closedReason:"manual"})` write, so REST-closed sessions stay cold-start recovery candidates (`isRecoveryCandidate` gates on `closedReason !== "manual"`). A production defect, found while designing this reap and filed separately. This change routes around it by using the WS path, rather than fixing it here.

## Capabilities

### New Capabilities

None. Both affected behaviours belong to capabilities that already exist.

### Modified Capabilities

- `playwright-e2e-qa`: new requirements — a spec SHALL release the sessions it spawns before the next spec runs; residual live sessions SHALL stay within a declared budget; and a dead harness SHALL be reported as such rather than as mass test failure.

*(`docker-test-harness` — the full-run memory guarantee — moved to `fix-tmux-session-shutdown-leak`.)*

## Impact

- `tests/e2e/helpers/` — new session-reaping teardown helper; adopted by the 57 spawning specs.
- `tests/e2e/global-setup.ts` / `global-teardown.ts` / `lifecycle.ts` — harness-liveness detection and the fail-loud path.
- `docker/compose.test.yml`, `docker/test-entrypoint.sh` — unchanged. The PID-1 supervisor's restart-grace behaviour is load-bearing and stays as-is.
- `packages/bus-client` — consumed, not modified: `BusClient` already gives E2E a typed headless WS client with `read.sessions()` and `send()`.
- No production code path changes: the reap sends browser-protocol messages that already ship.
- Unblocks #433 parts 1 and 2 (spec triage, CI trigger) by making a full run survivable. It does **not** by itself make `npm run test:e2e` complete unattended — the 15-minute `globalTimeout` above still stops that.

## Discipline Skills

- `systematic-debugging` — the root cause above was reached evidence-first; the remaining unknown (whether reaping alone keeps `memory.current` under the cap for a full run) is verified the same way before the fix is called done.
- `performance-optimization` — measure-before-optimize: the memory budget per session and the live-session ceiling are measured, and the fix is judged against those numbers, not against "it feels stable now".
- `observability-instrumentation` — the fail-loud harness-down signal and the footprint probe exist so this failure mode can never again present as anonymous mass regression.
