## ADDED Requirements

### Requirement: In-process mode is registered and selected per team

The plugin SHALL register mode `in-process` in core's mode registry with a per-caller availability check. A team SHALL have exactly one mode fixed at creation, taken from the `TeamCreate {mode}` argument, else the template `mode`, else config `teammateMode` (default `session`); a template without `mode` falls through to config. `TeammateSpawn` SHALL NOT accept a mode.

#### Scenario: Config default applies
- **WHEN** `TeamCreate` is called without `mode`, the template has none and `teammateMode` is unset
- **THEN** the team is created with mode `session`

#### Scenario: Explicit argument wins
- **WHEN** `teammateMode` is `session` and `TeamCreate {mode:"in-process"}` is called while in-process is available
- **THEN** the team is created with mode `in-process`

#### Scenario: Template without mode falls through
- **WHEN** a template declares no `mode` and `teammateMode` is `in-process`
- **THEN** the team resolves to `in-process`

#### Scenario: Mode is immutable
- **WHEN** a caller tries to change the mode of an existing team
- **THEN** the request is rejected with `invalid_args` and the mode is unchanged

### Requirement: Templates resolved to in-process mode

A templated start whose resolved mode is `in-process` SHALL create an in-process team when some connected session reports availability and SHALL be listed with `mode_unavailable` plus a reason when none does. The lead's first `inproc hello` after the start is authoritative.

#### Scenario: Available in-process template starts
- **WHEN** a template resolving to `in-process` is started and a lead reports availability
- **THEN** the team is created in mode `in-process` and eager members are spawned after `lead_bound` through the in-process driver

#### Scenario: Unavailable in-process template
- **WHEN** no connected session reports in-process availability
- **THEN** the template is listed with `mode_unavailable` and its reason and cannot be started

#### Scenario: Late mismatch closes the team
- **WHEN** a templated start succeeds but the new lead's first `inproc hello` reports unavailable
- **THEN** the team is closed with `closeReason` `mode_unavailable` and no teammate is spawned

### Requirement: Availability gate for in-process mode

In-process mode SHALL be available for a session only when its bridge's probe is answered with `apiVersion` at least `REQUIRED_API_VERSION` and every required feature. The bridge SHALL report the result in an `inproc hello` at `session_start`, on the first `subagents:*` event and after an empty reply. Otherwise `TeamCreate {mode:"in-process"}` SHALL fail with `mode_unavailable` and reason `subagents_extension_missing`, `subagents_extension_outdated` or `no_context`.

#### Scenario: Extension missing
- **WHEN** the probe gets no answer within 500 ms
- **THEN** `TeamCreate {mode:"in-process"}` fails with `mode_unavailable` reason `subagents_extension_missing` and an install hint

#### Scenario: Extension outdated
- **WHEN** the probe answers with a lower `apiVersion` or lacks a required feature
- **THEN** the failure reason is `subagents_extension_outdated` and names the missing features

#### Scenario: Lost activation race
- **WHEN** the probe ran before the subagents extension activated and the first `subagents:*` event arrives later
- **THEN** the bridge probes again and the session becomes available without a reconnect

#### Scenario: Session mode unaffected
- **WHEN** the subagents extension is absent
- **THEN** `session` teams are created and run exactly as before

### Requirement: In-process driver implements the member driver

The in-process driver SHALL implement core's `MemberDriver` (`spawn`, `deliver`, `abort`, `shutdown`, `isConnected`) and be built from the `ResolvedSpawnSpec`. It SHALL NOT call `spawnSession`, `abortSession`, `shutdownSession` or `emitEventToSession` for member sessions. Session-mode behaviour SHALL be unchanged.

#### Scenario: In-process does not use session seams
- **WHEN** an in-process teammate is spawned, steered and shut down
- **THEN** no session is spawned or shut down on the host for it

#### Scenario: Spec drives the child
- **WHEN** a contributor adds a prompt file and an env key to the spec
- **THEN** the spawn command carries the same ordered prompt files and env

#### Scenario: User stop uses the actor op
- **WHEN** a user stops a member's turn through core's `abortMember` with actor `user`
- **THEN** the in-process driver interrupts the child, or fails with `interrupt_unavailable` when the feature is absent

### Requirement: Lead bridge hosts in-process children over an idempotent command channel

The server SHALL command in-process members only through `agent-teams:inproc` events to the lead session (`spawn`, `steer`, `interrupt`, `stop`, `snapshot`), each with a `cmdId`; the event type SHALL be declared in the manifest `emits`. The bridge SHALL be the only caller of the subagents API, SHALL execute a repeated `cmdId` once and replay its stored result, and SHALL ack on `agent-teams/inproc`.

#### Scenario: Spawn acknowledged
- **WHEN** the server sends a `spawn` command and the subagents reply is `ok`
- **THEN** the bridge acknowledges with `childId` and `agentId` and the member keeps `spawning`

#### Scenario: Duplicate spawn executed once
- **WHEN** a `spawn` command is re-sent after a reconnect with the same `cmdId`
- **THEN** one child exists and the stored ack is replayed

#### Scenario: Emit refused
- **WHEN** the host refuses `agent-teams:inproc` because it is undeclared
- **THEN** the command fails at once with `emit_refused` instead of waiting for the timeout

#### Scenario: Lead not connected
- **WHEN** the lead session is disconnected at command time
- **THEN** the command is queued until the lead's `inproc hello` and `spawnTimeoutMs` counts from connection

### Requirement: Commands that time out are reconciled

An unacknowledged command SHALL fail with `delivery_timeout` after `inProcessCmdTimeoutMs`. For a timed-out `spawn` the server SHALL send `stop` for that member and reconcile through a `snapshot` before the name is reused, so a late ack leaves no orphan child. A timed-out `steer` SHALL leave the mail queued.

#### Scenario: Late ack after timeout
- **WHEN** a spawn ack arrives after `delivery_timeout`
- **THEN** the child is stopped, the member stays `failed` and the name is reusable only after the snapshot shows no child

#### Scenario: Steer timeout
- **WHEN** a steer is not acknowledged in time
- **THEN** the mail stays queued and the member is marked `disconnected`

### Requirement: Lifecycle reports survive a lane outage

The lead bridge SHALL keep an ordered outbox of unacknowledged lifecycle reports (`started`, `idle` with `finalText` or `error`, `gone`) keyed by member and run, flush it after every `inproc hello`, and include any unacknowledged settle in its `snapshot`. The server SHALL dedupe by core's `lastSettleId`.

#### Scenario: Teammate finishes during a server restart
- **WHEN** a child finishes while the lane is down and the server restarts
- **THEN** after reconnect the lead receives the final answer exactly once

#### Scenario: Report lost in flight
- **WHEN** a report request resolves `disconnected` or `timeout`
- **THEN** it stays in the outbox and is resent after the next `inproc hello`

### Requirement: Lead-proxied member identity

The server SHALL mint a random per-member `proxyToken` at spawn, persist it, and send it only in the `spawn` command. A request-lane call carrying `as {member, token}` SHALL be accepted by `resolveCaller` only from the socket of the lead of an in-process team, for a member that is not `gone`, with a constant-time token match. Any other `as` SHALL be rejected with `forbidden` and SHALL NOT fall back to the socket identity.

#### Scenario: Valid proxied call
- **WHEN** the lead socket sends `as {member:"bob", token}` with the correct token
- **THEN** the operation runs with caller `bob`

#### Scenario: Wrong token
- **WHEN** the lead socket sends `as {member:"bob"}` with a wrong token
- **THEN** the call fails with `forbidden` and nothing changes

#### Scenario: Non-lead socket
- **WHEN** a teammate session socket sends an `as` field
- **THEN** the call fails with `forbidden`

#### Scenario: Token never leaks
- **WHEN** any tool result, mail, log line, description, `TeamStatus` or REST snapshot is produced
- **THEN** it contains no `proxyToken`

### Requirement: Child lifecycle mapping

The lead bridge SHALL map subagents events to member state: spawn reply `queued` keeps `spawning` with `queuePosition`; `subagents:started` sets `busy`; `completed` or `failed` followed by `idle` in the same tick sets `idle` and reports `settleId`, `finalText|error` and `aborted`; a stopped run without `idle`, or `disposed`, sets `gone` (`stoppedBy: timeout` maps to `timeout`, others to `stopped`). The decision SHALL be made after the current tick.

#### Scenario: First run starts
- **WHEN** `subagents:started` arrives for a `spawning` member
- **THEN** the member becomes `busy`

#### Scenario: Run ends with an answer
- **WHEN** `completed {result}` and `idle {run:3}` arrive in the same tick
- **THEN** the member becomes `idle`, `settleId` is 3 and the lead gets the final answer in the idle notice

#### Scenario: Run ends with an error
- **WHEN** `failed` and `idle` arrive in the same tick
- **THEN** the idle notice carries the error text and the dispatcher does not auto-claim

#### Scenario: Stopped from the dock
- **WHEN** a run ends as stopped with no `idle` event
- **THEN** the member becomes `gone` with reason `stopped`, its tasks return to `pending` and the lead is woken

#### Scenario: Stopped by timeout
- **WHEN** the stopped run reports `stoppedBy: timeout`
- **THEN** the member becomes `gone` with reason `timeout`

### Requirement: Lead end, reload and session replacement close the team

Members of an in-process team SHALL NOT outlive the lead process. When the lead session ends the team SHALL close at once with `closeReason` `lead_ended` and members `gone: lead_ended`, and a best-effort `stop` for every known child SHALL be queued for the next `inproc hello` with the same incarnation. A `hello` carrying a different bridge `incarnation` SHALL mark members `gone: lead_reloaded` with `in_progress` tasks released and one waking notice. The orphan window SHALL NOT apply.

#### Scenario: Lead reloads
- **WHEN** the lead runs `/reload` and its new bridge sends `inproc hello` with a new incarnation
- **THEN** all members are `gone: lead_reloaded`, their tasks are `pending` and one waking notice is delivered

#### Scenario: Lead ends
- **WHEN** the lead session ends
- **THEN** the team is closed with `lead_ended` and members are `gone` without an orphan period

#### Scenario: New or fork of the lead
- **WHEN** the lead runs `/new` or `/fork` and gets a new session id
- **THEN** the old session's end closes the team with `lead_ended`; `/reload` and `/resume` of the same id close it through the incarnation change; either path leaves one closed team and one notice

#### Scenario: Heartbeat lapse then reconnect
- **WHEN** the lead's heartbeat lapses, the team closes, and the same incarnation reconnects
- **THEN** the queued `stop` is delivered and no child keeps running without a member

### Requirement: Closing the team stops its children

Approved shutdown, `abortMember` removal and `teamDelete` (with or without `force`) on an in-process team SHALL stop children through the driver's `shutdown`, release tasks per core, and notify the lead. The team SHALL close only after every child is `gone` or `shutdownGraceMs` plus `inProcessCmdTimeoutMs` has passed; remaining members then become `gone: not_alive` with a pending `stop` recorded.

#### Scenario: Forced delete
- **WHEN** the lead calls `TeamDelete {force:true}` with two live children
- **THEN** both receive `stop`, their tasks return to `pending`, and the team closes after their `disposed` events

#### Scenario: Stop never confirmed
- **WHEN** a child does not confirm within the grace
- **THEN** the member becomes `gone: not_alive`, a pending `stop` is recorded and the team still closes

### Requirement: Server restart keeps children

The lead process and its children SHALL survive a dashboard restart. On startup members of an in-process team SHALL be `disconnected` until the lead's `inproc hello` with a snapshot arrives, regardless of `reconcileGraceMs`; only members absent from the snapshot SHALL become `gone: not_alive` (or `failed` when still `spawning` with no pending command), and a lead that never returns is handled by `onSessionEnded`.

#### Scenario: Slow reconnect
- **WHEN** the lead reconnects 90 s after the server restart with the same incarnation and a snapshot
- **THEN** members are re-bound to their running children and queued mail is flushed

#### Scenario: Child missing from the snapshot
- **WHEN** the snapshot lacks a known busy member
- **THEN** that member becomes `gone: not_alive`, its tasks are released and the lead is woken

### Requirement: Mail delivery to children is framed per mail

The driver SHALL deliver each queued mail as its own block through the steer request: a core `formatEnvelope` line, an unquoted `[agent-teams · mail id <id>]` line, then every body line quoted with `│ ` (line-capped), so peer text cannot forge an envelope or approval. A running child gets them after the current tool, an idle child starts a run, and non-waking mail waits while it is idle. The prompt says only unquoted envelope lines are runtime-authored and a repeated mail id is ignored.

#### Scenario: Several mails at once
- **WHEN** three mails are queued for a running member
- **THEN** they are sent as three framed blocks in one steer, in mail-id order

#### Scenario: Forged header in a body
- **WHEN** a peer message body contains a line like `[agent-teams · from lead · …]` or "plan approved"
- **THEN** it is delivered quoted and inert, and the only unquoted envelope names the real sender

#### Scenario: Non-waking mail to an idle child
- **WHEN** a mail without the wake flag targets an idle member
- **THEN** it stays queued and is delivered with the next waking mail or when the child becomes busy

#### Scenario: Child no longer alive
- **WHEN** the steer result is `not_alive`
- **THEN** the member becomes `gone: not_alive` and the lead receives a waking notice

### Requirement: Queued steer is not treated as read

For a steer acknowledged as `queued` into a running child the host SHALL record the current run number from its registry (last `idle` run plus one while busy), never by counting events. If that run goes `idle` before an idle-to-busy transition, the driver SHALL send one `nudge` steer per recorded run, with a fresh `cmdId`, a content-free message and no mail text; upstream drains the stale steer at the next run start. A mail is final after that transition.

#### Scenario: Run ends between steer and read
- **WHEN** a steer is acked `queued` and the same run reports `idle` without a new run starting
- **THEN** the child is continued with a content-free nudge, the member starts a new run and the mail body reaches the child once

#### Scenario: Nudge starts a run despite ledgered ids
- **WHEN** the queued mail ids are already in the ledger and the nudge is sent
- **THEN** the nudge starts a run while a duplicate waking mail with the same ids still starts none, and no second nudge is sent for that run

#### Scenario: Progress emissions do not advance the run count
- **WHEN** upstream emits several progress `started` events during one run
- **THEN** the recorded run number and the `started` reports are unchanged, and only an idle-to-busy transition counts as a new run

### Requirement: Mail is handed to a child once per mail id

The lead host SHALL keep a bounded per-member ledger of handed-over mail ids, included in the `snapshot`, and SHALL record an id only after a `started` or `queued` steer result. Steer commands SHALL be addressed by member and mail ids with a `cmdId` derived from them. The host SHALL drop ids already in the ledger before handing over, re-ack them as `duplicate`, start no run when none remain, and then report the member's current state. A `nudge` steer is exempt from the drop.

#### Scenario: Duplicate mail after a lost ack
- **WHEN** a steer executed but its ack was lost and the server re-sends the same mail
- **THEN** the ack is replayed, or the ids are dropped by the ledger, and the child receives the mail once

#### Scenario: Queued re-send delivers the mail once
- **WHEN** a `queued` steer's run ends idle and the driver continues the child
- **THEN** the continuation carries ids only and the mail text appears in the child once

#### Scenario: Retry after not_started
- **WHEN** a steer returned `not_started` and is retried after the slot opens
- **THEN** the retry executes and the ids enter the ledger only after `started` or `queued`

#### Scenario: Duplicate-only waking mail
- **WHEN** every id of a waking mail is already in the ledger
- **THEN** no run starts and the host reports the member's current busy or idle state

### Requirement: Urgent interrupt degrades honestly

A lead `SendMessage {priority:"urgent"}` to a `busy` in-process member SHALL make the driver's `abort` use the interrupt request when feature `interrupt` is present, after which core's urgent path delivers the wake mail. Otherwise the message SHALL be sent by steer and the tool result SHALL carry `details.degraded: "urgent_as_steer"` and a text warning.

#### Scenario: Interrupt available
- **WHEN** the feature is present and the member is `busy`
- **THEN** the turn is aborted silently, no idle notice or auto-claim follows, and the wake mail starts the next run

#### Scenario: Interrupt missing
- **WHEN** the feature is absent
- **THEN** the message is steered and the result reports the degradation

### Requirement: Concurrency and queue visibility

The server SHALL include the subagents `maxConcurrent` in availability and report queued members as `spawning` with `queuePosition`; a continued run that re-queues SHALL show the same. `spawnTimeoutMs` SHALL count from the first `subagents:started`. When `maxTeammates` exceeds `maxConcurrent` the spawn result SHALL state the parallelism bound and that the lead's own `Agent` calls share the pool.

#### Scenario: Queued teammate
- **WHEN** `maxConcurrent` is 4 and a fifth teammate is spawned
- **THEN** it stays `spawning` with a queue position and does not time out while queued

#### Scenario: Parallelism bound stated
- **WHEN** `maxTeammates` is 5 and `maxConcurrent` is 4
- **THEN** the `TeammateSpawn` result says at most 4 teammates run in parallel

### Requirement: Parity gaps are enforced and stated

For in-process teams `TeammateSpawn {resume:true}` SHALL fail with `resume_unsupported_in_process`. Members SHALL have no `sessionId`; tool descriptions and the team snapshot SHALL state that the user cannot chat with a member directly, that the member opens as a read-only subagent view, and that children have no MCP.

#### Scenario: Resume refused
- **WHEN** the lead calls `TeammateSpawn {name:"bob", resume:true}` on an in-process team
- **THEN** it fails with `resume_unsupported_in_process`

#### Scenario: No session for a member
- **WHEN** the team snapshot lists an in-process member
- **THEN** `sessionId` is absent and `childAgentId` identifies its subagent view

### Requirement: Team view shows in-process members

A member without `sessionId` in the Team view SHALL show an action that opens the subagent view by `childAgentId` instead of a session link, and no chat affordance; the header SHALL show the mode and, when `maxTeammates` exceeds `maxConcurrent`, the parallelism bound; the dock Stop of a child SHALL show as member `gone`.

#### Scenario: Open subagent view
- **WHEN** an in-process member row is rendered
- **THEN** it offers "Open subagent view" and no session link or chat input

#### Scenario: Mode and bound in the header
- **WHEN** the team is `in-process` with `maxTeammates` 5 and `maxConcurrent` 4
- **THEN** the header names the mode and states 4 run in parallel

### Requirement: Open in-process teams are closed when the mode is gone

On server load, an open in-process team whose lead is not connected SHALL wait for the lead's `inproc hello`; an open in-process team found while the mode is unavailable (config `session` forced, package removed, rollback) SHALL be closed with `closeReason` `mode_unavailable` and its members marked `gone`.

#### Scenario: Rollback with an open team
- **WHEN** the plugin starts after rollback and an in-process team is still open
- **THEN** it is closed with `mode_unavailable` and members are `gone`

### Requirement: In-process configuration and observability

The plugin SHALL read `teammateMode`, `inProcessIdleTtlSec` (absent = keep alive until stopped), `inProcessLeanChildren` (default false) and `inProcessCmdTimeoutMs` (default 10000) from `configSchema.json`, log command, ack, event and mapping outcomes with ids and sizes only, and count unknown upstream events, identity rejections and forged-command rejections.

#### Scenario: Unknown upstream event
- **WHEN** a subagents event with an unexpected shape arrives
- **THEN** it is ignored and the `inproc_unknown_event` counter increases

#### Scenario: Idle TTL set
- **WHEN** `inProcessIdleTtlSec` is 900
- **THEN** a child idle for 900 s is freed and its member becomes `gone: idle_disposed`

### Requirement: Spawn clock, queue position and unusable concurrency

`queuePosition` SHALL be 1-based. A `no_context` retry SHALL count its deadline from the spawn command and end as `spawn_timeout`. Queue wait SHALL be unbounded but visible unless the opt-in `inProcessQueueTimeoutMs` is set (default unlimited). A `limits.maxConcurrent` that is missing, 0 or not an integer SHALL make in-process unavailable with `subagents_extension_outdated`.

#### Scenario: Queued without a queue timeout
- **WHEN** a member waits for a slot and `inProcessQueueTimeoutMs` is unset
- **THEN** it stays `spawning` with its 1-based `queuePosition` and never fails while queued

#### Scenario: Queue timeout set
- **WHEN** `inProcessQueueTimeoutMs` is 1000 and the member is still queued at 1001 ms
- **THEN** it fails with `spawn_timeout` and its queued child is stopped

#### Scenario: Unusable concurrency limit
- **WHEN** the capability answer has `limits.maxConcurrent` 0
- **THEN** in-process is unavailable with `subagents_extension_outdated`

### Requirement: Mode argument validation

`TeamCreate {mode}` SHALL accept only the exact lowercase values `session` and `in-process`; anything else SHALL fail with `invalid_args` naming `mode`, create no team and not fall back to the configured default.

#### Scenario: Misspelt mode
- **WHEN** `TeamCreate {mode: "inprocess"}` is called
- **THEN** it fails with `invalid_args` and no team is created

### Requirement: Abort on a member that is not busy

An abort or interrupt of an `idle` or `spawning` member SHALL succeed as a no-op with `details.noop: "not_busy"` and no upstream call. A `gone` member SHALL yield `member_gone`. A user abort of a slot-queued member SHALL be a no-op carrying a hint to use Stop.

#### Scenario: Abort of an idle member
- **WHEN** the user aborts an `idle` member
- **THEN** the result is success with `details.noop: "not_busy"`

#### Scenario: Abort of a gone member
- **WHEN** the lead aborts a `gone` member
- **THEN** the result is `member_gone`

### Requirement: Per-member command order and bounded queues

The driver SHALL keep one outstanding command per member and queue the next behind its ack. The handover ledger SHALL hold at most 200 ids per member (FIFO eviction). The outbox and the command queue SHALL hold at most 1 000 entries and 8 MiB, evicting oldest first with a counter, non-settle reports first and an `idle` with finalText only when nothing else is left. An application-error report SHALL be dead-lettered after 3 tries.

#### Scenario: Steer queued behind spawn
- **WHEN** a steer is issued while the member's spawn command is unacked
- **THEN** the steer is sent only after the spawn ack

#### Scenario: Outbox over the cap
- **WHEN** 1 001 reports are queued during a lane outage
- **THEN** the oldest non-settle report is evicted and `inproc_outbox_overflow` increases

#### Scenario: Poison report
- **WHEN** the server answers an application error for a report three times
- **THEN** the report is dead-lettered and later reports still flow

### Requirement: Command secret on the lead bus

The bridge SHALL mint a per-activation `commandSecret` and the driver SHALL echo it in every `agent-teams:inproc` command. A command with a wrong or missing secret SHALL be ignored with no upstream call and counted as `inproc_bad_command`. The secret SHALL never reach a snapshot, REST output, mail, prompt or log.

#### Scenario: Forged command
- **WHEN** another extension emits `agent-teams:inproc` without the secret
- **THEN** it is ignored and `inproc_bad_command` increases

### Requirement: Proxied identity for a gone member

A proxied `as` SHALL verify the lead socket and the token (constant time) first. A valid token for a `gone` member SHALL yield `member_gone`; a token mismatch SHALL yield `forbidden` whatever the member state, so no member existence is revealed.

#### Scenario: Gone member, valid token
- **WHEN** the lead's socket sends `as` with the right token of a `gone` member
- **THEN** the result is `member_gone`

#### Scenario: Wrong token for a gone member
- **WHEN** the token does not match
- **THEN** the result is `forbidden`

### Requirement: Unknown upstream events

Events for ids outside the member registry SHALL be ignored silently. An unknown non-empty `disposed.reason` or `stoppedBy` SHALL map to `gone: stopped` and increase `inproc_unknown_event`, so the counter indicates upstream drift. A missing `stoppedBy` SHALL map to `stopped` uncounted.

#### Scenario: Lead's own subagent
- **WHEN** a subagent event arrives for a non-managed child of the lead
- **THEN** no member changes and no counter increases

#### Scenario: Unknown disposal reason
- **WHEN** `disposed.reason` is a value outside the documented set
- **THEN** the member is `gone: stopped` and `inproc_unknown_event` increases

### Requirement: Pending stops retention

A best-effort `stop` recorded in `pendingStops` SHALL be delivered on the next `inproc hello` of the same incarnation. A hello of a different incarnation SHALL discard the entries and log it. Entries SHALL expire on team delete or after 24 h and SHALL never exceed the number of members ever created.

#### Scenario: Different incarnation returns
- **WHEN** the lead returns with a new incarnation
- **THEN** pendingStops are discarded and no stop is sent

### Requirement: Final text cut

The final text of a run SHALL be cut before crossing the lane at core's `maxFinalTextChars` counted in code points on a code-point boundary with core's marker; without that constant the cut SHALL be 256 KiB of UTF-8 with the marker `… [truncated N bytes]`. Lone surrogates SHALL be replaced by U+FFFD.

#### Scenario: Oversize answer
- **WHEN** a child answers with 4 MiB of text
- **THEN** the lane carries the cut text ending with the marker

### Requirement: Shared mail framing limits

The per-mail block SHALL use core's mail-framing helper, constants and mail-id comparator (never duplicated): at most 150 lines including the envelope, a final marker line `… N lines truncated` counted inside the cap, two or more consecutive blank lines collapsed to one, C0/C1, ANSI and bidi controls stripped except `\n` and `\t`. A batch above the steer limit SHALL be capped the same way; there is no per-steer split in v1. A `nudge` SHALL carry one fixed string and no ids or bodies.

#### Scenario: Long body
- **WHEN** a mail body has 400 lines
- **THEN** the block has 150 lines ending with the truncation marker and the header is intact

### Requirement: Burst of lifecycle events wakes the lead once

A burst of lifecycle events (spawn failures, idle reports, stops) SHALL produce one coalesced waking notice per core coalesce window listing every affected member, using core's coalescer and window constant unchanged.

#### Scenario: Three shutdowns at once
- **WHEN** three members approve shutdown within 50 ms
- **THEN** the lead receives one waking notice naming all three

### Requirement: No run watchdog and no user-to-member messages

A run that never settles SHALL NOT be failed automatically; an approved shutdown SHALL be bounded by core's `shutdownGraceMs` plus `inProcessCmdTimeoutMs`. A direct user-to-member message route SHALL NOT exist in v1; the user talks to the lead.

#### Scenario: Run never settles
- **WHEN** a member approves shutdown and its run never settles
- **THEN** the stop is sent after `shutdownGraceMs` and the member becomes `gone` on confirmation

### Requirement: Configuration ranges

`inProcessIdleTtlSec` SHALL be an integer ≥1 or absent, `inProcessCmdTimeoutMs` an integer 1000–120000 and `inProcessQueueTimeoutMs` an integer ≥1 or absent. The schema `minimum` and `maximum` SHALL reject out-of-range values at settings write; values SHALL never be clamped.

#### Scenario: Out-of-range write
- **WHEN** settings write `inProcessCmdTimeoutMs: 500`
- **THEN** the write is rejected by the schema

### Requirement: Team view test contract

The in-process Team view elements SHALL carry the stable `data-testid` values `team-member-open-subagent`, `team-member-status` (with a `data-status` value), `team-header-mode` and `team-header-parallel`, registered in the ui change's tasks.

#### Scenario: Status hook
- **WHEN** a member row is rendered
- **THEN** `team-member-status` carries `data-status` equal to the member status
