# Design — fix-worktree-server-autostart-leak

> Revised after cross-model doubt-review (`@propose-review-1`, cycle 1). Findings that changed the design are marked **[DR-n]**.

## Context

`autoStartServer()` (`packages/extension/src/server-auto-start.ts:77`) runs in every pi session: mDNS discovery (2s) → health check → spawn. The spawn target comes from `resolveServerCliPath()` (`packages/extension/src/server-launcher.ts:56`), which resolves **relative to the loaded extension copy**. A session whose cwd is `.worktrees/<name>` therefore spawns that worktree's server, detached, on hardcoded `--port 8000 --pi-port 9999` (`server-launcher.ts:103`).

Startup order matters and was missed in the first draft **[DR-1]**: `piGateway.start(config.piPort, config.host)` binds the gateway at `server.ts:1828`, and `fastify.listen({port: config.port})` runs much later at `:2099`. The gateway is therefore live before the dashboard port is ever attempted.

Three gaps let that become durable damage:

1. A startup failure occurring **after** `piGateway.start` leaves the gateway handle open. The observed `35826` held `127.0.0.1:9999` for 1h16m while **not** holding `:8000` — consistent with a retained pre-listen handle, not with a failed bind. The normal listen-rejection path already exits (`cli.ts:573-577` `main().catch → process.exit(1)`), so "the server forgets to exit" was the wrong diagnosis **[DR-1]**.
2. Nothing serialises the check→spawn window across processes, so N sessions each observe "no server" and each spawn.
3. Nothing stops a worktree checkout from taking the shared ports.

Pre-existing guard, previously unreconciled **[DR-3]**: `guardTempHomePort` (`cli.ts:131-147`) already remaps `8000→0` when `HOME` is under `os.tmpdir()`, for the same 127.0.0.1-shadows-`*:8000` reason. It fires only for a temp HOME, so it did not cover the observed worktree sessions (normal HOME). Its existence means two predicates now govern "may this process take the production port"; they must be reconciled deliberately rather than interact by accident.

Constraint: `.worktrees/` holds several hundred checkouts on the dev host, so gap 3 has a large standing blast radius.

## Goals / Non-Goals

**Goals**
- A startup failure cannot leave a process holding the pi-gateway port.
- At most one auto-start spawn attempt per user per port at a time.
- A worktree checkout never takes the shared dashboard **or** gateway port.
- Refusal and lock-loss are greppable in a durable log file.

**Non-Goals**
- Pruning existing `.worktrees/` entries.
- Changing mDNS discovery or the health-check protocol.
- Changing `resolveServerCliPath()`'s resolution order — only adding a predicate over its result.
- Reaping already-leaked processes.
- Making the lock work across OS users (see D2 scope note).

## Decisions

### D1 — A server that never reaches serving state exits **[DR-1, re-aimed; REPRODUCED 2026-08-13]**

> **Reproduction supersedes the earlier inference.** PID 78379 was captured holding `127.0.0.1:9999` for 5h52m while never having bound its dashboard port, with a live event loop, and exited cleanly on SIGTERM. It never reached `main().catch`. Full capture in `proposal.md` → Evidence. Consequences for this decision:
>
> 1. The trigger is **not** a rejected bind. Startup failed or hung *before* `fastify.listen()` was reached, so an `EADDRINUSE` handler at the listen site would never have fired.
> 2. **Teardown is necessary but not sufficient.** Closing the gateway socket does not end a process whose loop is held by `pi-gateway.ts:214` `pingTimer`. The decision now requires an explicit bounded startup and exit, not just handle release.
> 3. The hang case must be covered, which no earlier version of this decision addressed.

The original decision (exit non-zero on `EADDRINUSE` at the `listen()` site) targeted a defect the code does not have: `cli.ts:573-577` already exits 1 when `start()` rejects. Re-aimed at the real mechanism.

`start()` SHALL tear down every listener it has already opened — the pi gateway first — when a later startup step fails, so no failure path can leave the process resident holding a port. Teardown runs before the rejection propagates to `main().catch`.

Separately, and retained from the original D1, a port conflict SHALL be distinguishable to the spawning parent. Because `recovery-server.ts:411` already exits **2** on its own `EADDRINUSE`, the parent MUST treat both 2 and the normal-path conflict code as "port taken" **[DR-6]**.

*Alternative rejected*: relying on `process.exit()` to reap handles implicitly. The reproduction settles this — the observed process never reached `main().catch` at all, so an exit path that depends on the rejection arriving cannot be the whole answer. A startup deadline is required so that "never completes" is also bounded.

*Startup deadline*: startup SHALL be bounded and the bound SHALL exceed a legitimate cold start (jiti compile + plugin load) — the same tension as the D2 readiness budget, and it SHOULD be derived from the same constant so the two cannot drift apart.

*Precision correction* **[DR-13]**: the earlier draft framed recovery-server as "deliberately binds the same port," implying a same-process conflict. Import-fail→recovery and import-ok→listen are disjoint within one process; the only interaction is cross-process, and recovery already handles it.

### D2 — Advisory lockfile at `~/.pi/dashboard/autostart-<port>.lock`

Acquire with `open(..., 'wx')` (atomic O_EXCL), write `{sessionPid, startedAt, cliPath, childPid?}`, release in `finally`.

Hardened after review:
- **Staleness needs more than a live pid** **[DR-7]**. A reused pid makes a dead holder look alive. Staleness SHALL cross-check the recorded `startedAt` against the holder process's start time; a pid whose process is younger than the lock is a reuse, and the lock is stale.
- **The detached child outlives the session** **[DR-8]**. The spawned server is `detached: true`, so session death does not mean spawn death. Once the child pid is known it SHALL be recorded in the lock, and staleness SHALL consider the child's liveness — not only the session's. Otherwise "holder pid dead → break lock → spawn again" races an orphaned child that is still binding.
- **The readiness window is explicit and distinct from the health-check timeout** **[DR-9]**. A legitimate cold start (jiti compile on a slow host) can exceed the 10s health timeout; using that value as the staleness bound would let a concurrent session break the lock and double-spawn — reintroducing the race. The staleness bound SHALL be the spawn readiness budget, defined independently and larger than the health-check timeout.

*Scope note* **[DR-11]**: `~/.pi/` is per-user, so this serialises per user, not literally per host. Multi-user sessions on one machine are out of scope; the spec wording follows this.

*Alternatives rejected*: abstract-socket mutex (unavailable on macOS); in-process guard (the five observed copies were separate OS processes).

### D3 — Refusal keyed on `.worktrees/` AND (default port OR default piPort) **[DR-2, re-keyed]**

The first draft keyed refusal on `config.port === 8000` alone while every problem statement named `:9999` as the hijack vector — so `--port 8001 --pi-port 9999` would evade refusal and still capture the gateway. `config.piPort` is already in scope at `server-auto-start.ts:78`.

Refuse when the resolved `cliPath` contains a `.worktrees/` path segment AND (`config.port` is the shared default OR `config.piPort` is the shared default). Refusal means: skip spawn, attach if a host dashboard is reachable, otherwise report unavailable. Never throw.

An isolated worktree dashboard must therefore move **both** ports off their defaults — which `isolated-ui-verification` already does via its allocator.

**Ordering** **[DR-10]**: the refusal is evaluated **before** lock acquisition, so a session that will refuse never takes (or contends for) the lock.

**Matching** **[DR-12]**: the match is path-segment aware on a `realpath`-resolved path — `.worktrees-backup` must not match, and a symlinked worktree must not evade.

**Reconciliation with `guardTempHomePort`** **[DR-3]**: that guard may have already remapped `config.port` to `0`, in which case the port limb of this predicate is false. The piPort limb still applies. The two guards SHALL be documented as complementary, and the refusal SHALL NOT assume `config.port` still equals its configured value.

*Alternative rejected*: refuse based on cwd. The bug is which **code** is spawned, not where the session sits.

### D4 — Durable log file, not `notify` **[DR-4]**

The extension has no logger; `deps.notify` is wired to `ctx.ui.notify` (`bridge.ts:2574`) — a transient TUI toast, and invisible in headless/RPC sessions. It cannot satisfy "greppable without correlating OS process state." Compounding this, `keeperLog.capturePiOutput` may be disabled, so `console.*` is not durably captured either.

Refusal and lock-loss SHALL be appended to the dashboard server log file already owned by the launch primitive (`getDashboardServerLogPath()`), which `server-launch` guarantees exists. `notify` MAY additionally surface a toast for the interactive case; it is not the requirement's target.

### D5 — Spinner lifecycle on the new exits **[DR-5]**

`deps.onLaunchStart()` fires at `server-auto-start.ts:119`, immediately before `launchServer`, and `bridge.ts:2622` carries an explicit `stopSpinner()` net for `onLaunchEnd` not firing. Both new exits (worktree refusal, lock loss) SHALL return **before** `onLaunchStart` is called. If that ordering ever becomes impossible, they MUST call `onLaunchEnd(false)` — a spinner that never stops is a user-visible regression.

## Risks / Trade-offs

- **Over-eager refusal strands a developer with no dashboard** → refusal requires a default port on one dimension, and always logs the resolved path + both ports.
- **Stale lockfile blocks all auto-start** → staleness = (dead holder OR pid-reuse detected via `startedAt`) OR age beyond the readiness budget, considering the detached child.
- **Lock breaks under legitimate slow cold start** → readiness budget defined independently of, and larger than, the health-check timeout.
- **Isolated worktree dashboards must now move both ports** → mildly stricter; `isolated-ui-verification` already allocates both.
- **Handle-teardown ordering could mask the original startup error** → teardown must not swallow or replace the rejection that triggered it.
- **The real linger mechanism is still inferred** → tasks 1.1/1.4 reproduce and confirm the retained-gateway-handle theory *before* D1 is implemented. If reproduction contradicts it, D1 returns here.

## Migration Plan

No data migration, no config change. Behaviour is additive for single-dashboard hosts. Rollback is a straight revert; the only persisted state is a transient lockfile safe to delete.

## Accepted Trade-offs — deferred doubt-review findings

Cycle 2 of the cross-model doubt-review (`@propose-review-1`) surfaced the findings below. They were **verified against source** and then **accepted as-is by explicit decision** rather than reconciled, to keep the change moving. They are recorded here so the implementer is not surprised, and so a future reader does not mistake silence for absence.

**Diagnosis-level — RESOLVED 2026-08-13, no longer a deferred finding**

- ~~The linger diagnosis does not cover the evidence.~~ **The reviewer was right, and the case is now reproduced.** PID 78379 held the gateway port for 5h52m without ever binding its dashboard port, with a live event loop — exactly the mechanism predicted (gateway timers at `pi-gateway.ts:214` holding the loop open), and exactly what listener-teardown alone would not have fixed. D1 and the `server-launch` requirement were rewritten against the captured state: they now bound startup, cover the hang case, and require the process to exit rather than merely release handles. `server-launch` is no longer an unproven limb.

**Correctness of the stated predicates**

- **`realpath` inverts the symlink goal** (D3). Resolving the real path *strips* a `.worktrees` segment reached via symlink, so a symlinked worktree evades the check — the opposite of the stated intent. Segment-matching and symlink-catching are in tension; the spec currently picks the one that defeats its own goal.
- **Refusal keys on a directory-name convention, not the structural property.** `git worktree add ../feature-x` places a worktree outside `.worktrees/` with identical hijack risk and no match.
- **The `guardTempHomePort` reconciliation is against a non-interaction.** That guard runs server-side in `buildConfig` (`cli.ts:157`); the extension never remaps its own `config.port`. The real cross-process discrepancy is the reverse — the extension may refuse a spawn the server would have made safe.

**Lock robustness**

- **The lock is keyed on the dashboard port only** while the documented hijack vector is the gateway port. Two sessions on different dashboard ports but the same `piPort` are not serialised.
- **The pre-`childPid` window reopens the TOCTOU.** `childPid` is surfaced only on readiness success (`shared/server-launcher.ts:284`); there is no `onChildSpawned` seam. A holder that dies during the readiness window leaves a lock that reads as stale while its detached child is alive — permitting exactly the double-spawn the lock exists to prevent.
- **The spawn readiness budget has no value or derivation**, though staleness and the loser's wait both depend on it.
- **Pid start-time reads are unspecified** and have no pure-Node API (`ps` spawn or `/proc`).

**Interface reality**

- **`PortConflictError` already exists** via the probe path (`shared/server-launcher.ts:289`), and the early-exit check precedes the probe — so a new exit-code path shadows it. Two mechanisms, undefined precedence. The normal-path conflict code is also never pinned to a value.
- **The refusal log destination assumes the spawn it prevents.** `getDashboardServerLogPath()` is created by the launch primitive, which refusal skips; the extension must create the file itself.
- **D5's motivation is overstated** — `bridge.ts:2622`/`:2627` already call `stopSpinner()` on every return. The ordering requirement is still sound; it is a cleanliness invariant, not regression prevention.
- **"Tear down every listener" is broader than the tasks.** The model-proxy second listener already swallows its own bind failure (`server.ts:2132`).
- **Field-name drift** across artifacts: `sessionPid` / `pid` / "holder pid" name one field three ways.

## Open Questions

- Should the lock loser wait for the holder's readiness budget and attach, or fail fast and let the next reconnect cycle attach? Design assumes wait-then-attach.
- Should `guardTempHomePort` and the D3 predicate be unified into one "may this process take production ports" helper, or left as two documented guards? Deferred — unification is a refactor beyond this change's scope.
