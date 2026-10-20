# Test Plan — add-access-provisioning

Stage: design   Generated: 2026-10-19

Levels: L1 = vitest (`packages/**/__tests__/*.test.ts[x]`). L3 = Playwright `tests/e2e/*.spec.ts` against the docker harness (port from `.pi-test-harness.json`). "Registry" = `packages/server/src/access/provisioning.ts`. Fixture tree: tmp dir with `/w/app` (has `.git`), `/w/lib`, `/w/real`, `/w/link → /w/real`, and a fake `$HOME` with `.aws`, `.gnupg`, `Library/Keychains`. Time is injected (`now`) or faked.

Clarifications resolved at the HARD gate (2026-10-19, operator): an empty `why` is allowed and shown as "no reason given"; a request with only remote goals is accepted, and one with neither folders nor goals is refused `empty`; the 32-line limit counts raw input lines.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | access-provisioning: proposes and never writes | EP | L1 | automated | empty grant store; request root `/w/app`, lines `../lib`, `/w/real` | `POST /api/access/provision` | 200 with `requestId` + classifications `grantable`×2; `access-grants.json` byte-identical (absent) |
| E2 | access-provisioning: line count | BVA | L1 | automated | 0 lines + 0 goals; 0 lines + goal `lan`; 1, 31, 32, 33 lines (33 = 32 distinct + 1 duplicate) | POST | 0+0 → 400 `empty`; 0+`lan` → 200; 1/31/32 → 200; 33 → 400 `too-many-lines`, registry `list()` empty |
| E3 | access-provisioning: classification order | decision table | L1 | automated | lines: `""`, `~bob/x`, NUL-containing, `/w/missing`, a file `/w/app/README`, `~` (home), `~/.aws`, `~/Library` (macOS fixture), `/w/app/docs` with a grant covering `/w`, `/w/lib` covered by grant, `/w/lib2` | classify | `invalid`, `invalid`, `invalid`, `missing`, `missing`, `forbidden`, `sensitive`, `sensitive`, `in-root` (not `covered`), `covered`, `grantable` |
| E4 | access-provisioning: real path + collapse | EP | L1 | automated | lines `/w/link` (why "a"), `/w/real` (why "b") | classify | one line, shown `/w/real`, `why` = "a" |
| E5 | access-provisioning: relative + home expansion | EP | L1 | automated | root `/w/app`; lines `../lib`, `~/proj` (exists under fake home) | classify | `/w/lib`, `<home>/proj`, both `grantable` |
| E6 | access-provisioning: credential folders and ancestors | EP | L1 | automated | `~/.ssh/x`, `~/.pi`, `~/.aws/sub`, `~/.gnupg`, `~/.kube`, `~/.docker`, `~/Library/Keychains`, `~/Library`, `/w/creds → ~/.gnupg` | classify | `.ssh`/`.pi` → `forbidden`; others incl. `~/Library` and the symlink → `sensitive`; none approvable |
| E7 | access-provisioning: project root validation | decision table | L1 | automated | root relative `app`; `/w/nogit` (no `.git`/`.pi`); `/w/onlypi` (has `.pi`); `<home>` with `.git`; `/w/file.txt`; `/w/app` | POST | relative/no-marker/home/file → 400 with reason, no pending; `.pi`-only and `/w/app` → 200 |
| E8 | access-provisioning: pending key aliasing | EP | L1 | automated | pending for `/w/app`; second POST with `/w/app/`, then with symlink `/w/applink → /w/app` | POST | both 409 `pending-exists` carrying the first `requestId` |
| E9 | access-provisioning: bounds | BVA | L1 | automated | pending total 3, 4, attempt 5th (distinct roots) | POST | 4th accepted; 5th 429 `capacity` |
| E10 | access-provisioning: rate limits | BVA | L1 | automated | same root: create at t0, settle, create at t0+59 s / t0+60 s; global: 3 creations in 10 min then a 4th at +9:59 and +10:00 | POST | +59 s → 429 `rate-limited` with retry-after; +60 s → accepted; 4th global at 9:59 → 429; at 10:00 → accepted |
| E11 | access-provisioning: cooldown | state-transition | L1 | automated | request for `/w/app` ends (a) settled with 0 approvals (b) dismissed (c) expired (d) settled with 1 approval | new POST at +1 min and +5 min | (a)(b)(c) +1 min → 429 `cooldown`, +5 min → accepted; (d) +1 min → accepted (only per-root 60 s rule) |
| E12 | access-provisioning: eligibility ladder | decision table | L1 | automated | kill switch `1`; `promptEnabled:false`; host gate `report`; 0 operator sockets; observe-tier socket with capability only; all OK | POST | 503 `disabled`; 409 `prompting-disabled`; 409 `report-mode`; 409 `no-operator`; 409 `no-operator`; 200 — first failing rung wins in that order |
| E13 | access-provisioning: YOLO never answers | EP | L1 | automated | unscoped YOLO active; valid request | POST, wait | status stays `pending`; YOLO `history()` gains no entry; no grant |
| E14 | access-provisioning: re-verify on approval | state-transition | L1 | automated | dialog shows `/w/lib`; before approval replace `/w/lib` with symlink → `/w/secret` | approve | line `changed`; store has no `/w/lib` nor `/w/secret`; no revoke call |
| E15 | access-provisioning: root re-validation | state-transition | L1 | automated | pending for `/w/app`; delete `/w/app/.git` | approve 2 lines | both `refused` reason `root-changed`; no grant |
| E16 | access-provisioning: approval writes provisioned grant | EP | L1 | automated | approve `/w/lib` for `/w/app` | settle | store entry `{subject:/w/lib, scope:"project", via:"provision", origin:"/w/app"}`; bridge `GrantCache` (fixture store path) admits `/w/lib/x` |
| E17 | access-provisioning + path-anchor-grants: capacity, no eviction | BVA | L1 | automated | store 198 / 199 grants; approve 2 net-new lines; also 199 + 1 net-new + 1 already-granted | settle | 198 → both `granted` (200); 199 + 2 net-new → both `refused` `capacity`, store unchanged; 199 + 1 net-new + 1 existing → both `granted` (existing idempotent) |
| E18 | path-anchor-grants: provisioned never evicted | decision table | L1 | automated | 200 grants, oldest provisioned; 200 all provisioned | `recordGrant` from a denial verdict | first → oldest non-provisioned evicted, provisioned kept, log `[access-grants] evicted subject= via=`; second → `{ok:false}` and 200 remain |
| E19 | path-anchor-grants: `evict:false` per call | EP | L1 | automated | store at 200 | `recordGrant({..., evict:false})` | `{ok:false, error:"capacity"}`; file unchanged |
| E20 | access-provisioning: pi-trust per line | decision table (project root × approve × piTrust) | L1 | automated | `/w/lib` with `.git`: approve+true, approve+omitted, reject+true; `/w/plain` (no marker) approve | settle | `setChoice("accessGrants", "/w/lib", true)`, then `false` for omitted, none for rejected; `/w/plain` no setChoice call |
| E21 | access-provisioning: reasons bounded and inert | BVA | L1 | automated | why absent; 200 chars; 201 chars; 500 chars; `"x\n[access-provision] settled id=evil"`; `"<b>x</b>"` | create + log | absent → view `no reason given`; 200 unchanged; 201/500 → 200 chars + `…`; newline stripped, log line JSON-quoted (no line starts with the injected text); markup kept as literal text |
| E22 | access-grant-dialog: default on | decision table | L1 | automated | config without `accessGrants`; `{accessGrants:{}}`; `{promptEnabled:false}`; `{promptEnabled:true}`; `{promptEnabled:"yes"}` | `loadConfig()` | true; true; false; true; true (non-boolean → default) |
| E23 | access-grant-dialog: explicit false survives a partial write | EP | L1 | automated | config `{accessGrants:{promptEnabled:false}}` | `writeConfigPartial({port: 8001})` | file still holds `promptEnabled:false`; no writer adds `accessGrants` to a config that lacked it |
| E24 | access-provisioning: dialog line controls | decision table (class) | L1 | automated | request with one line of each class + remote goal `lan` | render `ProvisionPromptDialog` | approve control only on `grantable`; none checked; `in-root`/`covered`/`forbidden`/`sensitive`/`missing`/`invalid` show reason text; `lan` shows "Open Remote access" + "Allow devices on my network" |
| E25 | access-provisioning: dialog copy | EP | L1 | automated | any request | render | consequence text (every session on this machine), "requested for `/w/app`" claim wording, consent-not-protection line present; no answer focus-defaulted |
| E26 | access-settings-tab: provisioned label | EP | L1 | automated | grants list with `via` provision / prompt / agent-prompt | render Access section | provisioned row shows "requested for /w/app" + revoke; others keep their existing labels |
| E27 | access-provisioning: status + outcomes | state-transition | L1 | automated | request A,B settled A approve / B reject; goal `lan` | `GET /api/access/provision/:id` | `status:"settled"`, A `granted`, B `rejected`, `lan` `handed-off`; unknown id → 404 |
| E28 | access-provisioning: terminal first-wins | state-transition | L1 | automated | settled request; expired request; dismissed request | answer again (WS + HTTP) | 409 `already-settled` / dropped; no state change; no grant |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | path-anchor-grants: bound exists for cold-path cost (design D5 sync section) | timed micro | L1 | automated | settle of 32 grantable lines against a 168-grant store (fixture tmpdir) | synchronous section < 50 ms on CI (single run, warm fs) | one settle |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | access-provisioning: first answer wins across clients | state-convergence | L3 | automated | two browser contexts on the harness, both operate tier; one pending request | context A approves `/w/lib` | A dialog closes; B dialog closes within 5 s (`provision_dismiss`); store holds exactly one `/w/lib` grant |
| F2 | access-settings-tab: answer from Access page | state-transition | L3 | automated | request pending; dialog left open in tab A; tab B opens Settings ▸ Access | approve line in tab B | request `settled`; tab A dialog closes; grant row "requested for" visible in B |
| F3 | access-settings-tab: read-only without capability | EP | L1 | automated | Access section rendered with `useHasGrantChannel()=false` and a pending request | render | request listed, no approve controls, reason text shown |
| F4 | access-settings-tab: dismiss all pending | state-transition | L3 | automated | 3 pending requests (3 roots) | click "Dismiss all pending" | all 3 `dismissed`; a new POST for any of those roots within 5 min → 429 `cooldown` |
| F5 | access-provisioning: reconnect reconciles | state-transition | L3 | automated | pending request; browser socket dropped and reconnected | reconnect | dialog re-appears for the still-pending request (from `GET /api/access/provision`) or not at all if it ended meanwhile |
| F6 | access-provisioning: remote hand-off | EP | L3 | automated | request with goal `internet` | click "Open Remote access" | Remote access dialog opens on its landing (4 task entries visible); `trustedNetworks`/`cors.allowedOrigins` in config unchanged |
| F7 | access-provisioning: dialog visual fit | visual/subjective | — | manual-only | 32-line dialog at 375 / 1440 px, dark + light | human looks | [judgment: lines readable, consequence text not buried, no layout overflow] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | access-provisioning: capability-less HTTP settle | fault (missing credential) | L1 | automated | loopback request, operate tier, no `X-Pi-Grant-Channel` | `POST /api/access/provision/:id/settle` approve | 403; request stays `pending`; no grant |
| X2 | access-provisioning: socket without capability | fault (wrong socket) | L1 | automated | WS socket B never issued a capability; socket A holds one | B sends `provision_response` approve | dropped; `droppedResponses` +1; log `response-dropped reason=no-capability`; still pending |
| X3 | access-provisioning: capability bound to its socket | fault (replay) | L1 | automated | socket A's capability value sent in a frame on socket B | B sends `provision_response` | dropped (capability A never authorises B) |
| X4 | access-provisioning: observe-tier socket | fault (tier) | L1 | automated | observe-tier socket holding a capability | sends `provision_response`; is it a send target? | not sent `provision_request`; response refused by tier; still pending |
| X5 | access-provisioning: ladder re-check at settle | fault (config flip) | L1 | automated | pending request; then (a) host gate → `report` (b) kill switch set (c) `promptEnabled:false` | operator approves | refused, request stays `pending`, no grant, until expiry → `expired` |
| X6 | access-provisioning: store write failure | fault (abort) | L1 | automated | `writeAtomic` throws on 2nd of 3 approved lines | settle | line 1 `granted`, line 2 `failed`, line 3 `granted`; cache never widened for line 2; settle does not 500 |
| X7 | access-provisioning: expiry | fault (timeout) | L1 | automated | pending request, fake timers | advance 9:59 then 10:00 | 9:59 pending; 10:00 `expired`, `provision_dismiss` sent, no grant, cooldown starts |
| X8 | access-provisioning: restart loses pending | fault (process restart) | L1 | automated | pending request in registry instance 1 | new registry instance (restart) then `GET /:id` | 404; store unchanged |
| X9 | access-provisioning: disconnect mid-dialog | fault (abort) | L3 | automated | only operator browser closes while request pending | wait | request stays pending until expiry; new POST for another root → 409 `no-operator` |
| X10 | access-provisioning: observability | fault-free trace | L1 | automated | create → settle (1 approve, 1 reject); create → expire; refused POST | inspect logs + `/api/health` | one `[access-provision]` line per transition with id + JSON-quoted project; health `accessGrants.provisioning` counters `created 2, approved 1, rejected 1, expired 1, refused 1, pending 0`; old health readers tolerate the field |
| X11 | access-provisioning: profile grants nothing alone | EP | L3 | automated | harness repo with `.pi/access.json` listing `/w/lib`; no request made | session reads `/w/lib/x` via `read` tool | agent path-gate prompt is raised (not silently allowed) |
| X12 | access-provisioning: end-to-end honest path | integration | L3 | automated | harness; `.pi/access.json` with `/w/lib` + `/w/other` | POST via the skill's request shape; approve `/w/lib`, reject `/w/other` in the dialog | session reads `/w/lib/x` without a prompt; read of `/w/other/x` prompts; Access page shows "requested for" on `/w/lib` |
| X13 | access-provisioning: project-access skill `map` writes nothing | manual run | — | manual-only | repo with grants | run skill `map` in a pi session | [judgment: report is correct and complete; `git status` + store mtime unchanged — skill is prose, verified by a human run] |
| X14 | access-provisioning: skill `suggest` gap reporting | manual run | — | manual-only | 3 grants with `origin:"unknown"`, sessions API stopped | run skill `suggest` | [judgment: skill states 3 skipped + list may be partial before asking to write] |
| X15 | project-init-skill: opt-in access step | manual run | — | manual-only | bare dir with `.pi/access.json`; dashboard closed (no operator) | run project-init, accept access step | [judgment: init completes; skill says to retry with `project-access` later] |

---

## Coverage summary

- Requirements covered: 23/23 (access-provisioning 16, path-anchor-grants 2, access-settings-tab 4 incl. MODIFIED, access-grant-dialog 1, pi-trust-mirror 1, project-init-skill 1 — counted by requirement, several rows cover more than one)
- Scenarios by class: edge 28 · perf 1 · frontend 7 · error 15
- Scenarios by level: L1 39 · L3 8 · manual 4
- Scenarios by disposition: automated 47 · manual-only 4

## New infra needed

- none. L3 reuses `tests/e2e/access-grant-dialog.spec.ts` (already opens a second browser context via `newContext`). Socket/capability L1 rows extend `packages/server/src/__tests__/browser-gateway-grant-channel.test.ts`.
