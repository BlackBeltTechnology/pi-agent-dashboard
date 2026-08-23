## 1. Lock the current behaviour and the target behaviour in tests

- [x] 1.1 Write a failing test proving the gateway currently accepts an unauthenticated connection that can register an arbitrary `sessionId` (documents the hole this change closes)
- [x] 1.2 Write a failing test for local endpoint resolution: derives from the injected `homedir`, is stable across calls, differs for two distinct HOMEs, and never consults discovery
- [x] 1.3 Write a failing integration test: a bridge connects over a unix socket and completes `session_register`
- [x] 1.4 Write a failing test proving WebSocket `ping`/`pong` still resolves the contention probe over a socket transport (guards the `bridge-contention.ts` liveness oracle)
- [x] 1.5 Write a failing test for precedence: an explicit endpoint is not replaced by a discovered candidate
- [x] 1.6 Write a failing test for stickiness: a registered bridge reconnects to the same instance, and refuses an unverified candidate
- [x] 1.7 Write a failing test proving a live socket is never unlinked: a second instance starting on an occupied path aborts with a conflict and leaves the incumbent serving
- [x] 1.8 Write a failing test proving a bridge refuses an instance whose identity differs from the rendezvous record, even when the local credential is valid
- [x] 1.9 Confirm 1.2–1.8 fail against current `main` for the stated reason, not an unrelated error

## 2. Rendezvous and local socket transport (D0, D1, D2, D9, D15)

- [x] 2.0a **Wire `home-lock` — it currently has no production caller.** Call `acquireOrAttach` on server startup so the rendezvous record is actually written, and release it on shutdown via `home-lock-release.ts`. Verify a `server.lock` appears on disk for a running dashboard (today none exists)
- [x] 2.0b Re-root the lock/record path onto `dashboard-paths.ts` so the record and the socket share one home root; `canonicalHomedir()` is `$HOME`-immune (`home-lock.ts:96-105`) while `dashboard-paths.ts` honours `$HOME`, and the temp-HOME isolated-verification workflow needs the `$HOME`-honouring root. Cheap now precisely because the module is unwired
- [x] 2.0c Define what an `attach`-mode instance does on startup: bind its own `gateway-<piPort>.sock`, serve only pinned bridges, and **not** write the rendezvous record. `acquireOrAttach` returns `{mode:"attach", meta}` describing the *holder*, so the translation to server behaviour must be explicit, not inferred
- [x] 2.0d **Persist the instance id** at `<dashboardConfigDir>/instances/<piPort>.id` (file `0600`, dir `0700`): generate once, reuse across restarts, pass as `home-lock`'s `config.identity`. The `randomUUID()` default (`home-lock.ts:290`) is per *acquisition* and dies on every restart, which would make a benign restart indistinguishable from an endpoint capture and put D4 stickiness in conflict with D14
- [x] 2.0d-i Test the two properties together: the id is **unchanged across a restart** on the same port, and **differs** between two instances on different ports
- [x] 2.0d-ii Do NOT use the per-HOME Ed25519 fingerprint (`auth/identity.ts`) as the instance id — it is shared by every same-HOME dashboard. A cross-model reviewer conflated the two, so assert the distinction in a test
- [x] 2.0e Expose the instance id on `/api/health` as `instanceId` — **not** `identity`, which `server.ts:1600` already binds to the Ed25519 object; reusing the name makes every second instance throw `InstanceLockMismatchError` instead of attaching
- [x] 2.0e-i **Change both read sites, or the check silently dies.** `isLockHolderResponsive` compares `res.identity === meta.identity` (`home-lock.ts:219-220`) and `defaultProbeHealth` reads `body.identity` (`home-lock.ts:240`). Publishing `instanceId` without updating these makes the comparison fall through to the PID-match branch (`home-lock.ts:222-226`) and the verification never runs. Add a test that fails if the field names diverge
- [x] 2.0e-ii Treat the instance id as an **identifier, not a secret**: `/api/health` has no preHandler (`system-routes.ts:479`), so it is published unauthenticated and readable over the network under the container's `0.0.0.0` default. Entitlement SHALL continue to come from the local token / socket ownership, never from knowledge of the id
- [x] 2.0e-iii Specify that a restart on a *different* port yields a new id, and that a bridge pinned to the old endpoint re-resolves from the record rather than refusing
- [x] 2.0h **Make lock takeover acquire-then-verify.** `home-lock.ts:354-368` unlocks and removes metadata unconditionally, so two newcomers observing one dead holder can each delete the other's live lock and fresh record. `proper-lockfile` does NOT fix this — its stale path is `stat → isLockStale → removeLock → acquireLock` with no re-stat before removal (`proper-lockfile/lib/lockfile.js:70-79`). Instead: acquire, then re-read the record and confirm it still names the holder observed dead; if not, release and take the attach path
- [x] 2.0h-i Test the interleaving directly: two starters observing one dead holder must end with exactly one owner, and neither may delete the other's live lock or fresh record
- [x] 2.0i Distinguish an **absent** record from an **unreadable** one — `readMetadata` returns `null` on any failure (`home-lock.ts:174-183`) and `null` is treated as stale, so a live holder with an unreadable sidecar can be stolen from. Absent permits takeover; unreadable fails loudly
- [x] 2.0j-i Specify promotion **detection**: `acquireOrAttach` is one-shot with no polling anywhere in the module, so add a periodic liveness re-check for attach-mode instances plus an on-demand check when a bridge reports the recorded endpoint unreachable. Test that two attach instances racing to promote yield exactly one owner
- [x] 2.0j **Implement promotion:** an attach-mode instance that detects a dead owner SHALL acquire and rewrite the record to name itself. Without it, a crashed owner (no `releaseOnce`) leaves unpinned bridges dialling a dead socket forever, and a clean shutdown silently leaves the HOME with no default while a healthy instance is still running
- [x] 2.0f **Teach the spawn path to pin over the socket.** `process-manager.ts:203` sets `env.PI_DASHBOARD_URL = ws://localhost:<piPort>`, and `PI_DASHBOARD_SOCKET` is handled **nowhere in `packages/`** today. Task 8.1 removes the default TCP listener, which would break this pin and send a non-default instance's spawned sessions to the wrong dashboard — the exact bug `setSpawnDashboardPiPort` exists to prevent. Emit `PI_DASHBOARD_SOCKET` (or an equivalent pinned endpoint) and add the resolver support for it
- [x] 2.0g Re-root `local-token.ts` (currently `os.homedir()`, `local-token.ts:21`) onto `dashboard-paths.ts` alongside the record and socket, or record why divergence is acceptable; on Windows an injected `env.homedir` and `USERPROFILE` disagree, so isolated verification would read the token from a different home than the record
- [x] 2.0 Add a single HOME-derived rendezvous resolver returning `{ endpoint, identity }`, reading the record written in 2.0a; this is the only way any platform learns where to connect
- [x] 2.1 Add `getGatewaySocketPath(env?, piPort)` to `packages/shared/src/dashboard-paths.ts` returning a **per-instance** path (`gateway-<piPort>.sock`), reusing the existing `homedir` seam; POSIX path only in this task
- [x] 2.1b Detect at path-construction time that the path exceeds the platform `sun_path` limit (~104 B macOS / ~108 B Linux), or that the filesystem does not support unix sockets; report the actual cause and fall back to the loopback + local-token transport, never to discovery
- [x] 2.2 Ensure `~/.pi/dashboard/` is created with mode `0700`
- [x] 2.3 In `pi-gateway.ts`, restructure to `WebSocketServer({ noServer: true })` with one shared upgrade/connection handler
- [x] 2.4 Bind an `http.Server` on the socket path; **probe before unlinking** — remove a pre-existing socket file only on `ECONNREFUSED`/`ENOENT`, abort with a conflict error when a live listener answers; `chmod 0600` after bind
- [x] 2.4b **Serialize probe/unlink/bind under an exclusive lock on a companion file** `gateway-<piPort>.sock.lock` (a socket cannot itself be locked), via `proper-lockfile`. Hold it only for the sequence, not for the listener's lifetime. A bind-error guard does NOT work: `bind()` raises `EADDRINUSE` only when the path exists, so a process binding during `[probe → unlink]` has its live socket unlinked and our bind then succeeds silently
- [x] 2.4c Fail closed when the probe is indeterminate — a live listener with a full backlog also returns `ECONNREFUSED`, so "refused" alone SHALL NOT authorise an unlink
- [x] 2.5 Remove the socket file on clean shutdown, and make `stop()` idempotent with respect to a missing file
- [x] 2.6 **Construct `ConnectionManager` with the `ws` package as `WebSocketImpl`** (already a dep, `packages/extension/package.json:41`). `connection.ts:110` defaults to `globalThis.WebSocket`, which rejects `ws+unix://` with `DOMException: expected a ws: or wss: url`; the same swap is required for the Windows token header
- [x] 2.6b Re-test reconnect and error paths against the `ws` client — `connection.ts` carries a workaround tuned to the previous implementation's `onerror`-without-`onclose` behaviour
- [x] 2.7 In the bridge, resolve the socket path and dial `ws+unix://<path>:/`
- [x] 2.8 Make 1.2, 1.3, 1.4, 1.7 pass
- [x] 2.9 Make `address()` transport-aware: it returns `addr.port` only when `typeof addr === "object"` (`pi-gateway.ts:235-238`), so a UDS listener would yield `null` and blank the gateway port in the settings UI

## 3. Endpoint precedence and stickiness (D3, D4)

- [x] 3.1 Introduce a single endpoint-resolution function in the extension implementing the precedence ladder; make it the only place an endpoint is chosen
- [x] 3.2 Mark explicitly configured endpoints as pinned, and make pinning a property the connection layer can read
- [x] 3.3 Refuse any re-target of a pinned endpoint; log both endpoints and the reason
- [x] 3.4 Track the instance the bridge registered with, and require identity verification before any re-target
- [x] 3.5 Make 1.5 and 1.6 pass
- [x] 3.6 Confirm no delta was introduced on the `mdns-discovery` capability (this change must not collide with `fix-bridge-mdns-migration-hijack`)
- [x] 3.7 **Reconcile with `fix-bridge-mdns-migration-hijack` before archiving.** Making explicit endpoints pinned narrows that change's migration scenarios in practice, and both changes touch the same re-target path (`connection.updateUrl`). Re-read its spec at archive time and confirm the merged behaviour is coherent; if it is not, declare the delta rather than leaving the conflict implicit
- [x] 3.8 Verify identity before adopting the instance named by the record: a bridge SHALL refuse an instance whose identity differs from the recorded one; make 1.8 pass

## 4. Local authorisation (D5)

- [x] 4.1 Assert socket mode `0600` and directory mode `0700` in a test
- [x] 4.2 Add a test that a connection from another uid is refused (skip with a recorded reason where the CI user cannot drop privileges)
- [x] 4.3 Confirm no token is required or accepted on the local socket path

## 5. Windows loopback transport (D6)

- [ ] 5.1 On Windows, resolve the local endpoint to `127.0.0.1:<piPort>` from the rendezvous record; no named pipe, no `getGatewaySocketPath`
- [x] 5.2 Pin the Windows local bridge listener to `127.0.0.1` regardless of the configured bind host
- [x] 5.3 Have the bridge read the local token via `ensureLocalToken`'s location and present it on the WebSocket upgrade; verify server-side with `verifyLocalToken`
- [x] 5.4 Reject a loopback bridge connection that presents no token or a wrong token, distinctly from other refusal causes
- [ ] 5.4b **Verify the instance identity in addition to the token (D14).** `local-token.ts` resolves from `os.homedir()`, so the token is per-HOME and shared by every same-HOME dashboard; it cannot answer "is this the instance the record named". Reuse the `identity`-vs-`/api/health` check `home-lock.ts` already performs
- [x] 5.4c Define the Windows mixed-version rollout: the loopback listener is always bound, and an old bridge cannot present a token. State whether tokenless upgrades are refused outright or accepted for a deprecation window, and record the horizon
- [ ] 5.5 **Verify, do not assume**, that `~/.pi/dashboard/local/token` is unreadable by a second OS user on Windows — `chmod` is a documented no-op there, so the guarantee rests on inherited NTFS ACLs
- [ ] 5.6 If 5.5 fails, treat it as a pre-existing defect affecting `identity.key` and `paired-devices.json` too, and raise it as its own change rather than patching it here
- [ ] 5.7 Add a Windows QA arm (alongside `qa/tests/windows-nsis-*.ps1`) covering connect, reconnect, stale-record rejection, and the two-user read test

## 6. Remote bridge authentication (D7)

- [x] 6.1 Add `bridge` to `WsRouteScope` and to `routeScopeForUrl`
- [x] 6.2 Allow a bridge to mint a bridge-scoped ticket using its device bearer
- [x] 6.3 Enforce ticket verification on the TCP bridge upgrade path; reject unauthenticated, reused, expired, and wrong-scope tickets distinctly
- [x] 6.4 Ensure the durable bearer is never sent over the WebSocket
- [x] 6.5 Persist the bridge's device credential with `0600`, consistent with existing credential storage
- [x] 6.6 Add a revocation test: a revoked device cannot obtain a ticket and cannot register
- [x] 6.7 Make 1.1 pass in its inverted form — the previously accepted unauthenticated registration is now refused

## 7. Server identity pinning (D8)

- [x] 7.1 Record the server fingerprint on the bridge at pairing time
- [x] 7.2 Verify possession via the existing nonce challenge before registering
- [x] 7.3 Refuse on mismatch with a distinct, logged reason
- [x] 7.4 Test that a pinned identity reachable at a new address is accepted without re-pairing
- [x] 7.5 Test that an impostor at the expected address is refused

## 8. Listener policy and rollout (D10)

- [x] 8.1 Stop binding the bridge TCP listener by default; make it explicit opt-in
- [x] 8.2 Serve socket and TCP bridges through the same connection handler
- [x] 8.3 Bridge falls back to TCP when no socket is present, so a new bridge works against an old server
- [x] 8.4 Old bridge against a new server keeps working while the TCP listener is enabled
- [x] 8.5 Record a deprecation horizon for the unauthenticated TCP path, so the fallback does not become permanent
- [x] 8.6 **The shipped container default DOES depend on the TCP gateway** — `docker/compose.yml:28` publishes `${PI_GATEWAY_BIND:-0.0.0.0}:${PI_GATEWAY_PORT:-9999}` and `PI_DASHBOARD_HOST` defaults to `0.0.0.0`. Decide and implement one: keep the TCP listener with bridge auth mandatory, or move the container to the socket and update `compose.yml`. The default must not remain an unauthenticated `0.0.0.0:9999`
- [ ] 8.7 Confirm the socket works under the container's `VOLUME ["/home/pi/.pi"]` mount, or that 2.1b's fallback engages cleanly there

## 9. Explicit session move (D11)

- [x] 9.1 Write a failing test: moving to a reachable target registers with the target BEFORE the origin connection closes
- [x] 9.2 Write a failing test: a completed move sets `pinned`, so the next reconnect returns to the moved-to instance
- [x] 9.3 Add a `session_moved` message to the protocol — the only new message type in this change — and have the origin render the session as moved, not crashed
- [x] 9.3a **Add a provisional registration mode to the protocol.** A second registration for one `sessionId` is not inert today: same-pid is accepted with no probe (`bridge-contention.ts:81-84`) and `pi-gateway.ts:532` `connections.set()` takes over routing immediately, after which the origin's sends are dropped by the ownership gate (`pi-gateway.ts:493`). A provisional registration SHALL announce intent, return the target's `instanceId`, and claim neither the routing entry nor a contention slot; routing transfers only on explicit commit
- [x] 9.3a-i Make a refusal on a provisional registration distinguishable from one on a live registration, so it can never set `intentionalClose` on the origin — `connection.ts:451-460` currently treats `register_rejected` as terminal for the session (`pi-gateway.ts:347`)
- [x] 9.3a-ii Test the different-pid path explicitly: a move whose target refuses SHALL leave the origin registered and serving
- [x] 9.3a-iii Give provisional registrations a **TTL**, discarded on expiry exactly as on failure, so unclaimed provisional state cannot accumulate
- [x] 9.3a-iv Ensure a provisional refusal does not disclose whether the `sessionId` exists — otherwise the mode is an oracle for enumerating live sessions. Either make refusal causes indistinguishable to the caller, or require proof of session ownership first
- [x] 9.3a-v Implement the bypass at both named sites: skip `connections.set()` (`pi-gateway.ts:532`) **and** the same-pid fast-accept (`bridge-contention.ts:82-83`)
- [x] 9.3b **Add the overlap capability to `ConnectionManager` — it does not exist today.** `updateUrl()` (`connection.ts:334-340`) sets `this.url` then immediately calls `handleDisconnect()`, tearing down the origin before any target connection exists, and the class holds exactly one `ws`. Implement a provisional second connection that registers on the target and only closes the origin after acknowledgement, aborting back to the origin on failure
- [x] 9.3c Specify and test which connection owns the send ring during the overlap, so no prompt is duplicated or dropped mid-move
- [x] 9.4 Register the session command in the extension, following the `pi.registerCommand("__dashboard_reload", …)` template at `bridge.ts:1367`
- [x] 9.5 Implement `connect <instance>` accepting a socket path, a port, an instance identity, or `default`, resolved through the same ladder as startup
- [x] 9.6 Implement `--list` over rendezvous records visible under the current HOME, and `where` reporting endpoint + identity + pinned
- [x] 9.7 Refuse a move whose target identity does not verify; leave the existing registration untouched
- [x] 9.8 Warn before a move whose target cannot read the session's `.jsonl` (history and resume will not follow)
- [x] 9.9 Make 9.1 and 9.2 pass

## 10. Observability

- [x] 10.1 Log endpoint resolution with the winning precedence rule
- [x] 10.2 Log every refusal to migrate, with both endpoints
- [x] 10.3 Log bridge auth refusals with a distinguishable cause
- [x] 10.4 Log completed moves with origin, destination, and initiator
- [x] 10.5 Confirm all of the above survive `capturePiOutput=false`

## 11. Remote session transcript access (D12, D13)

- [x] 11.1 **Decision gate.** Choose one of the four shapes recorded in D12 (push-at-register / pull-on-demand / federate / log-ship with cursor, or the eager-forward + lazy-backfill hybrid). Record the choice and its reasoning in `design.md` BEFORE writing transport code. **The choice MUST satisfy the spec**, which requires transcript data to outlive the session — D12's own table marks pull-on-demand as failing that, so it is only admissible combined with server-side retention
- [x] 11.2 Re-verify the append-only property against the pinned pi version before relying on a cursor: compaction must not rewrite the `.jsonl`, and branching must continue to write a new file
- [x] 11.3 Write a failing test: a request naming a filesystem path is refused by the bridge
- [x] 11.4 Write a failing test: a request for a session id other than the bridge's own is refused
- [x] 11.5 Write a failing test: a session with a large transcript becomes usable before the transfer completes
- [x] 11.6 Implement the chosen mechanism, addressing session data by id only
- [x] 11.7 Add the origin device identity to the session model, sourced from the bridge's paired-device identity, and make it presentable
- [x] 11.8 Prove two hosts with an identical cwd path produce distinct, correctly attributed sessions
- [x] 11.9 Ensure full-fidelity payloads (beyond the `memory-event-store` 4 KB cap) resolve for remote sessions, not just the truncated in-memory copy
- [x] 11.10 Ensure transcript data remains servable after the remote session ends
- [x] 11.11 Refuse resume/respawn for an ended remote session with an explanatory response; ensure the client does not present resume as available
- [x] 11.12 Confirm local-session resume behaviour is unchanged
- [x] 11.13 Make 11.3, 11.4, 11.5 pass

## 12. Scenario tests (folded from `test-plan.md` — manifest is the source of truth)

### L1 — vitest, `packages/*/src/**/__tests__/*.test.ts`

- [x] 12.1 Extend `packages/shared/src/__tests__/dashboard-paths.test.ts` — socket path fallback at the `sun_path` boundary. Triple: configDir yielding a 103 / 104 / 105-byte socket path on macOS · resolve local endpoint · ≤104 returns a socket path, 105 returns the loopback fallback with a diagnostic naming the length limit rather than `EINVAL`. (test-plan #E1)
- [x] 12.2 Extend `packages/shared/src/__tests__/dashboard-paths.test.ts` — per-instance path distinctness. Triple: piPort 9999 and 9594 under one HOME · resolve socket path for each · two distinct paths under the same config dir. (test-plan #E2)
- [x] 12.3 Extend `packages/server/src/__tests__/home-lock.test.ts` — instance id survives restart. Triple: instance on piPort 9999 with its id file written · stop and start again on 9999 · `instanceId` identical to the pre-restart value. (test-plan #E3)
- [x] 12.4 Extend `packages/server/src/__tests__/home-lock.test.ts` — instance id distinguishes instances. Triple: instances on 9999 and 9594 · read each `instanceId` · values differ. (test-plan #E4)
- [x] 12.5 Extend `packages/server/src/__tests__/home-lock.test.ts` — id file permissions. Triple: fresh HOME · create the instance id file · file mode `0600`, containing dir `0700`. (test-plan #E5)
- [x] 12.6 Extend `packages/server/src/__tests__/home-lock.test.ts` — health field naming regression. Triple: running instance · `GET /api/health` then run `isLockHolderResponsive` · health exposes `instanceId` and the probe reads the SAME field, returning `alive-match` and never falling through to the PID branch. (test-plan #E6)
- [x] 12.7 Extend `packages/extension/src/__tests__/connection.test.ts` — endpoint precedence decision table. Triple: one row per reachable combination of `PI_DASHBOARD_SOCKET`, `PI_DASHBOARD_URL`, pinned identity, record, paired remote, mDNS candidate · resolve endpoint · the highest-precedence present source wins in every row and mDNS wins none. (test-plan #E7)
- [x] 12.8 Extend `packages/extension/src/__tests__/connection.test.ts` — mDNS may not override a pin. Triple: pinned `PI_DASHBOARD_URL` plus a reachable mDNS candidate advertising a different host · resolve endpoint · pinned endpoint chosen, candidate recorded as a suggestion only. (test-plan #E8)
- [x] 12.9 Extend `packages/extension/src/__tests__/connection.test.ts` — absent record does not fall through to discovery. Triple: no rendezvous record for the current HOME · resolve endpoint · reports "no local dashboard available" and substitutes no discovered candidate. (test-plan #E9)
- [x] 12.10 Extend `packages/server/src/__tests__/home-lock.test.ts` — unreadable record is not absent. Triple: record present but unreadable (mode `000`) · attempt takeover · takeover refused and the condition reported distinctly from "absent". (test-plan #E10)
- [x] 12.11 Extend `packages/server/src/__tests__/home-lock.test.ts` — partial record. Triple: record truncated mid-JSON · resolve endpoint · treated as absent, never partially trusted. (test-plan #E11)
- [x] 12.12 Extend `packages/extension/src/__tests__/connection.test.ts` — stickiness decision table. Triple: bridge registered with X, candidate Y whose identity verifies, rows over {pinned, failed} · attempt re-target · re-target only when unpinned AND failed AND identity verifies; every other row keeps X. (test-plan #E12)
- [x] 12.13 New sibling test near `packages/server/src/__tests__/session-file-dedup.test.ts` — bridge serves only its own session. Triple: bridge owning session A · transcript request naming session B · refused, no data for B returned. (test-plan #E13)
- [x] 12.14 New sibling test near `packages/server/src/__tests__/session-file-dedup.test.ts` — no path on the wire. Triple: request carrying `../../etc/passwd` in a path field · bridge receives it · refused with no filesystem read attempted. (test-plan #E14)
- [x] 12.15 New sibling test near `packages/server/src/__tests__/session-file-dedup.test.ts` — origin namespacing. Triple: two hosts each with a session at cwd `/Users/robson/Project/x` · both register with one dashboard · sessions stay distinct and each is attributable to its originating device. (test-plan #E15)
- [x] 12.16 New Windows-facing test modelled on `packages/server/src/__tests__/ws-ticket.test.ts` — loopback pin. Triple: `--host 0.0.0.0` on Windows · start the bridge listener · listener bound to `127.0.0.1` only. (test-plan #E16)
- [x] 12.17 Extend `packages/server/src/__tests__/pi-gateway-consume-pending-attach.test.ts` — socket ownership. Triple: bound gateway socket · stat socket and dir · socket `0600`, dir `0700`. (test-plan #E18)
- [x] 12.18 Extend `packages/extension/src/__tests__/connection.test.ts` — `ws+unix` client dial regression. Triple: `ConnectionManager` constructed per this change · dial `ws+unix://<path>:/` · connection opens; a build that falls back to `globalThis.WebSocket` fails this test. (test-plan #E19)
- [x] 12.19 Extend `packages/server/src/__tests__/bridge-contention.test.ts` — provisional TTL boundary. Triple: provisional registration opened · commit at 29s and at 31s · 29s accepted, 31s refused because the provisional was already discarded. (test-plan #E20)
- [x] 12.20 New sibling test near `packages/server/src/__tests__/session-file-dedup.test.ts` — registration precedes transfer completion. Triple: remote join with a 44 MB transcript pending · observe timestamps · register-ack strictly precedes transfer-complete. (test-plan #P1)
- [x] 12.21 Extend `packages/server/src/__tests__/pi-gateway-consume-pending-attach.test.ts`, timed — socket transport parity. Triple: 1000 messages through the send ring over UDS vs TCP · compare p95 · UDS p95 not worse than TCP p95 by more than 20%. (test-plan #P4)
- [x] 12.22 Extend `packages/server/src/__tests__/pi-gateway-consume-pending-attach.test.ts` — a live socket is never unlinked. Triple: socket path already bound by a live listener · a second instance starts · startup aborts with a conflict naming the path, the incumbent stays bound, its bridges undisturbed. (test-plan #X1)
- [x] 12.23 Extend `packages/server/src/__tests__/pi-gateway-consume-pending-attach.test.ts` — concurrent bind is serialized. Triple: two instances race to bind one path · simultaneous start · exactly one binds, the other aborts with a conflict, and no live socket file is removed. (test-plan #X2)
- [x] 12.24 Extend `packages/server/src/__tests__/pi-gateway-consume-pending-attach.test.ts` — indeterminate probe fails closed. Triple: live listener with a saturated backlog returning `ECONNREFUSED` · probe before unlink · path NOT removed and startup aborts. (test-plan #X3)
- [x] 12.25 Extend `packages/server/src/__tests__/home-lock.test.ts` — takeover is acquire-then-verify. Triple: two starters both observe the same dead holder · simultaneous takeover · exactly one owner results and neither deletes the other's live lock or fresh record. (test-plan #X4)
- [x] 12.26 Extend `packages/server/src/__tests__/bridge-contention.test.ts` — move refusal spares the origin. Triple: target refuses the provisional registration on the different-pid branch · attempt the move · origin stays registered and serving, and its `intentionalClose` is never set. (test-plan #X7)
- [x] 12.27 Extend `packages/server/src/__tests__/bridge-contention.test.ts` — commit never arrives. Triple: target accepts the provisional then goes silent · wait past 30s · provisional discarded, origin never stopped owning the send ring, no message lost or duplicated. (test-plan #X8)
- [x] 12.28 Extend `packages/server/src/__tests__/bridge-contention.test.ts` — provisional does not claim routing. Triple: live bridge on session A plus a provisional registration for A · provisional registers · `connections.get(A)` still maps to the origin socket and the origin's sends are still delivered. (test-plan #X9)
- [x] 12.29 Extend `packages/server/src/__tests__/bridge-contention.test.ts` — provisional is not an enumeration oracle. Triple: provisional registrations for one existing and one non-existent sessionId · compare the refusals · responses indistinguishable to the caller, or ownership proof required before either answers. (test-plan #X10)
- [x] 12.30 Extend `packages/server/src/__tests__/ws-ticket.test.ts` — revoked device is locked out. Triple: paired bridge device revoked · attempt ticket mint and register · both refused with a distinct reason. (test-plan #X11)
- [x] 12.31 Extend `packages/server/src/__tests__/identity.test.ts` — impostor at the expected address. Triple: server at the pinned address cannot answer the nonce challenge · remote bridge connects · registration refused with a fingerprint-mismatch reason. (test-plan #X12)
- [x] 12.32 Extend `packages/server/src/__tests__/ws-ticket.test.ts` — ticket misuse table. Triple: tickets that are reused, expired, or wrong-scope · present on upgrade · each refused with the three reasons distinguishable in logs. (test-plan #X13)
- [x] 12.33 New local-token test modelled on `packages/server/src/__tests__/ws-ticket.test.ts` — tokenless loopback. Triple: Windows bridge connects with no `X-Pi-Local-Token` · upgrade · refused, distinctly from a wrong-token refusal. (test-plan #X14)
- [x] 12.34 Extend the same new local-token test — wrong token. Triple: Windows bridge presents an incorrect token · upgrade · refused with a reason distinguishable from "missing". (test-plan #X15)
- [x] 12.35 Extend `packages/server/src/__tests__/home-lock.test.ts` — stale record, foreign listener. Triple: record names a port now held by an unrelated process · bridge dials it · refused with an identity mismatch rather than a generic connection failure, and a valid local token does not bypass it. (test-plan #X16)
- [x] 12.36 New sibling test near `packages/server/src/__tests__/session-file-dedup.test.ts` — transfer interrupted mid-flight. Triple: bridge dies during transcript transfer · inspect the stored transcript · partial data is not presented as complete and the gap is detectable. (test-plan #X18)
- [x] 12.37 New sibling test near `packages/server/src/__tests__/session-file-dedup.test.ts` — resume refused for an ended remote session. Triple: remote session whose bridge has ended · `POST /api/session/:id/resume` · refused with an explanation naming host unreachability, while a local session is unaffected. (test-plan #X19)
- [x] 12.38 Extend `packages/server/src/__tests__/bridge-contention.test.ts` — unauthenticated gateway registration. Triple: unauthenticated peer on the TCP gateway · attempt `session_register` for an arbitrary sessionId · refused, inverting the hole this change closes. (test-plan #X20)

### L2 — qa VM smoke, `qa/tests/*.sh` | `*.ps1` (no rendered-UI asserts)

- [x] 12.39 New arm modelled on `qa/tests/03-websocket.sh` — POSIX binds no bridge TCP port. Triple: default `pi-dashboard` start on macOS/Linux · inspect listening sockets · no TCP listener on the gateway port at all. (test-plan #E17)
- [x] 12.40 New arm modelled on `qa/tests/03-websocket.sh` — registration not blocked, wall clock. Triple: remote join with a 44 MB transcript · measure over 20 runs · prompt accepted within 1s of register-ack at p95. (test-plan #P2)
- [x] 12.41 New arm modelled on `qa/tests/03-websocket.sh` — remote-join at p99 transcript size. Triple: remote join with a ~4 MB transcript · 20 runs · register-to-usable p95 recorded as a baseline. (test-plan #P3)
- [x] 12.42 New arm modelled on `qa/tests/03-websocket.sh` — promotion poll churn soak. Triple: 3 attach-mode instances with a 60s poll and the owner alive throughout · run 10 minutes · zero spurious promotions and lock acquisitions bounded by poll count. (test-plan #P5)
- [x] 12.43 New arm modelled on `qa/tests/03-websocket.sh` — `where` reports endpoint/identity/pinned. Triple: bridge registered with an instance · run `/dashboard where` · prints current endpoint, instance id, and pinned status. (test-plan #F7)
  - Writing this arm found the command short of task 9.6: `instance:` read `unverified` for every session the dashboard spawns, because those are pinned via `PI_DASHBOARD_SOCKET` and only the record-sourced path carried an id. Fixed at the source the socket itself names — `instances/<piPort>.id`, the sibling of `gateway-<piPort>.sock`. The record could NOT be used: it names the HOME's owner, so a session pinned to an attach instance's socket would have been told a confident wrong id.
- [x] 12.44 New arm modelled on `qa/tests/03-websocket.sh` — crashed owner is recovered. Triple: record owner killed with SIGKILL while one attach instance is alive · wait · survivor promotes within 60s and an unpinned bridge then resolves to the survivor, not the dead endpoint. (test-plan #X5)
- [x] 12.45 New arm modelled on `qa/tests/03-websocket.sh` — clean shutdown keeps a default. Triple: owner stops cleanly while one attach instance is alive · shutdown completes · survivor promotes and the HOME still has a resolvable default. (test-plan #X6)
- [x] 12.46 New arm modelled on `qa/tests/03-websocket.sh` — filesystem without UDS support. Triple: HOME on a filesystem where socket bind fails · start dashboard · falls back to loopback + token, the log names the actual cause, and it never falls back to discovery. (test-plan #X17)

### L3 — Playwright e2e, `tests/e2e/*.spec.ts` (harness port from `.pi-test-harness.json`, never hardcoded)

- [x] 12.47 New spec modelled on `tests/e2e/bridge-contention-health.spec.ts` — move renders as moved. Triple: session live on the origin dashboard · complete a move to the target · origin card converges to *moved*, never *crashed* or dead. (test-plan #F1)
- [x] 12.48 New spec modelled on `tests/e2e/blackhole-settings.spec.ts` — gateway transport surfaced. Triple: dashboard running on a UDS listener · open settings · gateway endpoint displayed and not blank, guarding `address()` returning a string for UDS. (test-plan #F2)
- [x] 12.49 New spec modelled on `tests/e2e/ended-session-endedat.spec.ts` — ended remote session hides resume. Triple: remote session whose bridge has ended · view the session · resume is not presented as an available action. (test-plan #F3)
- [x] 12.50 New spec modelled on `tests/e2e/bridge-contention-health.spec.ts` — origin converges without reload. Triple: origin dashboard open in a browser · move completes · origin view reaches *moved* with no manual reload. (test-plan #F4)
- [x] 12.51 New spec modelled on `tests/e2e/session-context-injection.spec.ts` — session origin displayed. Triple: session originating on another host · view the session list · originating device shown. (test-plan #F5)
- [ ] 12.52 **NOT WRITABLE against what shipped — deferred with the read path.** New spec modelled on `tests/e2e/large-session-replay.spec.ts` — pre-attach history renders. Triple: remote session with entries predating the bridge attach · open the transcript · pre-attach entries present in the rendered transcript. (test-plan #F6)
  - The requirement this scenario tests was narrowed to acquisition-and-retention: `RemoteTranscriptStore` is written by the `transcript_chunk` handler and its `read()` has NO caller, no HTTP route, and no client surface. There is therefore no rendered transcript for a browser test to assert on, and any spec written today would either test the store directly (not L3) or pass vacuously. Moves with the read path into the follow-up carved out in `proposal.md`.

> Tasks 12.47–12.51 landed as one file, `tests/e2e/gateway-origin-surfaces.spec.ts`, rather than five: all five need the same paired-bridge registration, the same ended-tier reveal, and the same harness plumbing, and five copies of it would drift apart. Each test names its task and its test-plan id.

### Manual-only (no test folded; deferred post-merge)

- [ ] 12.53 Windows credential readability on a real Windows host: log in as a second standard OS user and attempt to read `~/.pi/dashboard/local/token`, `identity.key`, and `paired-devices.json`. `chmod` is a documented no-op on Windows, so this rests on inherited NTFS ACLs and must be observed rather than asserted. (test-plan: manual-only)

## 13. Verification

- [ ] 13.1 Full test suite green
- [x] 13.2 Isolated-verification run: two dashboards under two HOMEs, each with its own bridges, no cross-talk, without needing `PI_DASHBOARD_NO_MDNS`
- [x] 13.3 Reproduce the hijack scenario — a stale dashboard advertising a hostname it does not serve — and confirm a bridge on the socket path is unaffected
- [x] 13.4 Move a live session between two same-HOME instances and confirm no prompt is lost, history still resolves, and the origin shows *moved*
- [ ] 13.5 Remote-join end-to-end: local pi pairs with a remote dashboard, registers, survives a reconnect, serves history predating the attach, retains that history after the session ends, and is locked out after revocation
- [ ] 13.6 Confirm an ended remote session refuses resume with an explanation, and a local session does not
- [x] 13.7 Measure the remote-join path against a p99 transcript (~4 MB) and the observed maximum (~44 MB); record registration latency and transfer cost
- [ ] 13.8 Cross-platform QA arms for macOS, Linux, and Windows, including that a POSIX default start binds no bridge TCP port at all
- [x] 13.9 Update `docs/architecture.md` via DocScribe (transport, precedence ladder, auth model, move command, remote transcript access + the read-only boundary)
