## ADDED Requirements

### Requirement: Opt-in CDP debug surface

The Electron main process SHALL accept an opt-in activation that exposes Chromium's Chrome DevTools Protocol (CDP) on a loopback port for the lifetime of the app instance. Activation SHALL require an explicit CLI flag (`--debug-cdp[=<port>]`) or environment variable (`PI_DEBUG_CDP=<value>`). Default behavior with no flag and no env var SHALL be CDP-disabled.

The activated port SHALL default to `9222`. A non-default port MAY be supplied via `--debug-cdp=<port>` or `PI_DEBUG_CDP=<port>`. When `PI_DEBUG_CDP=1` (truthy non-port value) is supplied without an explicit port, the default `9222` SHALL apply. When both CLI flag and env var are present, the CLI flag SHALL take precedence.

When activated, the main process SHALL append Chromium's `remote-debugging-port` command-line switch via `app.commandLine.appendSwitch('remote-debugging-port', <port>)` before any code path that materializes Chromium state (specifically: before `app.whenReady()` resolves and before the first `BrowserWindow` is created).

The main process SHALL NOT append `remote-debugging-address`. Chromium's default loopback (`127.0.0.1`) binding SHALL apply, restricting CDP to local clients.

#### Scenario: Default — CDP disabled

- **WHEN** the Electron app is launched without `--debug-cdp` and without `PI_DEBUG_CDP` set
- **THEN** Chromium SHALL NOT expose any CDP HTTP endpoint
- **AND** `app.commandLine.hasSwitch('remote-debugging-port')` SHALL return `false`

#### Scenario: CLI flag with default port

- **WHEN** the Electron app is launched with `--debug-cdp` (no `=<port>`)
- **THEN** the main process SHALL call `app.commandLine.appendSwitch('remote-debugging-port', '9222')` before `app.whenReady()`

#### Scenario: CLI flag with explicit port

- **WHEN** the Electron app is launched with `--debug-cdp=9333`
- **THEN** the main process SHALL call `app.commandLine.appendSwitch('remote-debugging-port', '9333')`

#### Scenario: Env var activates default port

- **WHEN** the Electron app is launched with `PI_DEBUG_CDP=1` and no CLI flag
- **THEN** the main process SHALL call `app.commandLine.appendSwitch('remote-debugging-port', '9222')`

#### Scenario: Env var supplies explicit port

- **WHEN** the Electron app is launched with `PI_DEBUG_CDP=9444` and no CLI flag
- **THEN** the main process SHALL call `app.commandLine.appendSwitch('remote-debugging-port', '9444')`

#### Scenario: CLI flag overrides env var

- **WHEN** the Electron app is launched with both `--debug-cdp=9555` and `PI_DEBUG_CDP=9777`
- **THEN** the main process SHALL use port `9555`

#### Scenario: Never binds promiscuously

- **WHEN** CDP is activated by any means
- **THEN** the main process SHALL NOT call `app.commandLine.appendSwitch('remote-debugging-address', ...)`
- **AND** there SHALL be no CLI flag, env var, or config field that causes such an append to occur

### Requirement: Activation logs a warning

When CDP is activated, the main process SHALL log a single-line warning to stderr at startup making the activation visible to the user. The warning SHALL include the port number and indicate that local automation is enabled.

#### Scenario: Warning emitted on activation

- **WHEN** the Electron app is launched with CDP activated
- **THEN** stderr SHALL contain a log line matching the form `[debug-cdp] CDP listening on :<port> — local automation is enabled` (or equivalent prose with the same elements: tag, port, intent)

#### Scenario: No warning when disabled

- **WHEN** the Electron app is launched without CDP activation
- **THEN** stderr SHALL NOT contain any `[debug-cdp]` log line

### Requirement: Single-instance-lock interaction

The CDP debug surface SHALL be enabled only at first-instance launch. The dashboard's existing single-instance lock SHALL continue to apply: a second launch with `--debug-cdp` (or `PI_DEBUG_CDP`) while a first instance is already running SHALL NOT retroactively enable CDP on the first instance.

When the single-instance second-instance hook is invoked with `--debug-cdp` present in the second instance's argv and the first instance was launched without CDP, the first instance SHALL log a single warning line to its stderr explaining that CDP enablement requires fully quitting and relaunching.

#### Scenario: Second launch with flag against running app

- **WHEN** a first instance is running without CDP and a second launch is invoked with `--debug-cdp`
- **THEN** the second-instance hook SHALL log a warning to the first instance's stderr indicating that CDP cannot be enabled retroactively
- **AND** the first instance SHALL NOT open a CDP port
- **AND** the second-instance process SHALL exit normally (per existing single-instance behavior)

#### Scenario: Second launch without flag against CDP-enabled app

- **WHEN** a first instance is running with CDP enabled and a second launch is invoked without `--debug-cdp`
- **THEN** behavior SHALL be unchanged from existing single-instance handling
- **AND** the first instance's CDP port SHALL remain open
