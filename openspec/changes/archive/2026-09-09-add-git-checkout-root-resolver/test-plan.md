# Test Plan — add-git-checkout-root-resolver

Stage: design   Generated: 2025-09-07

Two spec gaps were raised at the HARD gate and answered before this catalog was written
(resolver returns `core.worktree` verbatim, consumers validate; persisted records drop on any
stat failure). No unresolved clarifications remain.

Fixture note: every L1 row that builds real repos must set `GIT_CONFIG_GLOBAL=/dev/null` and
`GIT_CONFIG_SYSTEM=/dev/null` so a developer's own global config cannot leak into a
`core.worktree` assertion, and must pass `-c protocol.file.allow=always` for local-path
`submodule add`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | resolution: three facts | decision-table | L1 | automated | normal checkout root | resolve roots | `thisCheckout` = checkout, `isLinkedWorktree` = false, `mainCheckout` = same path |
| E2 | linked-worktree detection | decision-table | L1 | automated | `git worktree add` from a normal checkout | resolve roots | `isLinkedWorktree` = true, `mainCheckout` = main checkout, `thisCheckout` = worktree root |
| E3 | linked-worktree detection | decision-table | L1 | automated | submodule checkout (`--git-dir` == `--git-common-dir` == `<super>/.git/modules/models/sub`) | resolve roots | `isLinkedWorktree` = false, `mainCheckout` = `<super>/models/sub`, no `.git` segment in either root |
| E4 | main-checkout resolution 2a | decision-table | L1 | automated | worktree created from the submodule at `<super>/models/sub` | resolve roots | `isLinkedWorktree` = true, `mainCheckout` = `<super>/models/sub` (not `<super>/.git/modules/models`) |
| E5 | main-checkout resolution 2c | decision-table | L1 | automated | worktree created from a `clone --bare` hub | resolve roots | `isLinkedWorktree` = true, `thisCheckout` = worktree root, `mainCheckout` = `null` |
| E6 | resolution: bare | decision-table | L1 | automated | bare repository directory as cwd | resolve roots | result is present (not "no result"), `thisCheckout` = `null`, `mainCheckout` = `null` |
| E7 | linked-worktree detection | decision-table | L1 | automated | checkout created with `git init --separate-git-dir=<elsewhere>.git` | resolve roots | `isLinkedWorktree` = false, both roots = that checkout, neither is the directory holding the git dir |
| E8 | resolution: subdirectory | EP | L1 | automated | cwd 3 levels below a checkout root | resolve roots | `thisCheckout` = checkout root (not the cwd); same `mainCheckout` as from the root |
| E9 | probe canonicalization | BVA | L1 | automated | `--git-dir` thunk yielding the relative `.git`, `--git-common-dir` thunk yielding an absolute path, same repo | resolve roots | `isLinkedWorktree` = false — the two forms are canonicalized before comparison, so a normal checkout is NOT reported as a linked worktree |
| E10 | probe canonicalization | BVA | L1 | automated | `--git-common-dir` output carrying a trailing separator | resolve roots | classification identical to the no-trailing-separator case |
| E11 | exact-segment `.git` test | BVA | L1 | automated | ordinary checkout located at `/work/app.git` | resolve roots, then apply the `.git`-segment test | path is NOT treated as containing a `.git` segment; the record/report is retained |
| E12 | `core.worktree` locality | decision-table | L1 | automated | global (user) config sets `core.worktree`; repo-local config does not; ordinary linked worktree | resolve `mainCheckout` | global value is NOT used; resolution falls to rule 2b (`dirname` of the `.git`-named common dir) |
| E13 | verbatim return (G1) | decision-table | L1 | automated | linked worktree whose repo-local `core.worktree` points inside a git dir | resolve `mainCheckout` | the configured path is returned verbatim — not `null`, not `thisCheckout`, not a rule-2b value |
| E14 | persisted repair predicate | decision-table | L1 | automated | persisted `mainPath` = `<super>/.git/modules/models` | load session | record dropped; session groups by its own cwd; `.meta.json` not rewritten |
| E15 | persisted repair predicate | decision-table | L1 | automated | persisted `mainPath` = an existing directory with no `.git` segment and no `.git` entry (e.g. a temp dir standing in for `/tmp`) | load session | record dropped — existence alone does not qualify a path as plausible |
| E16 | persisted repair predicate | decision-table | L1 | automated | persisted `mainPath` = existing directory, no `.git` segment, containing a `.git` entry | load session | record preserved unchanged |
| E17 | persisted repair limitation | decision-table | L1 | automated | bare hub at `<home>/bare.git` with phantom `mainPath` = `<home>`, where `<home>` is itself a checkout | load session | record SURVIVES the filter — pins the documented shape-vs-identity limitation so it cannot silently change |
| E18 | consumer validation (bridge) | decision-table | L1 | automated | resolver returns `mainCheckout` containing a `.git` segment | `gatherGitInfo` / worktree detection runs | no worktree identity emitted; no `mainPath` with a `.git` segment on the wire |
| E19 | consumer validation (kb) | decision-table | L1 | automated | resolver returns `mainCheckout` inside a git dir that sits under a known folder; worktree cwd itself not known | guard evaluates admission | rejected `403`; not admitted via that path being under a known folder |
| E20 | kb admission breadth preserved | decision-table | L1 | automated | only `/repo` known; request `cwd = /repo/src` | guard evaluates admission | admitted — `mainCheckout` resolves to `/repo`; store opened |
| E21 | kb submodule non-inheritance | decision-table | L1 | automated | `/super` known; submodule `/super/models/sub` not known | guard evaluates admission | rejected `403`; adding `/super/models/sub` as a known folder then admits it |
| E22 | kb worktree-of-bare | decision-table | L1 | automated | worktree of a bare hub, not a known folder, `mainCheckout` = `null` | guard evaluates admission | rejected `403`; no store opened |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | persisted repair on load | invariant-count | L1 | automated | session store containing 200 persisted sessions with `gitWorktree` records | zero git subprocesses spawned by the repair filter; at most one filesystem stat per record | single load pass |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | submodule folder grouping | state-convergence | L3 | automated | a session whose cwd is a submodule checkout carrying its own `.pi/` | dashboard loads and the session registers | sidebar converges to a folder card headed at the submodule's own checkout path; no card headed at a `…/.git/modules/…` path exists |
| F2 | worktree-of-submodule grouping | state-convergence | L3 | automated | a session whose cwd is a worktree created from a submodule | dashboard loads and the session registers | session converges under the submodule's checkout as its parent group, not under a `.git/modules` path |
| F3 | phantom repair after restart | state-transition | L3 | automated | persisted session metadata carrying a `…/.git/modules/…` phantom `mainPath`, written before the fix | server restarts and the dashboard reloads | no phantom folder group is rendered; the affected session appears grouped by its own cwd |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | required probes | fault-injection (abort) | L1 | automated | `--git-dir` probe fails (non-repo cwd) | resolve roots | "no result" returned; no path derived from the partial probe |
| X2 | required probes | fault-injection (abort) | L1 | automated | `--show-toplevel` fails while `--git-dir`/`--git-common-dir` succeed (bare repo) | resolve roots | a result IS returned with `thisCheckout` = `null` — bare stays distinguishable from non-repo, so a consumer does not fall through to a non-git path |
| X3 | required probes | fault-injection (delay) | L1 | automated | a probe exceeds its timeout | resolve roots | "no result"; caller degrades rather than throwing |
| X4 | `core.worktree` probe safety | fault-injection | L1 | automated | repository path containing a space, and one containing a shell metacharacter | resolve `mainCheckout` for a linked worktree | probe issued in argv form: the value is read correctly for the spaced path, and no shell command is executed for the metacharacter path |
| X5 | persisted repair (G2) | fault-injection (abort) | L1 | automated | stat on the persisted `mainPath` fails with an error other than not-found (unreachable/unmounted volume) | load session | record dropped; the load does not throw for that session |
| X6 | worktree detection failure | fault-injection (abort) | L1 | automated | a `rev-parse` invocation fails during `gatherGitInfo` | poll tick runs | `gitWorktree` = undefined; branch / remote / PR detection still proceeds |

---

## Coverage summary

- Requirements covered: 8/8 (4 resolver requirements + `git-context`, `bridge-session-state-poll`, `kb-plugin-cwd-guard`, and the persisted-repair requirement)
- Scenarios by class: edge 22 · perf 1 · frontend 3 · error 6
- Scenarios by level: L1 29 · L2 0 · L3 3
- Scenarios by disposition: automated 32 · manual-only 0

No L2 rows: this change adds no install, spawn, or multi-OS runtime behaviour — it is pure
resolution logic plus three consumers. Routing a git-state matrix through VM smoke would be a
downgrade of L1 coverage, not an addition.

## New infra needed

- **A shared git-fixture builder** for the nine repo states (normal, linked worktree,
  submodule, worktree-of-submodule, bare, worktree-of-bare, separate-git-dir, plus
  subdirectories). Needed by ~20 L1 rows and by F1–F3 for seeding. No equivalent helper exists;
  the closest precedent is the ad-hoc temp-repo setup inside
  `packages/server/src/lib/__tests__/path-containment.test.ts`, which builds only the non-repo
  and bare cases inline.
- **E17 and F3 require seeding a pre-fix phantom record**, i.e. writing session metadata that
  the current code would never produce. F1–F3 additionally need the docker harness to host a
  submodule checkout and a worktree-of-submodule as session cwds.
