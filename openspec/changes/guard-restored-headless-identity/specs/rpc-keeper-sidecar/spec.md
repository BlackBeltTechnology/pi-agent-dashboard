## MODIFIED Requirements

### Requirement: Server reconnect to existing keepers on startup

On dashboard server startup, the server SHALL scan `~/.pi/dashboard/sessions/*.rpc.sock`
(Unix) or the equivalent named-pipe directory (Windows) for existing keepers. For each
socket / pipe found:

1. Read the keeper PID from the corresponding `.pid` sidecar.
2. Verify the keeper PID is alive (`isProcessAlive`).
3. Verify the pi PID (read from the keeper's pi-PID sidecar) is alive.
4. If both alive, and the keeper pid does not fail verification as a mismatch (`headless-spawn` *Headless spawn cleanup tracks keeper PIDs*): register the session as RPC-dispatch-ready. The server SHALL connect to
   the socket lazily on first `dispatch_extension_command` for that session.
5. If keeper alive but pi dead: kill the keeper and unlink the socket + PID files, only after the keeper pid verifies against its pid sidecar's mtime (`headless-spawn` *Headless spawn cleanup tracks keeper PIDs*); otherwise log and leave the files.
6. If keeper dead but pi alive: kill pi, unlink files (this state is unreachable in normal
   operation but defensive).
7. If both dead: unlink files.

Step 3 SHALL be a real liveness check. It is currently inert because the keeper manager is
constructed without an `isPiAliveForSession` probe, so the default `() => true` is used. The
probe SHALL read the pi-PID sidecar from the sessions directory and test that PID for liveness,
and SHALL be the keeper manager's default rather than an injected dependency, because it must
answer for discovered keepers that have **no** reclaimed registry entry, which the registry cannot
speak for.

The probe SHALL return "alive" when the sidecar is absent or unparseable, and "dead" only for a
present, parseable PID that is not live. Step 3 gates a destructive branch (kill the keeper,
unlink its files); a keeper whose sidecar write failed, or which predates this change, is healthy
and SHALL NOT be terminated on the basis of a missing file.

During the scan the server SHALL populate the registry entry's `piPid` from the pi-PID sidecar, only when that pid verifies against the sidecar's mtime,
when the entry has none, SHALL leave an existing `piPid` untouched, and SHALL leave the entry
unchanged when the sidecar is absent or unparseable. The server SHALL NOT derive pi's PID from a
process-tree enumeration, a cwd, or a process name.

To make that possible, the discovery result for each keeper SHALL carry the pi PID read from the
sidecar alongside the existing session id, keeper PID, and socket path. The existing consumer
SHALL be restructured so this value is applied to entries that already carry a keeper PID:
today it acts only on entries whose keeper PID is unset, which excludes every reclaimed entry —
the primary population — and would otherwise leave this requirement inert.

The session id carried by a discovery result is the keeper's **transport** id, not pi's session
UUID. Consumers SHALL associate a result with a registry entry via the keeper PID, and SHALL NOT
assume the two id spaces are interchangeable.

#### Scenario: Missing sidecar does not terminate a healthy keeper

- **GIVEN** a live keeper with a live pi and no pi-PID sidecar
- **WHEN** the startup scan evaluates step 3 for that session
- **THEN** the scan SHALL treat pi as alive
- **AND** the keeper SHALL NOT be sent SIGTERM
- **AND** the socket and PID sidecar SHALL NOT be unlinked

#### Scenario: Discovery fills piPid on a reclaimed entry

- **GIVEN** a reclaimed registry entry that already carries a keeper PID and has no `piPid`
- **AND** a readable pi-PID sidecar naming a live PID for that keeper
- **WHEN** the startup scan runs
- **THEN** the server SHALL record that PID on the entry

The server SHALL emit a diagnostic per discovered keeper recording whether the pi PID was
recorded, left unchanged, or unavailable.

#### Scenario: Both keeper and pi alive across server restart

- **WHEN** the dashboard server starts and finds `<sid>.rpc.sock` with PID `K` (alive) and a pi-PID sidecar naming a live PID `P`
- **THEN** the server SHALL register session `<sid>` as RPC-dispatch-ready
- **AND** the server SHALL NOT spawn a new keeper for this session

#### Scenario: Keeper alive but pi dead (orphan keeper)

- **WHEN** the dashboard server finds `<sid>.rpc.sock` with PID `K` (alive) but the pi PID for that session is dead
- **THEN** the server SHALL send SIGTERM to `K`
- **AND** the server SHALL unlink the socket file and both PID sidecars
- **AND** the server SHALL NOT register session `<sid>` for RPC dispatch

#### Scenario: Both keeper and pi dead (stale socket)

- **WHEN** the dashboard server finds `<sid>.rpc.sock` with a `.pid` sidecar containing PID `K` that is no longer alive
- **THEN** the server SHALL unlink the socket file and both PID sidecars
- **AND** the server SHALL NOT register session `<sid>`

#### Scenario: Missing pi-PID sidecar degrades to today's behaviour

- **GIVEN** a live keeper spawned before this change, with no pi-PID sidecar
- **WHEN** discovery runs
- **THEN** the server SHALL leave the entry's `piPid` unchanged
- **AND** the diagnostic SHALL record the pi PID as unavailable
- **AND** the session SHALL otherwise be handled exactly as before this change

#### Scenario: A recycled keeper pid is not registered dispatch-ready

- **GIVEN** a keeper pid sidecar whose pid is alive but fails verification as a mismatch, and a live pi pid
- **WHEN** discovery runs
- **THEN** the session SHALL NOT be registered as RPC-dispatch-ready
- **AND** no signal SHALL be sent and the sidecars SHALL stay in place
