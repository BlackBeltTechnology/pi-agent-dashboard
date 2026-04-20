## ADDED Requirements

### Requirement: Single-source child_process module
All code in `packages/server/src`, `packages/extension/src`, `packages/electron/src`, and `packages/shared/src` (excluding `packages/shared/src/platform/exec.ts` and `packages/shared/src/platform/runner.ts`) SHALL import subprocess functions from `@blackbelt-technology/pi-dashboard-shared/platform/exec.js`, not directly from `node:child_process`. A repo-level test SHALL enforce this invariant.

#### Scenario: No direct child_process import outside the wrapper
- **WHEN** the test suite scans every `.ts` file under `packages/*/src/` (excluding `__tests__/`) for direct `node:child_process` imports
- **THEN** the only files that may import from `node:child_process` are `packages/shared/src/platform/exec.ts` and `packages/shared/src/platform/runner.ts`
- **AND** any other match SHALL cause the test to fail with the offending file paths

#### Scenario: Adding a new spawn site
- **WHEN** a developer adds a new call to `execSync` / `execFile` / `spawn` / `spawnSync` / `exec` / `fork` in a non-exempt file
- **THEN** they SHALL import it from `@blackbelt-technology/pi-dashboard-shared/platform/exec.js`
- **AND** the import-ban test SHALL pass without modification

### Requirement: exec.ts sets windowsHide: true by default
The `packages/shared/src/platform/exec.ts` module SHALL export wrapped versions of `execSync`, `exec`, `execFile`, `spawnSync`, `spawn`, `execAsync`, and `execFileAsync`. Each wrapper SHALL set `windowsHide: true` in the options passed to the underlying Node function unless the caller explicitly sets `windowsHide: false`.

#### Scenario: execSync inherits windowsHide: true
- **WHEN** a caller invokes `execSync("cmd", opts)` from the wrapper without specifying `windowsHide`
- **THEN** the underlying `node:child_process.execSync` SHALL be invoked with `opts.windowsHide === true`

#### Scenario: Explicit windowsHide: false is honored
- **WHEN** a caller invokes `execSync("cmd", { windowsHide: false })`
- **THEN** the underlying call SHALL be invoked with `windowsHide === false`

#### Scenario: All wrappers apply the same default
- **WHEN** each of `execSync`, `exec`, `execFile`, `spawnSync`, `spawn`, `execAsync`, `execFileAsync` is called without explicit `windowsHide`
- **THEN** the underlying Node function SHALL receive `windowsHide: true`

#### Scenario: spawn without arguments array
- **WHEN** a caller invokes `spawn("cmd")` without an args array
- **THEN** the wrapper SHALL pass `[]` to the underlying `spawn` and include `windowsHide: true`

### Requirement: runner.ts exposes a single run() function
The `packages/shared/src/platform/runner.ts` module SHALL export a single `run<I, O>(recipe, input, ctx?)` function that executes a `Recipe<I, O>` against a typed `input`, returning a typed `Result<O>`.

#### Scenario: Successful recipe execution
- **WHEN** `run(recipe, input)` is called and the underlying subprocess exits with code 0
- **THEN** the result SHALL be `{ ok: true, value: recipe.parse(stdout, input) }`

#### Scenario: Non-zero exit with tolerated code
- **WHEN** `run(recipe, input)` is called and the subprocess exits with a code listed in `recipe.tolerate`
- **THEN** the result SHALL be `{ ok: true, value: recipe.parse(stdout, input) }` (parsed as if successful)

#### Scenario: Non-zero exit without tolerated code
- **WHEN** `run(recipe, input)` is called and the subprocess exits with a non-zero code NOT in `recipe.tolerate`
- **THEN** the result SHALL be `{ ok: false, error: { kind: "exit", code, signal, stdout, stderr } }`

#### Scenario: Binary not found
- **WHEN** `run(recipe, input)` is called and `ToolResolver.which(recipe.argv(input)[0])` returns null
- **THEN** the result SHALL be `{ ok: false, error: { kind: "not-found", binary } }`
- **AND** no spawn SHALL be attempted

#### Scenario: Timeout exceeded
- **WHEN** `run(recipe, input)` is called and the subprocess does not exit before `recipe.timeout` (default 5000ms)
- **THEN** the child SHALL be terminated
- **AND** the result SHALL be `{ ok: false, error: { kind: "timeout", timeoutMs } }`

#### Scenario: Spawn failure (OS-level)
- **WHEN** `run(recipe, input)` is called and the OS fails to spawn the child (e.g. permission denied)
- **THEN** the result SHALL be `{ ok: false, error: { kind: "spawn-failure", message } }`

### Requirement: Runner always applies safety defaults
The runner SHALL apply these options to every subprocess it spawns, overridable per-recipe:
- `windowsHide: true`
- `stdio: ["pipe", "pipe", "pipe"]`
- `encoding: "utf-8"`
- `shell: false` (always argv array; arguments are never shell-interpolated)
- `timeout: 5000` (default; recipes may override)

#### Scenario: windowsHide always true
- **WHEN** any recipe is executed
- **THEN** the underlying spawn SHALL use `windowsHide: true`

#### Scenario: shell: false always
- **WHEN** any recipe is executed
- **THEN** the underlying spawn SHALL be invoked with an argv array, not a shell-interpolated string
- **AND** path components containing spaces or special characters SHALL be passed verbatim in the args array

### Requirement: Recipes are pure data
A `Recipe<I, O>` object SHALL be serializable data (no closures over mutable state beyond `argv` and `parse`, which are pure functions). A recipe SHALL NOT reference `process.platform` inside its `argv` or `parse` functions.

#### Scenario: Recipes serialize to inspectable JSON except for functions
- **WHEN** a recipe is inspected (e.g. `Object.keys(recipe)`)
- **THEN** the keys SHALL be a subset of `{ argv, parse, timeout, tolerate, cwd, stdin }`

#### Scenario: Recipes do not branch on platform
- **WHEN** a recipe's `argv(input)` function is called on any OS
- **THEN** the returned argv SHALL be platform-independent
- **AND** per-OS alternatives SHALL be expressed as separate Recipe objects (e.g. `LIST_PROCESSES_WMIC` vs `LIST_PROCESSES_PS`), selected by the Tool-module layer

### Requirement: Binary resolution happens in the runner
The runner SHALL resolve the command name (first element of `recipe.argv(input)`) to an absolute path via `ToolResolver.which` before spawning. Resolved paths SHALL be cached per command name for the lifetime of the process.

#### Scenario: First call resolves the binary
- **WHEN** `run(recipe, input)` is called for the first time with a given command name
- **THEN** `ToolResolver.which(commandName)` SHALL be invoked once
- **AND** the result (or null) SHALL be cached

#### Scenario: Subsequent calls reuse the cache
- **WHEN** `run(recipe, input)` is called again with the same command name
- **THEN** the cached resolution SHALL be used without re-invoking `ToolResolver.which`

#### Scenario: Cache reset for tests
- **WHEN** the test-only helper `resetResolverCache()` is called
- **THEN** the next `run()` call SHALL re-invoke `ToolResolver.which`

## ADDED Requirements — Tool Modules

### Requirement: platform/git.ts exports a Recipe-based API
The `packages/shared/src/platform/git.ts` module SHALL expose typed functions for the git operations currently invoked via inline `execSync` across the codebase: `diff`, `status`, `branches`, `currentBranch`, `headSha`, `remoteUrl`, `isGitRepo`, `checkout`, `stash`, `stashPop`. Each function SHALL internally call `run(GIT_RECIPES.X, input, ctx)` and SHALL NOT contain `execSync`, `spawn`, or `process.platform`.

#### Scenario: git.diff routes through the runner
- **WHEN** `git.diff({ path, cwd })` is called
- **THEN** it SHALL invoke `run(GIT_RECIPES.GIT_DIFF, { path }, { cwd })`
- **AND** SHALL NOT contain any direct `child_process` import

#### Scenario: Every git call site uses the module
- **WHEN** the repo is inspected for `execSync("git ...")` or `execSync(\`git ...\`)` patterns
- **THEN** matches SHALL be limited to the `GIT_RECIPES` registry definitions inside `platform/git.ts`

### Requirement: platform/openspec.ts supersedes openspec-poller.ts
The `packages/shared/src/platform/openspec.ts` module SHALL expose Recipe-based `list`, `status`, `archive` operations. The existing `openspec-poller.ts` `pollOpenSpec` and `pollOpenSpecAsync` APIs SHALL be preserved as thin wrappers over the new module for back-compat during migration. Callers SHALL migrate to the new API within this change or in a follow-up.

#### Scenario: pollOpenSpec back-compat
- **WHEN** a caller invokes `pollOpenSpec(cwd)` from the old module path
- **THEN** the call SHALL succeed with identical return shape and semantics as before the migration

#### Scenario: New callers use platform/openspec
- **WHEN** a new caller needs openspec list/status/archive
- **THEN** it SHALL import from `@blackbelt-technology/pi-dashboard-shared/platform/openspec.js`
- **AND** not from `@blackbelt-technology/pi-dashboard-shared/openspec-poller.js`

### Requirement: platform/npm.ts exports a Recipe-based API
The `packages/shared/src/platform/npm.ts` module SHALL expose typed functions for the npm operations currently invoked via inline `execSync` across the codebase: `rootGlobal`, `outdated`, `install`, `remove`, `viewVersion`. Each function SHALL route through the runner.

#### Scenario: npm.rootGlobal replaces inline execSync
- **WHEN** a caller needs the global npm root
- **THEN** it SHALL call `npm.rootGlobal()` from `platform/npm.ts`
- **AND** inline `execSync("npm root -g")` SHALL NOT appear elsewhere in the codebase

### Requirement: Result type surfaces errors without throwing
`run()` SHALL return `Result<T> = { ok: true; value: T } | { ok: false; error: ExecError }` and SHALL NOT throw for the error classes: "not-found", "exit", "timeout", "spawn-failure". Callers receive errors as typed values.

#### Scenario: Best-effort caller with unwrap helper
- **WHEN** a caller uses `unwrap(git.diff(input), "")` to get a default on any error
- **THEN** the call SHALL return the parsed string on success or `""` on any error kind

#### Scenario: Caller distinguishes error kinds
- **WHEN** a caller checks `if (!result.ok && result.error.kind === "not-found") { ... }`
- **THEN** the error discriminant SHALL be available as a typed string union

### Requirement: Single-source process-termination module
All code in `packages/server/src`, `packages/extension/src`, `packages/electron/src`, and `packages/shared/src` (excluding `packages/shared/src/platform/process.ts` and `packages/shared/src/platform/exec.ts`) SHALL terminate processes exclusively via helpers exported from `@blackbelt-technology/pi-dashboard-shared/platform/process.js` (`isProcessAlive`, `killProcess`, `killPidWithGroup`). Direct calls to `process.kill(pid, …)` outside the platform module are prohibited. A repo-level test SHALL enforce this invariant.

#### Scenario: No direct process.kill outside the platform module
- **WHEN** the test suite scans every `.ts` file under `packages/*/src/` (excluding `__tests__/` and `packages/shared/src/platform/`)
- **THEN** no file SHALL contain a call matching the regex `\bprocess\.kill\s*\(`
- **AND** any match SHALL cause the test to fail with the offending file paths and line numbers

#### Scenario: Adding a new termination site
- **WHEN** a developer needs to terminate a PID, check liveness, or kill a process group
- **THEN** they SHALL import the appropriate helper (`isProcessAlive`, `killProcess`, or `killPidWithGroup`) from `@blackbelt-technology/pi-dashboard-shared/platform/process.js`
- **AND** the enforcement test SHALL pass without modification

#### Scenario: Platform module is exempt
- **WHEN** the scanner encounters files under `packages/shared/src/platform/`
- **THEN** those files SHALL be skipped
- **AND** their internal use of `process.kill` SHALL NOT cause failures

### Requirement: Cross-platform tree termination uses killProcess
Code that needs to terminate a spawned session, editor, tunnel, or any process whose descendants MUST also be terminated SHALL use `killProcess(pid, opts)` from the platform module. On Windows this SHALL invoke `taskkill /F /T /PID <pid>`; on POSIX this SHALL send SIGTERM, wait up to `timeoutMs` (default 5000), then SIGKILL if the process is still alive.

#### Scenario: Windows tree kill
- **WHEN** `killProcess(pid)` is invoked with `platform: "win32"`
- **THEN** the platform SHALL execute `taskkill /F /T /PID <pid>` via the wrapped `execSync`
- **AND** return `{ ok: true, forced: false }` on success

#### Scenario: POSIX escalation path
- **WHEN** `killProcess(pid, { timeoutMs: 2000 })` is invoked with `platform: "linux"` or `platform: "darwin"` on a live PID
- **THEN** the platform SHALL send `SIGTERM` to `pid`
- **AND** poll liveness every 200ms until `timeoutMs` elapses
- **AND** send `SIGKILL` if the process is still alive when the deadline passes
- **AND** return `{ ok: true, forced: true }` when SIGKILL was required

#### Scenario: Already-dead process
- **WHEN** `killProcess(pid)` is invoked for a PID that is not alive
- **THEN** the platform SHALL return `{ ok: false, forced: false }` without sending any signal
