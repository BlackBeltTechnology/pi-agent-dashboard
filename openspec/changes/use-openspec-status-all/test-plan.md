# Test Plan — use-openspec-status-all

Stage: design   Generated: 2026-10-17

Hard gate passed: every Triple is filled from spec-defined values. Those values are:
- 500/64-char caps;
- 30 s timeout;
- the per-turn floor of "The poll path self-attributes its per-turn synchronous cost";
- spawn counts.

There are no clarification markers.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Status-all output is validated as an envelope | EP | L1 | automated | fake `status --all` stdout: 102 entries, one `{changeName:"bad",status:[{severity:"error",code:"change_error",message:"Invalid YAML"}]}`, exit 1 | gated poll builds data | `changes.length===102`, `initialized===true`, `bad.error.code==="change_error"`, `bad.artifacts` empty, others carry artifacts |
| E2 | Status-all output is validated as an envelope | EP | L1 | automated | stdout `{"changes":[],"root":null,"status":[{"severity":"error","code":"invalid_store_pointer","message":"x"}]}`, exit 1 | gated poll | broadcast `{initialized:false,pending:false,changes:[]}`, readiness `BROKEN/cli-failed`; next tick spawns `status --all` exactly once more |
| E3 | Status-all output is validated as an envelope | EP | L1 | automated | stdout `{"changes":[],"root":{"source":"implicit","path":"/x"}}`, exit 0 | gated poll | treated as whole-call failure: readiness `cli-failed`, not `READY` |
| E4 | Status-all output is validated as an envelope | EP | L1 | automated | stdout `Error: boom` (no `{`/`[`), exit 1 | gated poll | readiness `cli-failed`; data not `initialized:true` |
| E5 | Status-all output is validated as an envelope | BVA | L1 | automated | change error `message` of 499, 500, 501 and 4000 chars incl. `\n` and `\x1b[31m`; `code` of 64 and 100 chars | build | message ≤ 500 chars, no `\n`, no control chars; 499/500 unchanged; 501/4000 truncated to 500; code 64 unchanged, 100 → 64 |
| E6 | Status-all output is validated as an envelope | EP | L1 | automated | entry `{changeName:"odd"}` with neither `artifacts` nor `status` | build | `odd.error.code==="unknown-entry"`, `artifacts` empty |
| E7 | Local task counting follows OpenSpec's task-line rule | EP | L1 | automated | `tasks.md` with 34 top-level and 3 indented `- [ ]` lines (16 `x`/`X`), plus `* [x]`, a fenced checkbox, CRLF endings | count | `totalTasks` and `completedTasks` equal what OpenSpec's `countTasksFromContent` returns for the same text (37/16 for the base fixture) |
| E8 | Local task counting follows OpenSpec's task-line rule | decision table | L1 | automated | rows: (a) project schema `apply.tracks: plan.md` + artifact `plan`; (b) project schema without `apply.tracks`; (c) `apply.tracks: x.md` matching no artifact; (d) user-dir `spec-driven` shadow tracking `other.md`; (e) broken change with 9-checkbox `tasks.md` | count | (a) `plan.md` counted, `tasks.md` ignored; (b) artifact `tasks` counted; (c) top-level `tasks.md` counted; (d) `other.md` counted; (e) `totalTasks===9` |
| E9 | Poll paths use one `openspec status --all` spawn per directory | EP | L1 | automated | CLI artifacts in order `proposal, specs, dependencies, design, tasks` | gated poll and force refresh | both paths emit `proposal, design, specs, tasks, dependencies` |
| E10 | Poll paths use one `openspec status --all` spawn per directory (order) | EP | L1 | automated | cold cache; `changes/a` tracked mtime T-1d, `changes/b` T, `changes/c` T (tie) | first poll | `changes` order `b, c, a` (newest first, ties by name), not `--all`'s name order |
| E11 | Poll paths use one `openspec status --all` spawn per directory (short-circuit) | EP | L1 | automated | `<cwd>/openspec/` present, `changes/` absent | gated poll and force refresh | zero `openspec` spawns; readiness `BROKEN/missing-changes-dir` |
| E12 | Cwd-level change-detection gate for the status-all poll | decision table | L1 | automated | warm cache; one mutation per row: in-place `tasks.md`; first creation of `dependencies.yaml` (non-glob output); `.openspec.yaml` edit; `config.yaml` edit; `config.yaml` delete (not newest file); rename `schemas/foo`→`schemas/bar`; first `spec.md` in an empty nested dir under a glob prefix; `README.md` edit; no mutation | next gated tick | `status --all` spawn count 1 for every row except `README.md` and no-mutation (0) |
| E13 | Push refresh on local filesystem change to openspec/changes/ | decision table | L1 | automated | watcher events: `changes/new-x/` dir create; `changes/new-x/proposal.md` (unknown change); `changes/known/dependencies.yaml` (matches `resolvedOutputPath`); `changes/known/.openspec.yaml`; `openspec/config.yaml`; `openspec/schemas/s/schema.yaml`; `changes/known/README.md`; `openspec/specs/cap/spec.md` | event fires | debounced re-poll for the first six; none for the last two; `openspec/specs/` not watched |
| E14 | Cwd-level change-detection gate for the status-all poll (paths) | EP | L1 | automated | server cwd `/tmp/repo` (symlink) while the CLI emits `root.path` `/private/tmp/repo` and `existingOutputPaths` under it; one output path `../../etc/x` | build tracked set | outputs map onto the server's canonical `openspec/`; the escaping path is ignored; editing the mapped file trips the gate |
| E15 | Fallback when `openspec status --all` is unsupported | decision table | L1 | automated | rows: stderr `error: unknown option '--all'` + no JSON; same text on stdout; JSON present + that text; package `version` unchanged on next tick; version changed; no resolvable `package.json` | poll | unsupported / unsupported / NOT unsupported / no `--all` retry / `--all` retried / cached for process, re-tried on force refresh |
| E16 | Fallback when `openspec status --all` is unsupported (first detection) | state-transition | L1 | automated | old fake CLI rejecting `--all`, cold cache, 3 changes | cold-boot `refreshOpenSpec` (bootstrap path) | same poll continues on the fallback: data broadcast with 3 changes (not `cli-failed`); spawns = 1 `--all` + fallback force spawns; next gated tick spawns no `--all` |
| E17 | Poll paths use one `openspec status --all` spawn per directory | EP | L1 | automated | 102 changes, warm cache | force refresh; then force refresh whose `--all` is a whole-call failure | exactly 1 spawn each; the failing refresh spawns no second process and never calls `pollOpenSpecAsync` |
| E18 | Poll paths use one `openspec status --all` spawn per directory | EP | L1 | automated | 102 changes, one `tasks.md` edited | gated tick | exactly 1 `status --all`, 0 `list`, 0 `status --change` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Cwd-level change-detection gate (no-op tick) + Per-turn main-thread work does not block | threshold | L1 | automated | 107 unchanged change fixtures, `useWorker:true` | no instrumented turn (`dirPollPre/Gate/Cli/Post`) self-records above the configured floor | 3 consecutive ticks |
| P2 | Periodic poll derivation runs off the main event loop (in-process mode) | threshold | L1 | automated | same fixture, `useWorker:false` | no instrumented turn above the floor; stats issued as async (spy: zero `statSync` calls) | 3 consecutive ticks |
| P3 | Poll paths use one `openspec status --all` spawn per directory | measurement | — | manual-only | this repo (100+ changes) on macOS and the Windows 11 QA VM | record `status --all` wall time, gated no-op probe time, and force-refresh wall time before/after into design.md Context | one session per OS |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Card shows a per-change CLI error; Proposal cards | EP | L1 | automated | `OpenSpecData` with `add-auth.error={code:"change_error",message:"Invalid YAML in metadata file"}` and 2 healthy changes | render `OpenSpecBoardView` | `add-auth` card has an element with role/label containing the message; its stepper segments are all `todo`; the 2 other cards render unchanged; `New session` stays enabled |
| F2 | OpenSpec actions are blocked for a change with a CLI error | decision table | L1 | automated | `deriveOpenSpecActions` ctx: change with `error`, continue+ff enabled, not streaming | derive | primary `continue` blocked with literal reason = message; `ff` item blocked; `explore`/`detach` not blocked by the rule; no `archive` key present |
| F3 | OpenSpec actions are blocked for a change with a CLI error | decision table | L1 | automated | same ctx but `continue` workflow disabled | derive | primary is `ff`, blocked with the message; no `continue` action |
| F4 | OpenSpec actions are blocked for a change with a CLI error | EP | L1 | automated | `MobileActionMenu` with attached broken change | render | Continue and Fast-Forward rows natively `disabled`; Explore row unaffected by this rule |
| F5 | OpenSpec actions are blocked for a change with a CLI error | EP | L1 | automated | `ComposerSessionActions` with attached broken change | render | Continue primary has `aria-disabled="true"`, is focusable, `aria-describedby` text contains the message |
| F6 | OpenSpec actions are blocked for a change with a CLI error | decision table | L1 | automated | broken change AND session streaming | derive | reason shown is the error message (not "Session is streaming"); `detach` still enabled |
| F7 | OpenSpec actions are blocked for a change with a CLI error (Error clears) | state-transition | L1 | automated | broken change rendered in `SessionOpenSpecActions` | rerender with `error` removed | badge removed; actions return to normal `PLANNING` behaviour |
| F8 | Card shows a per-change CLI error + Push refresh | state-transition (convergence) | L3 | automated | docker harness project with 3 changes | overwrite `changes/c2/.openspec.yaml` with `schema: [unclosed` on disk; later restore it | board converges to an error badge on `c2` only (others unchanged); after restore the badge disappears with no manual refresh |
| F9 | Poll path emits transitional pending before the slow CLI spawn | state-transition | L1 | automated | cold cwd with `openspec/changes/` | first poll | broadcast order: `pending:true` before the probe request is dispatched to the worker, then the final payload |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Poll paths use one `openspec status --all` spawn per directory (timeout) | fault-injection (delay) | L1 | automated | fake CLI never exits | gated poll | call aborted at 30 s (fake timers); readiness `cli-failed`; next tick spawns once |
| X2 | TOCTOU-safe stamping around the status-all invocation | fault-injection (race) | L1 | automated | `changes/foo/tasks.md` written during the fake `--all` call | gated tick, then next tick | `foo` keeps its previous entry and stamp; other changes updated; next tick spawns `--all` again |
| X3 | TOCTOU-safe stamping around the status-all invocation | fault-injection (race) | L1 | automated | `changes/bar/` removed during the call | tick | `bar` absent from this and later broadcasts |
| X4 | TOCTOU-safe stamping around the status-all invocation | fault-injection (race) | L1 | automated | `changes/new/` created between probe and spawn, present in the result | tick, next tick | `new` broadcast this tick; next tick spawns `--all` exactly once more, then stabilizes (0 on the third tick) |
| X5 | TOCTOU-safe stamping around the status-all invocation | fault-injection (race) | L1 | automated | `openspec/config.yaml` edited during the call | tick, next tick | cwd stamp not advanced; next tick spawns `--all` |
| X6 | Periodic poll derivation runs off the main event loop | fault-injection (abort) | L1 | automated | poll worker crashes during the build request | tick | in-process build yields data equal to the worker result for the same inputs; broadcast emitted |
| X7 | Server skips OpenSpec polling when `openspec.enabled` is false | fault-injection (config) | L1 | automated | `openspec.enabled=false`, 5 known dirs | one interval + `openspec_refresh` | zero `openspec` processes (`status --all`, `list`, `status --change`) |
| X8 | Status-all and task-count parity is guarded by test | parity | L1 | automated | real CLI on this repo | run the parity test | per change: `--all` artifact set equals `status --change`; error-in-`--all` ⇔ per-change failure; local counts equal `openspec list`; CLI present + unparseable output fails (no skip) |
| X9 | Local derivation parity with CLI is guarded by test (fallback-scoped) | regression | L1 | automated | existing fallback parity suite | run it after the change | still green (fallback path unchanged) |

---

## Coverage summary

- Requirements covered:
  - all 7 ADDED server requirements, plus the board and frontend-actions requirements;
  - behaviour-changing MODIFIED requirements: Server polls, Push refresh, pending, off-main-loop, disabled, self-attribution + per-turn budget, specs evidence, detection "probe-injectable";
  - wording-only MODIFIED requirements (readiness ×3, fallback-scoped legacy ×4, detection design-evidence): covered by existing suites and kept green by X9.
- Scenarios by class: edge 18 · perf 3 · frontend 9 · error 9
- Scenarios by level: L1 37 · L3 1 · — 1
- Scenarios by disposition: automated 38 · manual-only 1

## New infra needed

- none. A fake `openspec` runner/recipe stub already exists in the directory-service tests. L3 reuses the docker harness with out-of-band filesystem mutation, as in `tests/e2e/archived-attachment.spec.ts`.
