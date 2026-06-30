## ADDED Requirements

### Requirement: Bridge reports its session's pi version

The bridge SHALL report the pi-coding-agent version of the process it runs inside, per session, via a `{ type: "pi_version_update", sessionId, version }` message to the server. The version SHALL be read from inside the bridge's own process (`createRequire(import.meta.url).resolve("@earendil-works/pi-coding-agent/package.json")` + `readFileSync`), which is the ground-truth pi for that session — distinct from the server-side `readCurrentPiVersion()` read that drives the global `/api/health.compatibility` advisory.

The bridge SHALL send the message once when the session registers, and again whenever a later read yields a version different from the last value sent (including after an out-of-band pi upgrade). A module-scoped `lastPiVersion` SHALL suppress redundant sends, including across reconnect. The version re-read SHALL piggyback on the existing git/model poll tick (`runGitPollTick`, 30s) — no dedicated timer.

A read failure SHALL log a warning and skip the send without crashing the bridge or interrupting the heartbeat; the next tick retries.

#### Scenario: Push at session register
- **WHEN** the bridge registers a session against pi 0.80.2
- **THEN** the bridge SHALL send `{ type: "pi_version_update", sessionId, version: "0.80.2" }`

#### Scenario: No push when version unchanged
- **WHEN** a poll tick re-reads the same version already sent
- **THEN** no `pi_version_update` SHALL be sent

#### Scenario: Push after out-of-band upgrade
- **WHEN** the user runs `pi update --self` so the bridge's process now resolves to a newer pi version
- **AND** the next poll tick fires
- **THEN** the bridge SHALL send `pi_version_update` with the new version

#### Scenario: Read failure is silent
- **WHEN** the pi version read throws
- **THEN** the bridge SHALL log a warning, skip the send, and keep the poll loop running

#### Scenario: Reconnect does not redundantly push
- **WHEN** the bridge reconnects against the same pi version it last sent
- **THEN** no `pi_version_update` SHALL be sent because `lastPiVersion` is unchanged

### Requirement: Server stores and broadcasts reported pi version

On receipt of `pi_version_update`, the server SHALL store `version` as `DashboardSession.piVersion` for that session and broadcast a session update to subscribed browsers, mirroring the `git_info_update` handling. Older bridges that never send the message SHALL leave `piVersion` undefined; no client behaviour depends on its presence beyond an optional read-only display in the session header.

#### Scenario: Stored and broadcast
- **WHEN** the server receives `{ type: "pi_version_update", sessionId, version: "0.80.2" }`
- **THEN** the session record's `piVersion` SHALL become `"0.80.2"`
- **AND** a session-updated broadcast carrying `{ piVersion: "0.80.2" }` SHALL be sent to that session's browser subscribers
