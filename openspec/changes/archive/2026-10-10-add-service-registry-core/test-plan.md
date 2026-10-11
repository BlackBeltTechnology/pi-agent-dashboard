# Test Plan — add-service-registry-core

Stage: design   Generated: 2026-10-08

Hard gate: two clarifications (re-probe interval, heartbeat interval) were
answered and folded into the specs before this file was written.
Exemplars are noted per level in `tasks.md`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | MS: definitions file | EP | L1 | automated | no `services.json`; spy runner | server bootstrap + `GET /api/services` | `[]`; runner spy recorded 0 calls |
| E2 | MS: definitions file | EP | L1 | automated | `services.json` with invalid JSON | `POST /api/services` (user entry) | write refused; corrupt bytes preserved byte-exact; every service `unavailable`/`invalid-definition`; `list` names the backup path |
| E3 | MS: definitions file | EP | L1 | automated | existing file mode 0644 | add a service | file mode is 0600 after write |
| E4 | MS: pi.services offers | decision-table | L1 | automated | fixture tree: pkg A `pi.tools` only, pkg B `pi.services` only, pkg C both | `discoverServiceOffers` + `discoverSkillManifests` | offers = B,C; skill manifests = A,C (unchanged from before) |
| E5 | MS: pi.services offers | decision-table | L1 | automated | offers carrying `lifecycle`, a bind mount, `privileged`, host network, `0.0.0.0` port, `:latest` image, `uvx` package without version, unknown key | parse | each is rejected, with the package and the offending key named |
| E6 | MS: pi.services offers | EP | L1 | automated | valid digest-pinned offer | discovery | listed in offers; runner spy 0 calls (no pull, no fetch) |
| E7 | MS: add/update/remove | state-transition | L1 | automated | offer `docling` | `POST /api/services {dryRun:true}` | response has digest, ports, volumes, secret names, `templateHash`; `services.json` sha unchanged |
| E8 | MS: add/update/remove | state-transition | L1 | automated | added entry; offer digest changed | `GET /api/services` | `updateAvailable:true`, diff `[{path:"oci.image",from,to}]`; entry unchanged until `update:true` |
| E9 | MS: add/update/remove | decision-table | L1 | automated | service with a named volume + secrets | `remove` with and without `--purge-data` | secrets, `services-run/<id>` gone in both; volume rm issued only with purge |
| E10 | MS: add/update/remove | EP | L1 | automated | native offer, CLI `add --yes` | add | entry written; no prefetch spawned (runner spy) |
| E11 | MS: three modes | EP | L1 | automated | definition `mode:"native"` | validate | rejected `invalid-definition` (native is a driver, not a mode) |
| E12 | MS: lifecycle | state-transition | L1 | automated | fake driver, every legal edge of D2 | drive events | state sequence equals the diagram; one log line per transition with from→to and reason |
| E13 | MS: lifecycle | state-transition (illegal) | L1 | automated | service `idle`, probe fails, process alive | `ensure` | state `blocked`, no `leaseId`, no endpoints (never `healthy` without a passing probe) |
| E14 | MS: lifecycle | BVA | L1 | automated | `startTimeout` 120 s, probe failing, alive | fake clock at 119.9 s / 120.1 s | `starting` / `blocked` |
| E15 | MS: lifecycle | BVA | L1 | automated | backoff after consecutive failures | fail ×1..×8 | `retryAt` deltas 5,10,20,40,80,160,300,300 s; reset to 5 s after `healthy` |
| E16 | MS: lifecycle | decision-table | L1 | automated | `failed` with future `retryAt` | `ensure`, `start`, `retry` | ensure/start → `failed`+`retryAt`, start spy 0; `retry` clears and starts once |
| E17 | MS: lifecycle | EP | L1 | automated | instance with old def-hash | `ensure` | serves the old endpoint, `restartRequired:true`; no recreate |
| E18 | MS: leases | BVA | L1 | automated | lease TTL 300 s, last heartbeat at t0 | fake clock t0+299.9 s / t0+300.1 s | lease live / expired |
| E19 | MS: leases | BVA | L1 | automated | idle 15 min, owned, unpinned, not blocked | clock at 14:59 / 15:01 after last lease ended | running / stop issued once |
| E20 | MS: leases | decision-table | L1 | automated | combos of pinned × blocked × startedBy(dashboard/external) × has-stop-path | idle elapsed | stop issued only for unpinned ∧ ¬blocked ∧ dashboard ∧ stop-path |
| E21 | MS: leases | state-transition | L1 | automated | pinned, idle 20 min | unpin at t; clock t+14:59 / t+15:01 | not stopped / stopped |
| E22 | MS: leases | state-transition | L1 | automated | blocked 20 min, then probe recovers | clock +1 s after recovery | no stop (idle clock reset) |
| E23 | MS: leases | EP | L1 | automated | `ensure` returning `unavailable`/`failed`/`blocked` | inspect payload | no `leaseId` |
| E24 | MS: leases | EP | L1 | automated | attached entry with `lifecycle.start` only and `idleStopMinutes: 15` | validate | rejected `invalid-definition` |
| E25 | MS: adoption | decision-table | L1 | automated | `ps -a` fixtures: 0 / 1 running / 1 exited / 2 matches / other `pi.owner` | manager construct | stopped / idle+endpoints / stopped / `duplicate-instances` no endpoint / `owner-conflict`; create spy 0 in all |
| E26 | MS: adoption | decision-table | L1 | automated | native instance file: pid dead / alive+token+port / alive+token, no port / alive, `findPortHolders` → `[]` | construct | discarded / idle / `adoption-uncertain` / `adoption-uncertain`; spawn spy 0 |
| E27 | MS: adoption | EP | L1 | automated | definitions present | boot | runner spy shows only `ps -a`/`inspect`; probe spy 0; no socket opened |
| E28 | MS: adoption | EP | L1 | automated | existing `instanceId` | 5 consecutive writes | `instanceId` unchanged |
| E29 | MS: OCI | EP | L1 | automated | create argv captured | start OCI service with 2 secrets | argv has `--init`, 3 `pi.*` labels, `127.0.0.1::<p>`, `-v …/secrets/<n>:/run/secrets/<n>:ro` ×2, no `-e <secret>`, no `--env-file`, no `pull`; env `DOCKER_CONFIG=<empty dir>` |
| E30 | MS: OCI | decision-table | L1 | automated | runtime binary missing / `info` fails + machine stopped / `info` fails / image absent / `OSType=windows` | ensure | `runtime-missing` / `host-vm-stopped` / `runtime-unreachable` / `image-absent` / `unsupported-platform`; `image inspect` never called before `info` succeeds |
| E31 | MS: OCI | decision-table | L1 | automated | drivers `[oci:docker, oci:podman]`, docker unreachable, podman image-absent | ensure | `reason:"runtime-unreachable"`, `tried` lists both with reasons |
| E32 | MS: OCI | state-transition | L1 | automated | inspect port 54264, then 62520 after restart | ensure after restart | endpoint uses 62520 |
| E33 | MS: host VM | EP | L1 | automated | podman machine stopped; last service idle-stopped | ensure / idle-stop | no `machine start`/`machine stop`/`docker desktop` argv ever issued |
| E34 | MS: native | EP | L1 | automated | recipe `{runner:"uvx",package:"docling-serve@1.36.0",args:["--port","${port.http}"]}` | start | argv composed with an allocated port; spawned via `platform/exec.ts` spawn with detached:true |
| E35 | MS: native | decision-table | L1 | automated | `runner:"bash"` / `package:"x"` (no version) / args with `$(...)` | validate | each rejected `invalid-definition` |
| E36 | MS: native | EP | L1 | automated | offline probe fails, no marker | ensure | `package-absent`; spy shows only offline-flag invocations |
| E37 | MS: attached | decision-table | L1 | automated | package-origin entry with `lifecycle.start`; user entry with `lifecycle.stop` but no `process` | validate | both rejected |
| E38 | MS: attached | EP | L1 | automated | start/stop argv with shell metacharacters `["open","-a","A; rm -rf"]` | start | spawned with `shell:false`, argv passed verbatim |
| E39 | MS: health | EP | L1 | automated | local fixture servers: http 200/500, tcp open/closed, ws sends hello / sends nothing | probe | pass/fail per kind; ws probe sends 0 bytes of auth |
| E40 | MS: health | EP | L1 | automated | lsof fixtures `OBS *:4455`, `127.0.0.1:4455`, netstat `tcp46 *.4455`, win32 `0.0.0.0:4455`, empty | `findListenAddresses` | all-interfaces / loopback / all-interfaces / all-interfaces / unknown |
| E41 | MS: health | EP | L1 | automated | `oci-healthcheck` on an image with no HEALTHCHECK | validate at add | `invalid-definition` |
| E42 | MS: runtimes | EP | L1 | automated | injected outputs reproducing spike `s7-matrix.json` | `GET /api/services/runtimes` ×2 within 30 s | report matches; second call issues 0 commands |
| E43 | MS: CLI/REST | decision-table | L1 | automated | states healthy/unavailable/no-server × `--json` on/off | `service ensure` | `--json` exit 0 always with payload; plain exit 0 only when healthy |
| E44 | MS: CLI/REST | EP | L1 | automated | server unreachable | `ensure docling --json` | stdout `{"id":"docling","state":"no-server"…}`, exit 0 |
| E45 | MS: CLI/REST | EP | L1 | automated | `exec svc -- node -e "process.exit(7)"` | run | CLI exit 7; lease released |
| E46 | MS: CLI/REST | decision-table | L1 | automated | callers: loopback, loopback under strict mode without proof, trusted-CIDR unauth, observe bearer, control bearer, operate bearer | POST attached definition | accept / reject / reject / reject / reject / accept; `services.json` unchanged on reject |
| E47 | MS: CLI/REST | EP | L1 | automated | new routes registered | run `route-tier-gate` + `mcp-manifest-completeness` | both green; mutations denylisted from MCP |
| E48 | SS: store | EP | L1 | automated | add service with `generate:{bytes:32}` | add | `<id>/password` stored; response `configured:true`; value absent from response |
| E49 | SS: store | EP | L1 | automated | invalid JSON secrets file holding other services' keys | `secret set` | refused; file byte-identical; status names the backup |
| E50 | SS: sources | EP | L1 | automated | `service secret set obs password` with the value on stdin | run while sampling child argv | stored; value absent from every captured argv |
| E51 | SS: refs | decision-table | L1 | automated | `keychain:` on darwin ok / darwin timeout 10 s / linux no bus / win32; `env:` set/unset; `store:` missing | resolve | value / `secret-unavailable` ×3 / value / `secret-unavailable` / `secret-unavailable`; store never consulted for keychain refs |
| E52 | SS: refs | EP | L1 | automated | keychain resolver | resolve | argv is `security find-generic-password -s … -a … -w`; no `add-generic-password` ever |
| E53 | SS: never leaves | EP | L1 | automated | fixture secret `SVCTEST-<rand>` configured on a service | drive every route, every CLI verb, every transition log | grep of all captured bodies/stdout/logs for the marker = 0 |
| E54 | SS: env delivery | EP | L1 | automated | `exec obs -- node script.js` | run | child sees `SVC_OBS_PASSWORD` (hash match); parent env lacks it; argv lacks it |
| E55 | CE: killProcessGroup | state-transition | L1 | automated | leader + worker ignoring SIGTERM (real processes, posix) | `killProcessGroup(pid,{timeoutMs:2000})` | SIGTERM then SIGKILL to `-pid`; 0 group members alive; `{ok:true,forced:true}` |
| E56 | CE: killProcessGroup | EP | L1 | automated | group exits on SIGTERM | call | no SIGKILL sent |
| E57 | CE: killProcessGroup | EP | L1 | automated | `platform:"win32"` | call | identical to `killProcess` (`taskkill /F /T /PID`) |
| E58 | CE: no direct kill | EP | L1 | automated | new services module | run `no-direct-process-kill` scan | green |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | MS: health polling | threshold | L1 | automated | 20 leased services, every probe stalls 10 s | max concurrent in-flight probes ≤ 4 | one 30 s cycle (fake timers) |
| P2 | MS: boot / detection | threshold | L1 | automated | 50 definitions across 2 runtimes | boot adoption issues ≤ 2 `ps -a` calls (one per runtime) | boot |
| P3 | MS: runtimes | threshold | L1 | automated | 10 `GET /runtimes` in 30 s | detection commands executed once | 30 s |

### Frontend-quirk

None. This change ships no UI (the Settings page is a non-goal).

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | MS: lifecycle concurrency | fault-injection (delay) | L1 | automated | driver start delayed 2 s | 5 concurrent `ensure` | start spy = 1; all 5 get the same endpoint |
| X2 | MS: lifecycle concurrency | fault-injection (abort) | L1 | automated | two manager instances, same HOME, shared `lifecycle.lock` | concurrent start | one start; the other waits; lock refreshed during a 46 s fake start (not stolen at 30 s) |
| X3 | MS: lifecycle stop | fault-injection | L1 | automated | stop command rc 1 but process exits within 15 s | stop | `stopped` |
| X4 | MS: lifecycle stop | fault-injection | L1 | automated | stop command rc 0 but process alive at 15 s | stop | `stop-failed` |
| X5 | MS: attached stop | fault-injection | L1 | automated | blocked attached, probe failing, process stays | stop | `stop-failed` (probe failure does not confirm the stop) |
| X6 | MS: leases restart | fault-injection (abort) | L1 | automated | manager restarted mid-`exec` | next heartbeat | 404 `lease-unknown` → CLI re-ensures → new lease; no idle-stop while the child runs |
| X7 | MS: OCI | fault-injection | L1 | automated | `~/.docker/config.json` with a credHelper that exits 1 | create/start | runtime invoked with `DOCKER_CONFIG` pointing at the empty dir; credHelper fixture never executed |
| X8 | MS: OCI tunnel | fault-injection | L1 | automated | host probe fails, podman machine connection present | ensure | ssh `-N -L` spawned with identity/port from the connection JSON; endpoint rewritten; tunnel killed on stop |
| X9 | MS: native | fault-injection | L1 | automated | allocated port taken before bind | start | `failed` with `retryAt` set |
| X10 | SS: refs | fault-injection (delay) | L1 | automated | `security` hangs | resolve | returns `secret-unavailable` at 10 s; no fallback |
| X11 | MS: OCI real runtime | fault-injection | L2 | automated | podman on linux VM, user-authored small http service | add → ensure → release → idle (shortened) → restart server mid-way | healthy, host-reachable endpoint, adopted without duplicate after restart, stopped after idle |
| X12 | SS: container secrets real | fault-injection | L2 | automated | podman linux VM, service with stored secret | start + `podman inspect` | marker absent from inspect; readable at `/run/secrets/<n>` inside |
| X13 | MS: native real | fault-injection | L2 | automated | linux VM, `npx` recipe that forks a worker ignoring SIGTERM | stop | 0 processes of the group remain (`pgrep -g`) |
| X14 | MS: macOS podman tunnel | real host | — | manual-only | dev Mac podman machine | ensure a user OCI service | endpoint reachable from the host through the tunnel (macOS VM harness not available in qa) |
| X15 | MS: docker real | real host | — | manual-only | Docker Desktop already running (never started/stopped by the test) | ensure + inspect | healthy; secret absent from `docker inspect` |
| X16 | MS: docling native real | real host | — | manual-only | `uvx docling-serve@1.36.0` after explicit prefetch | ensure → convert one PDF → stop | healthy; group termination leaves 0 docling processes incl. lazy workers |
| X17 | MS: attached OBS | real host | — | manual-only | user's OBS (consent; never quit within 30 s of launch) | ensure with OBS already running → idle | `startedBy: external`, never stopped; `exec` delivers the password; `exposure: all-interfaces` |
| X18 | D9 skill pattern | model behaviour | — | manual-only | 5 runs healthy, 5 runs `no-server`, payload branching | session JSONL analysis | 0 wrong fallback reads; 0 secret occurrences (non-deterministic model behaviour; costs tokens) |

---

## Coverage summary

- Requirements covered: 22/22 (MS 15, SS 6, CE 1)
- Scenarios by class: edge 58 · perf 3 · frontend 0 · error 18
- Scenarios by level: L1 71 · L2 3 · L3 0 · — 5
- Scenarios by disposition: automated 74 · manual-only 5

## New infra needed

- A qa scenario script for podman on the linux VM (X11–X13). It needs podman
  installed in the qa linux image; add it as a precondition step in the new
  qa script rather than a new harness.
