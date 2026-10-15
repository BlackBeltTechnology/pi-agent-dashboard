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
is NEVER force-reaped. A phantom force-reap SHALL use the shared graceful
SIGTERM→grace→SIGKILL ladder, NOT a bare SIGKILL, to bound the append-only session-file
mid-write window and keep the reaped session resumable. That ladder SHALL reach the
session's `pi` process for every spawn strategy, not only for sessions tracked in the headless
PID registry, wherever the recorded process identity can be verified; on a Windows server a
non-headless session's identity cannot be verified, and its phantom reap SHALL be reported as
a failed reclaim instead of signalling the process. This SHALL be the mechanism that
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

#### Scenario: A wedged non-headless session is force-reaped too
- **WHEN** a phantom-eligible session was spawned by a mechanism the headless PID registry
  does not track, on a host where its recorded process identity can be verified
- **THEN** its `pi` process SHALL be terminated by the shared ladder
- **AND** the reap SHALL be counted as a `"phantom"` reap

### Requirement: Active-session caps with graceful reclaim

The server SHALL enforce configurable `maxActiveEmbedSessionsPerVisitor` and
`maxActiveEmbedSessionsGlobal`, counting ONLY `ephemeral` sessions. When a limit would be
exceeded on acquire, the server SHALL first reclaim the oldest safely-quiescent `ephemeral`
session. Reclaiming SHALL terminate that session's `pi` process through the same shared,
strategy-agnostic ladder the reaper uses (subject to the same identity verification, so on a
Windows server a non-headless victim is refused rather than signalled), and an acquire SHALL NOT be admitted on the
strength of a reclaim whose termination was not confirmed: an unconfirmed reclaim SHALL
be refused with the SAME structured capacity error as the all-busy case, and the acquire
SHALL NOT fall through to a second victim in the same attempt. A session whose reclaim has been given
up SHALL NOT be selected as a victim, but SHALL still count toward the caps because its
process is still resident; when every quiescent candidate is given up, the acquire SHALL
take the all-busy path. If no quiescent candidate
exists (every candidate is busy), the server SHALL
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

#### Scenario: Unconfirmed reclaim refuses the acquire
- **WHEN** the victim selected at the cap cannot be confirmed terminated
- **THEN** the server SHALL return the structured capacity error
- **AND** it SHALL NOT admit the acquire
- **AND** it SHALL NOT select a further victim within the same acquire

#### Scenario: A given-up session is never re-picked as a victim
- **WHEN** an acquire would exceed a cap and the oldest quiescent candidate's reclaim has
  been given up
- **THEN** the server SHALL NOT signal or select that session
- **AND** it SHALL select the next eligible quiescent candidate, or return the structured
  capacity error when none remains
- **AND** the given-up session SHALL still count toward the cap

#### Scenario: Reclaim at the cap frees a non-headless session
- **WHEN** the victim selected at the cap was spawned by a mechanism the headless PID
  registry does not track, on a host where its recorded process identity can be verified
- **THEN** its `pi` process SHALL be terminated before the new session is spawned
- **AND** the host SHALL NOT end up running more session processes than the cap allows

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
failed-reclaim count, capacity-rejection count, acquire reuse hit/miss counts, and
per-session last-activity timestamp. The failed-reclaim count SHALL cover reclaims whose
termination could not be confirmed, whose target identity was refused as reused or unverifiable, whose
session held no process identity, and `stop-after-turn` latches that could not be
delivered, and automation-run terminations that were not confirmed — so a
silently-ineffective reaper is detectable from the diagnostics surface alone. The
failed-reclaim count SHALL be a single number, not broken down by reason (the diagnostic
log carries the reason). Given-up sessions SHALL be reported by their error-level
diagnostic only; the diagnostics surface SHALL NOT list them. One consistent term SHALL be
used for this counter across diagnostics, logs and code. Metrics SHALL be reachable via `/api/health` and/or a JWT-gated
diagnostics endpoint.

#### Scenario: Diagnostics surface embedded-session growth
- **WHEN** an operator queries the health/diagnostics surface
- **THEN** it SHALL report the active and idle embedded-session counts and the reaped count
  broken down by reason

#### Scenario: Reuse hit/miss is observable
- **WHEN** an `acquire` reuses an existing session versus spawning a new one
- **THEN** the corresponding reuse hit or miss counter SHALL increment

#### Scenario: An ineffective reaper is visible in diagnostics
- **WHEN** reclaims have failed to terminate their target processes
- **THEN** the diagnostics surface SHALL report a non-zero failed-reclaim count as a
  single number
- **AND** the reaped counts SHALL NOT include those attempts
- **AND** the diagnostics surface SHALL NOT carry a per-session list of given-up sessions

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

### Requirement: The pending-ask signal is the union of both pending registries

The reaper's pending-ask signal SHALL report `true` when **either** the extension-UI request registry (`pendingUiRequests`) **or** the PromptBus pending-prompt registry (`pendingPromptRequests`) holds an entry for the session. Wiring it to only one registry leaves the other's blocked sessions reapable, which violates the existing requirement that an `ask_user`-blocked session is never force-reaped.

The signal SHALL be explicit at the lifecycle wiring site. A non-null `currentTool` produced by the prompt-derived tool state SHALL NOT be relied upon as the veto: that value gates only the idle gear (`skip("current-tool")`), while the phantom force-reap path consults the pending-ask signal instead.

#### Scenario: Session blocked on a PromptBus prompt is not idle-reaped

- **WHEN** an `ephemeral` session is at rest past the idle timeout with no live children and no subscriber
- **AND** it has a tracked PromptBus pending prompt
- **THEN** the pending-ask signal SHALL be `true`
- **AND** the reaper SHALL skip it with reason `"pending-ask"`

#### Scenario: Session blocked on a PromptBus prompt is not phantom-reaped

- **WHEN** an `ephemeral` session is `streaming` past the hard ceiling with a ~0-CPU pi tree, no live children, and no subscriber
- **AND** it has a tracked PromptBus pending prompt
- **THEN** the reaper SHALL NOT force-reap it

#### Scenario: Extension-UI requests still block reaping

- **WHEN** a session has a tracked `pendingUiRequests` entry and no PromptBus prompt
- **THEN** the pending-ask signal SHALL remain `true` exactly as before this change

#### Scenario: Neither registry holds an entry

- **WHEN** a session has no entry in either registry
- **THEN** the pending-ask signal SHALL be `false`
- **AND** the reaper's existing verdicts SHALL be unchanged

#### Scenario: The veto does not depend on currentTool

- **WHEN** the phantom force-reap path evaluates a session blocked on a PromptBus prompt
- **THEN** the skip SHALL be attributable to the pending-ask signal
- **AND** SHALL NOT require `currentTool` to be non-null

### Requirement: A reap SHALL be counted only when termination is confirmed

Reaps SHALL be counted under two explicit rules.

Kill gears (`idle`, `phantom`): a reap SHALL be counted only when the session's
process is verified gone after the kill, not when a kill was merely issued. When
termination is not confirmed, the sweep SHALL report a FAILED reclaim: it SHALL
log a diagnostic naming the session, the reap reason and the surviving process,
SHALL increment a failed-reclaim counter, and SHALL NOT increment the
reaped-by-reason counters.

Latch gear (`stop-after-turn`): it terminates no process, so it SHALL be counted
on DELIVERY of its latch to the session's bridge. An undeliverable latch SHALL be
reported as a failed reclaim with reason `stop-after-turn`, SHALL NOT increment
the `stop-after-turn` reaped counter, and SHALL be re-attempted on later sweeps
while the session stays eligible; it SHALL NOT be subject to the give-up bound
below.

Both counters count attempts per sweep.

A failed reclaim SHALL NOT remove the session record, which distinguishes an
unattended reclaim from an operator shutdown — the latter deliberately releases
the record so the UI is not wedged.

Retry of a failed KILL reclaim SHALL be bounded. After a configured small number
of consecutive failures, or immediately when the failure cannot change by
retrying (no process identity is held, or the recorded identity is reused or
unverifiable), the session SHALL be marked given-up: the server SHALL emit ONE
error-level diagnostic naming the session, the reason, the outcome and the
process, and neither the reaper nor the caps reclaim SHALL attempt that session
again. A given-up session remains listed. Clearing it is an operator action.

"Consecutive" counts failed kill ATTEMPTS: the count SHALL reset only when a reclaim of
that session is confirmed or the session is no longer listed. A sweep that makes no
attempt for the session (it is temporarily ineligible) SHALL NOT reset the count, and a
`stop-after-turn` latch outcome SHALL NOT affect it. Once given up, the session SHALL
receive no further kill attempt from the reaper or the caps reclaim; no latency bound is
otherwise imposed on a sweep or an acquire.

#### Scenario: A confirmed reap is counted

- **WHEN** a reap gear terminates a session and its process is confirmed gone
- **THEN** the reaped-by-reason counter for that reason SHALL increment
- **AND** no failed-reclaim diagnostic SHALL be emitted

#### Scenario: A failed reap is loud, not counted

- **WHEN** a reap gear cannot terminate the session's process
- **THEN** the server SHALL log a diagnostic naming the session id, the reap
  reason and the surviving process id
- **AND** the failed-reclaim counter SHALL increment
- **AND** the reaped-by-reason counters SHALL be unchanged

#### Scenario: A failed reap is retried on the next sweep

- **WHEN** a reclaim fails and the session still satisfies the reap predicate
- **THEN** the session SHALL remain listed
- **AND** the next sweep SHALL attempt the reclaim again

#### Scenario: Retrying stops after repeated failure

- **WHEN** a session's reclaim has failed on several consecutive sweeps
- **THEN** the server SHALL emit one error-level diagnostic for that session
- **AND** later sweeps SHALL NOT attempt to reclaim it again
- **AND** the session SHALL remain listed

#### Scenario: An ineligible sweep does not reset the give-up count

- **WHEN** a session's kill reclaim has failed, a later sweep makes no attempt because the
  session is temporarily ineligible, and subsequent attempts fail again
- **THEN** the failures before and after the ineligible sweep SHALL count toward the same
  give-up bound
- **AND** only a confirmed reclaim of that session, or the session no longer being listed,
  SHALL reset the count

#### Scenario: An undeliverable stop-after-turn latch is a failed reclaim

- **WHEN** the `stop-after-turn` gear selects a session whose bridge connection
  cannot receive the latch
- **THEN** the `stop-after-turn` reaped counter SHALL NOT increment
- **AND** the failed-reclaim counter SHALL increment
- **AND** a later sweep SHALL attempt the latch again once the session is still
  eligible, regardless of how many earlier latches failed
