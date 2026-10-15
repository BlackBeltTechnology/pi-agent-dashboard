## MODIFIED Requirements

### Requirement: Provenance-scoped lifecycle marker

The dashboard SHALL distinguish machine-fronted sessions from interactive coding sessions
via a session-record marker. `SessionSource` SHALL gain the value `"embed"`, and
`DashboardSession` SHALL gain an orthogonal `lifecyclePolicy?: "ephemeral" | "durable"`.
An absent `lifecyclePolicy` SHALL be treated as `"durable"`. Idle reaping and active-session
caps SHALL act ONLY on sessions whose effective policy is `"ephemeral"`; `"durable"`
sessions SHALL retain their existing forever-alive semantics. One exception applies to idle
reaping only: a session whose spawning plugin declared a close policy with an idle threshold
(capability `plugin-session-close-hook`) SHALL be governed by idle reaping — all three gears
(idle, stop-after-turn, phantom) — with its declared idle threshold, regardless of its
`lifecyclePolicy`; the requirements "Idle reaping gated on a lossless quiescence predicate",
"Graceful mid-turn stop for idle-trending sessions" and "Phantom-liveness escape hatch"
SHALL apply to such a declared session wherever they say an `ephemeral` session. Declared sessions SHALL NOT be
counted against or reclaimed by active-session caps unless they are also `ephemeral`.
The marker SHALL be settable by any front that spawns sessions (embed widget, chat gateway,
automation), not embed only. The `lifecyclePolicy` marker SHALL be persisted to the session's
`.meta.json` and restored on cold-start rehydration, so a server restart never reclassifies
an `ephemeral` session as `durable`.

#### Scenario: Durable sessions are never reaped or capped
- **WHEN** the lifecycle feature is enabled and a `tui` / `dashboard` / `durable` session
  with no plugin-declared close policy sits idle past the configured idle timeout
- **THEN** the reaper SHALL NOT reap it
- **AND** it SHALL NOT count against any per-visitor or global embedded-session cap

#### Scenario: Absent policy defaults to durable
- **WHEN** a session (older bridge, or a persisted `.meta.json` predating this change) has
  no `lifecyclePolicy` field
- **THEN** the server SHALL treat it as `"durable"`
- **AND** no migration SHALL be required for it to load

#### Scenario: Any front may mark a session ephemeral
- **WHEN** the embed widget, the chat gateway, or an automation trigger spawns a session
  and requests `lifecyclePolicy:"ephemeral"`
- **THEN** the session SHALL be governed by reaping and caps regardless of its `source`

#### Scenario: Ephemeral marker survives a server restart
- **WHEN** an `ephemeral` session is persisted and the server restarts and rehydrates
  sessions from disk
- **THEN** the session SHALL be restored as `ephemeral` (not reclassified to `durable`)
- **AND** it SHALL remain eligible for reaping and caps after the restart

#### Scenario: Declared durable session is reaped but not capped
- **WHEN** a session with no `lifecyclePolicy` was spawned with a plugin-declared idle
  threshold and satisfies every quiescence condition past that threshold
- **THEN** the reaper SHALL reap it
- **AND** it SHALL NOT count against any active-session cap

### Requirement: Disabled by default and version-floor safe

The lifecycle feature SHALL be disabled by default; with it disabled, no reaping of
`ephemeral` sessions, no caps, and no server-side reuse SHALL occur and existing behavior
SHALL be unchanged. Sessions with a plugin-declared close policy SHALL be idle-reaped whether
or not the feature is enabled, because the plugin's declaration is itself the opt-in; with no
such declaration present, behavior with the feature disabled SHALL be observably unchanged.
The mechanism SHALL operate at the current pi compatibility floor without a floor bump,
consuming the bridge-normalized `agent_settled` signal with no per-session `piVersion` branch
in the reaper.

#### Scenario: No behavior change on upgrade
- **WHEN** the dashboard is upgraded, the lifecycle feature is left at its default
  (disabled), and no plugin declares a close policy
- **THEN** no session SHALL be reaped or capped and acquire SHALL not alter spawn behavior

#### Scenario: Declared session reaped while the feature is disabled
- **WHEN** the lifecycle feature is disabled and a plugin-declared session is quiescent past
  its declared idle threshold
- **THEN** the reaper SHALL reap that session
- **AND** no `ephemeral` session SHALL be reaped

#### Scenario: Quiescence gate reads a version-agnostic settle signal
- **WHEN** a connected session runs any supported pi (the current compatibility floor
  through the bundled version)
- **THEN** the reaper SHALL determine "at rest" from exactly one `agent_settled` per run
  without branching on the session's pi version
