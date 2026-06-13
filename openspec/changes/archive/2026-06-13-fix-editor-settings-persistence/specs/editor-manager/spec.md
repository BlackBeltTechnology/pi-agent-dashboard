## MODIFIED Requirements

### Requirement: Spawn code-server per folder
The EditorManager SHALL spawn a code-server child process for a given folder cwd. Each folder SHALL have at most one running instance. The instance SHALL bind to `127.0.0.1` on a dynamically allocated free port. The instance SHALL use `--auth none`, `--disable-telemetry`, `--disable-update-check`, and `--user-data-dir ~/.pi/dashboard/editors/<folder-hash>/`. Before spawning, the EditorManager SHALL seed `~/.pi/dashboard/editors/<folder-hash>/User/settings.json` with persistence-friendly defaults merged with any existing values; user-set values SHALL take precedence over seeded defaults. The seeded keys SHALL include theme keys plus `window.restoreWindows: "all"`, `workbench.editor.restoreViewState: true`, `files.hotExit: "onExitAndWindowClose"`, `security.workspace.trust.enabled: false`, `update.mode: "none"`, and `extensions.autoCheckUpdates: false`.

#### Scenario: Start instance for a folder
- **WHEN** `start(cwd)` is called and no instance exists for the cwd
- **THEN** `<dataDir>/User/settings.json` SHALL be written with the seeded persistence keys merged over any existing content
- **THEN** a free port SHALL be allocated
- **THEN** code-server SHALL be spawned with `--bind-addr 127.0.0.1:<port>` and `--user-data-dir` based on a hash of the cwd
- **THEN** the manager SHALL wait until the port is accepting connections (ready probe)
- **THEN** it SHALL return `{ id, port, status: "ready" }`

#### Scenario: User customization preserved across spawns
- **WHEN** `<dataDir>/User/settings.json` already contains `"security.workspace.trust.enabled": true` from a prior user edit
- **AND** `start(cwd)` is called again for that cwd
- **THEN** the resulting `settings.json` SHALL retain `"security.workspace.trust.enabled": true`
- **THEN** other seeded keys absent from the existing file SHALL be added

#### Scenario: Instance already exists
- **WHEN** `start(cwd)` is called and an instance is already running for the cwd
- **THEN** the existing instance's `{ id, port }` SHALL be returned without spawning a new process

#### Scenario: Concurrent start for the same folder
- **WHEN** two or more `start(cwd)` calls for the same cwd are in flight before the first has registered its instance (e.g. multiple browser tabs/iframes opening the same folder, or post-restart heartbeat re-starts)
- **THEN** at most one code-server keeper SHALL be spawned for that cwd
- **THEN** all concurrent callers SHALL resolve to the same `{ id, port }` instance
- **THEN** no duplicate code-server SHALL be started against the same `--user-data-dir`

### Requirement: Stop instance
The EditorManager SHALL support stopping a running instance via SIGTERM, allowing up to 5 seconds for the child to exit gracefully before escalating to SIGKILL of the process group. On process exit, all tracking state SHALL be cleaned up.

#### Scenario: Stop running instance flushes state
- **WHEN** `stop(id)` is called for a running instance
- **THEN** SIGTERM SHALL be sent to the code-server process
- **THEN** the manager SHALL wait up to 5 seconds for graceful exit before SIGKILL escalation
- **THEN** the instance SHALL be removed from tracking after exit

#### Scenario: Stop non-existent instance
- **WHEN** `stop(id)` is called for an unknown id
- **THEN** no error SHALL be thrown
