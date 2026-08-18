# Test Plan — fix-tmux-cwd-command-injection

Stage: design   Generated: 2026-06-15

Requirements under test (from `specs/session-spawn/spec.md`):

- **R1** — cwd containing a command substitution → literal dir, nothing executes
- **R2** — cwd containing quotes / separators / spaces → one argument, nothing executes
- **R3** — the tmux command is an argv executed without a shell
- **R4** — session flag values reach pi as single literal arguments

Design decisions under test: **D2** (no `cd` prefix; `-c` carries the cwd),
**D4** (`piInvocation` param), **D5a** (`wsl.exe --exec`), **D6** (fail closed on
builder *and* execution revert).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 | EP (metachar class: substitution) | L1 | automated | `cwd = "/tmp/$(touch /tmp/PWNED) dir"` | `buildTmuxCommand(cwd, false)` | returned array contains an element **strictly equal** to `cwd`, immediately after the `-c` element; no element contains added quote characters |
| E2 | R2 | EP (metachar class: quotes/separators) | L1 | automated | ``cwd = `/tmp/a"b'c;d e&f` `` | `buildTmuxCommand(cwd, false)` | exactly one element equals `cwd` verbatim; `cwd` appears in no other element |
| E3 | R1+D2 | state (pane-command shape) | L1 | automated | `cwd = "/tmp/$(id) x"`, no options | `buildTmuxCommand(cwd, false)` | last element === `"pi"`; it contains no `cd`, no `&&`, and no substring of `cwd` |
| E4 | R4 | EP (metachar class in flag value) | L1 | automated | `options = { sessionFile: "/s/a$(id);x .jsonl", mode: "continue" }` | `buildTmuxCommand("/p", false, options)` | pane element === `pi --session '/s/a$(id);x .jsonl'` — one single-quoted token; array length unchanged (pane stays ONE element) |
| E5 | R3 | decision-table (sessionExists × token × flags) | L1 | automated | 8 combinations of `sessionExists ∈ {t,f}` × `spawnToken ∈ {set, unset}` × `flags ∈ {present, absent}` | `buildTmuxCommand(...)` per row | `new-window`,`-t`,`pi-dashboard` vs `new-session`,`-d`,`-s`,`pi-dashboard` as discrete elements; when token set → `-e` and `PI_DASHBOARD_SPAWN_TOKEN=<token>` are two elements and the token value is **raw, not shell-escaped**; when unset → no `-e` element |
| E6 | D4 | EP (parameter default vs supplied) | L1 | automated | `piInvocation = ["/usr/local/bin/node", "/opt/pi/cli.js"]` | `buildTmuxCommand("/p", false, undefined, piInvocation)` | pane element starts with both tokens in order, each `shellEscape`d; omitting the 4th arg yields `pi` |
| E7 | R2 | BVA (degenerate paths) | L1 | automated | `cwd ∈ { "/", "/tmp/trailing\\", "/tmp/  double  space  " }` | `buildTmuxCommand(cwd, false)` | one element strictly equal to each input; no element dropped, no throw |
| E8 | R3+D6 | invariant on call mode | L1 | automated | exec module mocked; `cwd = "/tmp/$(id)"` | `spawnTmux(cwd, opts)` | `execFileSync` called once with `(argv[0], argv.slice(1))` from `buildSafeArgv` and `shell: false`; `execSync` **never** called with a string containing `tmux new-` |
| E9 | D5a | invariant on WSL argv shape | L1 | automated | exec module mocked (`buildSafeArgv` real via `importActual`), platform win32 | `spawnWslTmux(cwd, opts)` | spawned argv === `["wsl.exe", "--exec", "tmux", …]`; first element is **not** `cmd.exe`; `--exec` present |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R3 | fault-injection (abort) | L1 | automated | `execFileSync` throws `ENOENT` (tmux absent) | `spawnTmux("/p")` | returns `{ success: false, code: "TMUX_MISSING" }` with `err.message` in `message`; no throw escapes |
| X2 | D5a | fault-injection (abort) | L1 | automated | `execFileSync` throws | `spawnWslTmux("/p")` | returns `code: "TMUX_MISSING"` and the WSL-specific message (`…via WSL tmux (wsl-tmux mechanism)…`) is retained |
| X3 | R3 (env invariant) | invariant on options | L1 | automated | `options.spawnToken = "tok-1"` | `spawnTmux` and `spawnWslTmux` | both pass `stdio: "ignore"` and an `env` from `buildSpawnEnv` carrying `PI_DASHBOARD_SPAWN_TOKEN=tok-1` — the WSL site does not lose env in the conversion |
| X4 | R1 | fault-injection (precondition) | L1 | automated | `cwd` does not exist | `spawnPiSession(cwd)` | `code: "DIR_MISSING"`, and no exec call is made at all (guard runs before construction) |

### Runtime (real tmux, docker harness)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| T1 | R1 | end-to-end falsification | L3 | automated | inside the harness container: `mkdir '/work/$(touch /tmp/PWNED) hostile;x'` (single-quoted at setup, or the sentinel self-creates) | spawn a session with that cwd via `BusClient` (harness runs `PI_SPAWN_STRATEGY=tmux`) | `/tmp/PWNED` does **not** exist in the container **and** a tmux pane exists whose `#{pane_current_path}` equals the literal directory name |
| T2 | R2+D2 | state-transition (pane starts in `-c` dir) | L3 | automated | dir named `/work/a"b'c;d e` | spawn a session with that cwd | pane count +1; `#{pane_current_path}` equals the literal dir — proves `-c` alone sets the cwd once `cd` is dropped; the session reaches live (pi registers) |

### Manual-only

| id | requirement | technique | level | disposition | surface | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------|---------|---------------------|
| M1 | D5a | host-dependent runtime | — | manual-only | a real Windows host with WSL + tmux | spawn a session into a dir containing `%USERNAME%`, `&` and a double quote | pane opens in the literal dir, `%USERNAME%` is **not** expanded, nothing after `&` runs — [no Windows/WSL runner exists in CI; E9 covers argv shape only] |

---

## Coverage summary

- Requirements covered: 4/4 (R1–R4), plus design D2, D4, D5a, D6
- Scenarios by class: edge 9 · perf 0 · frontend 0 · error 4 · runtime 2 · manual 1
- Scenarios by level: L1 13 · L2 0 · L3 2 · — 1
- Scenarios by disposition: automated 15 · manual-only 1

**No performance scenarios**: the change alters command construction only; no
latency or throughput budget is asserted by the spec. **No frontend-quirk
scenarios**: no rendered UI is touched.

## New infra needed

None. L1 rides `packages/server/src/__tests__/process-manager.test.ts`; L3 rides
the existing docker harness, exemplar `tests/e2e/tmux-session-shutdown.spec.ts`
(already spawns tmux sessions and inspects the container out-of-band, port from
`.pi-test-harness.json` — never hardcoded).
