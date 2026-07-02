## MODIFIED Requirements

### Requirement: Node-script executors spawn without shebang interpreter dependency

Managed Node-script executors (`openspec`, `pi`) SHALL be spawnable without relying on a `#!/usr/bin/env node` shebang finding a `node` binary on the child process's PATH. The registry's `toArgv` for these executors SHALL supply the Node interpreter explicitly (resolving the `.js` entry point plus a resolved `node`), OR the spawn environment SHALL be guaranteed to contain a real `node` bin directory. This behavior SHALL hold on unix (macOS/Linux) with parity to the existing Windows node-wrap, so a GUI-launched (Electron) server with a stripped PATH can still execute the CLI.

#### Scenario: Unix openspec spawn with a stripped child PATH

- **WHEN** the dashboard server spawns `openspec` on unix from a process whose PATH contains no binary named `node` (e.g. an Electron-launched server under `ELECTRON_RUN_AS_NODE`)
- **THEN** the resolved spawn argv SHALL invoke a real `node` interpreter against the resolved `bin/openspec.js` (not the bare `.bin/openspec` shebang symlink), OR the spawn env SHALL include a real `node` bin directory
- **AND** the CLI SHALL execute successfully instead of failing with exit 127 / `env: node: No such file or directory`

#### Scenario: Windows node-wrap parity preserved

- **WHEN** the same executor is resolved on Windows to a `.js` entry point
- **THEN** the existing `[node.exe, script.js]` node-wrap SHALL remain in effect with no regression
