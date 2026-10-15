# plugin-session-close-hook Specification

## Purpose
Let a dashboard plugin opt the sessions it spawns into core's quiescence-gated idle close, veto an idle close, and request a safe close for its own domain events — while every plugin that does not opt in keeps today's behavior on every close path.

## Requirements

### Requirement: Opt-in plugin close policy on spawn

A trusted plugin's spawn lifecycle declaration SHALL accept an optional `close` block with an optional idle threshold (`idle.afterMs`, a finite integer of at least 1000 milliseconds) and an optional close mode (`"sleep"` default, or `"archive"`). A session with a recorded close policy is *declared*; a declared session whose policy has an idle threshold is *governed* by the idle reaper. The declaration SHALL be recorded on the session at its first register together with the id of the declaring plugin, SHALL be persisted with the session, and SHALL be restored after a server restart. Whether a session is governed, its threshold and its mode SHALL derive only from the declared fields, never from `pluginRef` contents or a plugin name; the declaring plugin's id SHALL be used only to route that plugin's closer and to authorize its close requests. A `pluginRef` body SHALL NOT be able to set or alter the close policy. A `close` block from an untrusted plugin SHALL be ignored. An invalid `close` block (`afterMs` not a finite integer, or below 1000; unknown `mode`) SHALL be ignored with a warning naming the plugin id and spawn token, and the session SHALL behave as undeclared.

#### Scenario: Declared session is governed by the idle reaper
- **WHEN** a plugin spawns a session with `close: { idle: { afterMs: 1800000 } }` and the global embedded-lifecycle feature is disabled
- **THEN** the idle reaper SHALL evaluate that session with a 30-minute idle threshold
- **AND** no other session's reaping behavior SHALL change

#### Scenario: Declaration survives a restart
- **WHEN** a session with a declared close policy is persisted and the server restarts
- **THEN** the restored session SHALL carry the same idle threshold, mode and declaring plugin id

#### Scenario: Invalid declaration is ignored
- **WHEN** a plugin declares `close: { idle: { afterMs: 0 } }`
- **THEN** the session SHALL NOT be governed by the reaper because of that declaration
- **AND** a warning naming the plugin id and spawn token SHALL be logged

#### Scenario: Close policy cannot be forged through pluginRef
- **WHEN** a plugin files a `pluginRef` body containing a `closePolicy` key
- **THEN** the key SHALL be dropped and the session's close policy SHALL come only from the lifecycle declaration

#### Scenario: Untrusted plugin cannot declare
- **WHEN** an untrusted plugin spawns with a `close` block
- **THEN** the session SHALL be undeclared

### Requirement: Undeclared sessions keep today's behavior

A session whose spawn declared no `close` block SHALL be closed, kept, reaped and finalized exactly as before this change on every path, and a plugin that registers no closer and never calls `requestSessionClose` SHALL observe no behavior change.

#### Scenario: Existing plugin unaffected
- **WHEN** a plugin spawns sessions with only `recover`, `finalizeOnSocketClose`, `hidden` or `archiveOnEnd`
- **THEN** those sessions SHALL be reaped, finalized and ended exactly as before this change

#### Scenario: Interactive session never reaped by this capability
- **WHEN** a user-started session (no plugin declaration) sits idle past any declared threshold
- **THEN** it SHALL NOT be reaped

### Requirement: Plugin closer consulted on the idle reaper path

A trusted plugin SHALL be able to register one session closer, during its activation. When the idle reaper decides to close a governed session declared by that plugin, core SHALL first ask the closer, passing only the session id, cwd, reap reason and idle duration (never other plugins' refs or the session owner identity), and SHALL close only on a `"close"` verdict. A session whose close its declaring plugin requested SHALL NOT be sent to the closer. Total closer time per sweep SHALL be bounded; candidates not asked within the bound SHALL be deferred to the next sweep, not closed. A `"keep"` verdict SHALL skip that session for the current sweep only. A closer that throws, returns an unknown value, or does not answer within 1 second SHALL be treated as `"keep"` and SHALL be logged and counted. When the declaring plugin has no closer registered, the verdict SHALL be `"close"`. A closer SHALL never be consulted for a session declared by another plugin or for an undeclared session.

#### Scenario: Closer keeps a session
- **WHEN** a declared session is idle-reapable and its plugin's closer returns `"keep"`
- **THEN** the session SHALL NOT be closed in that sweep
- **AND** it SHALL be re-evaluated in the next sweep

#### Scenario: Failing closer does not close
- **WHEN** the closer throws or does not answer within 1 second
- **THEN** the session SHALL NOT be closed in that sweep
- **AND** a warning and a closer-failure count SHALL be recorded

#### Scenario: No closer registered
- **WHEN** a declared session is idle-reapable and its plugin registered no closer
- **THEN** the session SHALL be closed

#### Scenario: Closer isolation
- **WHEN** plugin X has a closer and a session declared by plugin Y is idle-reapable
- **THEN** plugin X's closer SHALL NOT be called for it

### Requirement: Closer not consulted on other close paths

User-initiated shutdown, the spawn-register watchdog, socket-close finalization, heartbeat expiry and a plugin's own `abortSpawnedRun` SHALL NOT consult any closer and SHALL behave as before this change. Active-session caps reclaim SHALL NOT close a declared session.

#### Scenario: User shutdown is never vetoed
- **WHEN** a user shuts down a declared session whose closer would return `"keep"`
- **THEN** the session SHALL be shut down

#### Scenario: Never-registered spawn is still reclaimed
- **WHEN** a declared spawn never registers and the spawn-register watchdog fires
- **THEN** the process SHALL be reclaimed without consulting any closer

### Requirement: Plugin-requested close

A trusted plugin SHALL be able to request the close of a session it declared, with a reason and a timing of `"now"` or `"idle"`. `"now"` SHALL end the session through the graceful kill path immediately. `"idle"` SHALL end it at the next sweep in which every reaper veto other than idle age is clear (no watcher, outside grace window, at rest, no tool, no pending `ask_user`, empty queues, no live child or terminal). The request SHALL NOT consult a closer. A request for a session the plugin did not declare, an unknown or already-ended session, or with a `when` value other than `"now"`/`"idle"` SHALL have no effect, SHALL report failure, and SHALL log one warning. An `"idle"` request SHALL stay in force across later activity (a new prompt or turn) and SHALL close the session at its next quiet point. An `"idle"` request SHALL NOT persist across a server restart.

#### Scenario: Close now
- **WHEN** a plugin requests `when:"now"` for a session it declared
- **THEN** the session SHALL be ended through the graceful kill path

#### Scenario: Close when idle waits for a pending question
- **WHEN** a plugin requests `when:"idle"` for a declared session that has an unanswered `ask_user`
- **THEN** the session SHALL NOT be closed while the question is pending
- **AND** it SHALL be closed at the first sweep after the question is answered and the session is at rest with no watcher

#### Scenario: Foreign session refused
- **WHEN** a plugin requests a close for a session declared by another plugin, or an undeclared session
- **THEN** nothing SHALL be closed and the request SHALL report failure

### Requirement: Close mode

A session closed through this capability (idle reap or plugin-requested) SHALL keep its history and stay resumable. Mode `"sleep"` SHALL do nothing further. Mode `"archive"` SHALL mark the session archive-on-end so it is archived after the existing service-session grace window, subject to the existing operator setting that enables archiving service sessions on end.

#### Scenario: Sleep keeps the conversation resumable
- **WHEN** a session declared with `mode:"sleep"` is idle-closed
- **THEN** it SHALL be ended, not archived, and resumable

#### Scenario: Archive mode archives after close
- **WHEN** a session declared with `mode:"archive"` is idle-closed
- **THEN** it SHALL be archived after the service-session archive grace window

### Requirement: Close decisions are observable

Every closer verdict, closer failure and plugin-requested close SHALL be logged with the session id, declaring plugin id, reason and outcome, and SHALL be counted in the lifecycle diagnostics. A reap of a governed session SHALL keep its gear reason (`idle`, `stop-after-turn`, `phantom`) and SHALL additionally be marked as declared, with the declaring plugin id, so it is distinguishable in diagnostics from an ephemeral-session reap.

#### Scenario: Keep verdict is logged
- **WHEN** a closer returns `"keep"`
- **THEN** a log line SHALL record the session id, plugin id, reap reason and `keep`
- **AND** the keep counter SHALL increase by one
