# Test Plan — fix-spawned-session-pwd

Stage: design   Generated: 2026-11-03

Hard gate: no unfillable Triple slots; no clarifications outstanding.

Conventions for every row below:
- `canon(p)` = `fs.realpathSync(p)` of a real temp dir created by the test (`fs.mkdtempSync(os.tmpdir())`), so macOS `/var` → `/private/var` aliasing is exercised for free.
- "stale PWD" = `PWD=/launch/dir` placed in the base env (or stubbed on `process.env` via `vi.stubEnv`).
- "fails at HEAD" = the row's observable is false on the current checkout (no `cwd` option, no deny entry, no `runAgent` PWD); rows marked *guard* already hold at HEAD and pin existing behaviour the change must not break.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | headless-spawn "sanctioned REWRITE is `PWD`" | EP (nominal) | L1 | automated | base env `{PATH, HOME, PWD:"/launch/dir"}`, temp dir `T` | `buildSpawnEnv(base, { cwd: T })` | returned `PWD === canon(T)`; `base.PWD` still `"/launch/dir"` (input not mutated). Fails at HEAD. |
| E2 | design D1 "absent `cwd` ⇒ env byte-identical" | EP (absent option) | L1 | automated | (a) base with `PWD:"/launch/dir"`; (b) base with no `PWD` | `buildSpawnEnv(base, { spawnToken:"t" })` (no `cwd`) | (a) `PWD === "/launch/dir"`; (b) `"PWD" in env === false`; no other key differs from the same call at HEAD semantics. *guard* |
| E3 | headless-spawn rewrite, base lacks `PWD` (launchd / Windows w/o Git Bash) | EP (absent inherited value) | L1 | automated | base env with no `PWD`, temp dir `T` | `buildSpawnEnv(base, { cwd: T })` | `PWD === canon(T)`. Fails at HEAD. |
| E4 | headless-spawn "Aliased spawn cwd yields the canonical PWD" | EP (symlink alias) | L1 | automated | real dir `T/real`, symlink `T/link → T/real` (test `skipIf(win32)`) | `buildSpawnEnv(base, { cwd: "T/link" })` | `PWD === canon("T/real")` (no `link` segment). Fails at HEAD. |
| E5 | headless-spawn "Relative spawn cwd yields an absolute PWD" + alias spellings | EP (non-canonical spellings) | L1 | automated | `it.each`: `T + "/"`, `T + "/./sub/.."`, `path.relative(process.cwd(), T)` | `buildSpawnEnv(base, { cwd: <spelling> })` | every case yields `PWD === canon(T)`; result is absolute, no trailing separator. Fails at HEAD. |
| E6 | headless-spawn canonical path, unusual characters | EP (special chars) | L1 | automated | temp dir `T/"a b"/"é-ü"` (space + non-ASCII) | `buildSpawnEnv(base, { cwd })` | `PWD === canon(cwd)` byte-exact (no quoting/escaping added). Fails at HEAD. |
| E7 | headless-spawn "Other inherited variables unaffected by PWD rewrite"; design D2 | EP + decision table (operator-set context-mode names) | L1 | automated | base `{PATH, HOME, CONTEXT_MODE_TZ:"UTC", FOO:"1", PWD:"/launch/dir"}`; variant base adds `PI_PROJECT_DIR:"/op"` | `buildSpawnEnv(base, { cwd: T })` vs `buildSpawnEnv(base, {})` | every key except `PWD` deep-equal between the two calls; `PI_WORKSPACE_DIR`, `CONTEXT_MODE_PROJECT_DIR` absent; `PI_PROJECT_DIR` absent in base-1 and `"/op"` (passed through, never host-set) in variant. Fails at HEAD on the `PWD` part only. |
| E8 | plugin-spawn-env-contributor reject list gains `PWD` | decision table (contribute × base-has-PWD × mechanism=headless) | L1 | automated | trusted contributor returns `{ PWD:"/elsewhere", CTX_X:"1" }`; base with stale `PWD` | `buildSpawnEnv(base, { cwd: T, mechanism:"headless" })` | `PWD === canon(T)`, `CTX_X === "1"`, warn logged matching `rejected env name "PWD"`. Fails at HEAD (no warn). |
| E9 | plugin-spawn-env-contributor + headless-spawn "A plugin cannot remove or replace PWD" | decision table (contribute × base-lacks-PWD × mechanism=tmux) | L1 | automated | same contributor; base with NO `PWD`; `contributedOut = {}` | `buildSpawnEnv(base, { cwd: T, mechanism:"tmux", contributedOut })` | `PWD === canon(T)`; `contributedOut` has `CTX_X` and has no `PWD` key. Fails at HEAD (`contributedOut.PWD === "/elsewhere"`). |
| E10 | plugin-spawn-env-contributor "supersede marker SHALL NOT remove `PWD`" | decision table (supersede lists PWD) | L1 | automated | base `{ PWD:"/launch/dir", MARK:"PWD,CTX_Y", CTX_Y:"old" }`; contributor with `supersede:{ marker:"MARK", names:["PWD","CTX_Y"] }` | `buildSpawnEnv(base, { mechanism:"headless" })` (no `cwd`) | `CTX_Y` removed, `MARK` removed, `PWD === "/launch/dir"` (not deleted). Fails at HEAD (`PWD` deleted). |
| E11 | headless-spawn "for tmux / wsl-tmux the tmux argv SHALL carry no `-e PWD=` entry" | decision table (tmux argv) | L1 | automated | contributor returns `{ PWD:"/elsewhere", CTX_X:"1" }`; `execFileSync` mocked | `spawnPiSession(T, { strategy:"tmux" })` | captured tmux argv contains `-e CTX_X=1` and no argv element starting `PWD=`. Fails at HEAD. |
| E12 | headless-spawn "PWD set for every strategy" (env handed to mechanism) | EP over mechanism set | L1 | automated | `it.each` over `tmux`, `wsl-tmux`, `wt`, `headless`, ACP `childCmd` (platform/resolver mocked as in existing tests); stale `PWD` stubbed on `process.env` | `spawnPiSession(T, { strategy, … })` | the env captured at the sink (`execFileSync` env for tmux/wsl-tmux, `spawnDetached` env for wt, keeper-manager `spawnKeeperFor` env for headless + childCmd) has `PWD === canon(T)`. Fails at HEAD for all five. |
| E13 | headless-spawn "a keeper respawn of pi SHALL keep that value" | state-transition (first launch → respawn) | L1 | automated | keeper env `{ PWD:"/work/p", PI_DASHBOARD_SPAWN_TOKEN:"t", PI_DASHBOARD_SPAWNED:"1" }` | `buildPiEnv(env, true)` then `buildPiEnv(env, false)` | both results have `PWD === "/work/p"`; token present only on the first. *guard* |
| E14 | headless-spawn "Spawned pi PWD names the spawn cwd" (real process chain) | state convergence across process boundary | L1 | automated | `env = buildSpawnEnv({ ...process.env, PWD:"/elsewhere" }, { cwd: T })`; real `keeper.cjs` launched with that env and cwd `T`; mock-pi via `PI_KEEPER_PI_CMD` in a new env-dump mode writing `{ PWD, cwd: process.cwd() }` to a file | keeper starts, mock-pi writes the dump | dump `PWD === canon(T)` and `PWD === dump.cwd`. Fails at HEAD (`"/elsewhere"`). |
| E15 | worktree-init-hook "Agent pi PWD names the checkout cwd"; heap-limits strip still applies | EP (default env path) | L1 | automated | `process.env` stubbed with `PWD:"/launch/dir"` + dashboard heap stamp; checkout dir `T`; `spawnFn` spy; no `opts.env` | `runInitHook(T, agentHook, …)` | spy's `options.env.PWD === canon(T)`; heap stamp + marker absent; other vars equal `defaultHookEnv()` copy. Fails at HEAD. |
| E16 | worktree-init-hook "Caller-supplied environment keeps its PWD"; heap-limits "Explicit caller environment is respected" | EP (explicit env, with / without PWD) | L1 | automated | `opts.env` = (a) `{ PWD:"/x", A:"1" }`, (b) `{ A:"1" }` | `runInitHook(T, agentHook, …, { env })` | spy receives the env unchanged: (a) `PWD === "/x"`; (b) no `PWD` key. *guard* |
| E17 | worktree-init-hook "The gate and script-flavor hook environments are not affected" | EP (other flavors) | L1 | automated | stale `PWD` on `process.env`; `script` hook and gate command; `spawnFn` spy; no `opts.env` | `evaluateGate(T, hook)` and `runInitHook(T, scriptHook, …)` | both spawned envs carry `PWD === "/launch/dir"` (inherited, untouched). *guard* |

### Performance

None — the change adds one `realpathSync` per user-initiated spawn; no spec states a latency/throughput threshold, and no hot path is touched.

### Frontend-quirk

None — no client/UI surface changes.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | headless-spawn "Aliased spawn cwd … when the path cannot be canonicalised, `PWD` SHALL be the absolute lexical form and the spawn SHALL NOT fail" | fault-injection (abort: `realpathSync` ENOENT) | L1 | automated | `cwd` = `"/nonexistent/fsp-1079"` and relative `"nope/fsp-1079"` (neither exists) | `buildSpawnEnv(base, { cwd })` | no throw; `PWD === "/nonexistent/fsp-1079"` and `PWD === path.resolve(process.cwd(), "nope/fsp-1079")` respectively. Fails at HEAD. |
| M1 | issue #1079 acceptance (context-mode routing end-to-end) | real-system acceptance | — | manual-only | dashboard server started from dir `A`; context-mode 1.0.169 installed | spawn a headless session in project `B ≠ A`, then run `ctx_execute` printing `process.cwd()` and `process.env.PWD`, and a Bash `pwd` | all three print `canon(B)`; context-mode session memory is filed under `B`, not `A`. [judgment: needs a live LLM-driven session with the real context-mode extension] |
| M2 | headless-spawn "for `tmux` the pane's pi process SHALL observe a `PWD` naming the `-c` directory" | real-system regression check | — | manual-only | server env `PWD=/launch/dir`; tmux available | spawn a session with strategy `tmux` into dir `B`; in the pane run `node -e 'console.log(process.env.PWD)'` | prints `B` (tmux-derived). [no automatable harness: the spawn path targets the developer's default tmux server; automating it would mutate that server] |
| M3 | headless-spawn "for `wt` … observed only as far as `wt.exe` provides it" | real-system check (Windows) | — | manual-only | Windows host, dashboard started from Git Bash in dir `A` (so `PWD` is exported), Windows Terminal installed | spawn with strategy `wt` into `C:\work\B`; in the tab run `node -e "console.log(process.env.PWD)"` | records whether the tab shows `C:\work\B` (propagated) or the stale/absent value (wt.exe exposure, accepted in design Risks). [needs a Windows host; outcome documents, does not gate] |

## Coverage summary

- Requirements covered: 10/10 (headless-spawn rewrite + aliasing/relative/unresolvable + every-strategy + plugin-cannot-replace + other-vars-unaffected + respawn; plugin-spawn-env-contributor reject list + supersede; worktree-init-hook agent PWD + caller env; gate/script unchanged). The spawn-correlation / tool-registry / host-cwd-policy / acp-agent-sessions deltas only admit the rewrite in "unchanged" clauses — covered by E7 (nothing else changes) and the existing suites staying green.
- Scenarios by class: edge 17 · perf 0 · frontend 0 · error 4 (X1 + M1–M3)
- Scenarios by level: L1 18 · L2 0 · L3 0 · manual 3
- Scenarios by disposition: automated 18 · manual-only 3

## New infra needed

- `packages/server/src/rpc-keeper/__tests__/fixtures/mock-pi.cjs` gains an env-dump mode (e.g. `MOCK_PI_ENV_OUT=<file>` → write `{ PWD: process.env.PWD, cwd: process.cwd() }` as JSON, then continue normal mode) for E14. Fixture extension only; no new harness.
