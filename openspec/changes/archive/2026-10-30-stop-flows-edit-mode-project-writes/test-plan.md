# Test Plan — stop-flows-edit-mode-project-writes

Stage: design   Generated: 2026-10-30

Hard gate passed: no unfillable Triple. Numbers come from design.md (poll 10 × 200 ms; rate limit = the `flow-files.ts` scope). L3 rows assume the docker harness installs pi-flows >= 0.8.1 (npm latest).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | New/Edit gated on effective edit-mode | decision-table | L1 | automated | project `flows.editFlow` ∈ {true,false,unset,unparseable} × global `flows.editFlow` ∈ {true,false,unset} × legacy `flowsEditFlow` ∈ {true,unset} (each file) | `resolveEditMode(cwd,{home})` | result equals pi-flows rule project ?? global ?? false for all 24+ rows (unparseable = unset; `flows.editFlow` before `flowsEditFlow` within a file) |
| E2 | Edit-mode routes guarded and narrow / Unparseable project settings | EP | L1 | automated | `<cwd>/.pi/settings.json` = `{bad json` | `GET /edit-mode-state?sessionId=<s in cwd>` | 200 `{enabled:<global value>}`; project file bytes + mtime unchanged |
| E3 | Non-boolean body rejected | EP+BVA | L1 | automated | PUT bodies `{enabled:"yes"}`, `{}`, `null`, `{enabled:1}`, `{enabled:true,path:"/etc/x"}` | `PUT /api/plugins/flows/edit-mode-default` (fastify inject) | first four → 400, global file byte-identical; fifth → only `flows.editFlow` written, no other path touched |
| E4 | Unrelated global keys survive | invariant | L1 | automated | global file with `packages`, `dashboardPluginBridges`, `flows.someOtherKey`, BOM-free | PUT `{enabled:true}` | `flows.editFlow===true`; the three other keys deep-equal before/after |
| E5 | PI_CODING_AGENT_DIR does not redirect the write | EP | L1 | automated | `PI_CODING_AGENT_DIR=<tmp>/alt`, `home=<tmp>/home` | PUT `{enabled:true}` | `<tmp>/home/.pi/agent/settings.json` has `flows.editFlow:true`; `<tmp>/alt/settings.json` absent/unchanged; lock file created at `<tmp>/home/.pi/agent/settings.json.lock` |
| E6 | Default is off / Legacy top-level key is shown | EP | L1 | automated | global file: (a) `{}` (b) `{flowsEditFlow:true}` (c) missing file | `GET /edit-mode-default` | (a) `{enabled:false}` (b) `{enabled:true}` (c) `{enabled:false}`, no file created |
| E7 | Unknown session | EP | L1 | automated | sessionId not in `listActive()` | `GET /edit-mode-state?sessionId=ghost` | 404; fs read spy records zero calls |
| E8 | Legacy plugin-config value migrates once | decision-table | L1 | automated | plugin config `editFlow` ∈ {true,false,absent} × global ∈ {unset, `flows.editFlow:false`, unparseable} | `registerPlugin(ctx)` | (true,unset) → global `flows.editFlow:true` + key absent in `config.json`; (true,false) → global unchanged + key absent; (false,*) → global unchanged + key absent; (true,unparseable) → global byte-identical + key still `true`; no project `.pi/settings.json` written in any row |
| E9 | Legacy migration under lock | concurrency invariant | L1 | automated | plugin config `editFlow:true`, global unset | two migrations started concurrently on the same file | exactly one write; final file `flows.editFlow:true`; neither run throws |
| E10 | Stale label sends nothing | state-transition (illegal edge) | L1 | automated | project file already `flows.editFlow:true` | `plugin_action flow.set-edit-mode payload {enabled:true}` | `emitEventToSession` called 0×; one `flows_edit_mode_state {sessionId,enabled:true}` frame per session in cwd |
| E11 | Explicit per-project action reaches pi-flows | contract | L1 | automated | flows `package.json` manifest | manifest test + emit seam test (`plugin-event-seam.test.ts` pattern) | `emits` contains `flow:set-edit-mode`; seam returns `true` for it from plugin `flows` |
| E12 | Edit-mode routes guarded | contract | L1 | automated | `route-tiers.ts` | route-tier coverage test | rows exist: `GET /api/plugins/flows/edit-mode-default` observe, `GET /api/plugins/flows/edit-mode-state` observe, `PUT /api/plugins/flows/edit-mode-default` operate |
| E13 | Lock module stays out of client code (D3) | static boundary | L1 | automated | repo sources | vitest scan of `packages/client/src/**` + `packages/*-plugin/src/client/**` | zero imports of `pi-agent-settings-lock`; not re-exported from any barrel |
| E14 | Lock move is behaviour-neutral (D3) | regression | L1 | automated | existing `packages/server/src/__tests__/pi-agent-settings*.test.ts` | run unchanged after the move | all pass with no test edits |
| E15 | New/Edit gated / Explicit per-project action labels | decision-table | L1 | automated | availability ∈ {open,closed} × effective ∈ {true,false,unknown} | render `SessionFlowMenuClaim` | New/Edit rendered only for (open,true); per-project item: (open,false) "Turn on edit mode for this project", (open,true) "Turn off edit mode for this project", unknown/closed → absent; hint text contains `.pi/settings.json` |
| E16 | session-card-subcards FLOWS gate unchanged | regression | L1 | automated | empty `flowsList`, no flow events, effective edit mode on | `shouldRenderFlowsSubcard(session)` + card render | false; no `FLOWS` title; New/Edit present in menu |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Global save reaches idle sessions (D4 read bound) | counting invariant | L1 | automated | 50 active sessions across 5 distinct cwds | PUT `{enabled:true}` → project-file reads = 5 (one per cwd), frames emitted = 50 | single PUT |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Project settings are never written implicitly / Opening a repo | state-transition | L1 | automated | flows available, plugin config `editFlow` ∈ {true,false,absent} | mount `SessionFlowMenuClaim`, then 5 re-renders with changing `commandsList` | `usePluginSend` mock: 0 calls with `flow_management` or `flow.set-edit-mode` |
| F2 | Several browser tabs send nothing | convergence | L1 | automated | same session rendered by 2 independent provider trees | mount both, unmount/remount one | 0 edit-mode sends across both |
| F3 | Opening a repo writes nothing (end-to-end) | convergence | L3 | automated | harness repo with clean `git status --porcelain`, global `flows.editFlow:true` | open dashboard, session card renders, reload page twice | `git status --porcelain` empty; `<repo>/.pi/settings.json` and `<repo>/.pi/skills/manage-flows/` absent/unchanged; New/Edit… visible in menu |
| F4 | Global save reaches idle sessions | convergence | L3 | automated | idle session, no project value, global unset | Settings › Plugins › Flows → Edit mode on → Save | container `~/.pi/agent/settings.json` has `flows.editFlow:true`; repo tree clean; session menu shows New/Edit… without a prompt being sent |
| F5 | Turning on for one project / Sibling sessions follow | convergence | L3 | automated | two sessions in one cwd, effective off | session A menu → "Turn on edit mode for this project" | `<repo>/.pi/settings.json` `flows.editFlow:true`; session B menu label becomes "Turn off edit mode for this project" without reload; global file unchanged |
| F6 | Out-of-band change is picked up on menu open | state-transition | L1 | automated | hook initial state off; GET mock now returns `{enabled:true}` | open the session actions menu | GET called again; label "Turn off edit mode for this project" |
| F7 | Push frames are session-scoped | EP | L1 | automated | hook for session S | `flows_edit_mode_state` frames for S and for other session T | state updates only from S's frame |
| F8 | Settings section renders the toggle | state-transition | L1 | automated | GET mock `{enabled:false}` | toggle on → draft commit | PUT called once with `{enabled:true}`; no `plugin_config_write` sent |
| F9 | Hint copy is clear to users | visual/subjective | — | manual-only | menu item + settings hint | a human reads them | [judgment: user understands the per-project item writes the repo file and the global toggle does not] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Unparseable global settings are not overwritten | fault-injection (abort) | L1 | automated | global file `{"flows":` | PUT `{enabled:true}` | 400 with `parseError` (position only); file byte-identical; settings section shows the error (FlowsSettings test) |
| X2 | Settings lock held | fault-injection (delay) | L1 | automated | `<settings.json>.lock` held by another `proper-lockfile` holder for the whole retry budget | PUT `{enabled:true}` | 503; file byte-identical |
| X3 | Session not reachable | fault-injection (abort) | L1 | automated | `emitEventToSession` returns false | `flow.set-edit-mode {enabled:true}` | no poll started; frame `{enabled:<unchanged>, error:"not-delivered"}`; client hook surfaces an error notification and label stays unchanged |
| X4 | Per-project write never lands | fault-injection (delay) | L1 | automated | emit returns true, project file never changes | `flow.set-edit-mode {enabled:true}` with fake timers | exactly 10 resolves at 200 ms spacing; then frame `{enabled:false, error:"timeout"}` |
| X5 | State unavailable | fault-injection (abort) | L1 | automated | `GET /edit-mode-state` rejects / 500 / 404 (plugin route absent) | render menu claim | neither New/Edit… nor the per-project item rendered; no throw |
| X6 | Legacy migration write fails | fault-injection (abort) | L1 | automated | lock step returns `io` error | `registerPlugin(ctx)` | plugin config still `editFlow:true`; second `registerPlugin` with healthy fs migrates |

---

## Coverage summary

- Requirements covered: 11/11 (flows-edit-mode-settings: 7 incl. 2 REMOVED verified by F1/F2; flows-plugin: 1; session-card-subcards: 1; design D3 lock + manifest/tier contracts: 2)
- Scenarios by class: edge 16 · perf 1 · frontend 9 · error 6
- Scenarios by level: L1 29 · L2 0 · L3 3
- Scenarios by disposition: automated 31 · manual-only 1

## New infra needed

- none (L3 reuses the docker harness with the real pi-flows engine, as `tests/e2e/flow-attach-before-run.spec.ts` does)
