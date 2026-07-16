## ADDED Requirements

### Requirement: Synchronous spawn-env injection with bare-interpreter fallback
`augmentEnvWithPythonSource` SHALL be a synchronous function wired into the same spawn-env injection points as the bundled-git seam (`ToolResolver.buildSpawnEnv` and the terminal PTY path). It SHALL prepend the platform-correct venv bindir when the overlay exists and its `.py-stamp` matches the bundled interpreter version; otherwise it SHALL prepend the bare bundled interpreter bindir (present in resources immediately) and fire a non-blocking materialization trigger. It SHALL never block on or await materialization.

#### Scenario: python resolves before any venv exists
- **WHEN** a bash tool call runs `python --version` before materialization has completed
- **THEN** `python` resolves via the bare bundled interpreter and prints a version

#### Scenario: Ready overlay is preferred when stamp matches
- **WHEN** a tool call spawns and the overlay exists with a matching stamp
- **THEN** the overlay bindir is prepended to PATH and `VIRTUAL_ENV` points at the overlay

#### Scenario: Stale overlay is rejected after an update
- **WHEN** the overlay exists but its stamp does not match the bundled interpreter version
- **THEN** the seam prepends the bare interpreter bindir instead of the stale overlay
- **AND** a background rebuild is triggered

#### Scenario: Injection applies to both spawn paths
- **WHEN** a session is spawned via `buildSpawnEnv` and separately a terminal is spawned via the PTY path
- **THEN** both child environments have the Python bindir prepended to PATH

### Requirement: All-platform activation
Python source injection SHALL be active on macOS, Linux, and Windows (unlike the win32-only git seam). The platform-correct bindir SHALL be `Scripts` on Windows and `bin` on POSIX so `python`/`pip` resolve via the same PATHEXT logic used for git.

#### Scenario: Windows resolves python.exe from Scripts
- **WHEN** injection runs on Windows
- **THEN** the prepended bindir is the venv `Scripts` directory containing `python.exe`

#### Scenario: POSIX resolves python from bin
- **WHEN** injection runs on macOS or Linux
- **THEN** the prepended bindir is the venv `bin` directory containing `python`

### Requirement: Minimal spawn-env surface; UV_* confined to materialization
The spawn-env seam SHALL inject only `PATH`, `VIRTUAL_ENV`, and `SSL_CERT_FILE` (the interpreter's own CA bundle). `UV_*` variables SHALL be passed only to the materialization subprocess and SHALL NOT appear in spawned child environments.

#### Scenario: No UV_* leakage into children
- **WHEN** a session or terminal child is spawned with Python injection active
- **THEN** the child environment contains no `UV_*` variables
- **AND** it contains `SSL_CERT_FILE` pointing at the interpreter's CA bundle

#### Scenario: Agent pip install uses the interpreter CA store
- **WHEN** an agent runs `python -m pip install <pkg>` over HTTPS
- **THEN** TLS verification uses the interpreter's bundled CA bundle via `SSL_CERT_FILE`

### Requirement: Tri-state pythonSource config defaulting to bundled
Config SHALL expose `pythonSource: auto | host | bundled` defaulting to `bundled` on all platforms; `host` is an opt-in escape hatch. When bundled resources are absent, the seam SHALL no-op like the git seam and fall back to host Python if present.

#### Scenario: Default resolves to bundled
- **WHEN** `pythonSource` is unset
- **THEN** the resolved source is `bundled` on macOS, Linux, and Windows

#### Scenario: Host opt-in
- **WHEN** `pythonSource` is `host`
- **THEN** the seam does not prepend the bundled env and host Python is used when present

### Requirement: Doctor readout for the Python runtime
Doctor SHALL expose `getPythonSourceReadout` reporting source+setting, interpreter version, venv path + stamp match, baseline satisfied count, last install status, and pip network reachability.

#### Scenario: Readout surfaces env health
- **WHEN** Doctor runs with the bundled Python active
- **THEN** it reports the interpreter version, whether the overlay stamp matches, whether the baseline is satisfied, and whether pip can reach the network
