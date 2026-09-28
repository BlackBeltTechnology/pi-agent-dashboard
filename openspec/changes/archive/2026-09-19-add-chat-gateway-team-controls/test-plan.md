# Test Plan — add-chat-gateway-team-controls

Stage: design   Generated: 2026-09-18

All three clarification gaps resolved before writing (retention default 10,000 entries; rate ceiling 5 msg/5s per channel; reconciliation synchronous with the config write). No open markers.

Harness note: L3 rows read their observable against the docker harness port recorded in `.pi-test-harness.json` (`dashboardPort`), never a hardcoded `:18000`. Discord REST/gateway is stubbed at every level — no live-guild test.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | tier-auth: identifier + role both grant | decision-table | L1 | automated | principal listed `observe` by id, holds role mapped `control`, ceiling `operate` | authorize() a `send_prompt` | grant tier = `control` |
| E2 | tier-auth: ceiling clamps | BVA | L1 | automated | principal mapped `operate`, ceiling `control` | authorize() any verb | grant tier = `control`, never `operate` |
| E3 | tier-auth: default ceiling | BVA | L1 | automated | config with no ceiling key | authorize() a `control`-tier verb for an `operate`-mapped principal | grant tier = `observe`; the verb is refused `insufficient_tier` |
| E4 | tier-auth: per-binding scoping | decision-table | L1 | automated | principal mapped `control` on binding A only | authorize() in binding B | `Refusal{reason:"no_principal_mapping"}` |
| E5 | tier-auth: fail-closed fresh binding | decision-table | L1 | automated | binding created, zero principals; another binding has 3 principals at `operate` | authorize() from each of those 3 in the new binding | all three → `Refusal{"no_principal_mapping"}` |
| E6 | tier-auth: every refusal reason | decision-table | L1 | automated | one fixture per reason (bot author; unbound channel; unmapped; cross-workspace target; disarmed; `mint_device_token`; `observe` calling `send_prompt`) | authorize() each | 7 distinct reason codes, exactly one per fixture |
| E7 | tier-auth: bot author outranks a matching mapping | decision-table | L1 | automated | message with `author.bot=true` whose id equals a principal mapped `operate` | authorize() | `Refusal{"non_human_author"}` — the mapping never applies |
| E8 | tier-auth: webhook author | decision-table | L1 | automated | message carrying `webhook_id`, no `author.bot` | authorize() | `Refusal{"non_human_author"}` |
| E9 | tier-auth: role cannot map to operate | EP (invalid partition) | L1 | automated | config mapping role→`operate` | schema validation | rejected with the `operate`-requires-identifier reason; config not persisted |
| E10 | tier-auth: verb tier read, not declared | decision-table | L1 | automated | stub `GENERATED_TOOLS` row for `resume_session` altered to `operate` | authorize() `resume_session` for a `control` principal | `Refusal{"insufficient_tier"}` — proves the tier is read from the table |
| E11 | tier-auth: verb absent from the curated allowlist | EP (invalid) | L1 | automated | `operate` principal, verb `shutdown_server` (exists in table, not in allowlist) | authorize() | refused despite sufficient tier |
| E12 | tier-auth: verb absent from the tier table | EP (invalid) | L1 | automated | allowlisted command naming a verb with no `GENERATED_TOOLS` row | authorize() | refused; no tier inferred |
| E13 | tier-auth: NON_DELEGABLE at operate | decision-table | L1 | automated | principal at `operate`, ceiling `operate` | each of `mint_device_token`, `set_providers`, `install_package`, `tunnel_connect` | all 4 → `Refusal{"non_delegable_verb"}` |
| E14 | workspace-binding: sibling name prefix | BVA | L1 | automated | workspace folder `/a/fo`; session cwd `/a/foo` | resolve cwd→workspace | no match (segment-boundary rule) |
| E15 | workspace-binding: nested folders, two workspaces | BVA | L1 | automated | ws A folder `/a`; ws B folder `/a/b`; session cwd `/a/b/c` | resolve cwd→workspace | resolves to ws B (longest match) |
| E16 | workspace-binding: exact folder match | BVA | L1 | automated | ws folder `/a/b`; session cwd `/a/b` | resolve | resolves to that workspace |
| E17 | workspace-binding: symlinked cwd | EP | L1 | automated | `/tmp/link` → `/a/b/c`; ws folder `/a/b` | resolve real path | resolves to that workspace |
| E18 | workspace-binding: cwd outside every binding | EP (invalid) | L1 | automated | ws folder `/a/b`; session cwd `/x/y` | resolve | no match; session not surfaced |
| E19 | chat-gateway (MOD): workspace folder outside allowedRoots | EP (invalid) | L1 | automated | `allowedRoots=['/srv/ok']`; bound ws folders `['/srv/ok/p','/home/secret']` | resolve a bind for each folder | `/srv/ok/p` resolves; `/home/secret` inert — no resolution, no spawn |
| E20 | chat-gateway (MOD): resolver precedence with the workspace source | decision-table | L1 | automated | persisted binding + workspace + fixed map + default workspace all applicable | resolve an unbound then a bound channel | persisted binding wins; workspace precedes the fixed map |
| E21 | audit: retention at the bound | BVA | L1 | automated | log holding limit−1 entries (limit 10,000) | append 1, then 1 more | at limit: nothing discarded; at limit+1: oldest gone, count == limit, newest present |
| E22 | audit: default retention | BVA | L1 | automated | config with no retention key | read effective limit | 10,000 |
| E23 | audit: one entry per action-bearing request | decision-table | L1 | automated | 1 permitted prompt, 1 refused prompt, 1 mirrored event | process all three | exactly 2 entries; the mirrored event produces none |
| E24 | output-filter: default level omits structured payloads | decision-table | L1 | automated | events: file-edit tool call w/ args+diff, shell tool call w/ output, assistant text | render at names-only | tool names present; args, diff, and terminal output absent |
| E25 | output-filter: level change is forward-only | state-transition | L1 | automated | thread with 3 posted messages at names-only | raise to full transcript, emit 1 event | new event renders in full; the 3 prior messages unchanged |
| E26 | seam: defensive copy | EP | L1 | automated | `listWorkspaces()` result | mutate the returned array and a nested `folders` array | store unchanged; a re-read returns original state |
| E27 | seam: empty state | BVA | L1 | automated | no workspaces configured | `listWorkspaces()` | empty collection, no throw |
| E28 | seam: every mutator notifies | decision-table | L1 | automated | subscriber registered; all 9 store mutators | invoke each in turn | 9 notifications, one per mutator |
| E29 | seam: completeness guard | decision-table | L1 | automated | notification wiring removed from one mutator | run the guard test | the guard fails and names that mutator |
| E30 | seam: unsubscribe | state-transition | L1 | automated | subscriber that has unsubscribed | mutate a workspace | handler not invoked |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | output-filter: bounded posting rate | threshold | L1 | automated | 100 mirrorable events emitted within 1s to one thread (stubbed REST clock) | posts to that channel ≤ 5 | any 5s window |
| P2 | output-filter: sustained streaming | soak | L1 | automated | continuous event stream, 60s | no 5s window exceeds 5 posts; zero rate-limit errors from the stub | 60s |
| P3 | output-filter: one post in flight per thread | invariant | L1 | automated | event arriving while a post is unresolved | concurrent in-flight posts to one thread == 1 | duration of the run |
| P4 | tier-auth: per-request re-resolution cost | tail-latency | L1 | automated | 10,000 sequential `authorize()` calls, 50 principals × 20 roles | p95 < 1ms per call (no caching permitted) | full run |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | config surface: delegation list | state-convergence | L3 | automated | binding with a role mapped `control`, assignable by a non-owner member | open the config surface | converges to showing the mapping alongside the naming of those members |
| F2 | config surface: delegation unavailable | state-convergence | L3 | automated | stubbed platform lacking the member-enumeration permission | open the config surface | states the list is unavailable and names the missing permission — never an empty list implying nobody |
| F3 | config surface: inert workspace folders | state-convergence | L3 | automated | bound workspace with one folder inside and one outside `allowedRoots` | open the config surface | the outside folder is shown as inert |
| F4 | config surface: disarmed state visible | state-transition | L3 | automated | layer disarmed from chat | open the config surface | shows disarmed; re-arm control present |
| F5 | audit: log view ordering | state-convergence | L3 | automated | 3 log entries written in known order | open the log view | rendered most-recent-first |
| F6 | tier-auth: config editable only from the dashboard | state-transition | L3 | automated | config surface open; a chat-originated config-mutation attempt in flight | attempt the chat mutation | rendered config values unchanged |
| F7 | output-filter: elision marker rendering | state-convergence | L3 | automated | assistant message exceeding the platform message limit | mirror it | rendered thread shows an explicit elision marker, not a silently cut message |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | workspace-binding: provisioning without overwrite permission | fault-injection (abort) | L1 | automated | REST stub rejects channel-create carrying overwrites | provision a binding | no channel created; plugin health entry names the reason |
| X2 | workspace-binding: no create-then-patch window | invariant | L1 | automated | REST stub recording the full call sequence | provision a channel | create call carries the `@everyone` view deny; zero subsequent permission-PATCH calls |
| X3 | workspace-binding: synchronous revocation | invariant | L1 | automated | binding with principal P; REST stub with a delayed overwrite update | remove P and await the config write | at write-success, the stub has already applied the overwrite — no interval where P retains access |
| X4 | workspace-binding: reconciliation fails | fault-injection (abort) | L1 | automated | REST stub rejects the overwrite update | change a mapping | config write fails reporting the reason; stored mapping and channel access remain consistent |
| X5 | workspace-binding: reconcile-at-activation | state-transition | L1 | automated | mapping changed on disk while the layer was inactive | activate the layer | overwrites reconciled to the current mapping |
| X6 | workspace-binding: workspace deleted | state-transition | L1 | automated | bound workspace deleted | `onWorkspacesChanged` fires | binding inactive; zero channel-delete calls; history untouched |
| X7 | workspace-binding: channel deleted on the platform | state-transition | L1 | automated | bound channel deleted in Discord | next mirrorable event | binding dropped; the session keeps running; no session abort issued |
| X8 | workspace-binding: irrelevant workspace fire | invariant | L1 | automated | `setWorkspaceCollapsed` and a folder reorder | seam notification fires | zero platform calls |
| X9 | workspace-binding: coalesced fires | state-convergence | L1 | automated | rename + folder-add + rename again delivered as one coalesced notification | reconcile | converges to the final workspace state; reconcile is idempotent under replay |
| X10 | tier-auth: trusted-gated verb no-ops | fault-injection (abort) | L1 | automated | stubbed untrusted context (`assignSessionRef` → false) | drive a session from chat | plugin reports unhealthy naming the missing trust level; the command is refused with that reason, not reported as done |
| X11 | tier-auth: no path reaches a session without a Grant | invariant | L1 | automated | dispatcher invoked without a grant | attempt every action verb | no session is affected for any verb |
| X12 | tier-auth: scope violation | fault-injection (malicious input) | L1 | automated | binding for ws A; request naming a session whose cwd is in ws B | authorize() | `Refusal{"scope_violation"}`; the referenced session unaffected |
| X13 | tier-auth: free-text cwd rejected | fault-injection (malicious input) | L1 | automated | message text supplying a cwd, incl. `..` traversal | resolve a target | text never used for resolution; no spawn |
| X14 | tier-auth: disarm then re-arm | state-transition | L1 | automated | `observe` principal disarms | `control` principal attempts re-arm from chat, then the dashboard re-arms | chat re-arm refused and state persists; dashboard re-arm restores action handling |
| X15 | tier-auth: mirroring survives disarm | invariant | L1 | automated | layer disarmed | bound session emits events | events still mirrored while every action-bearing request is refused |
| X16 | tier-auth: role removed mid-conversation | state-transition | L1 | automated | principal whose only `control` grant is a role | remove the role, send a second request | second request resolves lower or refuses, with no restart |
| X17 | tier-auth: layering cannot widen L1 | invariant | L1 | automated | principal with a `control` mapping but absent from chat-gateway's L1 allowlist | inbound action-bearing message | refused at L1; the mapping grants nothing |
| X18 | tier-auth: layering cannot widen L2 | invariant | L1 | automated | non-admin principal at `operate` attempting a channel binding | bind attempt | refused by L2 despite the tier |
| X19 | chat-gateway (MOD): observer activates a question control | fault-injection (unauthorized input) | L1 | automated | pending `prompt_request`; principal below `control` | activate the control | no `prompt_response` sent; session stays blocked; interaction still acknowledged (no "interaction failed") |
| X20 | chat-gateway (MOD): bystander answers an invoker's question | fault-injection (unauthorized input) | L1 | automated | question raised by principal A's command; principal B at `control` | B activates the control | no `prompt_response` sent |
| X21 | chat-gateway (MOD): question with no chat invoker | state-transition | L1 | automated | session bound by attach-to-existing raises a question | any `control` principal on the binding answers | `prompt_response` delivered; the session does not deadlock |
| X22 | seam: throwing subscriber | fault-injection (abort) | L1 | automated | two subscribers, the first throws | mutate a workspace | second subscriber still notified; the workspace mutation persists |
| X23 | audit: refusal reasons recorded distinctly | decision-table | L1 | automated | one request per refusal class | process all | each log entry carries its own distinct reason |
| X24 | audit: provenance persists | state-transition | L1 | automated | session first driven from chat | restart the dashboard | the plugin-owned ref survives, naming principal + channel + binding; the user-curated tag namespace is untouched |
| X25 | audit: log has no edit path | invariant | L1 | automated | existing log entries | enumerate the layer's exposed interface | no edit or delete operation exists |
| X26 | audit: log unreachable from chat | fault-injection (unauthorized input) | L1 | automated | `operate` principal asks the bot for the log | process the request | refused and redirected to the dashboard; no log content posted |
| X27 | output-filter: assistant prose boundary | invariant | L1 | automated | assistant message whose own text quotes a diff | mirror at names-only | prose mirrored verbatim — documents that the filter bounds structured payloads only |
| X28 | output-filter: untiered pull | fault-injection (unauthorized input) | L1 | automated | user resolving to no tier requests a diff | process the pull | refused |
| X29 | output-filter: permitted pull under a names-only filter | decision-table | L1 | automated | `control` principal requests a diff; thread at names-only | process the pull | content delivered (tier-gated, not filter-gated) |
| X30 | seam: additivity | invariant | L1 | automated | a plugin written before the seam existed | load it | activates unchanged; no existing context member changed shape |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | end-to-end team flow | exploratory | — | manual-only | a real test guild, 2 accounts at different tiers | bind a workspace, prompt as `control`, attempt as `observe`, revoke, disarm | [judgment: the whole flow behaves sanely against real Discord — stubs cannot prove platform acceptance of the overwrite/thread calls] |
| M2 | config surface comprehensibility | exploratory | — | manual-only | the configuration panel with 3 bindings and mixed mappings | an operator reads it cold | [judgment: an operator can tell who can do what, where, without documentation] |

---

## Coverage summary

- Requirements covered: 34/34 (6 capability specs — `chat-gateway` MODIFIED ×3, tier-authorization ×12, workspace-binding ×7, output-filter ×6, audit ×5, workspace-seam ×5)
- Scenarios by class: edge 30 · perf 4 · frontend 7 · error 30 · manual 2
- Scenarios by level: L1 66 · L2 0 · L3 7 · — 2
- Scenarios by disposition: automated 71 · manual-only 2

Why no L2: this change adds no install, spawn-mechanism, or multi-OS runtime behaviour — it is authorization logic plus platform REST calls. Cross-OS coverage would restate L1 with more setup.

## New infra needed

- A stubbed Discord REST/gateway fixture that records the full call sequence (needed by X2's "no create-then-patch window" and the rate-budget rows). Extend chat-gateway's adapter stub rather than building a second one.
- No new test level or harness.
