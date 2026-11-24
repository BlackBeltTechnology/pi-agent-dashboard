# Test Plan — add-plugin-spawn-worktree

Stage: design   Generated: 2026-11-24

Requirements: R1 create or reuse · R2 fail policy · R3 typed failures, no local fallback · R4 attach, prompt, init · R5 serialization · R6 trusted plugins only.

L1 = vitest in `packages/server/src/__tests__/`. `ensureWorktree` rows use a real temp git repo (exemplar `git-operations.test.ts`). Hook rows drive the extracted hook module (task 3.0) with stub registries and spawn functions (exemplar `plugin-spawn-choice.test.ts`).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 create | state (no branch) | L1 | automated | temp repo on `develop`, no `os/add-x` anywhere | `ensureWorktree({branch:"os/add-x", ifExists:"reuse"})` | `ok`, `created:true`, path `<repo>/.worktrees/os-add-x`, `git -C path rev-parse --abbrev-ref HEAD` = `os/add-x`, HEAD = `develop`'s commit, `.git/info/exclude` contains `.worktrees/` |
| E2 | R1 reuse | state (registered worktree) | L1 | automated | E1 result present | second `ensureWorktree` same args | `ok`, `created:false`, same path; `git worktree list` count unchanged |
| E3 | R1 local branch | state (branch, no worktree) | L1 | automated | local `os/add-x` one commit ahead of `develop`, no worktree | `ensureWorktree` | `created:true`, worktree HEAD = that branch's commit (not `develop`) |
| E4 | R1 origin only | state (remote-only branch) | L1 | automated | bare remote `origin` has `os/add-x`; local clone has only `refs/remotes/origin/os/add-x` | `ensureWorktree` | worktree on local `os/add-x` at `origin/os/add-x`'s commit |
| E5 | R1 stale registration | state (`exists:false`) | L1 | automated | worktree for `os/add-x` registered, its dir deleted | `ensureWorktree` reuse | `git worktree prune` ran; new worktree created; `created:true` |
| E6 | R1 base ignored on reuse | decision table (base × existing) | L1 | automated | E2 state, `base:"no-such-ref"` | `ensureWorktree` reuse | `ok`, `created:false` (no `base_not_found`) |
| E7 | R2 fail policy | decision table (ifExists × exists) | L1 | automated | E1 result present | `ensureWorktree({ifExists:"fail"})` | `{ok:false, code:"exists"}`, worktree count unchanged |
| E8 | R6 untrusted | decision table (priority) | L1 | automated | plugin manifest `priority: 500`, valid block | hook `spawnSession` | `success:false`; `ensureWorktree` stub not called; spawn stub not called |
| E9 | R3 legacy mode | decision table (mode × block) | L1 | automated | `mode:"worktree"`, no `worktree` key | hook `spawnSession` | spawn stub called with `opts.cwd`; `ensureWorktree` stub not called |
| E10 | R4 cwd rekey | state (intents) | L1 | automated | valid block, `initialPrompt:"/skill:ship-it"`, `attachChange:"add-x"` | hook `spawnSession` succeeds | prompt and attach registries hold entries keyed by the worktree path, none by `opts.cwd`; spawn stub, watchdog stub and PID registry stub all received the worktree path |
| E11 | R4 attach queue full | BVA (cap 8) | L1 | automated | attach registry stub whose `enqueue` returns `false` | hook `spawnSession` | `success:true`, `warning` contains `attach queue full` |
| E12 | R4 no base meta | invariant | L1 | automated | E10 input | hook `spawnSession` | `pendingWorktreeBaseRegistry.enqueue` not called |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R3 not git | fault (non-repo) | L1 | automated | admitted temp dir without `.git` | `ensureWorktree` | `{ok:false, code:"not_git"}`; no throw |
| X2 | R3 hostile branch | EP (invalid refs) | L1 | automated | branch ∈ {`../../etc`, `-x`, `a..b`, `@{-1}`, `a b`, `x\u0000`} | `ensureWorktree` | each `code:"branch_invalid"`; no new branch, dir or worktree; `git worktree prune` not run |
| X3 | R3 unknown base | fault (missing ref) | L1 | automated | new branch, `base:"no-such-ref"` | `ensureWorktree` | `code:"base_not_found"`; nothing created |
| X4 | R3 no default base | fault (`resolveDefaultBase` null) | L1 | automated | repo whose only branch is `trunk`, no `base` | `ensureWorktree` new branch | `code:"base_not_found"` |
| X5 | R3 main checkout | fault (branch in main) | L1 | automated | main checkout on `os/add-x` | `ensureWorktree` reuse | `code:"branch_in_use"`; no spawn path returned |
| X6 | R3 outside worktree dir | fault (foreign registration) | L1 | automated | `os/add-x` worktree registered at `<tmp>/elsewhere` | `ensureWorktree` reuse | `code:"branch_in_use"` |
| X7 | R3 malformed block | EP (block shape) | L1 | automated | `worktree` ∈ {`"os/x"`, `[]`, `{}`, `{branch:"x", ifExists:"maybe"}`, `{branch:"x", ifExists:"reuse", attachChange:"Bad Name"}`} | hook `spawnSession` | each `code:"invalid_block"`; spawn stub not called; no registry entry |
| X8 | R3 admission | fault (unknown folder) | L1 | automated | `cwd` a git repo not in the known-folder set | `ensureWorktree` | `code:"not_git"`, no worktree |
| X9 | R3 admission undecidable | fault (admission stub indeterminate) | L1 | automated | admission dep returns indeterminate | `ensureWorktree` | `code:"admission_unavailable"` |
| X10 | R3 policy | fault (floor mismatch) | L1 | automated | `checkTarget` returns mismatch | `ensureWorktree` new branch | `code:"policy_mismatch"`; no branch or dir created |
| X11 | R3 git throws | fault (exception) | L1 | automated | `listWorktrees` dep throws | `ensureWorktree` | `code:"git_failed"`; promise resolves (no rejection) |
| X12 | R3 no residue on failure | invariant | L1 | automated | `ensureWorktree` stub returns `branch_invalid`, `initialPrompt` set | hook `spawnSession` | plugin-ref, prompt and attach registries all empty |
| X13 | R4 init trusted | state (needsInit, trusted) | L1 | automated | `startWorktreeInit` stub resolves `{ran:true, ok:true}` after 50 ms, auto-init on | hook `spawnSession` | stub called with `{skipIfRunning:true}` and no `confirmHash`; spawn stub called after it resolved |
| X14 | R4 init failed | fault (init exit 1) | L1 | automated | `startWorktreeInit` stub resolves failed | hook `spawnSession` | `code:"init_failed"`; spawn stub not called; no registry entry |
| X15 | R4 init untrusted | state (untrusted) | L1 | automated | stub returns `init_untrusted` | hook `spawnSession` | spawn stub called; result `success:true` |
| X16 | R4 auto-init off | decision table | L1 | automated | preference off | hook `spawnSession` | `startWorktreeInit` stub not called |
| X17 | R4 route unchanged | regression | L1 | automated | live run in registry for cwd | `POST /api/git/worktree/init` (exemplar `routes-git-worktree-init.test.ts`) | run restarts as today (no `already_running`); existing route tests green |

### Concurrency

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| C1 | R5 two plugin spawns | race | L1 | automated | temp repo, no `os/add-x` | `Promise.all` of two `ensureWorktree` reuse calls | one `created:true`, one `created:false`, same path; one worktree |
| C2 | R5 route + plugin | race | L1 | automated | temp repo | `POST /api/git/worktree` (newBranch `os/add-x`) concurrent with `ensureWorktree` reuse (exemplar `git-worktree-routes.test.ts`) | route 200; `ensureWorktree` `created:false` on the route's path |

### Manual

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | R1, R4 | live run | — | manual-only | running dashboard, a first-party test plugin action calling `spawnSession` with a `worktree` block and `/skill:ship-it`-like prompt | trigger the action | session appears under the worktree folder on the board, attached to the change, init ran before the first prompt |

---

## Coverage summary

- Requirements covered: 6/6
- Scenarios by class: edge 12 · error 17 · concurrency 2 · manual 1
- Scenarios by level: L1 31 · manual 1
- Scenarios by disposition: automated 31 · manual-only 1

## New infra needed

- None. The hook's worktree branch is extracted from `server.ts` into a module (task 3.0) so L1 can drive it with stubs.
