## MODIFIED Requirements

### Requirement: Cold start SHALL classify interrupted sessions as recovery candidates

On server cold start, for each rediscovered session, the server SHALL classify it as a recovery candidate WHEN its `.meta.json` carries `live: true` AND its persisted `status` is NOT `"ended"` AND it does NOT carry `closedReason: "manual"` AND it is NOT an automation run session (`kind: "automation"`) AND **no process-carrier proves the session is still alive**. A session is proven alive by EITHER of two liveness channels, and such a session SHALL NOT be a recovery candidate (its on-disk liveness marker SHALL be consumed so a later cold boot does not re-classify it):

- **Keeper channel (synchronous):** the startup keeper reclaim (`cleanupKeeperOrphans` / `discoverExistingKeepers` + `headlessPidRegistry`) found the session's keeper AND pi process alive. This is available before the offer is broadcast.
- **Bridge channel (asynchronous):** the session's bridge re-registers with `registerReason: "reattach"` within a bounded grace window after startup (tmux / TUI / mDNS-discovery sessions have no keeper socket to probe synchronously).

Disk markers alone are insufficient because a plain server restart (`process.exit` without a clean `stop()`) leaves a still-running session `live: true` + non-`ended`, identical on disk to a crash. The liveness gate distinguishes a surviving process (restart — do NOT offer) from a genuinely lost one (crash / full reboot — offer).

#### Scenario: Keeper-alive session is not a candidate

- **GIVEN** a `.meta.json` with `live: true` and a non-`ended` status
- **AND** the startup keeper reclaim found the session's keeper PID and pi PID both alive
- **WHEN** the server classifies sessions on cold start
- **THEN** the session SHALL NOT be a recovery candidate
- **AND** its on-disk liveness marker SHALL be consumed (`live: false`)

#### Scenario: Reattached (still-alive) session is retracted from the offer

- **GIVEN** an `ask`-mode candidate with no keeper socket (tmux / TUI / discovery bridge)
- **WHEN** its bridge re-registers with `registerReason: "reattach"` within the grace window
- **THEN** the server SHALL drop it from the pending recovery offer
- **AND** SHALL consume its on-disk liveness marker
- **AND** a client connecting afterward SHALL NOT receive it in a replayed offer

#### Scenario: Genuinely lost session is still a candidate

- **GIVEN** a `.meta.json` with `live: true` and a non-`ended` status and no `closedReason`
- **AND** no keeper reclaim found it alive AND no bridge reattaches within the grace window
- **WHEN** classification completes
- **THEN** the session SHALL be a recovery candidate and SHALL be offered (`ask`) or resumed (`auto`)

#### Scenario: Interrupted (crashed) session is a candidate

- **GIVEN** a `.meta.json` with `live: true` and a non-`ended` status (e.g. `idle`/`streaming`) and no `closedReason`
- **WHEN** the server classifies sessions on cold start
- **THEN** the session SHALL be a recovery candidate

#### Scenario: Cleanly stopped session is not a candidate

- **GIVEN** a `.meta.json` with `live: false` (idle timer / app-quit clean stop), regardless of status
- **WHEN** the server classifies sessions on cold start
- **THEN** the session SHALL NOT be a recovery candidate

#### Scenario: Cleanly unregistered session (dashboard close or pi TUI quit) is not a candidate

- **GIVEN** a `.meta.json` whose persisted `status` is `"ended"` (a clean `unregister()` ran), even if `live: true` remains set
- **WHEN** the server classifies sessions on cold start
- **THEN** the session SHALL NOT be a recovery candidate

#### Scenario: Manual close is not a candidate

- **GIVEN** a `.meta.json` carrying `closedReason: "manual"`
- **WHEN** the server classifies sessions on cold start
- **THEN** the session SHALL NOT be a recovery candidate

#### Scenario: Automation run session is never a candidate

- **GIVEN** a session whose `.meta.json` carries `live: true`, a non-`ended` status, and `kind: "automation"`
- **WHEN** the server cold-starts
- **THEN** the session SHALL NOT be a recovery candidate
- **AND** its status SHALL be normalized to `ended` like any non-candidate

#### Scenario: Pre-feature session without marker is not a candidate

- **GIVEN** a `.meta.json` that contains no `live` field
- **WHEN** the server classifies sessions on cold start
- **THEN** the session SHALL NOT be a recovery candidate

## ADDED Requirements

### Requirement: Auto mode SHALL NOT resume a session proven alive

In `auto` mode the server resumes candidates without prompting. The same liveness gate SHALL apply: a session proven alive by the keeper channel or the bridge-reattach channel SHALL NOT be auto-resumed, because a second `continue` spawn for a sessionId whose pi process is already alive double-registers the session and breaks message routing (the gateway session→connection map is last-write-wins).

#### Scenario: Auto mode skips a keeper-alive session

- **GIVEN** setting `reopenSessionsAfterShutdown = "auto"` and a candidate whose keeper+pi the startup reclaim found alive
- **WHEN** cold-start classification completes
- **THEN** the server SHALL NOT spawn a resume for that session
- **AND** SHALL rely on the existing keeper reattach (RPC-dispatch-ready) instead
