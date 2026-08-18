## Context

`buildTmuxCommand` (`packages/server/src/spawn-process/process-manager.ts`) returns a
**shell command string**; `spawnTmux` / `spawnWslTmux` run it with `execSync(cmd)`.

Current shape:

```
tmux new-session -d -s pi-dashboard [-e TOKEN=…] -c <cwd> "cd <cwd> && pi <flags>"
```

Two shell layers exist:

1. **Dashboard-side `/bin/sh`** — created by `execSync`. Parses the whole string.
2. **tmux pane shell** — tmux runs its `shell-command` argument through a shell.

`shellEscape` single-quotes values. Single quotes are **inert inside the
double-quoted** pane segment, so `$(…)`, backticks and `$VAR` in `cwd` are
expanded by layer 1 before tmux ever sees them. The `cd <cwd> &&` prefix is the
only reason `cwd` sits inside that segment.

`cwd` is attacker-influenced: it is any directory reachable through workspace
config, `PI_WORKSPACES`, the path picker, or directory scanning. tmux is the
**default** mechanism on macOS/Linux (`selectMechanism`), so this is the common
spawn path.

The **WSL-tmux** mechanism has two more layers, and they are not obvious:

3. **`cmd.exe`** — `buildSafeArgv("wsl", …)` sees an *extensionless* command and
   returns `["cmd.exe", "/d", "/s", "/c", "wsl", …]` (`packages/shared/src/platform/exec.ts`,
   the `isShim || !hasExtension` branch). cmd.exe expands `%VAR%` **even inside
   double quotes**, and treats `&` / `|` / `<` as separators in any *unquoted*
   segment — and `shellEscape`'s single-quoted output is exactly that to cmd.exe,
   which has no concept of single quotes.
4. **WSL's default shell** — `wsl <command>` without `--exec` runs the command
   line through it.

The existing `isWslTmuxAvailable` probe uses this same call, but passes only the
constants `["which", "tmux"]` — it carries no attacker-influenced data, so "the
probe works today" proves nothing about the payload.

Repo constraint: every spawn goes through
`@blackbelt-technology/pi-dashboard-shared/platform/exec.js`; `buildSafeArgv`
is the canonical no-shell argv builder (`shell: false`, `windowsHide: true`).

## Goals / Non-Goals

**Goals:**
- Remove layer 1 from the spawn path — tmux is invoked as argv, never through a
  dashboard-side shell. (`dashboardSessionExists` keeps its
  `execSync("tmux has-session … 2>/dev/null")`; its input is a constant, it is not
  on the injection path, and it is out of scope — so "no shell anywhere in this
  module" is *not* the claim.)
- Carry `cwd` as a literal `-c <cwd>` argv element, never inside a quoted string.
- Remove layers 3 and 4 on the WSL path (`wsl.exe` spelling + `--exec`).
- Keep `shellEscape` for the pane command, where layer 2 legitimately remains.
- Keep the WSL path working, resolving `pi` inside the WSL namespace.
- Regression tests that fail on revert — including on an *execution-side* revert.

**Non-Goals:**
- Changing *which* pi binary runs (owned by `select-pi-runtime-install`).
- Auditing other `execSync` shell-string builders in the server.
- Touching the `wt` or `headless` mechanisms (already argv-based).
- Removing tmux's own pane shell.
- **Windows→WSL path translation.** `spawnWslTmux` hands a host `C:\…` path to a
  Linux tmux; no `wslpath` translation exists anywhere in server/shared. That is a
  pre-existing *correctness* bug (today the equally-broken `cd 'C:\…'` masks it),
  distinct from shell interpretation, and is flagged as an open question in
  `select-pi-runtime-install/design.md:226`. See risk below.

## Decisions

### D1 — `buildTmuxCommand` returns `string[]` (argv), not `string`

The tmux invocation becomes an argument vector:

```
["tmux", "new-window", "-t", "pi-dashboard", ("-e", "PI_DASHBOARD_SPAWN_TOKEN=…"),
 "-c", cwd, paneCommand]
```

`cwd` and the token are raw, unescaped argv elements. No quoting is needed
because no shell parses them.

*Alternative rejected:* keep the string and escape harder (e.g. wrap the pane
segment in single quotes). Correct escaping of a nested two-layer string is
possible but fragile — every future edit to this builder must re-derive it. Argv
makes the class of bug unrepresentable for layer 1.

### D2 — Drop the `cd <cwd> &&` prefix

tmux's `-c` flag already sets the pane's working directory, so the prefix was
always redundant. Removing it is what actually closes the vulnerability: it is
the only reason `cwd` appeared inside the pane command. Pane command becomes
`pi` or `pi <escaped flags>`.

### D3 — `shellEscape` is RETAINED for the pane command

tmux runs `shell-command` through a shell of its own (layer 2). Flag values —
and, once `select-pi-runtime-install` lands, the resolved pi path — must stay
escaped. In the new shape there is no enclosing double-quote context, so
single-quoting is sound.

An earlier draft removed `shellEscape` from this path. That would leave a value
like `--session /s/a$(id).jsonl` interpreted by the **pane** shell. (Note the
layers differ in what they expand: inside today's double-quoted segment `;` is
already inert and only `$(…)`/backticks/`$VAR` fire, whereas an *unquoted* pane
token is exposed to `;`, `&`, `|` as well — so layer-2 escaping is about a wider
set than layer 1.) Explicitly rejected: conflating the two layers in either
direction produces a wrong fix.

### D4 — Pi invocation becomes a parameter

Signature: `buildTmuxCommand(cwd, sessionExists, options?, piInvocation: string[] = ["pi"])`
— an **argv**, joined + `shellEscape`d into the pane command. `spawnTmux` takes the
default; `spawnWslTmux` passes `["pi"]` explicitly, so `pi` resolves **inside the WSL
namespace** rather than embedding a host path.

The parameter has no second caller *yet*, which brushes against the repo's
no-speculative-flexibility rule. It is kept because D2 forces the pane command to
be constructed here anyway, and because this change is now the **owner** of the
conversion that `select-pi-runtime-install` (D9, tasks 4.1/4.5) also describes —
that change becomes a dependant and passes its registry-resolved argv into this
seam. Which binary runs is unchanged by this change.

### D5 — Execution via `buildSafeArgv` + `execFileSync`

`spawnTmux`: `const { argv, spawnOptions } = buildSafeArgv(cmd[0], cmd.slice(1))`,
then `execFileSync(argv[0], argv.slice(1), { stdio: "ignore", env, ...spawnOptions })`.
`env` handling (spawn token via `buildSpawnEnv`) is unchanged; the `-e` per-window
token flag stays, now as two argv elements. (The `isWslTmuxAvailable` probe uses
`spawnSync` for the same no-shell effect; `execFileSync` is chosen here only to
keep the existing sync-throw-on-failure error mapping.)

### D5a — WSL: `wsl.exe` + `--exec`, not `wsl`

`spawnWslTmux` builds `buildSafeArgv("wsl.exe", ["--exec", ...tmuxArgv])`:

- **`wsl.exe`, not `wsl`** — the `.exe` extension takes `buildSafeArgv`'s
  `hasExtension` branch, so the argv is spawned directly instead of through
  `cmd.exe /d /s /c` (layer 3 gone). `wsl.exe` is on PATH via System32.
- **`--exec`** — runs the given command directly instead of through WSL's default
  login shell (layer 4 gone).

Without both, the spec Requirement — which names the WSL-tmux mechanism — is not
met: a `cwd` containing `%VAR%`, or `&` in an unquoted segment, is expanded/split
by cmd.exe before WSL ever sees it.

**Residual boundary, stated rather than assumed away.** Removing layers 3 and 4
does not make the WSL path argv-clean end to end. `CreateProcess` takes a command
*string*: Node/libuv joins our argv with MSVCRT quoting rules, and `wsl.exe` then
re-splits that string with **its own** parser to build the Linux argv. The
pane-command element is a single argv element containing spaces (whenever any flag
is present), single quotes from `shellEscape`, and possibly backslashes — a `cwd`
ending in `\` also hits libuv's trailing-backslash doubling. So one parse boundary
remains, and it is the one the spec's "path containing double quotes → single
argument" scenario lands on.

*Verification limit, disclosed:* no Windows/WSL runner exists in this repo's CI, so
D5a is covered by an **argv-shape unit test only**. Runtime behaviour on Windows —
especially the quote/backslash-bearing cases above, which are what to test first on
a WSL box — stays unverified.

### D6 — Tests assert argv elements AND the execution call

Two distinct fail-closed surfaces, because the vulnerability has two halves:

1. **Builder shape.** Existing tests in
   `packages/server/src/__tests__/process-manager.test.ts` assert `toContain("…")`
   on the returned string; they are rewritten to assert on the array — `cwd` is
   its own element, **exactly equal** to the input (no quoting added, no
   substitution), the pane command contains no `cd`, and metacharacter-bearing
   flag values are one escaped token.
2. **Execution mode.** A builder-only test suite still passes if someone reverts
   `spawnTmux` to `execSync(cmd.join(" "))`. So the exec module is mocked and the
   spawn functions are asserted to call `execFileSync` with the argv (and
   `execSync` **not** called with the tmux command), and `spawnWslTmux` asserted to
   produce `wsl.exe --exec tmux …`.

Neither surface asserts *runtime* tmux behaviour — see the Risks note on what
stays manual.

## Risks / Trade-offs

- **No automated test spawns a real tmux.** The spec's scenarios are runtime
  behaviours ("the session SHALL be created for the literal directory name"), but
  D6's coverage is argv-shape + call-mode assertions → the runtime half is a
  **manual** smoke (tasks 4.3). Stated plainly rather than claimed as covered; if
  scenario-design routes a runtime scenario to L3, it lands as its own task.
- **Dropping `cd <cwd> &&` changes pane behaviour if `-c` were ever ignored**
  (e.g. a tmux config overriding `default-path`) → tmux `-c` has set the pane
  start directory since 1.9 and is already passed today; verified by the manual
  smoke, not by an automated test.
- **`execSync` → `execFileSync` changes error shape** (`err.message` text on
  failure) → the `TMUX_MISSING` result wraps `err.message` either way; message
  text is not asserted for equality.
- **`execFileSync` resolves `tmux` via the current process PATH**, where the shell
  previously used the `env` passed to `execSync` → differs only if tmux lived
  solely in a `buildSpawnEnv`-prepended directory, which it does not today.
- **WSL runtime stays unverified** — D5a is reasoned from `buildSafeArgv`'s own
  branch plus libuv's Windows arg-quoting, and covered by a unit test on the argv
  shape; there is no Windows/WSL runner → disclosed, not hidden. A WSL user
  hitting a regression is the detection mechanism.
- **WSL cwd is still a Windows path** handed to a Linux tmux (no `wslpath`) → not
  regressed by this change but not fixed either; after D2 tmux gets `-c C:\…` with
  no `cd` to fail first, so the pane may start in `$HOME` instead of failing
  loudly. Explicit non-goal above; needs its own change.
- **Signature change ripples to callers/tests/docs** (`string` → `string[]`, new
  4th param) → both call sites are in this file and TypeScript surfaces any miss;
  `docs/service-bootstrap.md:246` documents the old shape and is updated with it.
- **Layer 2 remains a shell by design** → accepted and documented in the
  builder's doc comment so a future reader does not "helpfully" strip
  `shellEscape`.
