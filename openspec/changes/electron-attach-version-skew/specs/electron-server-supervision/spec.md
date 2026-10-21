## MODIFIED Requirements

### Requirement: Zombie server detection and adoption

The app SHALL detect a reachable server that is an orphan of a prior Electron lifetime and offer the user adoption, leaving it running, or stopping it. When the zombie is also version-skewed (its `/api/health.version` differs from the expected runtime version), the stop choice SHALL be presented as a restart into the expected runtime, performed as specified by `electron-shell` "Version-skew restart is graceful, verified and fail-closed".

#### Scenario: Zombie detection on POSIX
- **WHEN** the reachable server reports `launchSourceEffective === "electron"`, was not spawned this lifetime, has been reparented away from its boot parent, and its boot parent is no longer alive
- **THEN** the server is classified as a zombie

#### Scenario: Zombie detection on Windows
- **WHEN** the reachable server reports `launchSourceEffective === "electron"`, was not spawned this lifetime, and its boot parent is no longer alive
- **THEN** the server is classified as a zombie

#### Scenario: Adoption prompt choices
- **WHEN** a zombie is detected on the attach path and its version matches the expected runtime version, or either version is unknown
- **THEN** the app presents a modal offering Take ownership, Leave running, and Stop now, with Leave running as the default and the Esc/close (cancel) action

#### Scenario: Stop a zombie
- **WHEN** the user chooses to stop the zombie
- **THEN** the app sends SIGTERM, polls up to the timeout for the process to exit, and sends SIGKILL if still alive
- **AND** reports the server as gone only after a liveness probe confirms the PID no longer exists ("permission denied" counts as alive)

#### Scenario: Zombie that cannot be stopped
- **WHEN** the zombie PID still exists after SIGKILL and the bounded wait
- **THEN** the app reports that the server could not be stopped and does not spawn a replacement

#### Scenario: Adoption prompt choices for a skewed zombie
- **WHEN** a zombie is detected on the attach path and its version differs from the known expected runtime version
- **THEN** the app presents one modal offering Restart with v<expected>, Take ownership, and Leave running, with Restart with v<expected> as the default and Leave running as the Esc/close (cancel) action
- **AND** Restart with v<expected> follows `electron-shell` "Version-skew restart is graceful, verified and fail-closed"
