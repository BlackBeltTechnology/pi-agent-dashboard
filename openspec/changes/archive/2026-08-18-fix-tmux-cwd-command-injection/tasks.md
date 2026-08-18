## 1. Test seam

- [x] 1.1 Export `spawnTmux` and `spawnWslTmux` from `packages/server/src/spawn-process/process-manager.ts` (both are module-private today at :434 and :453; the test file imports neither, so tasks 2.x cannot be authored without this).
- [x] 1.2 Establish the mock pattern for `@blackbelt-technology/pi-dashboard-shared/platform/exec.js`: stub `execFileSync`/`execSync` but keep the **real** `buildSafeArgv` via `importActual` — the WSL assertion depends on its real branch logic. Exemplar: existing mock usage in `packages/server/src/__tests__/`.

## 2. Red tests — L1 builder + execution (TDD)

All in `packages/server/src/__tests__/process-manager.test.ts`; exemplar = the
existing `describe("buildTmuxCommand")` block in that file (rewrite its
string-based `toContain` assertions to array assertions as you go).

- [x] 2.1 Command-substitution cwd is a literal argv element (test-plan #E1). Triple: input `cwd = "/tmp/$(touch /tmp/PWNED) dir"` · trigger `buildTmuxCommand(cwd, false)` · observable an element strictly equal to `cwd` immediately after `-c`, with no added quote characters.
- [x] 2.2 Quote/separator cwd is one element (test-plan #E2). Triple: input ``cwd = `/tmp/a"b'c;d e&f` `` · trigger `buildTmuxCommand(cwd, false)` · observable exactly one element equals `cwd` verbatim and `cwd` appears in no other element.
- [x] 2.3 Pane command carries no `cd` and no cwd (test-plan #E3, design D2). Triple: input `cwd = "/tmp/$(id) x"`, no options · trigger `buildTmuxCommand(cwd, false)` · observable last element === `"pi"`, containing no `cd`, no `&&`, no substring of `cwd`.
- [x] 2.4 Flag values stay one escaped token (test-plan #E4). Triple: input `{ sessionFile: "/s/a$(id);x .jsonl", mode: "continue" }` · trigger `buildTmuxCommand("/p", false, options)` · observable pane element === `pi --session '/s/a$(id);x .jsonl'` and the array length is unchanged (pane stays ONE element).
- [x] 2.5 Subcommand/token decision table (test-plan #E5). Triple: input 8 combos of `sessionExists` × `spawnToken` × `flags` · trigger `buildTmuxCommand(...)` per row · observable `new-window`/`-t`/`pi-dashboard` vs `new-session`/`-d`/`-s`/`pi-dashboard` as discrete elements; token present → `-e` and `PI_DASHBOARD_SPAWN_TOKEN=<token>` as two elements with the token value **raw, not shell-escaped**; absent → no `-e`.
- [x] 2.6 `piInvocation` parameter (test-plan #E6, design D4). Triple: input `["/usr/local/bin/node", "/opt/pi/cli.js"]` · trigger `buildTmuxCommand("/p", false, undefined, piInvocation)` · observable pane element starts with both tokens in order, each escaped; omitting the argument yields `pi`.
- [x] 2.7 Degenerate paths (test-plan #E7). Triple: input `cwd ∈ { "/", "/tmp/trailing\\", "/tmp/  double  space  " }` · trigger `buildTmuxCommand(cwd, false)` · observable one element strictly equal to each input, nothing dropped, no throw.
- [x] 2.8 `spawnTmux` executes without a shell (test-plan #E8, design D6.2). Triple: input exec module mocked, `cwd = "/tmp/$(id)"` · trigger `spawnTmux(cwd, opts)` · observable `execFileSync` called once with `(argv[0], argv.slice(1))` from `buildSafeArgv` and `shell: false`; `execSync` never called with a string containing `tmux new-`.
- [x] 2.9 `spawnWslTmux` argv shape (test-plan #E9, design D5a). Triple: input platform win32, exec mocked with real `buildSafeArgv` · trigger `spawnWslTmux(cwd, opts)` · observable spawned argv === `["wsl.exe", "--exec", "tmux", …]`, first element is not `cmd.exe`.
- [x] 2.10 tmux-missing fault on the native path (test-plan #X1). Triple: input `execFileSync` throws `ENOENT` · trigger `spawnTmux("/p")` · observable `{ success: false, code: "TMUX_MISSING" }` carrying `err.message`, no throw escapes.
- [x] 2.11 tmux-missing fault on the WSL path (test-plan #X2). Triple: input `execFileSync` throws · trigger `spawnWslTmux("/p")` · observable `code: "TMUX_MISSING"` with the WSL-specific message text retained.
- [x] 2.12 env/stdio survive the conversion on both sites (test-plan #X3). Triple: input `options.spawnToken = "tok-1"` · trigger `spawnTmux` and `spawnWslTmux` · observable both pass `stdio: "ignore"` and a `buildSpawnEnv` env carrying `PI_DASHBOARD_SPAWN_TOKEN=tok-1`.
- [x] 2.13 Missing-dir guard runs before construction (test-plan #X4). Triple: input `cwd` does not exist · trigger `spawnPiSession(cwd)` · observable `code: "DIR_MISSING"` and no exec call at all.
- [x] 2.14 Run the suite and confirm every test in section 2 FAILS against current code.

## 3. Builder conversion

- [x] 3.1 Change `buildTmuxCommand` to return `string[]`, signature `(cwd, sessionExists, options?, piInvocation: string[] = ["pi"])` (design D1, D4).
- [x] 3.2 Emit argv: `tmux`, subcommand + `-t`/`-s pi-dashboard`, optional `-e PI_DASHBOARD_SPAWN_TOKEN=<raw token>`, `-c`, raw `cwd`, pane command — all discrete elements, no quoting.
- [x] 3.3 Build the pane command as `shellEscape`d `piInvocation` + `shellEscape`d session flags joined by spaces; drop the `cd <cwd> &&` prefix (design D2, D3).
- [x] 3.4 Update the builder's doc comment: layers 1/3/4 removed, layer 2 (tmux pane shell) intentional — do NOT strip `shellEscape`.

## 4. Call sites

- [x] 4.1 `spawnTmux`: replace `execSync(cmd, …)` with `buildSafeArgv(cmd[0], cmd.slice(1))` + `execFileSync(argv[0], argv.slice(1), { stdio: "ignore", env, ...spawnOptions })` (design D5); keep `buildSpawnEnv` and the `TMUX_MISSING` mapping.
- [x] 4.2 `spawnWslTmux`: build the tmux argv, then `buildSafeArgv("wsl.exe", ["--exec", ...tmuxArgv])` — `.exe` bypasses the `cmd.exe /d /s /c` branch, `--exec` bypasses WSL's default shell (design D5a); pass `["pi"]` as `piInvocation`. Preserve `{ stdio: "ignore", env }` and the WSL-specific `TMUX_MISSING` message (`process-manager.ts:455-457`).
- [x] 4.3 Verify `execFileSync` is imported from `@blackbelt-technology/pi-dashboard-shared/platform/exec.js` (no direct `node:child_process` import).
- [x] 4.4 Run section 2 green.

## 5. Runtime tests — L3 docker harness

Both in `tests/e2e/`; exemplar = `tests/e2e/tmux-session-shutdown.spec.ts`
(harness runs `PI_SPAWN_STRATEGY=tmux`, spawns via `BusClient`, inspects the
container out-of-band with `docker exec`, port from `.pi-test-harness.json` via
`DASHBOARD_PORT` — never hardcoded).

- [x] 5.1 Hostile-cwd spawn executes nothing (test-plan #T1). Triple: input `mkdir '/work/$(touch /tmp/PWNED) hostile;x'` inside the container (single-quote at setup or the sentinel self-creates) · trigger spawn a session with that cwd via `BusClient` · observable `/tmp/PWNED` does not exist in the container AND a tmux pane exists whose `#{pane_current_path}` equals the literal directory name.
- [x] 5.2 `-c` alone sets the pane cwd (test-plan #T2, design D2 risk). Triple: input dir named `/work/a"b'c;d e` · trigger spawn a session with that cwd · observable pane count +1, `#{pane_current_path}` equals the literal dir, session reaches live (pi registers).

## 6. Verification

- [x] 6.1 Full suite green: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep the summary.
- [x] 6.2 Typecheck/build clean (`string` → `string[]` ripple, new 4th param, new exports).
- [x] 6.3 Restart the server (`curl -X POST http://localhost:8000/api/restart`) and confirm a normal spawn still works on both the new-session and new-window branch.

## 7. Manual verification (deferred, post-merge)

- [ ] 7.1 WSL-tmux runtime on a real Windows + WSL host (test-plan: manual-only, #M1): spawn into a dir containing `%USERNAME%`, `&` and a double quote; confirm the pane opens in the literal dir, `%USERNAME%` is not expanded, nothing after `&` runs. No Windows/WSL runner exists in CI — task 2.9 covers argv shape only.

## 8. Docs

- [x] 8.1 Update the `process-manager.ts` row in `packages/server/src/spawn-process/AGENTS.md` with `See change: fix-tmux-cwd-command-injection`.
- [x] 8.2 `docs/service-bootstrap.md:246` documents `buildTmuxCommand(cwd, sessionExists, options, resolvedPath)` returning a string — delegate a caveman-style update (argv return, `piInvocation: string[]`) to `DocScribe`, along with any tmux-construction prose in `docs/architecture.md`.
- [x] 8.3 Follow-up note (not edited here): `select-pi-runtime-install` tasks 4.1/4.5 + migration step 3 now duplicate this conversion — they reduce to passing the resolved argv into `piInvocation`. Flag for that change's owner rather than editing its artifacts.
