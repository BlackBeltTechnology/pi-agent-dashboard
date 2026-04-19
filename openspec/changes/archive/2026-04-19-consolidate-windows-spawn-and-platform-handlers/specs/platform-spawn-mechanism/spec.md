## ADDED Requirements

### Requirement: SpawnMechanism enum and selector
The `packages/shared/src/platform/spawn-mechanism.ts` module SHALL export a `SpawnMechanism` type equal to `"tmux" | "wt" | "wsl-tmux" | "headless"` and a pure function `selectMechanism({ platform, userStrategy, electronMode, available })` where `userStrategy: "tmux" | "headless"`, `electronMode: boolean`, and `available: { tmux: boolean; wt: boolean; wslTmux: boolean }`. The function SHALL be pure (no I/O, no subprocess calls) and SHALL return exactly one `SpawnMechanism` value per invocation. Tool availability SHALL be determined by the caller (typically via `ToolRegistry.resolve`) and passed in; the selector itself SHALL not probe tools.

#### Scenario: Electron mode always uses headless
- **WHEN** `selectMechanism({ platform: "win32", userStrategy: "tmux", electronMode: true, available: {...} })` is called
- **THEN** the function SHALL return `"headless"` regardless of other inputs

#### Scenario: User config headless always uses headless
- **WHEN** `selectMechanism({ userStrategy: "headless", ... })` is called on any platform
- **THEN** the function SHALL return `"headless"`

#### Scenario: Linux with tmux returns tmux
- **WHEN** `selectMechanism({ platform: "linux", userStrategy: "tmux", electronMode: false, available: { tmux: true, wt: false, wslTmux: false } })` is called
- **THEN** the function SHALL return `"tmux"`

#### Scenario: macOS with tmux returns tmux
- **WHEN** `selectMechanism({ platform: "darwin", userStrategy: "tmux", electronMode: false, available: { tmux: true, wt: false, wslTmux: false } })` is called
- **THEN** the function SHALL return `"tmux"`

#### Scenario: Linux without tmux falls back to headless
- **WHEN** `selectMechanism({ platform: "linux", userStrategy: "tmux", electronMode: false, available: { tmux: false, wt: false, wslTmux: false } })` is called
- **THEN** the function SHALL return `"headless"`

#### Scenario: Windows with wt returns wt
- **WHEN** `selectMechanism({ platform: "win32", userStrategy: "tmux", electronMode: false, available: { tmux: false, wt: true, wslTmux: false } })` is called
- **THEN** the function SHALL return `"wt"`

#### Scenario: Windows with wt AND wsl-tmux prefers wt
- **WHEN** `selectMechanism({ platform: "win32", userStrategy: "tmux", electronMode: false, available: { tmux: false, wt: true, wslTmux: true } })` is called
- **THEN** the function SHALL return `"wt"`

#### Scenario: Windows with wsl-tmux only returns wsl-tmux
- **WHEN** `selectMechanism({ platform: "win32", userStrategy: "tmux", electronMode: false, available: { tmux: false, wt: false, wslTmux: true } })` is called
- **THEN** the function SHALL return `"wsl-tmux"`

#### Scenario: Windows with nothing falls back to headless
- **WHEN** `selectMechanism({ platform: "win32", userStrategy: "tmux", electronMode: false, available: { tmux: false, wt: false, wslTmux: false } })` is called
- **THEN** the function SHALL return `"headless"`

### Requirement: Windows Terminal (wt) argv builder
The module SHALL export `buildWtArgs({ cwd, title, piArgv })` that returns a string array suitable for passing directly to `spawn("wt.exe", args, ...)` — argv form, not a shell string. The argv SHALL include `-w 0` (reuse existing Windows Terminal window if present), `new-tab` (open a new tab), `-d <cwd>` (starting directory), `--title <title>` (tab title), `--` (end-of-options sentinel), followed by `piArgv` elements verbatim. The function SHALL NOT shell-escape inputs (argv form bypasses shell parsing). The function SHALL NOT pass a `-p <profile>` flag so that the user's default Windows Terminal profile is respected.

#### Scenario: Basic wt argv shape
- **WHEN** `buildWtArgs({ cwd: "C:\\proj", title: "proj", piArgv: ["C:\\node.exe", "cli.js", "--mode", "rpc"] })` is called
- **THEN** it SHALL return `["-w", "0", "new-tab", "-d", "C:\\proj", "--title", "proj", "--", "C:\\node.exe", "cli.js", "--mode", "rpc"]`

#### Scenario: Cwd with spaces preserved as single argv element
- **WHEN** `buildWtArgs({ cwd: "C:\\Users\\Bob's Project (2)", title: "x", piArgv: ["pi"] })` is called
- **THEN** the returned array SHALL contain `"C:\\Users\\Bob's Project (2)"` as a single element (no quotes embedded, no splitting)

#### Scenario: Pi argv with --fork passed through
- **WHEN** `buildWtArgs({ cwd, title, piArgv: ["node.exe", "cli.js", "--fork", "C:\\x\\session.jsonl"] })` is called
- **THEN** `--fork` and the session-file path SHALL appear as two separate argv elements AFTER the `--` sentinel

### Requirement: Tool registry registration for wt
The module SHALL ensure `wt` is registered in the tool registry via `packages/shared/src/tool-registry/definitions.ts` with a chain of `override → where` only (no managed fallback; wt is not part of the managed install). `wt` SHALL be treated as optional — `ToolRegistry.resolve("wt")` returning `{ ok: false }` SHALL NOT produce an error, only cause `selectMechanism` to fall through.

#### Scenario: wt absent falls through without error
- **WHEN** `ToolRegistry.resolve("wt")` returns `{ ok: false }`
- **THEN** `selectMechanism` SHALL return the next available mechanism (wsl-tmux or headless)
- **AND** no error SHALL be emitted

### Requirement: Uniform options forwarding across mechanisms
All four spawn mechanisms (`tmux`, `wt`, `wsl-tmux`, `headless`) SHALL forward `SessionOptions.sessionFile` and `SessionOptions.mode` (`"continue" | "fork"`) to the underlying pi argv uniformly. Any code path that dispatches to a mechanism SHALL pass the full `SessionOptions` object through; no branch may silently drop these fields. When `mode === "continue"`, the pi argv SHALL include `--session <sessionFile>`. When `mode === "fork"`, the pi argv SHALL include `--fork <sessionFile>`. When both `sessionFile` and `mode` are absent, the pi argv SHALL include neither flag.

#### Scenario: Fork forwarded through wt mechanism
- **WHEN** `spawnPiSession(cwd, { sessionFile: "C:\\x.jsonl", mode: "fork" })` is called on Windows with wt available
- **THEN** the `wt` argv passed to spawn SHALL include `"--fork"` followed by `"C:\\x.jsonl"`

#### Scenario: Fork forwarded through wsl-tmux mechanism
- **WHEN** `spawnPiSession(cwd, { sessionFile, mode: "fork" })` is called on Windows with only wsl-tmux available
- **THEN** the tmux command SHALL include `pi --fork <sessionFile>`

#### Scenario: Fork forwarded through headless mechanism
- **WHEN** `spawnPiSession(cwd, { sessionFile, mode: "fork" })` is called on Windows with no interactive mechanism
- **THEN** the headless spawn SHALL include `pi --mode rpc --fork <sessionFile>` argv

#### Scenario: Continue forwarded through every mechanism
- **WHEN** `spawnPiSession(cwd, { sessionFile, mode: "continue" })` is called
- **THEN** every dispatching branch SHALL include `--session <sessionFile>` in pi's argv

### Requirement: Platform override for tests
`selectMechanism` SHALL take `platform: NodeJS.Platform` as an explicit required field in its argument object. Tests SHALL invoke it with explicit values (`"win32"`, `"linux"`, `"darwin"`) without mutating `process.platform`.

#### Scenario: Tests exercise each platform branch without globals
- **WHEN** tests call `selectMechanism` with `platform: "win32"`, `"linux"`, and `"darwin"`
- **THEN** each invocation SHALL return the correct mechanism for that platform
- **AND** tests SHALL NOT use `vi.mock` or mutate `process.platform`
