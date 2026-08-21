# Test Plan — add-openspec-init-affordances

> **Apply blocker (`fix-reliable-live-control-events`):** Scenario E14 assumes main-checkout skill inheritance that `resolveConfigRoot(cwd)` no longer provides. Reconcile expected behavior before implementation.

Stage: design   Generated: 2026-08-12

All five HARD-gate clarifications were resolved before this file was written (legacy-artifact
definition → coarse `openspec/` presence; concurrent init → `409`; session-card control →
scroll+expand+focus; CLI support → `init --help` probe; spawn timeout → 60s). No unfilled slots
remain.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Readiness precedence | decision-table | L1 | automated | `enabled:false`, cwd `initialized:true` | derive readiness | state `GLOBAL_OFF` |
| E2 | Readiness precedence | decision-table | L1 | automated | cwd in `optOutDirectories`, `initialized:true` | derive readiness | state `OPTED_OUT` |
| E3 | Readiness precedence | decision-table | L1 | automated | cwd in `optOutDirectories`, no `openspec/` | derive readiness | state `OPTED_OUT`, not `ABSENT` |
| E4 | Readiness precedence | decision-table | L1 | automated | cwd in `optOutDirectories`, `initialized:false`, `hasOpenspecDir:true` | derive readiness | state `OPTED_OUT`; no repair action offered |
| E5 | Readiness precedence | decision-table | L1 | automated | `pending:true` | derive readiness | state `PENDING` |
| E6 | Readiness precedence | decision-table | L1 | automated | `hasOpenspecDir:false`, not opted out, enabled | derive readiness | state `ABSENT` |
| E7 | Readiness precedence | decision-table | L1 | automated | `hasOpenspecDir:true`, `initialized:false`, `pending:false` | derive readiness | state `BROKEN` |
| E8 | Reason discrimination | decision-table | L1 | automated | `openspec/` present, `openspec/changes/` absent | derive readiness | reason `missing-changes-dir` |
| E9 | Reason discrimination | decision-table | L1 | automated | `openspec/changes/` present, `openspec list` returns non-array | derive readiness | reason `cli-failed` |
| E10 | Reason precedence | decision-table | L1 | automated | `initialized:true`, skills absent, recorded sig ≠ current | derive readiness | `STALE` reason `missing-skills` (not `profile-stale`) |
| E11 | Never-measured not stale | EP | L1 | automated | `initialized:true`, skills present, **no** recorded signature | derive readiness | state `READY` |
| E12 | Signature staleness | EP | L1 | automated | recorded signature ≠ current signature | derive readiness | `STALE` reason `profile-stale` |
| E13 | Zero-proposal project | EP | L1 | automated | `openspec list` → `{"changes":[]}`, skills present, sig matches | derive readiness | state `READY` |
| E14 | Skills stat at config root | EP | L1 | automated | worktree cwd without own `.pi/skills/openspec-explore/`, main checkout has it | compute `hasOpenSpecSkills` | `true` |
| E15 | Skills stat fallback | EP | L1 | automated | non-git dir, config root unresolvable | compute `hasOpenSpecSkills` | stat falls back to cwd, no throw |
| E16 | Non-worktree missing skills | EP | L1 | automated | non-worktree, `initialized:true`, no `.pi/skills/openspec-explore/` | derive readiness | `STALE` reason `missing-skills` |
| E17 | Path normalization | EP | L1 | automated | `/project/foo/` written to `optOutDirectories` | evaluate `/project/foo` | treated as opted out |
| E18 | Config defaults | BVA | L1 | automated | config file with neither new key | parse config | `optOutDirectories: []`, `offerInitialization: true` |
| E19 | Fleet switch scope | decision-table | L1 | automated | `offerInitialization:false`, cwd `BROKEN` | derive render decision | folder section still renders with Repair |
| E20 | Init validation set | EP | L1 | automated | pinned dir with **no** `openspec/` | POST init | accepted (not filtered out like `knownCwds()` would) |
| E21 | Init validation set | EP | L1 | automated | directory that is neither session cwd nor pinned | POST init | rejected, no spawn |
| E22 | Argv construction | EP | L1 | automated | any valid target | POST init | argv array is exactly `[init, <cwd>, --tools, pi, --force]`; no `--profile`, no `--no-animation`, no `--no-copilot-cloud` |
| E23 | Config write isolation | EP | L1 | automated | config with unrelated keys | write `optOutDirectories` | every other key preserved |
| E24 | Re-broadcast diffing | decision-table | L1 | automated | reconfigure changing only `pollIntervalSeconds` | reconfigurePolling | no readiness re-broadcast |
| E25 | Re-broadcast diffing | decision-table | L1 | automated | reconfigure adding one cwd to `optOutDirectories` | reconfigurePolling | only that cwd re-broadcast |
| E26 | Cleared payload carries state | EP | L1 | automated | `enabled` flips true→false | reconfigurePolling | every cleared payload carries `readiness.state === GLOBAL_OFF` |
| E27 | Signature recorded on init | EP | L1 | automated | successful init | inspect store | recorded signature === current; status `up-to-date` |
| E28 | No signature on failure | EP | L1 | automated | init exits non-zero | inspect store | no signature recorded |
| E29 | Menu item gating | decision-table | L1 | automated | cwd `OPTED_OUT` | build folder menu | contains "Enable OpenSpec for this folder" |
| E30 | Menu item gating | decision-table | L1 | automated | cwd `ABSENT`/`READY`/`BROKEN`/`STALE` | build folder menu | item absent |
| E31 | Menu item gating | decision-table | L1 | automated | cwd `OPTED_OUT` but `enabled:false` | build folder menu | item absent |
| E32 | Re-enable clears entry | EP | L1 | automated | opted-out cwd | activate re-enable | cwd removed from `optOutDirectories` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Signature computed once per tick | spawn-count | L1 | automated | 20 cwds polled in one tick | `openspec config list` spawn count == 1 | one tick |
| P2 | Signature cache invalidation | spawn-count | L1 | automated | profile save, then next tick | spawn count == 1 on the tick after save (not served stale) | two ticks |
| P3 | Readiness adds no client fetch | request-count | L3 | automated | session list with 10 folders + 40 session cards | `GET /api/openspec/update-status` request count == 0 from card rendering | page load + 30s idle |
| P4 | Skills stat cost | timed | L1 | automated | 50 cwds | added wall time of the stat pass vs baseline < 50ms total | single pass |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Folder section ABSENT variant | state-transition | L3 | automated | folder with readiness `ABSENT`, `offerInitialization:true` | render session list | one-line pill with Initialize + dismiss; no change count; no board link |
| F2 | Fleet switch hides offer | state-transition | L3 | automated | same, `offerInitialization:false` | render | no OpenSpec section for that folder |
| F3 | Pill height parity | visual-invariant | L3 | automated | folders in `ABSENT`, `BROKEN`, `STALE`, `READY` | render | computed height of each section equals the `READY` section's height |
| F4 | Session card hides on ABSENT | state-transition | L3 | automated | session whose cwd is `ABSENT` | render card | no element titled `OPENSPEC` |
| F5 | Session card disabled on BROKEN | state-transition | L3 | automated | session whose cwd is `BROKEN` | render card | `OPENSPEC` panel present; no Explore/Propose/Attach/Archive controls in DOM |
| F6 | Disabled subcard is inert | state-transition | L3 | automated | disabled subcard | tab through the panel | exactly one focusable element |
| F7 | Reason routing — folder | state-transition | L3 | automated | disabled subcard, reason `missing-changes-dir`, folder group collapsed | activate control | folder expands, header scrolled into view, focus on OpenSpec section, no dialog opened |
| F8 | Reason routing — settings | state-transition | L3 | automated | disabled subcard, reason `profile-stale` | activate control | navigates to the settings surface holding the OpenSpec profile section |
| F9 | Reason text distinctness | state-transition | L3 | automated | cards in `BROKEN`, `STALE/missing-skills`, `STALE/profile-stale` | render | three distinct reason strings |
| F10 | Control-less panel not collapsed | state-transition | L3 | automated | disabled subcard with only reason + one control | render | `OPENSPEC` title still renders (empty-subcard rule does not fire) |
| F11 | Legacy-server degrade | state-transition | L3 | automated | payload with no `readiness` field | render card | renders per the old `hasOpenspecDir \|\| pending` gate; never disabled |
| F12 | Init → READY convergence | state-convergence | L3 | automated | folder in `ABSENT` | click Initialize, await broadcast | section converges to `OpenSpec (N) →`; session card OPENSPEC becomes live — **no intermediate disabled/STALE state** |
| F13 | Dismiss removes the offer | state-transition | L3 | automated | folder in `ABSENT` | click dismiss | section stops rendering; cwd persisted in `optOutDirectories` |
| F14 | Re-enable restores | state-transition | L3 | automated | opted-out folder | menu → Enable OpenSpec for this folder | section renders again |
| F15 | cli-failed offers no repair | decision-table | L3 | automated | folder `BROKEN` reason `cli-failed` | render | no Repair/Initialize control; error text shown |
| F16 | Repair confirm | state-transition | L3 | automated | folder `BROKEN` reason `missing-changes-dir` | click Repair, dismiss the confirm | no request sent |
| F17 | Overwrite confirm | state-transition | L3 | automated | folder whose cwd already has `openspec/` | click Initialize | confirm naming the directory shown before any request |
| F18 | Nag-wall density | visual/subjective | — | manual-only | session list with ~20 OpenSpec-less folders | human looks at the sidebar | [judgment: offer reads as one calm line per folder, not a wall] |
| F19 | Disabled-state visual weight | visual/subjective | — | manual-only | card with disabled OPENSPEC subcard | human looks | [judgment: reads as deliberately unavailable, not as a broken/loading panel] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Init CLI failure | fault-injection (abort) | L1 | automated | CLI exits non-zero | POST init | response reports failure and includes stderr; no signature recorded |
| X2 | Init hang | fault-injection (delay) | L1 | automated | CLI never exits | POST init, wait 60s | process killed, request fails with partial stderr |
| X3 | Lock released after timeout | fault-injection (delay) | L1 | automated | prior request timed out | POST init again for that cwd | accepted (not `409`) |
| X4 | Concurrent init | fault-injection (race) | L1 | automated | init in flight for cwd | second POST init same cwd | `409 Conflict`; exactly one spawn |
| X5 | Unsupported CLI | fault-injection (abort) | L1 | automated | resolved CLI's `init --help` lacks `--tools` | POST init | refused with diagnostic naming the binary; no spawn |
| X6 | Support probe cached | fault-injection | L1 | automated | two init requests | POST init twice | `init --help` probed once |
| X7 | Expanded profile | fault-injection | L1 | automated | global profile is the expanded alias | POST init | profile healed before spawn; no `--profile` in argv; spawn succeeds |
| X8 | Squatted-stub resolver | fault-injection (abort) | L2 | automated | a bare `openspec` 0.0.0 stub earlier on `PATH` | POST init | the resolved binary is the tool-registry one, not the stub; `.pi/skills/openspec-explore/` exists after success |
| X9 | Init failure leaves state | fault-injection (abort) | L3 | automated | init fails | click Initialize | stderr surfaced; section stays `ABSENT`, does not show success |
| X10 | Signature spawn failure | fault-injection (abort) | L1 | automated | `openspec config list` fails during a tick | poll tick | readiness still emitted; no cwd falsely `STALE` |
| X11 | Config root unresolvable | fault-injection | L1 | automated | `resolveConfigRoot` returns null | compute skills | falls back to cwd, no throw, readiness still emitted |
| X12 | End-to-end skills chain | fault-injection | L2 | automated | fresh dir, init via endpoint | inspect result | `.pi/skills/openspec-explore/SKILL.md` and `.pi/prompts/opsx-*.md` exist (proves `--tools pi` survived) |

---

## Coverage summary

- Requirements covered: 15/15
- Scenarios by class: edge 32 · perf 4 · frontend 19 · error 12
- Scenarios by level: L1 45 · L2 2 · L3 18 · manual-only 2
- Scenarios by disposition: automated 65 · manual-only 2

## New infra needed

- **none.** L1 extends existing vitest suites under `packages/*/src/**/__tests__/`; L2 extends
  `qa/tests/`; L3 extends `tests/e2e/` against the docker harness (port read from
  `.pi-test-harness.json` `dashboardPort`, never hardcoded).
