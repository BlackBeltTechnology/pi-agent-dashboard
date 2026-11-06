# Spec Delta

## ADDED Requirements

### Requirement: Flows plugin publishes a tool facade for flow code nodes

While the flows plugin is enabled, its bridge SHALL publish a facade over the dashboard tool registry on the process-global slot `Symbol.for("pi-dashboard.flow-tools")` for pi-flows code-node handlers in the same pi process. It SHALL publish on activation and on every `session_start`, SHALL clear the slot on `session_shutdown`, and SHALL never throw. pi-flows' `CodeNodeContext` and the registry's tool definitions SHALL NOT change.

#### Scenario: Facade published on activation
- **WHEN** the flows plugin bridge activates in a pi session
- **THEN** the `pi-dashboard.flow-tools` slot holds the facade before any flow runs

#### Scenario: Facade absent without the flows plugin
- **WHEN** a pi session runs with the flows plugin disabled or without the dashboard
- **THEN** the `pi-dashboard.flow-tools` slot is unset, so a guarded handler takes its own fallback path

#### Scenario: No stale facade after reload with the plugin disabled
- **WHEN** the facade was published, then the session shuts down for `/reload` and the flows plugin bridge is not registered afterwards
- **THEN** the `pi-dashboard.flow-tools` slot is unset

### Requirement: Facade resolves any registered tool by name

The facade SHALL accept any tool name registered in the dashboard tool registry, not a fixed subset, and SHALL NOT offer an operation that resolves every tool at once. `has(name)` SHALL report whether `name` is registered. `resolve(name)` SHALL return the tool's resolved absolute filesystem path, or `null` when the tool is unregistered, does not resolve, has no absolute path, or resolution fails. None of them SHALL throw.

#### Scenario: Any registered tool name is accepted
- **WHEN** a handler calls `has("git")`, `has("node")` and `has("bash")`
- **THEN** each returns `true`, and `resolve` of each returns an absolute path when that tool is installed

#### Scenario: Unknown tool resolves to null
- **WHEN** a handler calls `resolve("not-a-registered-tool")`
- **THEN** it returns `null` and does not throw

### Requirement: Facade runs registered tools without throwing

`run(name, args, opts)` SHALL execute the registry's ready-to-spawn command for `name` (with any interpreter prefix) plus `args`, honouring `opts.cwd`, `opts.env`, `opts.timeoutMs` and `opts.signal`, with no console window on Windows. It SHALL resolve to `{ ok, code, stdout, stderr, out }` and never throw or reject. An unresolved tool SHALL yield `ok: false, code: 127` without spawning, and an already-aborted signal SHALL yield `ok: false, code: 130` without spawning.

#### Scenario: Registered tool runs
- **WHEN** a handler calls `run("git", ["--version"])`
- **THEN** it resolves with `ok: true` and `out` containing `git version`

#### Scenario: Unregistered tool fails soft
- **WHEN** a handler calls `run("not-a-registered-tool")`
- **THEN** it resolves with `ok: false` and `code: 127`
- **AND** no process is spawned and nothing is thrown

#### Scenario: Abort stops a running tool
- **WHEN** a handler passes `opts.signal` to `run` and the signal aborts while the tool is running
- **THEN** the child is terminated and the call resolves with `ok: false` instead of hanging

#### Scenario: Already-aborted signal spawns nothing
- **WHEN** a handler calls `run` or `shell` with a signal that is already aborted
- **THEN** the call resolves immediately with `ok: false` and `code: 130`, and no process is spawned

#### Scenario: Timeout stops the tool and its children
- **WHEN** a handler calls `shell("sleep 30 & wait", { timeoutMs: 500 })`
- **THEN** the call resolves with `ok: false` within 2 s of the timeout elapsing
- **AND** no process spawned by that call is still running

#### Scenario: Non-executable tool fails soft
- **WHEN** a handler calls `run` for a registered tool whose resolution is not an executable (for example a module directory)
- **THEN** the call resolves with `ok: false` and does not throw

### Requirement: Facade run and shell stop runaway children

For `run` and `shell`, a timeout (`opts.timeoutMs` that is a positive finite number) or a mid-run abort SHALL terminate the child and every process it spawned, and the call SHALL resolve with `ok: false` within 2 s of the timeout elapsing or the abort. Each of stdout and stderr SHALL be capped at a fixed 64 MiB. Exceeding the cap SHALL terminate the child the same way and resolve `ok: false` with the output captured up to the cap.

#### Scenario: Output beyond the cap is cut off
- **WHEN** a handler calls `shell` with a script that writes more than 64 MiB to stdout
- **THEN** the call resolves with `ok: false` within 2 s of crossing the cap, with `stdout` no longer than 64 MiB

#### Scenario: Non-positive timeout means no timeout
- **WHEN** a handler calls `shell("sleep 1", { timeoutMs: 0 })`
- **THEN** the call resolves with `ok: true` after the command completes

### Requirement: Facade shell runs bash without login profiles

`shell(script, opts)` SHALL run `script` with the registry-resolved `bash` without loading login or rc profiles, and without an inherited `BASH_ENV` / `ENV` unless the caller sets one in `opts.env`. It takes the same options and returns the same result shape as `run`, and it SHALL never throw or reject. If `bash` does not resolve, it SHALL resolve to `ok: false, code: 127`.

#### Scenario: Shell output is free of profile noise
- **WHEN** a handler calls `shell("echo hi")` on a host whose login profile prints to stderr and whose environment sets `BASH_ENV` to a script that prints
- **THEN** the result has `ok: true`, `stdout` of `hi`, and no profile or `BASH_ENV` output in `stderr`

#### Scenario: Managed-dir tools are found by shell
- **WHEN** a tool exists only in the dashboard's managed bin dir and a handler calls `shell("<tool> --version")`
- **THEN** the call resolves with `ok: true`

### Requirement: flow_write carries dashboard-only guidance for the facade

While the flows plugin is enabled, its bridge SHALL, before each agent run whose selected tools include `flow_write`, append exactly one guideline to `flow_write`'s prompt guidelines. The guideline SHALL include a literal guard snippet for obtaining the facade from the `pi-dashboard.flow-tools` slot with a fallback branch, and SHALL name the facade's methods and result shape. Failures while appending SHALL never block the run.

#### Scenario: Guideline added when flow_write is selected
- **WHEN** an agent run starts with `flow_write` among its selected tools
- **THEN** the `flow_write` guidelines contain the facade guideline exactly once, even if the hook runs more than once for that run

#### Scenario: No guideline when flow_write is not selected
- **WHEN** an agent run starts without `flow_write` among its selected tools (flow edit mode off)
- **THEN** no facade guideline is added for any tool

#### Scenario: No guideline without the flows plugin
- **WHEN** the flows plugin is disabled, so its bridge is not registered
- **THEN** `flow_write` carries only pi-flows' own description and guidelines
