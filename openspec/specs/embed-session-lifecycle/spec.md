# embed-session-lifecycle Specification

## Purpose
TBD - created by archiving change add-embed-session-lifecycle. Update Purpose after archive.
## Requirements
### Requirement: Provenance-scoped lifecycle marker

The dashboard SHALL distinguish machine-fronted sessions from interactive coding sessions
via a session-record marker. `SessionSource` SHALL gain the value `"embed"`, and
`DashboardSession` SHALL gain an orthogonal `lifecyclePolicy?: "ephemeral" | "durable"`.
An absent `lifecyclePolicy` SHALL be treated as `"durable"`. Idle reaping and active-session
caps SHALL act ONLY on sessions whose effective policy is `"ephemeral"`; `"durable"`
sessions SHALL retain their existing forever-alive semantics. The marker SHALL be settable
by any front that spawns sessions (embed widget, chat gateway, automation), not embed only.
The `lifecyclePolicy` marker SHALL be persisted to the session's `.meta.json` and restored
on cold-start rehydration, so a server restart never reclassifies an `ephemeral` session as
`durable`.

#### Scenario: Durable sessions are never reaped or capped
- **WHEN** the lifecycle feature is enabled and a `tui` / `dashboard` / `durable` session
  sits idle past the configured idle timeout
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

### Requirement: Existing spawn call-sites opt into ephemeral policy

Qualifying existing machine-front spawn paths SHALL mark their sessions `ephemeral` so the
lifecycle layer has real producers within this change. The dashboard embed acquire path and
automation/flow-triggered spawns SHALL set `lifecyclePolicy:"ephemeral"`. Interactive
`tui`/`dashboard` human spawns SHALL remain `durable`. (The chat gateway sets the marker
when it lands; it is out of scope here.)

#### Scenario: Embed and automation spawns are ephemeral
- **WHEN** a session is spawned via the embed acquire path or an automation/flow trigger
- **THEN** it SHALL carry `lifecyclePolicy:"ephemeral"`

#### Scenario: Interactive spawns remain durable
- **WHEN** a human starts a session from the dashboard UI or a TUI
- **THEN** it SHALL be `durable`
- **AND** it SHALL NOT be governed by reaping or caps

### Requirement: Idempotent server-side session acquisition

The server SHALL provide an atomic acquire path keyed by
`identityKey = visitor-or-channel-or-trigger identity + canonical cwd + agent/profile
identity`, where **canonical cwd** is the realpath-resolved, case-normalized directory (so
symlinks, worktrees, and case-insensitive filesystems collapse to one key). Before spawning,
acquire SHALL validate the requested cwd against a server-side allowlist and SHALL reject an
out-of-allowlist cwd. `acquire(identityKey)` SHALL, in order: (a) return an existing live
compatible session; (b) resume the most recent compatible ended session when policy permits;
or (c) spawn exactly one new session. Concurrent acquires for one `identityKey` SHALL be
coalesced onto a single in-flight result held until the spawned/resumed session's
`session_register` arrives — covering the whole spawn→register window, not merely the spawn
call — so a second acquire during that window does not start a second `pi`. The server SHALL
own the `identityKey → current live sessionId` mapping and SHALL re-point it across resume's
fresh-sessionId renumbering. A browser-local (`localStorage`) mapping MAY be retained as a
hint but SHALL NOT be the source of truth. The in-flight coalesced result SHALL have a
bounded timeout: if `session_register` does not arrive within it, the result SHALL reject
and the in-flight entry SHALL be cleared so coalesced waiters do not hang.

#### Scenario: Reopen/refresh for the same visitor/cwd reuses one session
- **WHEN** an embed for a visitor/cwd whose live session already exists is reopened or
  refreshed
- **THEN** `acquire` SHALL return the existing session
- **AND** no additional live `pi` process SHALL be created

#### Scenario: localStorage loss does not spawn a duplicate
- **WHEN** the browser-local `visitorId → sessionId` hint is missing or cleared but a live
  compatible server-side session exists for that visitor/cwd
- **THEN** `acquire` SHALL reuse the server-side session rather than spawn a new one

#### Scenario: Concurrent acquires converge on one spawn
- **WHEN** two acquire requests for the same `identityKey` arrive concurrently and no live
  session exists
- **THEN** at most one new session SHALL be spawned
- **AND** both requests SHALL resolve to that single session

#### Scenario: Acquire resumes a reaped session under a new id
- **WHEN** `acquire` is called for an `identityKey` whose most recent session was runtime-
  reaped (ended, history preserved)
- **THEN** the server SHALL resume it (minting a fresh `sessionId`) and re-point the
  `identityKey` mapping to the new id

#### Scenario: Concurrent acquire during the spawn→register window
- **WHEN** a second `acquire` for the same `identityKey` arrives after the first has begun
  spawning/resuming but before `session_register` for the new session has arrived
- **THEN** the second acquire SHALL join the in-flight result
- **AND** no second `pi` SHALL be started

#### Scenario: Same directory via symlink/case-variant reuses one session
- **WHEN** two acquires for the same visitor reference the same physical directory through
  different path strings (symlink, worktree, or case-variant)
- **THEN** they SHALL resolve to one `identityKey` and one session

#### Scenario: Out-of-allowlist cwd is rejected
- **WHEN** an acquire requests a cwd outside the server-side allowlist
- **THEN** the server SHALL reject the acquire and SHALL NOT spawn a session

#### Scenario: A spawn that never registers does not hang waiters
- **WHEN** an acquire spawns/resumes but `session_register` never arrives within the bounded
  timeout
- **THEN** the coalesced result SHALL reject and the in-flight entry SHALL be cleared

### Requirement: Idle reaping gated on a lossless quiescence predicate

When the feature is enabled, a periodic sweep SHALL reap an `ephemeral` session ONLY when
it is provably at rest. The server SHALL capture the bridge-forwarded, version-normalized
`agent_settled` into a per-session last-settled timestamp, and the reaper SHALL read that
captured signal rather than an inferred `status`. A session SHALL be eligible for idle
reaping only when ALL hold: the captured `agent_settled` is the latest terminal run signal
(not mid-run); `currentTool` is null; there is no pending `ask_user` interaction;
`pendingQueues.followUp` and `pendingQueues.steering` are empty; the session's pi process
tree has no live child process (determined by the bounded pid-child liveness probe, which
serves both this gate and the phantom gate); no live terminal PTY shares the session's cwd;
no browser is currently subscribed to it; the session is not within a post-spawn/resume grace
window; and time since `lastActivityAt` exceeds the configured idle timeout. On cold-start
rehydration, the last-settled timestamp SHALL be seeded (e.g. from the session-file mtime,
mirroring `lastActivityAt` seeding) so a restored quiescent session is evaluable without
waiting for a fresh run to settle. Reaping SHALL use the graceful kill path, SHALL mark the
runtime session ended, SHALL preserve session history, and SHALL leave the session resumable
by a later `acquire`.

#### Scenario: Eligible idle session is reaped after the timeout
- **WHEN** an `ephemeral` session satisfies every quiescence condition and its
  `lastActivityAt` age exceeds the configured idle timeout
- **THEN** the reaper SHALL end its runtime via the graceful kill path
- **AND** its session history SHALL remain on disk and resumable

#### Scenario: Active generation prevents reaping
- **WHEN** the most recent run event is `agent_start` (no terminal `agent_settled` yet)
- **THEN** the session SHALL NOT be reaped, regardless of `lastActivityAt` age

#### Scenario: In-flight tool execution prevents reaping
- **WHEN** `currentTool` is non-null (a tool is executing)
- **THEN** the session SHALL NOT be reaped

#### Scenario: Pending ask_user prevents reaping
- **WHEN** an unanswered `ask_user` interaction is tracked for the session
- **THEN** the session SHALL NOT be reaped

#### Scenario: Queued follow-up prevents reaping
- **WHEN** `pendingQueues.followUp` is non-empty (the user queued work)
- **THEN** the session SHALL NOT be reaped

#### Scenario: Live terminal or child process prevents reaping
- **WHEN** a live terminal PTY shares the session's cwd OR the session's pi process tree has
  a live child process (e.g. a background `npm run dev`)
- **THEN** the session SHALL NOT be reaped

#### Scenario: Freshly spawned or resuming session is not reaped on arrival
- **WHEN** an `ephemeral` session has just been spawned or is mid-resume (within the grace
  window, before its first activity event or subscriber)
- **THEN** the reaper SHALL NOT reap it, regardless of a stale or seeded `lastActivityAt`

#### Scenario: Active watcher prevents reaping
- **WHEN** a browser is currently subscribed to the session
- **THEN** the session SHALL NOT be reaped even if `lastActivityAt` is stale

#### Scenario: Reaping preserves resumable history
- **WHEN** a quiescent session is reaped and later `acquire`d for the same `identityKey`
- **THEN** resume SHALL reconstruct the full prior conversation from the session file

### Requirement: Graceful mid-turn stop for idle-trending sessions

The reaper SHALL prefer a graceful stop-after-turn over a hard mid-turn kill for an
`ephemeral` session that is streaming, has no active watcher, has empty `followUp`/`steering`
queues, and has drifted past the idle timeout: it SHALL signal the session (via
`stop_after_turn`) to finish the current turn and shut down cleanly at the next `turn_end`
before the session is marked ended, and SHALL NOT hard-kill such a session mid-turn while it
remains within the grace window. A streaming session with a non-empty queue SHALL NOT be
stopped (its queued work is drained first), so `stop_after_turn`'s clean shutdown never
discards queued follow-ups.

#### Scenario: Idle-trending streaming session stops after its turn
- **WHEN** an `ephemeral` streaming session has no subscriber, empty queues, and exceeds the
  idle timeout
- **THEN** the reaper SHALL send `stop_after_turn`
- **AND** the session SHALL end only after the current turn completes, leaving a resumable
  session file

#### Scenario: Streaming session with queued work is not stopped
- **WHEN** an `ephemeral` streaming session has no subscriber and exceeds the idle timeout
  but its `followUp` queue is non-empty
- **THEN** the reaper SHALL NOT send `stop_after_turn`
- **AND** the queued work SHALL be allowed to drain first

### Requirement: Phantom-liveness escape hatch

The reaper SHALL reclaim a session that reports `streaming` but is wedged. A session SHALL be
force-reaped, with a distinct reason, ONLY when ALL hold: it has emitted no run-terminal
`agent_settled` for longer than a configured hard ceiling (far larger than any real turn);
its pi process tree shows no live children and negligible CPU (via a liveness probe); no
browser is subscribed; **there is no pending `ask_user` interaction**; and
`pendingQueues.followUp`/`steering` are empty. The pending-ask and empty-queue conditions
SHALL be mandatory so a session merely blocked awaiting human input or holding queued work
is NEVER force-reaped. A phantom force-reap SHALL use the graceful SIGTERM→grace→SIGKILL
ladder (`killBySessionId`), NOT a bare SIGKILL, to bound the append-only session-file
mid-write window and keep the reaped session resumable. This SHALL be the mechanism that
clears accumulated stuck sessions that a pure quiescence gate would never touch.

#### Scenario: Wedged streaming session is force-reaped
- **WHEN** an `ephemeral` session has been `streaming` past the hard ceiling with a
  ~0-CPU pi tree, no live children, and no subscriber
- **THEN** the reaper SHALL force-reap it with reason `"phantom"`
- **AND** the reap reason SHALL be distinguishable from an ordinary idle reap in diagnostics

#### Scenario: ask_user-blocked session is never phantom-reaped
- **WHEN** an `ephemeral` session is `streaming` past the hard ceiling, ~0-CPU, no children,
  and no subscriber, BUT has an unanswered `ask_user` (or a non-empty follow-up queue)
- **THEN** the reaper SHALL NOT force-reap it

### Requirement: Active-session caps with graceful reclaim

The server SHALL enforce configurable `maxActiveEmbedSessionsPerVisitor` and
`maxActiveEmbedSessionsGlobal`, counting ONLY `ephemeral` sessions. When a limit would be
exceeded on acquire, the server SHALL first reclaim the oldest safely-quiescent `ephemeral`
session. If no quiescent candidate exists (every candidate is busy), the server SHALL
return a structured capacity error and SHALL NOT terminate active work. Interactive/durable
sessions SHALL never be counted or reclaimed. The GLOBAL cap SHALL be the hard security
bound against untrusted or spoofable identities (a caller controlling `visitorId`/`cwd` can
mint many `identityKey`s), and the per-visitor cap SHALL be treated as a fairness bound for
trusted identities only, not an adversarial control.

#### Scenario: Oldest idle session reclaimed at the cap
- **WHEN** an acquire would exceed a per-visitor or global embedded cap and at least one
  quiescent `ephemeral` session exists
- **THEN** the server SHALL reap the oldest quiescent session before spawning
- **AND** the new acquire SHALL succeed

#### Scenario: Capacity error when all candidates are busy
- **WHEN** an acquire would exceed a cap and every `ephemeral` candidate is busy (not
  quiescent)
- **THEN** the server SHALL return a structured capacity error
- **AND** no active session SHALL be terminated

### Requirement: Browser disconnect does not reclaim a busy session

Browser disconnect alone SHALL NOT terminate a session. Reclamation SHALL occur only via the
idle reaper (quiescence-gated) or the caps path.

#### Scenario: Disconnect leaves a busy session running
- **WHEN** the only subscribed browser disconnects from a session that is streaming or has
  a live child process
- **THEN** the session SHALL remain alive
- **AND** it SHALL become reap-eligible only after it later satisfies the full quiescence
  predicate and the idle timeout

### Requirement: Lifecycle observability

The server SHALL expose lifecycle metrics for embedded/`ephemeral` sessions: active count,
idle count, reaped count with reason (`idle` / `stop-after-turn` / `phantom`),
capacity-rejection count, acquire reuse hit/miss counts, and per-session last-activity
timestamp. Metrics SHALL be reachable via `/api/health` and/or a JWT-gated diagnostics
endpoint.

#### Scenario: Diagnostics surface embedded-session growth
- **WHEN** an operator queries the health/diagnostics surface
- **THEN** it SHALL report the active and idle embedded-session counts and the reaped count
  broken down by reason

#### Scenario: Reuse hit/miss is observable
- **WHEN** an `acquire` reuses an existing session versus spawning a new one
- **THEN** the corresponding reuse hit or miss counter SHALL increment

### Requirement: Disabled by default and version-floor safe

The lifecycle feature SHALL be disabled by default; with it disabled, no reaping, caps, or
server-side reuse SHALL occur and existing behavior SHALL be unchanged. The mechanism SHALL
operate at the current pi compatibility floor without a floor bump, consuming the bridge-
normalized `agent_settled` signal with no per-session `piVersion` branch in the reaper.

#### Scenario: No behavior change on upgrade
- **WHEN** the dashboard is upgraded and the lifecycle feature is left at its default
  (disabled)
- **THEN** no session SHALL be reaped or capped and acquire SHALL not alter spawn behavior

#### Scenario: Quiescence gate reads a version-agnostic settle signal
- **WHEN** a connected session runs any supported pi (floor 0.78.0 through the bundled
  version)
- **THEN** the reaper SHALL determine "at rest" from exactly one `agent_settled` per run
  without branching on the session's pi version

