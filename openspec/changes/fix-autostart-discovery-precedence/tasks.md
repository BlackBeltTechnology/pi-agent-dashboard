# tasks

> Test tasks are folded from `test-plan.md` (scenario-design manifest) in
> section 9. Sections 1-8 are implementation/setup only.

## 1. Seam widening (D2)

- [ ] 1.1 Widen `AutoStartDeps.isDashboardRunning` to accept a host (and bootstrap-aware opts) so a candidate can be probed at its advertised host + HTTP port; keep the bridge wiring in `bridge.ts` passing the shared fn
- [ ] 1.2 Add a small pure candidate-selection helper (resolved-port match → lowest port → host-string tiebreak) so both discovery branches share one total order

## 2. Pre-launch discovery branch (D1, D2, D2b, D3, D4)

- [ ] 2.1 Probe the resolved port BEFORE the discovery branch, using bootstrap-aware `retries`/`timeoutMs` that retry on `AbortError` (timeout) but NOT on `ECONNREFUSED`; when it serves, return it and do NOT consult discovery (no mismatch record, no banner)
- [ ] 2.2 On `portConflict`, do NOT short-circuit — fall through to discovery; apply the existing "port occupied" refusal only after discovery yields no verified candidate
- [ ] 2.3 Admit a discovered candidate only after a successful `/api/health` probe at its advertised host+port; on failure log the rejection (endpoint + reason) and fall through to launch
- [ ] 2.4 Replace `servers.find(s => s.isLocal)` with the shared deterministic selection helper
- [ ] 2.5 Notification: warning+toast only when the resolved port was probed and is silent; otherwise durable-log-only naming both ports, never asserting "silent" without a probe result

## 3. Post-launch attach branch (D1, D2, D3)

- [ ] 3.1 In `spawnAndAttach`, after a successful launch, probe the resolved port with the same bootstrap-aware opts and prefer it when it answers; use discovery only to resolve a non-localhost host, never to let a discovered stray displace the just-launched server
- [ ] 3.2 Use the same deterministic selection helper as 2.4 for any candidate the post-launch path does consider
- [ ] 3.3 The post-launch path raises NO "resolved port silent" warning on a transient miss after our own launch

## 4. Preserve unchanged behaviour

- [ ] 4.1 Keep the `PI_DASHBOARD_NO_MDNS` short-circuit, worktree-refusal, pin, and single-flight lock steps behaviourally unchanged
- [ ] 4.2 Confirm the connect path #569 fixed is untouched: no edits to `endpoint-resolution.ts` / `resolveEndpoint` / `decideRetarget`

## 5. Ephemeral server lifecycle (D5, D6)

- [ ] 5.1 Add explicit ephemeral opt-in as a **flag only** (no env var), defaulting off; never inferred from temp `HOME` / loopback bind / port
- [ ] 5.2 Add a small INDEPENDENT unconditional interval (e.g. 5 s), active only in ephemeral mode, evaluating boot-parent liveness; the existing `createIdleTimer` cannot host it (early-returns when `autoShutdown` is false — the default ephemeral config — and exits via raw `process.exit`); the interval is the stated exit-latency bound
- [ ] 5.3 Kill-decision liveness treats only `ESRCH` (and, on Windows, the reuse-immune Tier-2 signalled-exit) as dead; `EPERM` and any non-`ESRCH` errno count as alive — add a liveness helper distinct from the diagnostic `isProcessAlive`; Tier-2 is authoritative over Tier-1 where it exists
- [ ] 5.4 Terminate via the graceful stop (`server.stop`) so spawned sessions drain and an exit intent is recorded — never `process.exit()` (note: this is why the raw-exit idle timer is unsuitable per 5.2)
- [ ] 5.5 Add an `ephemeral` value to `ExitIntent` (`shared/src/boot-state.ts`) and place it in the recovery-suppressing set so an ephemeral exit is not treated as a recoverable crash
- [ ] 5.6 Shut down (naming the dead boot parent) only when ephemeral is on AND the parent is proven absent
- [ ] 5.7 Expose ephemeral state in `/api/health`
- [ ] 5.8 Guard: standalone and Electron-hosted servers are excluded by construction
- [ ] 5.9 Invoke `doubt-driven-review` on this section before it stands: it can terminate a running server

## 6. Verification (manual)

- [ ] 6.1 `npm test` green (pipe once to `/tmp/pi-test.log`, then grep — do not rerun to inspect)
- [ ] 6.2 Live dashboard serving + a second instance advertising → a fresh session shows NO warning banner and attaches to the live one
- [ ] 6.3 Live dashboard stopped + a reachable second instance advertising → a fresh session attaches to the second; the warning names both ports
- [ ] 6.4 Live dashboard stopped + only an UNREACHABLE advertiser → a fresh session launches a server
- [ ] 6.5 Foreign service on `:8000` + a real dashboard on another port → the session attaches to the real one, not "port occupied"
- [ ] 6.6 Confirm on the live instance that `endpoint_resolved` still reports `source=PI_DASHBOARD_SOCKET` and `retarget_refused` behaviour is unchanged in kind
- [ ] 6.7 Start an ephemeral server, kill its parent, confirm it exits within the timer cadence and frees its port
- [ ] 6.8 `review-code` pass before commit

## 7. Documentation

- [ ] 7.1 Delegate to DocScribe: `docs/architecture.md` Bridge Discovery — resolved port outranks discovery (both branches), candidates are health-gated, `portConflict` falls through
- [ ] 7.2 Update `packages/extension/src/server-auto-start.ts.AGENTS.md`, the `packages/shared/src/server-identity.ts.AGENTS.md` row for the widened seam, and the `packages/server` row for the ephemeral flag/timer
- [ ] 7.3 Update the isolated-verification references (`.pi/skills/debug-dashboard/references/isolated-verification.md`) to use the ephemeral flag instead of relying on manual teardown

## 8. Follow-up

- [ ] 8.1 Record in the archived `fix-bridge-mdns-migration-hijack` follow-up that task 7.2 is answered: `autoStartServer` (both discovery branches) was the other place, addressed here
- [ ] 8.2 Unrelated defects found during this investigation, to file separately if they persist: `lastActivityAt` ~52 min stale on a live streaming session; `[browser-gw]` back-pressure `total dropped=8792`; gateway `piPort` from mDNS TXT is never independently verified (pre-existing)

## 9. Automated test tasks (folded from test-plan.md)

L1 exemplar to copy harness glue from: `packages/extension/src/__tests__/server-auto-start.test.ts`
(and `server-auto-start-guarded.test.ts`). Ephemeral exemplar:
`packages/server/src/__tests__/boot-parent-liveness.test.ts`.

- [ ] 9.1 (test-plan E1) resolved port serves → return it, discovery ignored, notify not called · input: `isDashboardRunning(resolvedPort)→running` + `discoverDashboard→[local@8588]` · trigger: pre-launch autoStart · observable: returns `{port:resolvedPort}`, no notify · see server-auto-start.test.ts
- [ ] 9.2 (test-plan E2) resolved port serves → no mismatch record · input: resolved serves + a stray advertises · trigger: pre-launch autoStart · observable: no appendAutoStartLog mismatch line, no notify · see server-auto-start.test.ts
- [ ] 9.3 (test-plan E3) silent + verified candidate adopted, warning names both ports · input: resolved `{running:false}` + candidate@8588 health-ok · trigger: pre-launch autoStart · observable: returns `{port:8588}`, `notify("warning")` names 8000+8588 · see server-auto-start.test.ts
- [ ] 9.4 (test-plan E4) unhealthy candidate does not suppress launch · input: resolved silent + candidate `/api/health`→not-ok · trigger: pre-launch autoStart · observable: candidate rejected, `launchServer` called · see server-auto-start-guarded.test.ts
- [ ] 9.5 (test-plan E5) candidate health timeout → rejected + logged · input: resolved silent + candidate probe never resolves · trigger: pre-launch autoStart · observable: rejection logged with endpoint+reason · see server-auto-start-guarded.test.ts
- [ ] 9.6 (test-plan E6) portConflict falls through to discovery · input: resolved `{portConflict:true}` + candidate@8588 health-ok · trigger: pre-launch autoStart · observable: returns `{port:8588}`, no port-occupied refusal · see server-auto-start.test.ts
- [ ] 9.7 (test-plan E7) portConflict + no candidate → refuse · input: `{portConflict:true}` + `discoverDashboard→[]` · trigger: pre-launch autoStart · observable: "port occupied" logged, returns `{}` · see server-auto-start.test.ts
- [ ] 9.8 (test-plan E8) selection: resolved-port match wins · input: `[local@8588, local@8000]`, resolved=8000 · trigger: selection · observable: selects 8000 · see server-auto-start.test.ts
- [ ] 9.9 (test-plan E9) selection: lowest port, order-independent · input: `[8611,8588]` and reversed, none match · trigger: selection ×2 · observable: both select 8588 · see server-auto-start.test.ts
- [ ] 9.10 (test-plan E10) selection: same-port host tiebreak, order-independent · input: two locals same port hostA/hostB, both orders · trigger: selection ×2 · observable: both select same host by string · see server-auto-start.test.ts
- [ ] 9.11 (test-plan E11) bootstrap-aware probe retries on timeout · input: resolved probe attempt1 AbortError, attempt2 running · trigger: pre-launch autoStart · observable: resolved treated serving, returned · see server-auto-start.test.ts
- [ ] 9.12 (test-plan E12) cold start (ECONNREFUSED) pays no retries · input: resolved probe throws ECONNREFUSED · trigger: pre-launch autoStart · observable: `_sleep` seam not invoked, reaches launch · see server-auto-start.test.ts
- [ ] 9.13 (test-plan X1) post-launch: no stray displaces our server · input: `launchServer→success` + resolved health-ok + `discoverDashboard→[local@8588]` · trigger: spawnAndAttach · observable: returns `{port:resolvedPort}`, not 8588 · see server-auto-start.test.ts
- [ ] 9.14 (test-plan X2) post-launch: no silent warning on transient miss · input: `launchServer→success` + resolved probe misses once then answers · trigger: spawnAndAttach · observable: no "resolved port silent" notify, resolved returned after retry · see server-auto-start.test.ts
- [ ] 9.15 (test-plan X3) connect path unchanged (regression guard) · input: existing endpoint-resolution + decideRetarget suites · trigger: run unchanged · observable: all pass, no edits to endpoint-resolution.ts · see packages/extension/src/__tests__/endpoint-resolution.test.ts
- [ ] 9.16 (test-plan X4) ephemeral exits on ESRCH via graceful stop · input: ephemeral on + liveness→parent absent (ESRCH) · trigger: liveness tick · observable: `server.stop` called (not process.exit), exit intent = ephemeral · see boot-parent-liveness.test.ts
- [ ] 9.17 (test-plan X5) standalone unaffected by dead parent · input: ephemeral OFF + liveness→parent absent · trigger: liveness tick · observable: `server.stop` NOT called · see boot-parent-liveness.test.ts
- [ ] 9.18 (test-plan X6) EPERM treated as alive · input: ephemeral on + liveness probe throws EPERM · trigger: liveness tick · observable: `server.stop` NOT called · see boot-parent-liveness.test.ts
- [ ] 9.19 (test-plan X7) POSIX PID reuse defers exit · input: ephemeral on POSIX + Tier-1 signal-0 on recycled PID→alive · trigger: liveness tick · observable: server keeps running · see boot-parent-liveness.test.ts
- [ ] 9.20 (test-plan X8) Windows reuse-immune tier authoritative · input: ephemeral on Windows + Tier-2→exited + Tier-1→alive · trigger: liveness tick · observable: Tier-2 wins, `server.stop` called · see boot-parent-liveness.test.ts
- [ ] 9.21 (test-plan X9) ephemeral not inferred from env/HOME/bind · input: `PI_DASHBOARD_EPHEMERAL=1` set, flag not passed, temp HOME, loopback · trigger: server init · observable: not ephemeral, dead parent does not stop it · see boot-parent-liveness.test.ts
- [ ] 9.22 (test-plan X10) ephemeral state visible in health · input: ephemeral flag passed · trigger: `GET /api/health` · observable: response indicates ephemeral=true · see boot-parent-liveness.test.ts
