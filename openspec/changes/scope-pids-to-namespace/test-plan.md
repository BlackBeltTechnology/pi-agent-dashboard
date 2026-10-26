# Test Plan — scope-pids-to-namespace

Stage: design   Generated: 2026-10-26

Decisions applied (all accepted at the gate; see design D4 and D8):
- Q8 — `unknown` on a Windows server keeps today's signal on operator paths; on POSIX, `unknown` is refused on every path (X9, X10, X23, X33, X34, X84, X101).
- S1 — macOS/Windows report or context missing `hostId` ⇒ `unknown` (E100).
- S2 — force-kill with no pid runs the existing no-pid branch before resolution (E101).
- S3 — same-pid fast accept needs incumbent and newcomer targets both `host` (or both `unknown` on Windows) (E88, E102).
- S4 — argument-free enforcement scan, explicit `own-spawn` allowlist, `__tests__` excluded (X70–X74, E103).
- S5 — `pidNamespace` persisted with `pid` (E104).
- S6 — `pidNamespace` stripped from browser and peer payloads (E105).
- S7 — malformed `pidNamespace` ⇒ `unknown`; caps distro 64, ids 128 (E106, E109).
- S8 — operator `not-local` shutdown still runs the registry rung by token (X100, X102).
- S10 — no timing threshold; resolver does no I/O per call, asserted structurally (P100).
- S11 — watchdog `clearByCwd` stays for non-local registers; only the pid tier is skipped (E85, E107).

Notes:
- No rendered-UI requirement exists in this change, so there are no F rows and no L3 rows (the `force_kill_result` message text is asserted at the server message level only).
- The new qa scripts are numbered 54: `46`–`52` are taken in `qa/tests/`, and `53` is reserved by `add-windows-process-identity`.

## Fixtures (used by the rows; concrete values)

Server contexts (`ServerPidContext`):

| id | platform | hostId | nsId |
|----|----------|--------|------|
| SL | linux | `boot-A` | `pid:[4026531836]` |
| SW | win32 | `WINBOX` | — |
| SM | darwin | `mac.local` | — |

Bridge reports (`pidNamespace`):

| id | value |
|----|-------|
| RL | `{platform:"linux", kind:"host", hostId:"boot-A", nsId:"pid:[4026531836]"}` |
| RL-ctr | RL with `nsId:"pid:[4026532999]"` (a container) |
| RL-vm | RL with `hostId:"boot-B"` (another machine) |
| RL-wsl | `{platform:"linux", kind:"wsl", distro:"Ubuntu-24.04", hostId:"boot-W", nsId:"pid:[4026531840]"}` |
| RW | `{platform:"win32", kind:"host", hostId:"WINBOX"}` |
| RM | `{platform:"darwin", kind:"host", hostId:"mac.local"}` |

Session pid under test: `4242` unless stated. Origin: `originDeviceId:"dev-remote-1"` is the remote marker.
Harness note: the terminator, `signalZero`, `processStartedAt`, `killProcess`, `kill` (KillFn) and the reaper `probe` are already injectable (`packages/shared/src/platform/process.ts`, `ReaperDeps`, terminator deps). `buildPidNamespace()` is new and must take an injectable `{platform, env, readlink, readFile, hostname}` opts bag mirroring `ProcessOpts`; rows E50–E57 assume it (see New infra).

---

## Scenarios

### Edge-case — target resolution (`resolvePidTarget`), new file `packages/server/src/session/__tests__/pid-target.test.ts`
Harness to copy: `packages/server/src/__tests__/session-death-attribution.test.ts` (plain session rows, no I/O).

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Resolution 1 — remote origin is foreign | decision-table (origin × report) | L1 | automated | ctx SL; session `originDeviceId:"dev-remote-1"`, report RL (identical to SL), pid 4242 | `resolvePidTarget(s, SL)` | `foreign` |
| E2 | Resolution 1 beats rule 3 | decision-table | L1 | automated | ctx SL; `originDeviceId` set; NO report; `ownEntryPid=4242`, pid 4242 | resolve | `foreign` (not `host`) |
| E3 | Resolution 3 — same namespace | decision-table | L1 | automated | ctx SL; report RL | resolve | `host` |
| E4 | Resolution 3 — container | decision-table | L1 | automated | ctx SL; report RL-ctr | resolve | `foreign` |
| E5 | Resolution 3 — another machine | decision-table | L1 | automated | ctx SL; report RL-vm (same `nsId`, `hostId` differs) | resolve | `foreign` |
| E6 | Resolution 3 — missing field beats mismatch | decision-table (precedence) | L1 | automated | ctx SL; report `{platform:"linux",kind:"host",hostId:"boot-B"}` (no `nsId`) | resolve | `unknown` (not `foreign`) |
| E7 | Resolution 3 — server side unreadable | decision-table | L1 | automated | ctx `{linux, hostId:"boot-A"}` (no `nsId`); report RL | resolve | `unknown` |
| E8 | Resolution 3 — server side no `hostId` | decision-table | L1 | automated | ctx `{linux, nsId:"pid:[4026531836]"}` (no `hostId`); report RL | resolve | `unknown` |
| E9 | Resolution 2 — platform differs (darwin→linux) | EP | L1 | automated | ctx SL; report RM | resolve | `foreign` |
| E10 | Resolution 2 — platform differs (win32 bridge, Linux dashboard) | EP | L1 | automated | ctx SL; report RW | resolve | `foreign` |
| E11 | Resolution 2 — WSL report to win32 server | EP | L1 | automated | ctx SW; report RL-wsl | resolve | `{wsl, distro:"Ubuntu-24.04"}` |
| E12 | Resolution 2 — Linux non-WSL report to win32 server (Docker Desktop container) | EP | L1 | automated | ctx SW; report RL (kind host) | resolve | `foreign` (the WSL exception does not apply) |
| E13 | Resolution 4 — win32/win32 | decision-table | L1 | automated | ctx SW; report RW, then RW with `hostId:"OTHERBOX"` | resolve ×2 | `host`, then `foreign` |
| E14 | Resolution 4 — darwin/darwin | decision-table | L1 | automated | ctx SM; report RM, then RM with `hostId:"other.local"` | resolve ×2 | `host`, then `foreign` |
| E15 | Resolution 4 — documented weak discriminator | EP | L1 | automated | ctx SM; report RM from a different machine that has the same hostname `mac.local` | resolve | `host` (accepted risk, design Risks) |
| E16 | Same-WSL-distro dashboard | EP | L1 | automated | ctx `{linux, hostId:"boot-W", nsId:"pid:[4026531840]"}`; report RL-wsl | resolve | `host` |
| E17 | Another distro in the same WSL2 VM | decision-table | L1 | automated | ctx as E16; report RL-wsl with `distro:"Debian"`, `nsId:"pid:[4026532111]"`, same `hostId:"boot-W"` | resolve | `foreign` |
| E18 | Resolution 5 — legacy POSIX server | EP | L1 | automated | ctx SL, then ctx SM; no report; cwd `/home/u/p` | resolve ×2 | `host`, `host` (documented residual: legacy container resolves `host`) |
| E19 | Resolution 5 — legacy win32 BVA on cwd first char | BVA | L1 | automated | ctx SW; no report; cwd = `/home/u/p`, `//wsl.localhost/Ubuntu/home/u`, `C:\Users\u\p`, `\\wsl$\Ubuntu\home\u`, `` (empty) | resolve ×5 | `legacy-wsl`, `legacy-wsl`, `unknown`, `unknown`, `unknown` |
| E20 | Resolution 5 — ownEntryPid on win32 | decision-table | L1 | automated | ctx SW; no report; pid 4242; cwd `/home/u/p`; `ownEntryPid` = 4242 / 4243 / undefined | resolve ×3 | `host`, `legacy-wsl`, `legacy-wsl` |
| E21 | Resolution 5 — ownEntryPid ignored when a report exists | decision-table | L1 | automated | ctx SL; report RL-ctr; `ownEntryPid` = 4242 = pid | resolve | `foreign` |
| E22 | Resolution 5 — ownEntryPid on POSIX | EP | L1 | automated | ctx SL; no report; `ownEntryPid` 9999 ≠ pid 4242 | resolve | `host` |
| E100 | Resolution 4 — missing `hostId` (S1) | decision-table (side × presence) | L1 | automated | ctx SW; report `{platform:"win32", kind:"host"}` (no `hostId`); then ctx SM without `hostId` and report RM; then ctx SW without `hostId` and report RW | resolve ×3 | `unknown`, `unknown`, `unknown` (never `host`, never `foreign`) |

### Edge-case — bridge builder + wire (`buildPidNamespace`), new `packages/shared/src/__tests__/pid-namespace.test.ts`
Harness to copy: `packages/shared/src/__tests__/platform-process.test.ts` (injected exec/kill style).

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E50 | Bridge inside WSL reports distro + namespace | EP | L1 | automated | `platform:"linux"`, `WSL_DISTRO_NAME="Ubuntu-24.04"`, `readlink(/proc/self/ns/pid)="pid:[4026531840]"`, boot_id `boot-W` | `buildPidNamespace(opts)` | `{platform:"linux", kind:"wsl", distro:"Ubuntu-24.04", nsId:"pid:[4026531840]", hostId:"boot-W"}` |
| E51 | `kind` from env | EP | L1 | automated | `WSL_DISTRO_NAME` unset; then `""` | build ×2 | `kind:"host"` and no `distro` key, both times |
| E52 | Unreadable `nsId` omitted | fault-injection (abort) | L1 | automated | linux; `readlink` throws EACCES; boot_id readable | build | `nsId` key absent, `hostId` present, no throw |
| E53 | Unreadable boot_id omitted, no hostname fallback on Linux | fault-injection (abort) | L1 | automated | linux; boot_id read throws ENOENT; `hostname()` spy | build | `hostId` key absent; `hostname` spy 0 calls |
| E54 | Non-Linux never reads /proc | EP | L1 | automated | `platform` = `darwin`, then `win32`; `hostname()="mac.local"` / `"WINBOX"`; `readlink`/`readFile` spies | build ×2 | `hostId` = hostname; no `nsId` key; `readlink`/`readFile` 0 calls |
| E55 | Hostname failure | fault-injection (abort) | L1 | automated | `platform:"win32"`; `hostname()` throws | build | `hostId` key absent, no throw |
| E56 | Omitted ≠ null on the wire | EP | L1 | automated | E52 output inside a `session_register` | `JSON.parse(JSON.stringify(msg)).pidNamespace` | has no `nsId` key (not `null`, not `undefined`-stringified) |
| E57 | Server ctx uses the same builder | invariant | L1 | automated | identical opts fixture passed to the server-ctx constructor and to the bridge builder | compare | deep-equal (`platform`,`hostId`,`nsId`) |
| E58 | Every register site carries the field | decision-table (site) | L1 | automated | register built at `session-sync.ts:154`, `session-sync.ts:298`, `bridge-handlers/lifecycle.ts:585`, `bridge.ts:1695` (provisional), each with pid 1083 and builder stubbed to RL | emit register | each message has `pidNamespace` deep-equal to the builder output; 4/4 sites |
| E59 | Reattach equals first register | state-transition | L1 | automated | first register then reattach register, builder stubbed | compare | `pidNamespace` identical in both |
| E60 | ACP adapter registers in-process namespace | EP | L1 | automated | ACP adapter with `reportPid:5150`, builder stubbed to RL | `registerMessage("spawn")` and `("reattach")` | both carry `pid:5150` and `pidNamespace` deep-equal to RL |

Nearest harnesses: E58/E59 → `packages/extension/src/__tests__/session-register-carries-pid.test.ts` and `session-sync.test.ts`; E60 → `packages/server/src/acp-bridge/__tests__/adapter-harness.ts`.

### Edge-case — store, link, protocol back-compat
| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E70 | Stored atomically with `pid` (replace) | state-transition | L1 | automated | session with `pid:5`, `pidNamespace:RL-wsl` | re-register with `pid:6`, no `pidNamespace` | stored `pid` 6, `pidNamespace` undefined (not stale RL-wsl) |
| E71 | Register without `pid` clears both | state-transition | L1 | automated | session with `pid:5`, ns RL | re-register with no `pid` | `pid`, `pidRecordedAt`, `pidNamespace` all undefined |
| E72 | Provisional keeps namespace | state-transition | L1 | automated | provisional register `{pid:1083, pidNamespace:RL-wsl}` then commit | read stored session | `pid` 1083 and `pidNamespace` deep-equal RL-wsl |
| E73 | Provisional then direct, no mixing | state-transition | L1 | automated | provisional `{pid:100, ns:RL}`, then direct `{pid:200, ns:RL-ctr}`; second case direct `{pid:200}` without ns | read stored after each | `{200, RL-ctr}`; then `{200, undefined}` (never `{200, RL}`) |
| E74 | Provisional register with ns but no pid | EP | L1 | automated | provisional `{pidNamespace:RL}` no pid | commit | stored `pid` undefined and `pidNamespace` undefined |
| E75 | Legacy bridge | EP | L1 | automated | register without `pidNamespace`, pid 4242 | read stored | `pidNamespace` undefined (unreported); no throw |
| E76 | Tier 2 skipped for non-local | decision-table | L1 | automated | registry entry `{pid:4242, cwd:"/a"}` unlinked; register `{pid:4242, cwd:"/a", no token}` with target = foreign / wsl / legacy-wsl | link | entry stays unlinked in all 3 cases (`getPid(sessionId)` undefined) |
| E77 | Tier 3 skipped for non-local | decision-table | L1 | automated | entry `{pid:7001, cwd:"/a"}`; register `{pid:4242, cwd:"/a"}`, target foreign | link | entry unlinked (no cwd-FIFO) |
| E78 | `unknown` target: pid tier needs cwd match | BVA (cwd equal / differ) | L1 | automated | entry `{pid:4242, cwd:"/a"}`; register pid 4242 target unknown, cwd `/a` then `/b` | link ×2 | linked by pid; then NOT linked by pid |
| E79 | `unknown` target: cwd-FIFO allowed | EP | L1 | automated | entry `{pid:7001, cwd:"/a"}`; register pid 4242 target unknown cwd `/a` | link | linked (cwd-FIFO) |
| E80 | Tier 1 unchanged for non-local | decision-table | L1 | automated | entry with token `T1`; register target foreign carries `spawnToken:"T1"` | link | linked by token |
| E81 | Stale token falls through, tiers 2–3 skipped | state-transition | L1 | automated | register target wsl with token `STALE`, matching pid and cwd entry | link | not linked |
| E82 | Link time never circular | invariant | L1 | automated | win32 ctx; legacy register pid 4242 cwd `/home/u/p`; entry `{pid:4242}` unlinked | link | not linked (`legacy-wsl`, evaluated without `ownEntryPid`) |
| E83 | Host target unchanged | EP | L1 | automated | entry `{pid:4242, cwd:"/x"}`; host register pid 4242 cwd `/y` | link | linked by pid |
| E84 | Watchdog pid tier skipped | decision-table | L1 | automated | armed watchdog `{spawnPid:777, cwd:"/a", token:"T1"}`; register target foreign, pid 777, cwd `/zzz`, no token; repeat with wsl | register handler | watchdog still armed; fires after its timeout |
| E85 | Watchdog pid tier still clears host | EP | L1 | automated | as E84 with host target | register | watchdog cancelled |
| E107 | Watchdog cwd tier for non-local register (S11) | decision-table | L1 | automated | armed watchdog `{cwd:"/a"}`, no token, no pid; register target wsl, cwd `/a`, no token; repeat with foreign | register handler | watchdog cancelled by the cwd tier in both cases; the pid tier made 0 `clearByPid` calls |
| E86 | Process-list index | decision-table | L1 | automated | connected sessions A host pid 100, B foreign pid 101, C wsl pid 102, D unknown pid 103; E host pid 104 not connected; process_list pi entries pids 100–104 | `buildPidIndex` + classify | pid 100 → `sub-session`, `sessionRef` A; pids 101, 102, 103, 104 → `pi-worker`, no `sessionRef` |
| E87 | Same pid number in two namespaces | decision-table | L1 | automated | A host pid 100; B foreign pid 100; local pi process pid 100 | classify | `sessionRef` = A only |
| E88 | Same-pid fast accept by target | decision-table | L1 | automated | incumbent pid 4242 live OPEN socket whose stored target equals the newcomer's; newcomer pid 4242, target = host / unknown-on-win32 / unknown-on-POSIX / wsl / foreign / legacy-wsl | `decideClaim` | `accept same-pid` for host and unknown-win32; `probe` for the other four |
| E89 | Differing pid still no advantage | EP | L1 | automated | newcomer host pid 4243, incumbent 4242 | `decideClaim` | `probe` |
| E90 | Placeholder/provisional unchanged | EP | L1 | automated | newcomer target wsl; incumbent `source:"unknown"` | `decideClaim` | `accept placeholder` (placeholder rule precedes pid rule) |
| E102 | Same-pid fast accept — incumbent in another namespace (S3) | decision-table (incumbent × newcomer target) | L1 | automated | incumbent socket holds `S` with `{pid:5, ns: RL-wsl}` on ctx SW (target wsl); newcomer target host, pid 5; then incumbent host + newcomer host; then incumbent unknown + newcomer unknown on win32; then incumbent host + newcomer unknown on win32 | `decideClaim` ×4 | `probe`; `accept same-pid`; `accept same-pid`; `probe` |
| E91 | Old bridge, POSIX server (back-compat) | EP | L1 | automated | register without namespace, pid 4242 → operator force-kill | force-kill | `killProcess(4242,{timeoutMs:2000})` once (unchanged) |
| E104 | Namespace persisted with `pid` (S5) | state-transition | L1 | automated | session `{pid:4242, pidNamespace:RL-wsl}` saved, server store reloaded (restore); a second persisted JSON `{pid:4242}` with no `pidNamespace` | save → load → `resolvePidTarget` on ctx SW | first: stored namespace deep-equal RL-wsl and target `{wsl, "Ubuntu-24.04"}`; second: `pidNamespace` undefined (legacy rules); no throw |
| E105 | Namespace is server-internal (S6) | decision-table (channel) | L1 | automated | session with `pidNamespace:RL`; channels: `session_list`, `session_updated`, REST session GET, paired-peer sync payload | serialize each channel | `JSON.stringify` of each payload contains no `pidNamespace` key and no `boot-A` / `pid:[4026531836]` string; the in-memory session still has it |
| E106 | Malformed `pidNamespace` (S7) | error-guessing | L1 | automated | register with `{kind:"wsl"}` (no distro); `{platform:42}`; `nsId:null`; an array; a string; each as `pidNamespace`, pid 4242, ctx SL | register, then `resolvePidTarget` | register succeeds (session stored, no throw, no close); target `unknown` in all 5 cases (not `host`, not `foreign`) |
| E109 | Field-length caps (S7) | BVA | L1 | automated | `distro` of 64 / 65 chars; `hostId` of 128 / 129 chars; `nsId` of 128 / 129 chars (otherwise valid RL-wsl) | register, then resolve | 64 and 128 accepted (resolves on its merits); 65 and 129 ⇒ `unknown`; a 1 MB `hostId` is rejected without being stored or logged in full |

Nearest harnesses: E70/E71/E75 → `packages/server/src/__tests__/memory-session-manager.test.ts`; E72–E74 → `packages/server/src/pi/__tests__/provisional-registration.test.ts`; E76–E83 → `packages/server/src/__tests__/headless-pid-registry.test.ts` + `spawn-correlation-token-integration.test.ts`; E84–E85 → `packages/server/src/__tests__/spawn-register-watchdog.test.ts`; E86–E87 → `packages/server/src/__tests__/process-classifier.test.ts` + `event-wiring-process-classify.test.ts`; E88–E90 → `packages/server/src/__tests__/bridge-contention.test.ts`; E91 → `packages/server/src/__tests__/force-kill-handler.test.ts`.

### Error-handling — kill-safety (never signal an unrelated process)

#### Terminator (`packages/server/src/spawn-process/__tests__/session-terminator.test.ts`)
Spies: `signalZero`, `processStartedAt`, `killProcess`, registry `killBySessionId`.

| id | requirement | technique | level | disposition | fault / input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------------|---------|---------------------|
| X1 | Unattended foreign refused before probe | decision-table | L1 | automated | session `originDeviceId` set, pid 4242, no registry entry | `terminate(id, {operator:false, verifyIdentity:true})` | `outcome:"refused-identity"`, `terminated:false`; `signalZero`, `processStartedAt`, `killProcess` each 0 calls |
| X2 | Unattended foreign, registry rung still runs | decision-table | L1 | automated | as X1 plus a registry entry linked by token to the session | terminate | registry `killBySessionId` called once; outcome `refused-identity`; `killProcess` 0 calls |
| X3 | Unattended WSL on win32 never probed | decision-table | L1 | automated | ctx SW; report RL-wsl, pid 4242 | terminate unattended | `refused-identity`; `signalZero` 0 calls (no ESRCH ⇒ no `confirmed-dead`); `killProcess` 0 calls |
| X4 | Unattended legacy-wsl | decision-table | L1 | automated | ctx SW; no report; cwd `/home/u/p` | terminate unattended | `refused-identity`; all 3 spies 0 calls |
| X5 | Unattended unknown on win32 | decision-table | L1 | automated | ctx SW; no report; cwd `C:\p` | terminate unattended | `refused-identity`; `signalZero` 0 calls (refusal now precedes the liveness probe) |
| X6 | Unattended unknown on POSIX | decision-table | L1 | automated | ctx SL without `nsId`; report RL | terminate unattended | `refused-identity`; all 3 spies 0 calls |
| X7 | Unattended host unchanged | EP | L1 | automated | ctx SL; report RL; `signalZero` → alive; `processStartedAt` consistent | terminate unattended | `killProcess(4242, …)` once; `confirmed-dead` after `signalZero` → esrch |
| X8 | Operator non-local → `not-local` | decision-table | L1 | automated | foreign, wsl, legacy-wsl in turn | `terminate(id, {operator:true})` | `outcome:"not-local"`, `terminated:false`, `pid:4242`; 3 spies 0 calls (×3) |
| X9 | Operator unknown on win32 keeps signal (Q8) | decision-table | L1 | automated | ctx SW; no report; cwd `C:\p` | operator terminate | `killProcess(4242, …)` once |
| X10 | Operator unknown on POSIX | decision-table | L1 | automated | ctx SL without `nsId` | operator terminate | `not-local`; `killProcess` 0 calls |
| X11 | `operator` independent of `verifyIdentity` | decision-table (2×2 on host) | L1 | automated | host target; `{operator:true, verifyIdentity:true}` and `{operator:true, verifyIdentity:false}` | terminate | with `verifyIdentity:true` the identity guard still runs (`processStartedAt` 1 call); with `false` it does not (0 calls) |
| X12 | Absent `operator` = unattended | EP | L1 | automated | foreign target; options `{verifyIdentity:false}` only (today's shutdown shape) | terminate | `refused-identity` (never a signal) |
| X13 | Resolve once, before the registry rung | race / state-transition | L1 | automated | ctx SW; legacy session pid 4242 cwd `/home/u/p`; registry entry pid 4242 linked; registry kill deletes the entry (`getPid` → undefined afterwards) | operator terminate | `resolvePidTarget` called once; its `ownEntryPid` arg = 4242; verdict `host`; `killProcess` called once (not `not-local`) |
| X14 | Idempotent refusals | state-transition | L1 | automated | foreign session | terminate unattended ×2, operator ×2 | `refused-identity` ×2, `not-local` ×2; all spies 0 calls |
| X15 | No signal on dead-looking foreign pid | fault-injection (abort) | L1 | automated | foreign pid; `signalZero` stub returns `esrch` | terminate unattended and operator | `terminated:false` both; `signalZero` 0 calls; session not reported `confirmed-dead` |
| X100 | Operator `not-local` still runs the registry rung (S8) | decision-table | L1 | automated | foreign session, pid 4242, registry entry linked by token to the session | `terminate(id, {operator:true})` | registry `killBySessionId` called once; outcome `not-local`, `terminated:false`; `killProcess` / `signalZero` / `processStartedAt` 0 calls |
| X101 | Q8 matrix on a Windows server | decision-table (path × target) | L1 | automated | ctx SW; legacy native session (no report, cwd `C:\p`, target `unknown`) | operator terminate; `force_kill`; unattended terminate; idle-reaper sweep | operator terminate: `killProcess` once; force-kill: `killProcess` once; unattended: `refused-identity`, 0 spies; reaper: `probe` 0 calls |
| X102 | Token-only terminate resolves no target (S8) | EP | L1 | automated | `terminate("", {spawnToken:"T1", operator:false})` with a registry entry for `T1`; no session | terminate | registry kill by token called once; `resolvePidTarget` 0 calls; `signalZero` / `killProcess` 0 calls |

#### Shutdown handler (`packages/server/src/browser-handlers/__tests__/shutdown-terminator-delegation.test.ts`)
| id | requirement | technique | level | disposition | fault / input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------------|---------|---------------------|
| X20 | Shutdown of remote-origin = unconfirmed | state-transition | L1 | automated | session `originDeviceId` set, pid 4242 | browser `shutdown` message | `session_orphaned` with pid 4242 emitted alongside `session_removed`; a log line emitted; `killProcess` 0 calls |
| X21 | Shutdown passes `operator:true` | EP | L1 | automated | any session | `shutdown` | injected `terminate` called with `operator:true` |
| X22 | Shutdown of host unchanged | EP | L1 | automated | host target, terminator returns `confirmed-dead` | `shutdown` | no `session_orphaned`; `session_removed` |
| X23 | Shutdown of unknown on win32 | EP | L1 | automated | ctx SW legacy native pid | `shutdown` | terminator signalled (today's behaviour); no `session_orphaned` when confirmed |
| X24 | REST shutdown route same result | EP | L1 | automated | as X20 via REST shutdown route | `POST` shutdown | same `session_orphaned` + `session_removed` as X20 |

#### Force-kill (`packages/server/src/__tests__/force-kill-handler.test.ts`)
Spies: `killProcess`, gateway `closeBridge`, `sessionManager.update`, browser broadcast.

| id | requirement | technique | level | disposition | fault / input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------------|---------|---------------------|
| X30 | Force-kill remote-origin refused | decision-table | L1 | automated | live session `originDeviceId:"dev-remote-1"`, pid 4242, status `active` | `force_kill` | `killProcess` 0 calls; `closeBridge` 0 calls; status still `active`; no `session_updated` with status `ended`; `force_kill_result {success:false, message ~ /not on this host/}` |
| X31 | Force-kill WSL on win32 never uses taskkill | decision-table | L1 | automated | ctx SW; report RL-wsl, pid 4242 | `force_kill` | `killProcess` (taskkill seam) 0 calls; same refusal fields as X30 |
| X32 | Legacy WSL on win32 | decision-table | L1 | automated | ctx SW; no report; cwd `/home/u/p` | `force_kill` | refused as X30 |
| X33 | Unknown on POSIX refused | decision-table | L1 | automated | ctx SL no `nsId`; report RL | `force_kill` | refused as X30 |
| X34 | Unknown on win32 keeps signal | decision-table | L1 | automated | ctx SW; no report; cwd `C:\p` | `force_kill` | `killProcess(4242,{timeoutMs:2000})` once; `closeBridge` once; status `ended` |
| X35 | Host unchanged, resolve before close | state-transition | L1 | automated | ctx SL; report RL | `force_kill` | call order: resolve → `killProcess` → `closeBridge`; `force_kill_result.success:true` |
| X36 | Refusal precedes close | state-transition | L1 | automated | foreign | `force_kill` | `closeBridge` never called at any point (including after `await`s); bridge socket `readyState` still OPEN |
| X37 | Snapshot consistency (race) | race | L1 | automated | session `{pid:100, ns:RL}` resolves host; `killProcess` stub is async; during the first await the session is replaced by `{pid:5555, ns:RL-wsl}` | `force_kill` | `killProcess` called with 100 only; never with 5555 |
| X38 | Force-kill then shutdown on the same session | state-transition | L1 | automated | foreign session; X30 first | then `shutdown` | `not-local`; `session_orphaned` pid 4242; `session_removed` |
| X39 | Token-linked registry entry on a refused force-kill | decision-table | L1 | automated | foreign session with registry entry linked by token, pid 4242 | `force_kill` | `killProcess` 0 calls; registry `killBySessionId` 0 calls (refused ≠ partially executed) |
| X40 | Forked sibling still safe | regression | L1 | automated | existing scenarios "token-linked sibling" and "pid-linked sibling" with host targets | `force_kill` on F | killed pid 1234 only; 1000 not signalled (existing tests stay green) |
| X41 | No direct `process.kill` | regression | L1 | automated | `session-action-handler.ts` source | `no-direct-process-kill.test.ts` | passes (no `process.kill(` added) |
| X103 | No pid ⇒ no-pid branch before resolution (S2) | state-transition | L1 | automated | live session `originDeviceId:"dev-remote-1"`, no `pid`; then a foreign-report session with no `pid` | `force_kill` | `resolvePidTarget` 0 calls; bridge socket closed once; `force_kill_result {success:true}` with the WS-only message; `killProcess` 0 calls |

#### Carrier loss (`packages/server/src/__tests__/session-death-attribution.test.ts` + gateway tests)
| id | requirement | technique | level | disposition | fault / input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------------|---------|---------------------|
| X50 | Table of targets | decision-table | L1 | automated | pid 4242; `kill` stub throws ESRCH | `classifyCarrierLoss(session, target)` for host, foreign, wsl, legacy-wsl, unknown | host → `process_gone` (1 `kill` call); other four → `unknown`, 0 `kill` calls |
| X51 | Host alive / EPERM | EP | L1 | automated | host; `kill` stub returns alive; then throws EPERM | classify ×2 | `unknown`, `unknown` |
| X52 | No pid | EP | L1 | automated | `{}` and `{originDeviceId:"d"}` with no pid | classify | `unknown`, 0 `kill` calls |
| X53 | Gateway caller 1: reconnect grace expiry | state-transition | L1 | automated | foreign session; grace period elapses (fake timers) | expiry fires | `unregister` called with `closedReason:"unknown"`; `kill` 0 calls |
| X54 | Gateway caller 2: sleep-recovery failure | state-transition | L1 | automated | WSL-on-win32 session | recovery fails | `closedReason:"unknown"`; `kill` 0 calls |
| X55 | Gateway caller 3: heartbeat timeout | state-transition | L1 | automated | legacy-wsl session | `hbTimeout` ms of silence | `closedReason:"unknown"`; `kill` 0 calls |
| X56 | Gateway caller 4: ping timeout | state-transition | L1 | automated | foreign session; N missed pongs | ping timeout | `closedReason:"unknown"`; `kill` 0 calls |
| X57 | Host through gateway still `process_gone` | EP | L1 | automated | host session, `kill` → ESRCH, heartbeat timeout | timeout | `closedReason:"process_gone"` |

Nearest harness for X53–X57: `packages/server/src/__tests__/pi-gateway-duplicate-register.test.ts` / `pi-gateway-teardown.test.ts`.

#### Idle reaper (`packages/server/src/embed-lifecycle/__tests__/idle-reaper.test.ts`)
| id | requirement | technique | level | disposition | fault / input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------------|---------|---------------------|
| X60 | Probe skipped for non-host | decision-table | L1 | automated | sessions foreign, wsl, legacy-wsl, unknown, each pid 321; `deps.probe` spy | `assembleSignals` via one sweep | `probe` 0 calls ×4; signals `hasLiveChild:true`, `cpuIdle:false` |
| X61 | Probe used for host | EP | L1 | automated | host session pid 321 | sweep | `probe(321)` once |
| X62 | Non-host never idle-reaped by CPU/child signals | state-transition | L1 | automated | foreign session idle beyond `idleTimeoutMs` but below `hardCeilingMs` | sweep | `terminate` 0 calls (unknown probe ⇒ not idle) |
| X63 | Refusal not retried | state-transition | L1 | automated | foreign session beyond `hardCeilingMs`; `terminate` returns `refused-identity` | 3 consecutive sweeps | `terminate` called exactly once in total (give-up tracker unchanged) |
| X64 | No pid unchanged | EP | L1 | automated | session without pid | sweep | `probe` 0 calls; signals as today |

#### Repo enforcement test (D5), new `packages/server/src/__tests__/pid-target-enforcement.test.ts`
Harness: `packages/shared/src/__tests__/no-direct-process-kill.test.ts` (fs scan + allowlist). Scanner tested against temp-dir fixture files.

| id | requirement | technique | level | disposition | fault / input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------------|---------|---------------------|
| X70 | Tree is clean | regression | L1 | automated | `packages/server/src` after the change | run scanner | every file with a matching call is on the allowlist; each `resolves` entry contains a real `resolvePidTarget(` call; `own-spawn` entries are exempt and carry a reason |
| X71 | New unresolved consumer fails | mutation | L1 | automated | fixture `x.ts`: `signalZero(session.pid)` with no `resolvePidTarget` | run scanner on fixture dir | test fails, message names `x.ts` |
| X72 | Each helper is covered | decision-table | L1 | automated | one fixture per helper, argument shape irrelevant: `killProcess(s.pid)`, `killPidWithGroup(pid)`, `killProcessGroup(x)`, `isProcessAlive(s.pid)`, `processStartedAt(s.pid)`, `deps.probe(s.pid)` | scan | 6/6 fail, each naming its file |
| X73 | Allowlist needs a real call | mutation | L1 | automated | allowlisted fixture with `// resolvePidTarget(` only in a comment and `"resolvePidTarget("` in a string | scan | fails (comment/string is not a call) |
| X74 | Resolved module passes | EP | L1 | automated | fixture on the fixture allowlist as `resolves`, with `resolvePidTarget(s, ctx)` and `signalZero(s.pid)` | scan | passes |
| X75 | `handler` no direct kill | regression | L1 | automated | `no-direct-process-kill.test.ts` | run | still green |
| E103 | Scan is argument-free; `own-spawn` allowlist (S4) | mutation | L1 | automated | fixture dir: (a) `x.ts` with `const {pid} = session; signalZero(pid)`; (b) `y.ts` with `killProcess(entry.pid)` tagged `own-spawn` in the fixture allowlist and containing no `resolvePidTarget(`; (c) `__tests__/z.test.ts` calling `killProcess(1)`; (d) the real tree files `headless-pid-registry.ts`, `home-lock.ts`, `server.ts` | run scanner | (a) fails naming `x.ts`; (b) passes; (c) ignored; (d) pass as `own-spawn` entries with a reason tag |

### Error-handling — real-process runtime (L2)

| id | requirement | technique | level | disposition | fault / input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------------|---------|---------------------|
| X80 | Linux: remote-origin pid never signalled, host control kills | fault-injection | L2 | automated | new `qa/tests/54-pid-target.sh` (copy `qa/tests/17-bridge-contention.sh` harness): real server; two real `sleep 600` children C1, C2; fake bridge WS registers C1's pid as a session with `originDeviceId` set, C2's pid as a host-target session (real `buildPidNamespace` output) | browser `force_kill` for the remote session, then `shutdown` for it, then `force_kill` for the host session | `kill -0 C1` succeeds after both remote actions; `force_kill_result.success:false` for the remote one; `kill -0 C2` fails within 5 s after the host one |
| X81 | Linux: container pid namespace is foreign | fault-injection | L2 | automated | same script; a bridge started inside `unshare --pid --fork --mount-proc` (needs root; script SKIPs with exit 0 when `unshare` is unavailable) registers with its in-namespace pid equal to a live host `sleep` C3 pid | `force_kill` | `pidNamespace.nsId` differs from the server's; `kill -0 C3` succeeds; `success:false` |
| X82 | Windows: WSL-reported pid never taskkilled | fault-injection | L2 | automated | new `qa/tests/54-windows-pid-target.ps1` (copy `qa/tests/45-windows-reclaim-refused.ps1`): real server + real `node` child C4; fake bridge WS registers `pid = C4.Id` with `pidNamespace` RL-wsl | `force_kill`, then `shutdown` | `Get-Process -Id C4.Id` still alive; `force_kill_result.success:false`; `session_orphaned` pid C4.Id |
| X83 | Windows: legacy WSL (cwd `/home/u`) not killed | fault-injection | L2 | automated | as X82 without `pidNamespace`, cwd `/home/u/p` | `force_kill` | C5 alive; `success:false` |
| X84 | Windows: legacy native pi still stoppable (Q8 control) | fault-injection | L2 | automated | as X82 without `pidNamespace`, cwd `C:\work`; real `node` child C6 | `force_kill` | C6 exited within 5 s; `success:true` |
| X85 | Windows: unattended reclaim refused for native legacy | fault-injection | L2 | automated | as X84 with C7; run the real terminator `operator:false` (as 45 script) | terminate | `refused-identity`; C7 alive |
| X86 | Windows job wiring | ci | ci | automated | `.github/workflows/ci-gateway-platform.yml` `windows` job (`windows-latest`) | add steps running `54-windows-pid-target.ps1` | job runs the script; exit code non-zero fails the job |

### Performance

Decision S10: no timing threshold. The resolver does no I/O per call; this is asserted structurally, not timed.

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P100 | Resolver does no I/O per call (S10) | structural invariant | L1 | automated | `resolvePidTarget` over 500 sessions (host, foreign, wsl, legacy-wsl, unknown mix) with `fs` and `child_process` spies; plus the import list of `pid-target.ts` | 0 `fs` / `child_process` calls; `pid-target.ts` imports neither module | one run |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | Real WSL2 distro against a Windows dashboard | exploratory | — | manual-only | Windows host with WSL2 Ubuntu; pi session started inside WSL and registered to the Windows server; a Windows process started with the same pid number is not feasible to force | operator presses Shutdown, then Force-kill in the UI | [judgment: real WSL pid observed in `session_orphaned`; UI message reads "process not on this host"; the Windows process table shows no kill — needs real WSL2 hardware, not reproducible in CI] |
| M2 | New bridge, previous-release server | exploratory | — | manual-only | server from the last published release (no `pidNamespace` support), bridge from this change | register, then Shutdown and Force-kill | [judgment: registration succeeds, no rejection of the unknown field, today's kill behaviour; no old-server artifact exists in-repo] |

---

## Coverage summary

- Requirements covered: all 7 delta capabilities (force-kill-handler, shared-protocol, spawn-correlation, session-death-attribution, process-list-classification, spawn-register-watchdog, bridge-contention). Every decision Q8, S1–S11 maps to at least one row (see "Decisions applied").
- Scenarios by class: edge 63 · perf 1 · frontend 0 · error 62 · manual 2
- Scenarios by level: L1 119 · L2 6 · L3 0 · ci 1 · — (manual) 2  (128 rows)
- Scenarios by disposition: automated 126 · manual-only 2

## New infra needed

- `packages/shared/src/pid-namespace.ts` (builder) needs an injectable opts bag (`platform`, `env`, `readlink`, `readFile`, `hostname`) so E50–E57 are unit-testable; not stated in the spec, implementer's seam.
- `qa/tests/54-pid-target.sh` and `qa/tests/54-windows-pid-target.ps1` (new; number 54 because 46–52 exist and 53 is reserved by `add-windows-process-identity`): a fake-bridge WebSocket client that sends `session_register` with an arbitrary `pid` + `pidNamespace` and a browser-WS client that sends `force_kill` / `shutdown`; reuse the WS plumbing in `qa/tests/03-websocket.sh|ps1` and `17-bridge-contention.sh`.
- `.github/workflows/ci-gateway-platform.yml`: add the 54 ps1 step to the existing `windows` (windows-latest) job; add the `.sh` to a Linux/macOS job (X81's `unshare` needs sudo — skip-with-note otherwise).
- `packages/server/src/__tests__/pid-target-enforcement.test.ts`: scanner helper that runs on a fixture dir as well as on the real tree (X71–X74).
