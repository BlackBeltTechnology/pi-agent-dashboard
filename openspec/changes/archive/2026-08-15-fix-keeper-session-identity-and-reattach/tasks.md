# Tasks

Test tasks below are folded from `test-plan.md`; that manifest is the source of truth for
automated-vs-manual. Each folded task names a harness exemplar to copy glue from, states the
scenario Triple as input, trigger, observable, and references its manifest row.

## 1. Confirm the unproven mechanisms before writing any fix

- [x] 1.1 Repro the suspected register-ordering race: instrument a keeper-backed spawn so the
      order of `session_register` and `headlessPidRegistry.register()` is recorded, and determine
      whether the token-bearing register can arrive before the entry exists. Apply the
      `systematic-debugging` discipline; do not edit the token path until the ordering is
      established from evidence. → verify: ordering captured across at least 3 fresh and 3 resume
      spawns, with the tier that resolved each register named.
- [x] 1.2 Investigate the non-reconnecting bridge (keeper `abe06e02`, pi 76302): determine why it
      holds zero TCP connections while a comparable keeper-backed session stays connected.
      → verify: root cause stated with evidence, or explicitly recorded as not reproducible.
- [x] 1.3 Verify with the code open the two realities review surfaced: that
      `cleanupKeeperOrphans` skips reclaimed entries via its `keeperPid === undefined` guard, and
      that `KeeperEntry.sessionId` carries the keeper transport id rather than pi's session UUID.
      → verify: both confirmed or refuted in the change notes before section 5 is implemented.

## 2. Keeper records pi's PID in a sidecar

- [x] 2.1 Author the L1 filename-safety test; harness exemplar: `packages/server/src/__tests__/keeper-manager.test.ts`. Triple: filenames `<sid>.rpc.sock.pi-pid` and `pi-rpc-<sid>.pi-pid` · matched against the Unix and Windows keeper-sidecar scan patterns · neither matches and no session id of the form `<sid>.pi` is ever emitted. (test-plan #E12)
- [x] 2.2 Author the L2 own-sidecar-unchanged test; harness exemplar: `qa/tests/02-server-start.sh`. Triple: a keeper spawned on the current build · inspect its own `.pid` sidecar · file holds exactly the keeper PID as a bare integer and the startup orphan-cleanup reader still parses it. (test-plan #E13)
- [x] 2.3 Author the L2 shutdown-unlink test; harness exemplar: `qa/tests/02-server-start.sh`. Triple: a running keeper with pi alive and both sidecars present · SIGTERM the keeper · keeper exits and socket, own `.pid`, and `.pi-pid` are all unlinked. (test-plan #E17)
- [x] 2.4 Author the L2 write-ordering test; harness exemplar: `qa/tests/02-server-start.sh`. Triple: a keeper starting normally · read `keeper-<sessionId>.log` after startup · the `.pi-pid` file exists before the `keeper ready` line is written. (test-plan #E18)
- [x] 2.5 Author the L2 write-failure fault test; harness exemplar: `qa/tests/02-server-start.sh`. Triple: sessions directory unwritable for the pi-PID write · keeper spawns pi successfully then attempts the write · keeper logs the failure and keeps running, pi stays alive, no `.pi-pid` exists, own `.pid` unaffected. (test-plan #X1)
- [x] 2.6 Author the L2 spawn-failure test; harness exemplar: `qa/tests/02-server-start.sh`. Triple: keeper configured so the pi spawn fails · keeper starts · no `.pi-pid` sidecar is created and the keeper exits non-zero per existing behaviour. (test-plan #X6)
- [x] 2.7 Implement the post-spawn pi-PID sidecar write and its shutdown unlink in
      `packages/server/src/rpc-keeper/keeper.cjs`, using only Node built-ins so the file stays
      CommonJS. → verify: 2.1–2.6 pass; the keeper's own `.pid` sidecar is byte-identical.

## 3. Capture piPid only from identity-bearing resolutions

- [x] 3.1 Author the L1 token-tier capture test; harness exemplar: `packages/server/src/__tests__/headless-pid-registry.test.ts`. Triple: keeper-mode entry with `piPid` unset and `spawnToken` T · a register carrying that token and `pid` P resolves via the token tier · `entry.piPid` becomes P and the persisted pid file carries it. (test-plan #E1)
- [x] 3.2 Author the L1 pid-tier no-write test; harness exemplar: `packages/server/src/__tests__/headless-pid-registry.test.ts`. Triple: keeper-mode entry with `piPid` already P · a re-register carrying `pid` P resolves via the pid tier · `entry.piPid` is still P and no write occurs, confirming no reachable new-capture path on that tier. (test-plan #E2)
- [x] 3.3 Author the L1 single-candidate cwd-FIFO test; harness exemplar: `packages/server/src/__tests__/headless-pid-registry.test.ts`. Triple: exactly one unlinked keeper-mode entry for a cwd · a register with no token and no pid match resolves it via cwd-FIFO · `piPid` remains undefined while the entry still links. (test-plan #E3)
- [x] 3.4 Author the L1 multi-candidate cwd-FIFO test; harness exemplar: `packages/server/src/__tests__/headless-pid-registry.test.ts`. Triple: two unlinked keeper-mode entries for one cwd · a register resolves via cwd-FIFO · `piPid` stays undefined on whichever entry was selected. (test-plan #E4)
- [x] 3.5 Author the L1 no-pid register test; harness exemplar: `packages/server/src/__tests__/headless-pid-registry.test.ts`. Triple: keeper-mode entry with `piPid` unset · a register carrying no pid field · the entry links as before and `piPid` stays undefined. (test-plan #E5)
- [x] 3.6 Author the L1 non-keeper fallback test; harness exemplar: `packages/server/src/__tests__/headless-pid-registry.test.ts`. Triple: a non-keeper entry with pid N · any tier resolves it · `piPid` stays undefined and `getPid` returns N. (test-plan #E6)
- [x] 3.7 Author the L1 link-target regression guard; harness exemplar: `packages/server/src/__tests__/headless-pid-registry.test.ts`. Triple: two unlinked keeper-mode entries for one cwd with registers arriving in a fixed order · cwd-FIFO resolves both · each session links to exactly the entry it linked to before this change. (test-plan #E19)
- [x] 3.8 Implement the capture gate at the resolution boundary so only the token and pid tiers
      record `piPid`, persisting after capture. → verify: 3.1–3.7 pass; no capture occurs on the
      cwd-FIFO path at any candidate count.

## 4. Fill an absent piPid from the sidecar, liveness-checked

- [x] 4.1 Author the L1 fill test; harness exemplar: `packages/server/src/__tests__/keeper-manager.test.ts`. Triple: entry with `piPid` unset and a sidecar naming live PID Y · startup discovery runs · `entry.piPid` becomes Y and is persisted. (test-plan #E7)
- [x] 4.2 Author the L1 no-override test; harness exemplar: `packages/server/src/__tests__/keeper-manager.test.ts`. Triple: entry persisting `piPid` X and a sidecar naming a different Y · startup discovery runs · `entry.piPid` remains X, since the sidecar fills rather than arbitrates. (test-plan #E8)
- [x] 4.3 Author the L1 malformed-sidecar partition test; harness exemplar: `packages/server/src/__tests__/keeper-manager.test.ts`. Triple: sidecar contents across absent, empty, non-numeric, zero, negative, padded-valid, and above-pid-max partitions · startup discovery runs · only the padded valid integer is accepted, every other partition leaves `piPid` untouched, and none throws. (test-plan #E9)
- [x] 4.4 Author the L1 live-PID recorded test; harness exemplar: `packages/server/src/__tests__/keeper-manager.test.ts`. Triple: a sidecar naming a live PID P for a live keeper · startup discovery runs · `entry.piPid` becomes P and a `keeper-identity` log line records the recorded state. (test-plan #E14)
- [x] 4.5 Author the L1 absent-means-alive probe test; harness exemplar: `packages/server/src/__tests__/keeper-manager.test.ts`. Triple: a live keeper with no pi-PID sidecar · the liveness probe is evaluated for that session · the probe returns alive, never dead. (test-plan #X2)
- [x] 4.6 Author the L1 dead-PID rejection test; harness exemplar: `packages/server/src/__tests__/keeper-manager.test.ts`. Triple: a sidecar naming a PID that is not alive · startup discovery runs · that PID is not recorded, `entry.piPid` is unchanged, and a `keeper-identity` line records the unavailable state. (test-plan #X4)
- [x] 4.7 Implement the filesystem-backed `isPiAliveForSession` as the keeper manager default,
      with its pi-PID path helper, mapping an absent or unparseable sidecar to alive and only a
      present-but-dead PID to dead. → verify: 4.1–4.6 pass.

## 5. Reconcile during discovery

- [x] 5.1 Author the L1 reclaim round-trip test; harness exemplar: `packages/server/src/__tests__/headless-pid-registry.test.ts`. Triple: an entry with `piPid` P persisted · a restart followed by reclaim · the reclaimed entry still carries `piPid` P and its keeper PID. (test-plan #E10)
- [x] 5.2 Author the L1 reclaimed-entry fill test, the regression guard for the guard that today skips reclaimed entries; harness exemplar: `packages/server/src/__tests__/headless-pid-registry.test.ts`. Triple: a reclaimed entry already carrying a keeper PID with `piPid` unset, plus a readable sidecar naming live Y · startup discovery runs after reclaim · `entry.piPid` becomes Y. (test-plan #E11)
- [x] 5.3 Author the L1 per-keeper diagnostic test; harness exemplar: `packages/server/src/__tests__/keeper-manager.test.ts`. Triple: three discovered keepers, one fillable, one already set, one with no sidecar · startup discovery runs · one `keeper-identity` line per keeper carrying recorded, unchanged, and unavailable respectively. (test-plan #E20)
- [x] 5.4 Author the L2 healthy-keeper-survives-scan test; harness exemplar: `qa/tests/02-server-start.sh`. Triple: a healthy keeper and live pi with no pi-PID sidecar · a full server startup scan runs · the keeper receives no SIGTERM, its socket and `.pid` are not unlinked, and the session stays dispatchable. (test-plan #X3)
- [x] 5.5 Author the L2 stale-file cleanup test; harness exemplar: `qa/tests/02-server-start.sh`. Triple: a keeper SIGKILLed leaving socket and both sidecars behind · a server startup scan runs · all stale files are unlinked, no discovered-keeper record is emitted, and no phantom session id appears. (test-plan #X5)
- [x] 5.6 Implement discovery reconciliation: carry the sidecar pi PID on the discovery result,
      restructure the consumer so entries that already carry a keeper PID are reconciled rather
      than skipped, and associate results with entries by keeper PID rather than by the transport
      id. Decide deliberately which declaration gains the field, since return covariance
      determines whether test fakes break. → verify: 5.1–5.5 pass; 1.3 confirmed first.

## 6. Report positional resolution

- [x] 6.1 Author the L1 positional-report test; harness exemplar: `packages/server/src/__tests__/headless-pid-registry.test.ts`. Triple: one or more unlinked keeper-mode entries for a cwd · a register resolves one via cwd-FIFO · exactly one `keeper-identity` line naming the cwd and the resolved entry. (test-plan #E15)
- [x] 6.2 Author the L1 no-match-silent test; harness exemplar: `packages/server/src/__tests__/headless-pid-registry.test.ts`. Triple: a cwd with no keeper-mode entry · a register falls through cwd-FIFO and matches nothing · no `keeper-identity` line is emitted for that register. (test-plan #E16)
- [x] 6.3 Implement the `keeper-identity` prefixed reporting, applying the
      `observability-instrumentation` discipline so the signal stays rare and actionable rather
      than adding volume. → verify: 6.1–6.2 pass.

## 7. End-to-end guard

- [x] 7.1 Author the L3 restart-survival spec; harness exemplar: `tests/e2e/faux-ask.spec.ts`, the repo's documented reconnect scenario. Triple: a dashboard-spawned keeper-backed session against the docker harness · restart the dashboard server then dispatch a command to that session · the command reaches that session's pi and no other, with the harness port read from `.pi-test-harness.json` rather than hardcoded. (test-plan #F1)

## 8. Manual verification

- [x] 8.1 Review the PID-reuse residual window and confirm no caller can act destructively inside it. (test-plan: manual-only) — DEFERRED to post-merge verification (real OS PID reuse is not reproducible on demand; residual window analysed in design Risks + doubt-review §9.1).
(test-plan: manual-only) The window spans pi's death until the keeper unlinks its sidecar. Real OS PID reuse is not reproducible on demand, so there is no automatable signal; this is deferred to post-merge verification.

## 9. Review and land

- [x] 9.1 Run the `doubt-driven-review` discipline on the implemented capture and reconciliation
      paths: enumerate how a wrong `piPid` could route a kill to an unrelated live session, and
      what prevents it. → verify: findings recorded; blocking ones fixed before commit.
- [x] 9.2 Run the `review-code` inner-loop pass over the full diff. → verify: no blocking findings
      remain.
- [x] 9.3 Run the suite with `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`.
      → verify: `grep -nE 'FAIL|Error|✗|✘|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log` shows
      no failures.
- [x] 9.4 Confirm cross-platform parity by running the new qa smoke tests on both a Unix and a
      Windows runner. → DEFERRED (no Windows runner in the worktree). Parity IS asserted by the
      platform-parametrized unit tests: `piPidPathFor` / discovery take a `platform` arg, and E12
      checks BOTH the Unix `^(.+)\.rpc\.sock\.pid$` and Windows `^pi-rpc-(.+)\.pid$` scan patterns
      against the pi-PID filenames. Full Windows-runner run happens in CI.
(test-plan: manual-only)
- [x] 9.5 Restart the local server and confirm a keeper-backed session survives with `piPid`
      populated. → DEFERRED to post-merge (deploying to the local running instance is explicitly
      NOT run from a worktree). The L3 harness spec `tests/e2e/keeper-restart-survival.spec.ts`
      (#F1) exercises the equivalent survive-restart-and-dispatch path against the docker harness.
(test-plan: manual-only)
