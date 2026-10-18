# Test Plan — add-pi-spec-driven-schema

Stage: design   Generated: 2026-10-18

Hard gate passed: every Triple is filled from spec-defined values (retry 5×/2 s, state tables, 104/33 fixture, exact paths). No clarification markers. No performance threshold is specified by the delta, so no performance rows.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Workflow schema is generated… | EP | L1 | automated | temp repo with `openspec init`, no `schemas/pi-spec-driven/` | generate | `schema.yaml` has `x-pi-dashboard {derivedFrom: spec-driven@<cli --version>, patch: 1, previousDefault}`; design instruction contains the replaced `Not needed:` line; `openspec schema validate pi-spec-driven` valid |
| E2 | Workflow schema is generated… (user shadow) | EP | L1 | automated | real `XDG_DATA_HOME` holds a `spec-driven` schema whose description is `SHADOW` | generate | generated `schema.yaml` description is the package one (no `SHADOW`) |
| E3 | Workflow schema is generated… (non-package base) | EP | L1 | automated | stubbed `schema which` returning `source:"project"` | generate | aborts; repository tree byte-identical (fs snapshot) |
| E4 | Workflow schema is generated… (patch anchor) | EP | L1 | automated | stub base `schema.yaml` without the `When to include design.md (create only if any apply):` line | generate | aborts with an anchor error; no stamp written; no `.fork-staging-*` left |
| E9 | Workflow schema is generated… (fingerprint) | EP | L1 | automated | a template file under `pi-spec-driven/` edited after the status read | update | aborts before step 2; edited file preserved |
| E10 | Stamp comparison never downgrades | decision table | L1 | automated | stamps (1.11.0,1)/(1.10.0,1)/(1.11.0,0)/(1.12.0,1)/(1.11.0,2)/(1.12.0,0)/(1.10.0,2) vs local (1.11.0,1); dir without stamp; symlinked dir; no dir | compare | current / outdated / outdated / newer / newer / conflict / conflict; `unmanaged`; `unmanaged`; `none` |
| E11 | Stamp comparison never downgrades (validate memo) | state-transition | L1 | automated | `newer` stamp; stub `schema validate` exits 1; status evaluated 3× with the same (cwd, fingerprint, CLI version) | evaluate | status `incompatible`; exactly 1 validate spawn, through the semaphore |
| E12 | Enable pins file-less changes… | EP | L1 | automated | temp repo with 104 changes, 33 without `.openspec.yaml`, default `spec-driven` | enable | exactly 33 files created containing `schema: spec-driven`; `openspec status --all` reports all 104 with their previous `schemaName`; `config.yaml` names `pi-spec-driven` |
| E13 | Enable pins file-less changes… (custom default) | EP | L1 | automated | project schema `team-flow` is the default; change `x` without `.openspec.yaml` | enable | `x/.openspec.yaml` = `schema: team-flow`; stamp `previousDefault: team-flow` |
| E14 | Enable pins file-less changes… (idempotent) | EP | L1 | automated | enabled project, schema `current` | enable | fs snapshot before == after |
| E15 | Enable pins file-less changes… (no regeneration) | EP | L1 | automated | disabled project, schema `outdated`, `foo` pinned to `pi-spec-driven` | enable | `pi-spec-driven/` byte-identical; response status `outdated` |
| E16 | Enable… + Actions are allowed only in defined states (re-stamp) | state-transition | L1 | automated | stamp `previousDefault: spec-driven`, config default `team-flow`, disabled | enable; then update {previousDefault: team-flow}; then enable | first enable refused naming Update; update re-stamps `team-flow`; second enable succeeds |
| E17 | Enable… (config variants) | decision table | L1 | automated | rows: config without `schema:` key; both `config.yaml` (default A) and `config.yml` (default B); only `config.yml`; no config file | enable | previousDefault `spec-driven`; `config.yaml` read and edited (`config.yml` untouched); `config.yml` edited; refused |
| E18 | Every writing action verifies the root first | decision table | L1 | automated | rows: `root.source` declared / store; `root.path` realpath ≠ cwd; symlinked `openspec/`, `changes/`, `schemas/`, config file; stub status without `root` | each of enable, disable, update, adopt, pin, remove | refused for every row × action; zero writes |
| E19 | Schema names are validated before use | EP | L1 | automated | `pinTo: "spec-driven\nretire_capabilities: true"`; `previousDefault: pi-spec-driven`; `team-flow` only in `XDG_DATA_HOME`; deleted project schema in a stamp | pin / update / enable / disable | each refused, zero writes; the deleted-schema stamp value treated as absent |
| E20 | Actions are allowed only in defined states | decision table | L1 | automated | every action × generated ∈ {none,current,outdated,newer,incompatible,conflict,unmanaged} × configured ∈ {spec-driven, pi-spec-driven} | POST | allowed exactly per the requirement table, else refused with the current status |
| E21 | Pin only creates missing metadata | EP | L1 | automated | enabled; `foo` pinned `spec-driven`; `bar` file-less; a `.openspec.yaml` for `baz` created between enumeration and write | pin {changes:[foo,bar,baz], pinTo: spec-driven} | `foo` skipped unchanged; `bar` created; `baz` not overwritten (exclusive create) and reported skipped |
| E22 | Enable… / Pin… (enumeration) | EP | L1 | automated | `changes/archive/x`, `changes/.hidden`, `changes/evil` → symlink outside repo, `changes/ok` | enable | only `ok/.openspec.yaml` created; nothing written through `evil` |
| E23 | Disable restores the previous default… | decision table | L1 | automated | rows: enabled with `foo` pinned `pi-spec-driven`; config already `team-flow`; stamp-less without `previousDefault`; stamp-less with `previousDefault`+`confirm`; stamp `previousDefault` deleted | disable | config = previous default, schema dir kept, `foo` status without error; no-op; refused; applied; refused |
| E24 | Disable restores… (remove) | decision table | L1 | automated | rows: config names schema; active change pins it; only archived pins (with/without `confirm`); `unmanaged`; `none`; unreferenced `current` | remove | refused naming the reference; refused; warning / removed; refused; refused; dir renamed to `.fork-backup-*` then deleted, response warns about unmerged branches |
| E25 | Enable pins… (new change) | EP | L1 | automated | enabled temp repo | `openspec new change foo` | `foo/.openspec.yaml` contains `schema: pi-spec-driven` |
| E26 | Workflow schema is generated… (design skip) | EP | L1 | automated | `pi-spec-driven` change whose `design.md` is `Not needed: single-file fix` | `openspec status --all` | `design: done` |
| E27 | openspec-detection Local design evidence (schema gate) | decision table | L1 | automated | rows: `pi-spec-driven` + tasks checkboxes (status --all); `team-flow` + checkboxes; fallback `list` path with `.openspec.yaml` naming `pi-spec-driven`; fallback with no metadata | build data | not promoted / promoted / not promoted / promoted |
| E28 | openspec-detection Detection logic is shared | parity | L1 | automated | `pi-spec-driven` change with checkboxes; `spec-driven` change with checkboxes | run `effective-status.sh` and the dashboard build | both report `design: ready` for the first and `done` for the second |
| E29 | openspec-local-artifact-evidence Promote-only reconciliation | EP | L1 | automated | `pi-spec-driven` change, CLI `design: ready`, `design-a.md` present | reconcile | evidence not evaluated (probe spy 0 calls); `design: ready` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| F1 | Workflow schema status is reported separately from readiness | state-convergence | L1 | automated | READY project, generated `outdated` | poll | `readiness.state === READY`; `workflowSchema.generated === outdated` |
| F2 | Workflow schema status… (missing) | state-convergence | L1 | automated | config names `pi-spec-driven`, schema dir absent, 2 changes pinned to it | poll (status call succeeds with 2 per-change errors) | readiness `READY`; `workflowSchema.missing === true`; other changes without `error` |
| F3 | Workflow schema status… (unpinned) | state-transition | L1 | automated | enabled project; merged change `bar` without `.openspec.yaml` | poll; then pin {pinTo: spec-driven} | `unpinnedChanges == ["bar"]`; after pin `bar/.openspec.yaml` = `schema: spec-driven` and list empty |
| F4 | Workflow schema status… (failure payload) | EP | L1 | automated | whole-call failure | poll | payload has no `workflowSchema` key |
| F5 | settings-panel OpenSpec Workflow Schema section (default switch) | state-transition | L1 | automated | Settings OpenSpec page | toggle Default for new projects; then Save | draft dirty, no request until Save; Save sends `PUT /api/config` with `openspec.workflowSchema.defaultForNewProjects` |
| F6 | settings-panel … (enable confirm) | state-transition | L1 | automated | cwd `/repo/a` in a worktree on branch `wt-1`, generated `none` | click Enable; cancel; click Enable; confirm | dialog lists the paths and `wt-1`; cancel → no POST; confirm → one POST `{action:"enable"}`; Save Bar never appears |
| F7 | settings-panel … (availability) | decision table | L1 | automated | each generated status × configured value; project schemas `team-flow`, user-only schema `mine` | render | buttons exactly per the allowed-state table; previous-default selector lists `spec-driven` and `team-flow`, not `mine` |
| F8 | Workflow schema status… (folder chip) | EP | L1 | automated | folder with `workflowSchema.generated === conflict`; another with all clear | render | chip present only on the first; it is a link to `/settings/openspec#workflow-schema` with the cwd; no POST on click |
| F9 | Session controls unaffected | EP | L1 | automated | attached session, READY readiness, generated `outdated` | render session card | OpenSpec controls identical to the same fixture without `workflowSchema` |
| F10 | settings-panel … end to end | state-convergence | L3 | automated | docker-harness project initialized with default `spec-driven`, 2 changes (1 file-less) | Settings → OpenSpec → Enable → confirm | on disk: `config.yaml` names `pi-spec-driven`, the file-less change has `schema: spec-driven`; the section shows `current` |

### Error-handling

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E5 | Workflow schema is generated… (swap step 3) | fault-injection (abort) | L1 | automated | existing generated schema; rename staging→`pi-spec-driven` throws `EIO` | update | previous dir byte-identical; no `.fork-staging-*` / `*.fork-backup-*` left |
| E6 | Workflow schema is generated… (restore fails) | fault-injection (abort) | L1 | automated | step 3 throws and the restore rename also throws 6× | update | `pi-spec-driven.fork-backup-*` remains and is named in the error |
| E7 | Workflow schema is generated… (backup delete fails) | fault-injection (abort) | L1 | automated | backup `rm` throws after a successful swap | update | new schema stays in place; response carries a warning; no rollback |
| E8 | Workflow schema is generated… (Windows retry) | BVA | L1 | automated | rename throws `EPERM` 5× then succeeds / 6× (fake timers, 2 s window) | update | 5 failures → swap succeeds; 6 failures → rollback, previous dir byte-identical |
| X1 | REST endpoint… (gates) | decision table | L1 | automated | rows: untracked cwd; OpenSpec disabled; opted-out cwd; tracked cwd without `openspec/` | POST enable | error each; for the untracked row an fs spy records zero calls |
| X2 | REST endpoint… (lock) | fault-injection (race) | L1 | automated | two concurrent enables; a second request via a symlinked spelling of the same cwd; REST init with default on chaining into enable | POST | one 200 + one 409; the symlinked spelling also 409; chained enable does not 409 |
| X3 | REST endpoint… (registration) | EP | L1 | automated | route table | run the tier gate and the MCP manifest completeness test | `POST /api/openspec/workflow-schema` is `control` tier, has `networkGuard`, and is covered by the manifest test |
| X4 | Global default applies only to newly initialized projects | decision table | L1 | automated | rows: default on + dir without `openspec/`; default on + existing `openspec/`; default on + enable fails; default off | POST /api/openspec/init | enabled; not enabled; init succeeds and reports the enable error; not enabled |
| X5 | project-init applies the workflow schema only to new OpenSpec projects | EP | L1 | automated | project-init SKILL.md text | assert the skill text | the enable step appears in the pre-write preview, only for mode `offer`, only when the flag is true, is skipped on decline and on an unreachable dashboard with a Settings hint |
| X6 | Enable pins… (partial failure) | fault-injection (abort) | L1 | automated | pin write for the 2nd of 3 file-less changes throws | enable; then enable again | first: schema + 1st pin remain, config not switched, response reports partial; second: completes, config switched |
| X7 | REST endpoint… (logging) | EP | L1 | automated | successful update | POST update | one structured log line with cwd, action, written paths, stamp before and after |

---

## Coverage summary

- Requirements covered: all 10 `openspec-workflow-schema` requirements; `settings-panel` new section + Save Bar exception; `project-init-skill`; the `pi-spec-driven` bypass in `openspec-detection` (2), `openspec-local-artifact-evidence` (2) and `server-openspec-polling` (covered by E27).
- Scenarios by class: edge 25 · perf 0 · frontend 10 · error 11
- Scenarios by level: L1 45 · L3 1
- Scenarios by disposition: automated 46 · manual-only 0

## New infra needed

- none. Real-CLI rows reuse the temp-repo pattern of the parity tests; L3 reuses the docker harness.
