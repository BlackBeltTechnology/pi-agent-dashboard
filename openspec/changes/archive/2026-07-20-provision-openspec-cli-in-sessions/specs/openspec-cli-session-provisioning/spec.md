## ADDED Requirements

### Requirement: Bridge SHALL make the openspec CLI resolvable in-session

The bridge extension SHALL ensure that, for any pi session it runs in, the
`openspec` CLI is resolvable by bare name from the session's shell environment,
without editing the generated `openspec-*` skills and without requiring a global
install. It SHALL achieve this by placing an `openspec` executable in a dedicated
directory and prepending that directory to the session process's `PATH` so that
`getShellEnv()` (which reads live `process.env`) hands it to every bash child.

#### Scenario: Bare openspec resolves after bridge init on a CLI-less machine

- **WHEN** the bridge initializes in a session on a machine with no `openspec` on
  the pre-existing PATH
- **THEN** a subsequent bash command running `openspec --version` SHALL resolve and
  execute the pinned CLI
- **AND** the generated `openspec-apply-change` skill's bare `openspec` calls SHALL
  succeed rather than degrade to hand-editing artifacts

#### Scenario: Shim resolves to the pinned CLI, offline

- **WHEN** the shim's `openspec` is invoked
- **THEN** it SHALL execute the `@fission-ai/openspec` resolved for the extension
  at the single-source version (see `openspec-cli-version-single-source`; `1.6.0`),
  lockfile-resolved, requiring no network fetch and no `npx`-latest download
- **AND** `openspec --version` SHALL report the single-source version (`1.6.0`)

### Requirement: PATH prepend SHALL be idempotent and non-destructive

The bridge SHALL prepend its shim directory to `PATH` at most once per process and
SHALL NOT remove, reorder, or shadow unrelated existing PATH entries. A pre-existing
`openspec` earlier on PATH (e.g. a user's global install) is acceptable to leave in
place; the requirement is only that *some* `openspec` resolves.

#### Scenario: Re-init does not duplicate the PATH entry

- **WHEN** the bridge init runs more than once in the same process (e.g. `/reload`)
- **THEN** the shim directory SHALL appear at most once in `PATH` (compared by
  canonicalized/realpath form)

#### Scenario: Re-init refreshes the shim target

- **WHEN** the bridge init runs after the pinned CLI's resolved path has changed
  (e.g. extension upgrade)
- **THEN** the shim SHALL be re-pointed to the current resolved bin (not left
  stale), written atomically (temp-file + rename)

#### Scenario: Existing global openspec is preserved

- **WHEN** the machine already has a global `openspec` on PATH
- **THEN** the bridge SHALL NOT break that resolution and bare `openspec` SHALL
  still resolve to a working CLI

### Requirement: Shim SHALL be cross-platform via the bash shell

The bash tool always executes through a shell (POSIX `sh` / Git Bash `bash.exe -c`
on Windows). The shim SHALL therefore be an **extensionless** shell-resolvable
script (not a `.cmd`, which Git Bash ignores as it does not consult PATHEXT), and
SHALL invoke the pinned bin through an absolute `node` path (`process.execPath`) so
it resolves under a stripped system PATH.

#### Scenario: Windows (Git Bash) resolution

- **WHEN** the session runs on Windows and the bash tool invokes `openspec` via
  `bash.exe -c`
- **THEN** the extensionless shim SHALL resolve and execute the pinned CLI without
  requiring `node` on the pre-existing PATH

### Requirement: Provisioning SHALL fail soft and surface visibly

If the pinned bin cannot be resolved or the shim cannot be written, the bridge
SHALL NOT crash init. It SHALL **always log** a diagnostic AND, on a hard failure,
**emit a dashboard-visible `missingTool`-style signal** (repo convention
`register-bash-and-tool-install-help`) so the failure is seen rather than leaving
the session silently unprovisioned.

#### Scenario: Resolution failure does not crash init

- **WHEN** `require.resolve` for the pinned CLI throws (unexpected install layout)
- **THEN** bridge init SHALL continue and skip the PATH prepend — not throw
- **AND** a diagnostic SHALL be logged
- **AND** a dashboard-visible `missingTool`-style signal SHALL be emitted
