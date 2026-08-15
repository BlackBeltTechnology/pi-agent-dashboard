## ADDED Requirements

### Requirement: Keeper SHALL record pi's PID in a sidecar after spawning pi

The keeper writes its own PID sidecar before spawning pi, so pi's PID cannot be present in that
file. The keeper SHALL therefore write pi's PID to a **separate** sidecar — `<sockPath>.pi-pid`
on Unix, and `pi-rpc-<sessionId>.pi-pid` in the sessions directory on Windows — immediately after
`spawnPi()` returns a live child and before logging `keeper ready`.

The filename SHALL NOT end in `.pid`. The existing Windows keeper-sidecar scan matches
`^pi-rpc-(.+)\.pid$` with a greedy group, so a name such as `pi-rpc-<sessionId>.pi.pid` would be
matched by it and misread as a keeper sidecar — producing a phantom session whose id is
`<sessionId>.pi` and whose keeper PID is actually pi's PID.

The file SHALL contain pi's PID as a bare decimal integer, matching the existing sidecar's
format. The keeper's own PID sidecar SHALL be left byte-identical to its current form, so every
existing reader — including the server's startup orphan-cleanup — is unaffected.

Presence of the file is itself the signal: absent means pi's PID is unknown; present means it was
written after a successful spawn.

If the write fails, the keeper SHALL log the failure and continue running. Pi is alive at that
point and SHALL NOT be torn down because a diagnostic file could not be written.

The keeper SHALL unlink the pi-PID sidecar in the same `shutdown()` path that unlinks its socket
and its own PID sidecar, so a terminated keeper never leaves a file naming a process it no longer
owns.

This requirement adds only `fs` writes and unlinks to `keeper.cjs`; it introduces no module
import, so the keeper remains a CommonJS file depending solely on Node built-ins.

#### Scenario: Pi PID sidecar written after a successful spawn

- **WHEN** the keeper spawns pi successfully
- **THEN** the keeper SHALL write pi's PID as a decimal integer to the pi-PID sidecar
- **AND** the keeper SHALL do so before logging `keeper ready`
- **AND** the keeper's own PID sidecar SHALL be unchanged in content and format

#### Scenario: Failed sidecar write does not kill a live pi

- **GIVEN** pi has spawned successfully
- **WHEN** writing the pi-PID sidecar throws
- **THEN** the keeper SHALL log the error
- **AND** the keeper SHALL continue running with pi alive

#### Scenario: Pi PID sidecar removed on keeper shutdown

- **WHEN** the keeper's `shutdown()` runs for any reason
- **THEN** the keeper SHALL unlink the pi-PID sidecar alongside the socket and its own PID sidecar

#### Scenario: No pi-PID sidecar is written when the spawn fails

- **WHEN** the keeper's pi spawn fails
- **THEN** the keeper SHALL NOT create a pi-PID sidecar

#### Scenario: Pi-PID sidecar is never mistaken for a keeper sidecar

- **GIVEN** a sessions directory containing both a keeper PID sidecar and a pi-PID sidecar for the same session
- **WHEN** the startup keeper scan enumerates that directory on either platform
- **THEN** the scan SHALL treat only the keeper PID sidecar as a keeper record
- **AND** the scan SHALL NOT emit a discovered keeper whose session id is derived from a pi-PID sidecar filename

## MODIFIED Requirements

### Requirement: Server reconnect to existing keepers on startup

On dashboard server startup, the server SHALL scan `~/.pi/dashboard/sessions/*.rpc.sock`
(Unix) or the equivalent named-pipe directory (Windows) for existing keepers. For each
socket / pipe found:

1. Read the keeper PID from the corresponding `.pid` sidecar.
2. Verify the keeper PID is alive (`isProcessAlive`).
3. Verify the pi PID (read from the keeper's pi-PID sidecar) is alive.
4. If both alive: register the session as RPC-dispatch-ready. The server SHALL connect to
   the socket lazily on first `dispatch_extension_command` for that session.
5. If keeper alive but pi dead: kill the keeper and unlink the socket + PID files.
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

During the scan the server SHALL populate the registry entry's `piPid` from the pi-PID sidecar
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
recorded, corrected, left unchanged, or unavailable.

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
