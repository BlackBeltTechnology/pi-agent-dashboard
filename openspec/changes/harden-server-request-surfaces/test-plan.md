# Test Plan — harden-server-request-surfaces

Stage: design   Generated: 2026-06-12

Clarifications C1 (missing-binary stable code) and C2 (Windows `gh` observability)
were resolved before this manifest was written: C1 added a "binary not found"
clause + three scenarios to the `git-operations-api` delta; C2 routed the Windows
property to L1 with a forced `win32` platform rather than new qa infra. No open
markers remain.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | openspec-polling: refresh gated on tracked cwd | decision-table | L1 | automated | empty session registry, no pins | `openspec_refresh { cwd: "/tmp/anywhere" }` | CLI spawn spy not called; no `openspec_update` broadcast for that cwd |
| E2 | openspec-polling: opted-out cwd does not spawn | decision-table | L1 | automated | `/repo/a` tracked via a registered session, opted out of OpenSpec polling | `openspec_refresh { cwd: "/repo/a" }` | spawn spy not called; no broadcast |
| E3 | openspec-polling: tracked cwd without an openspec root | decision-table | L1 | automated | `/repo/c` tracked, no `<cwd>/openspec/` dir | `openspec_refresh { cwd: "/repo/c" }` | spawn spy not called; no broadcast |
| E4 | openspec-polling: global disable still wins | decision-table | L1 | automated | `openspec.enabled: false`, cwd tracked with an openspec root | `openspec_refresh` | spawn spy not called; no broadcast |
| E5 | openspec-polling: tracked cwd still force-polls (over-gating guard) | decision-table | L1 | automated | tracked cwd with `openspec/`, cache warm with a stale mtime | `openspec_refresh` | spawn spy called exactly once (mtime gate bypassed); exactly one `openspec_update` broadcast |
| E6 | openspec-polling: tracked gate precedes the filesystem probe | state-transition | L1 | automated | untracked cwd `/tmp/anywhere`, `fs.statSync` spied | `openspec_refresh { cwd: "/tmp/anywhere" }` | stat spy never called with any path at or below `/tmp/anywhere` |
| E7 | openspec-polling: `isTrackedCwd` admits an ended session's cwd | state-transition | L1 | automated | cwd whose only session has status `"ended"`, not pinned, still in the registry | `openspec_refresh` | spawn spy called once; one broadcast (parity with `openspec_get`) |
| E8 | openspec-polling: non-canonical cwd gates (recorded trade-off) | BVA | L1 | automated | `/repo/a` tracked; browser sends `/repo/a/` (trailing slash) | `openspec_refresh { cwd: "/repo/a/" }` | spawn spy not called — pins the accepted strict-equality trade-off so a future canonicalisation change is a deliberate decision |
| E9 | design D1: `refreshOpenSpec` keeps its un-gated contract | state-transition | L1 | automated | untracked, opted-out cwd | direct `directoryService.refreshOpenSpec(cwd)` call | resolves to an `OpenSpecData` object, never `null` — the regression guard for the four internal callers (`server.ts` group re-order, `session-bootstrap` cold boot, `POST /api/openspec/init`, task toggle) |
| E10 | bearer-device-auth: device bearer cannot revoke a sibling | decision-table | L1 | automated | registry rows A and B; `Authorization: Bearer <A>` from a non-local ip | `DELETE /api/paired-devices/<B>` | `401`; B's row remains and its token still `verify()`s |
| E11 | bearer-device-auth: device bearer cannot revoke itself | decision-table | L1 | automated | row A; `Authorization: Bearer <A>` from a non-local ip | `DELETE /api/paired-devices/<A>` | `401`; A's row remains |
| E12 | bearer-device-auth: loopback device bearer is still refused | decision-table | L1 | automated | rows A and B; `Authorization: Bearer <A>` from `127.0.0.1`, no forwarding headers | `DELETE /api/paired-devices/<B>` | `401`; B's row remains — the credential, not the network position, decides |
| E13 | bearer-device-auth: operator revokes over a tunnel | decision-table | L1 | automated | cookie session (`authVia: "session"`) from a non-local ip on an admitted Host | `DELETE /api/paired-devices/<B>` | `200`; B's token no longer verifies |
| E14 | bearer-device-auth: local-token operator revokes | decision-table | L1 | automated | valid `X-Pi-Local-Token`, no session | `DELETE /api/paired-devices/<B>` | `200`; B's token no longer verifies |
| E15 | design D2: mint route inherits the device refusal | decision-table | L1 | automated | `Authorization: Bearer <A>` from `127.0.0.1` | `POST /api/paired-devices` | `401`; no new row minted — pins the intended collateral tightening |
| E16 | qr-device-pairing: device bearer cannot approve | decision-table | L1 | automated | pending device P; correct `code` + `confirmCode`; `Authorization: Bearer <A>` | `POST /api/pair/approve` | `401`; `pairing.poll(P.pendingId).status` unchanged; P's token does not verify |
| E17 | qr-device-pairing: label just above max | BVA | L1 | automated | operator session; `label` of 65 UTF-8 bytes | `POST /api/pair/approve` | `400`; P remains pending |
| E18 | qr-device-pairing: label at max | BVA | L1 | automated | operator session; `label` of exactly 64 UTF-8 bytes | `POST /api/pair/approve` | `200`; stored label is the 64-byte value |
| E19 | qr-device-pairing: label at min | BVA | L1 | automated | operator session; `label` of 1 byte (`"x"`) | `POST /api/pair/approve` | `200`; stored label `"x"` |
| E20 | qr-device-pairing: whitespace-only label is below min | BVA | L1 | automated | operator session; `label: "   "` | `POST /api/pair/approve` | `400`; P remains pending; the redemption label is NOT overwritten with `""` |
| E21 | qr-device-pairing: label is trimmed, not rejected | BVA | L1 | automated | operator session; `label: "  phone  "` | `POST /api/pair/approve` | `200`; stored device label is exactly `"phone"` |
| E22 | qr-device-pairing: absent label keeps the pending label | decision-table | L1 | automated | operator session; body carries no `label` key | `POST /api/pair/approve` | `200`; device label equals the label recorded at redemption |
| E23 | qr-device-pairing: bound counts bytes, not characters | BVA | L1 | automated | operator session; a multi-byte label that is 64 bytes but far fewer characters, and a second that is 65 bytes | `POST /api/pair/approve` | `200` for the 64-byte value, `400` for the 65-byte value |
| E24 | qr-device-pairing: supplied non-string label is rejected | EP (type violation) | L1 | automated | operator session; `label: 123` | `POST /api/pair/approve` | `400`; P remains pending; NOT a `200` that silently keeps the pending label; no `500` |
| E25 | git-operations-api: command separator passed verbatim | EP | L1 | automated | create-worktree naming branch `feat&calc` | `addWorktree` | an `execFileSync` spy call with `file === "git"` and `feat&calc` present as exactly one argv element; the `execSync` spy is never called |
| E26 | git-operations-api: merge metacharacter branch | EP | L1 | automated | worktree whose branch is `x; echo pwned` | `mergeWorktree` | `git merge --no-ff` receives `x; echo pwned` as one argv element |
| E27 | git-operations-api: diff-stat base with spaces | EP | L1 | automated | diff-stat resolving base `release 2026` | `worktreeDiffStat` | the range is a single argv element `release 2026..<branch>` |
| E28 | git-operations-api: PR title passed untouched | EP | L1 | automated | create-pull-request with a title containing `"` and `$(`, injected `ghPath` | `createPullRequest` | title arrives as one argv element with both characters intact; argv[0] is the injected absolute `ghPath`, not the literal `"gh"` |
| E29 | git-operations-api: remaining migrated sites | EP | L1 | automated | caller-supplied values for `pushBranch`, `addWorktreeFromPr`, `listPullRequests`, the fetch, and the `resolveDefaultBase` hint verify | each op invoked | every call goes through `execFileSync`/`spawnSync` with the caller value as one argv element; `execSync` spy never called |
| E30 | git-operations-api: no shell interposed on Windows | decision-table | L1 | automated | platform reported as `win32`; injected absolute `ghPath` | every migrated git/`gh` op | argv[0] is the resolved binary path; argv[0] is never `cmd.exe` and no `/d /s /c` sequence appears (guards against a `buildSafeArgv` regression) |
| E31 | git-operations-api: property cannot silently regress | static-source | L1 | automated | the `git-operations.ts` module source read as text | assertion | the source contains neither `execSync(` nor `shellEscape`, comments included |
| E32 | shared-config: `hostGate.mode` loader decision table | decision-table | L1 | automated | `parseHostGateMode` called with `undefined`, `"report"`, `"enforce"`, `"yes"`, `123`, `null` | direct call | `undefined` → `"enforce"`; `"report"` → `"report"`; `"enforce"` → `"enforce"`; `"yes"`, `123`, `null` → `"report"` |
| E33 | shared-config: absent key loads as enforce | BVA | L1 | automated | `config.json` with no `hostGate` key | `loadConfig` | loaded `hostGate.mode === "enforce"` |
| E33b | shared-config: loader fallback paths resolve to enforce | EP (fallback class) | L1 | automated | (a) no `config.json`, (b) empty/whitespace `config.json`, (c) malformed-JSON `config.json` | `loadConfig` | each case yields `hostGate.mode === "enforce"` — the three early returns hand back `DEFAULTS` without reaching `parseHostGateMode`, so a fresh install must not stay report-only |
| E34 | shared-config: explicit report survives a round-trip | BVA | L1 | automated | `config.json` holding `hostGate.mode: "report"` | `loadConfig` | loaded value is `"report"` — the enforce default applies only to an absent value |
| E35 | shared-config: unrelated write does not seed hostGate | state-transition | L1 | automated | `config.json` with no `hostGate` key | `PUT /api/config` updating an unrelated key | the written file still has no `hostGate` key, so the boot source stays `default` |
| E36 | host-admission: mode resolution decision table | decision-table | L1 | automated | `(env, configMode)` pairs: `(unset, undefined)`, `("enforce", undefined)`, `("report", "enforce")`, `("yes", undefined)`, `("yes", "report")` | `resolveHostGateMode` | `enforce`; `enforce` with `envOverridden: true`; `report` with `envOverridden: true`; `enforce`; `report` |
| E37 | host-admission: enforce default refuses | EP | L1 | automated | env unset, no `hostGate` config | `GET /api/health` with `Host: rebind.example` | `403` with `error: "host_not_allowed"`; one refusal line logged; no `Access-Control-Allow-Origin` header |
| E38 | host-admission: enforce default admits the loopback/IP population | EP | L1 | automated | env unset, no `hostGate` config | `GET /api/health` with `Host:` each of `localhost:8000`, `127.0.0.1:8000`, `[::1]:8000`, `192.168.1.20:8000` | all four `200` |
| E39 | host-admission: report opt-out still works | decision-table | L1 | automated | `hostGate.mode: "report"`, env unset | request with a non-admissible `Host` | served normally; one refusal line logged |
| E40 | host-admission: boot line names mode and source | decision-table | L1 | automated | (a) env unset + config absent, (b) `hostGate.mode: "report"`, (c) `PI_DASHBOARD_HOST_GATE=report`, (d) `PI_DASHBOARD_HOST_GATE=yes` + config absent | server boot | exactly one host-gate boot line per boot, reporting `mode=enforce source=default`, `mode=report source=config`, `mode=report source=env`, and `mode=enforce source=default` respectively |
| E41 | host-admission: refusal page does not enumerate admitted hosts | EP | L1 | automated | enforce default; a live tunnel origin and an `allowedHosts` entry configured | `GET /` with a refused `Host` and `Accept: text/html` | body contains neither the tunnel origin nor the `allowedHosts` entry; contains the escaped received Host, `localhost:<port>`, `allowedHosts`, `publicBaseUrls`; contains no `<script>` and no `/assets/` reference |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | openspec-polling: gated refresh cannot be used to force process spawns | threshold | L1 | automated | 100 `openspec_refresh` messages naming distinct untracked cwds, delivered back-to-back | OpenSpec CLI spawn count == 0 (hard threshold, not a ratio) | single test run |
| P2 | git-operations-api: timeouts unchanged by invocation form | threshold | L1 | automated | every migrated git/`gh` op invoked once | the `timeout` option on each spawn equals `GIT_TIMEOUT`, and `env` still carries `GH_PROMPT_DISABLED` / `GIT_TERMINAL_PROMPT=0` | single test run |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | host-admission: settings shows the real effective default | state-convergence | L1 | automated | config payload with `hostGate.mode` absent | Settings ▸ Security renders | the mode control converges to `enforce`, never displays `report` |
| F2 | host-admission: settings copy no longer claims a report-only default | state-convergence | L1 | automated | `AllowedHostsSection` rendered | component render | the copy describes `enforce` as the default and names the `report` opt-out; no remaining "default is report-only" claim |
| F3 | host-admission: dashboard still loads end-to-end under the enforce default | state-transition | L3 | automated | docker harness with default config (no `hostGate` key), reached on the harness-derived `dashboardPort` from `.pi-test-harness.json` | browser loads the dashboard and the session list converges | page loads and the WebSocket connects — the flip does not lock out the normal `localhost` path |
| F4 | host-admission: refusal page reads clearly to a locked-out operator | visual/subjective | — | manual-only | the `403` HTML page in a real browser | a human reads it | [judgment: the page makes the fix obvious without prior knowledge — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | git-operations-api: exit-code → stable-code mapping unchanged | fault-injection (abort) | L1 | automated | `execFileSync` spy throws `{ status: 1, stderr: "already used by worktree at '/x'" }`, and separately a merge-conflict stderr | `addWorktree` / `mergeWorktree` | the same stable codes as today (`branch_in_use`, `merge_conflict`, …) |
| X2 | git-operations-api: merge conflict written to stdout is still classified | fault-injection (abort) | L1 | automated | spy throws with the conflict notice on `stdout` and an empty `stderr` | `mergeWorktree` | `merge_conflict` — the stdout+stderr concatenation is preserved |
| X3 | git-operations-api: missing git binary | fault-injection (abort) | L1 | automated | spy throws `ENOENT` with `status: null` and no `stderr` | `addWorktree` | a dedicated stable code identifying git as not found; no crash; not an empty-stderr generic failure |
| X4 | git-operations-api: missing gh binary | fault-injection (abort) | L1 | automated | spy throws `ENOENT` with `status: null` | `createPullRequest` | a dedicated stable code identifying gh as not found |
| X5 | bearer-device-auth: operator on a non-admitted Host | fault-injection (abort) | L1 | automated | operator session, `Host` not admissible, global gate in `report` mode | `DELETE /api/paired-devices/<B>` | `403 host_not_admitted` — the operator guard applies enforce semantics regardless of global mode |
| X6 | host-admission: refused WebSocket upgrade under the default | fault-injection (abort) | L1 | automated | env unset, no `hostGate` config | WS upgrade with a non-admissible `Host` | `HTTP/1.1 403` and the socket is destroyed |
| X7 | openspec-polling: gated refresh leaves no cache residue | fault-injection (abort) | L1 | automated | untracked cwd, cache empty | `openspec_refresh` then read the cache | no cache entry is created for that cwd (a gated call must not write a placeholder) |
| X8 | git-operations-api: git/gh prompt would block | fault-injection (delay) | L2 | automated | a git remote op that would prompt for credentials, run through the qa git-ops smoke | worktree push / PR path exercised | the op fails fast on git's own non-interactive error rather than hanging to the timeout — proves `env` survived the migration in a real process |

---

## Coverage summary

- Requirements covered: 6/6 (openspec-refresh gate, bearer revoke, approve+label, git argv+ENOENT+win32, host-admission default+boot log, shared-config loader)
- Scenarios by class: edge 42 · perf 2 · frontend 4 · error 8
- Scenarios by level: L1 53 · L2 1 · L3 1 · manual-only 1
- Scenarios by disposition: automated 55 · manual-only 1

## New infra needed

- None. Every automated row extends an existing test: `packages/server/src/browser-handlers/__tests__/directory-handler.test.ts`, `packages/server/src/__tests__/pairing.test.ts`, `packages/server/src/__tests__/git-worktree-lifecycle-ops.test.ts`, `packages/server/src/__tests__/host-gate.test.ts`, `packages/shared/src/__tests__/config-host-gate.test.ts`, `packages/client/src/components/settings/__tests__/`, `qa/tests/05-git-ops.sh`, `tests/e2e/host-gate-allow.spec.ts`.
