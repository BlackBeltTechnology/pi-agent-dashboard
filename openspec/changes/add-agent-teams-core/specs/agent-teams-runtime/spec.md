## ADDED Requirements

### Requirement: Bundled plugin package with its own identity

The system SHALL ship a bundled dashboard plugin package `packages/agent-teams-plugin` whose manifest id is `agent-teams` and which declares a `server`, a `bridge` and a `client` entry. Its manifest SHALL list every event type it emits in `emits`. It SHALL NOT reuse the id `team`, the `team-*` capability names or any state of `packages/team-plugin`.

#### Scenario: Plugin is discovered and loaded
- **WHEN** the dashboard server starts with the plugin bundled
- **THEN** `/api/health` lists plugin `agent-teams` as loaded and its bridge entry is auto-registered for pi sessions

#### Scenario: No collision with the team plugin
- **WHEN** both `team` and `agent-teams` plugins are enabled
- **THEN** each keeps its own REST prefix, data directory and request-lane types without interference

#### Scenario: Event type absent from manifest emits
- **WHEN** the plugin emits an event type that is not in its manifest `emits`
- **THEN** the host refuses the emit, the mail stays queued, and the manifest contract test fails for that type

### Requirement: Server-owned persisted team store

The server entry SHALL own all team state (teams, members, tasks, mail) in memory and persist it per team as JSON under the plugin data directory using atomic write (temp file + rename), with a `schemaVersion`; the mail log SHALL be a separate append-only file capped by `maxMailLogBytes`. Every mutation SHALL be a synchronous store operation; persistence SHALL NOT reorder mutations.

#### Scenario: State survives a server restart
- **WHEN** the server restarts while a team with tasks and unacked mail exists
- **THEN** the team, tasks and unacked mail are loaded again from the plugin data directory

#### Scenario: Crash-safe write
- **WHEN** the process dies during a team write
- **THEN** the previous complete team file remains readable

#### Scenario: Mail log does not bloat team writes
- **WHEN** the mail log grows past `maxMailLogBytes`
- **THEN** it is compacted and the team JSON file stays small

### Requirement: Identity is derived from the host session, never from payload

The server SHALL identify the caller of every request by the session id supplied by the request lane socket and resolve it to `{team, lead|member}` through its binding index. Teammates SHALL be bound through `onSessionResolved` using the `pluginRef` the server minted at spawn. Env hints SHALL NOT grant authority; a later teammate mode MAY define its own proxied identity explicitly.

#### Scenario: Payload cannot impersonate
- **WHEN** a request payload names another member or team
- **THEN** the server ignores it and acts as the socket's bound identity, or answers `not_in_team` when unbound

#### Scenario: Teammate binds before first event
- **WHEN** a spawned teammate session registers
- **THEN** `onSessionResolved` binds its session id to the member before any queued mail is delivered

### Requirement: Lead role via TeamCreate

A plain session SHALL become the lead of exactly one team by calling `TeamCreate`, or by calling `TeammateSpawn` when no team exists (which creates a default team). A session that is a teammate SHALL NOT create a team, and a lead SHALL NOT create a second team.

#### Scenario: Lead creates a team
- **WHEN** a plain session calls `TeamCreate {name}`
- **THEN** the server records its session as `leadSessionId` and the session receives the lead tool set

#### Scenario: Second team refused
- **WHEN** a lead calls `TeamCreate` again
- **THEN** the call fails with `already_in_team`

#### Scenario: Teammate cannot create a team
- **WHEN** a teammate session calls `TeamCreate`
- **THEN** the call fails with `nested_team_forbidden`

#### Scenario: First spawn creates a default team
- **WHEN** a plain session calls `TeammateSpawn` with no team
- **THEN** a default team is created with that session as lead before the spawn proceeds

### Requirement: Team size and count caps

The server SHALL enforce `maxTeammates` (default 5, range 1–10) per team and `maxActiveTeams` (default 3) across the server. The count check and the name reservation SHALL happen before any asynchronous step so concurrent spawns cannot exceed the cap.

#### Scenario: Spawn beyond the cap
- **WHEN** a lead with 5 live teammates calls `TeammateSpawn`
- **THEN** the call fails with `team_full` and no session is spawned

#### Scenario: Concurrent spawns at the limit
- **WHEN** two `TeammateSpawn` calls arrive when one slot remains
- **THEN** exactly one succeeds and the other fails with `team_full`

### Requirement: Member exit handling

When a member session ends for any reason, the server SHALL mark the member `gone` with a reason, release its `in_progress` tasks to `pending` and clear the owner of its `pending` tasks, discard its queued mail and send the lead a waking notice naming the affected tasks. A spawn that becomes `failed` SHALL do the same.

#### Scenario: Teammate crashes mid-task
- **WHEN** `onSessionEnded` fires for a member that owns an `in_progress` task
- **THEN** the task returns to `pending` unowned and the lead is notified of the exit

#### Scenario: Pre-assigned task of a failed spawn
- **WHEN** a member with an owned `pending` task becomes `failed`
- **THEN** the task is unowned and named in the lead notice

#### Scenario: Name reusable after exit
- **WHEN** a member is `gone` or `failed`
- **THEN** the lead can spawn a member with the same name again

### Requirement: Lead exit handling

When the lead session of a `session`-mode team ends, the server SHALL mark the team `orphaned`, pause dispatch, send members a non-waking notice and leave their sessions running. A `hello` from the same lead id within `orphanTtlMs` SHALL re-bind it; after the TTL the team SHALL close (`closeReason`) without killing any session. Other modes MAY close at once.

#### Scenario: Lead resumes in time
- **WHEN** the lead session reconnects within the orphan TTL
- **THEN** the team returns to `active` and dispatch resumes

#### Scenario: Orphan TTL expires
- **WHEN** the TTL passes with no lead
- **THEN** the team becomes `closed` and member sessions remain running as ordinary sessions

### Requirement: Restart reconciliation

On startup the server SHALL reload persisted teams, mark every member and the lead `disconnected`, wait `reconcileGraceMs` for re-binding through `hello` or `onSessionResolved`, mark members stuck in `spawning` without a bound session as `failed`, and redeliver unacknowledged mail on re-bind.

#### Scenario: Teammate session survived the restart
- **WHEN** a teammate's bridge sends `hello` after the server restarted
- **THEN** the member becomes `idle` or `busy` according to the `isIdle` reported in `hello` and its queued mail is delivered

#### Scenario: Spawn interrupted by restart
- **WHEN** a member persisted as `spawning` has no bound session after the grace period
- **THEN** the member is marked `failed` and the lead is notified

### Requirement: Cleanup is lead-only and explicit

`TeamDelete` SHALL be callable only by the lead. Without `force` it SHALL fail with `members_active` while any member is not `gone` or `failed`; with `force` it SHALL first post a visible notice to every live member session, request shutdown, end remaining sessions after `shutdownGraceMs` and close the team. It SHALL be an actor operation (`lead`, `user`, `server`).

#### Scenario: Delete with live members
- **WHEN** the lead calls `TeamDelete` while a member is `idle`
- **THEN** the call fails with `members_active` naming that member

#### Scenario: Forced delete
- **WHEN** the lead calls `TeamDelete {force:true}`
- **THEN** all members are shut down, the team becomes `closed`, `agent-teams:team_closed` is emitted and the lead-only tools are deactivated

#### Scenario: Force is announced
- **WHEN** `force` is used while a member session is open
- **THEN** that session receives a visible notice that the team is closed by force before it ends

### Requirement: Minimal read-only REST surface

The server SHALL expose `GET /api/plugins/agent-teams/teams` and `GET /api/plugins/agent-teams/teams/:id` returning team summaries and a full snapshot (members, tasks, recent mail). This change SHALL register no mutating route; later changes MAY add routes under the same prefix, each with a route tier. Both routes SHALL have a route tier, allow at least 8 requests per second per client, pass teams through a visibility hook and be excluded from the MCP tool surface.

#### Scenario: Snapshot for a later UI
- **WHEN** a client requests `GET /api/plugins/agent-teams/teams/:id`
- **THEN** it receives members with status, tasks with derived `blocked`, and the latest mail entries

#### Scenario: No mutating route in this change
- **WHEN** a client sends POST/PUT/DELETE to `/api/plugins/agent-teams/*` with only this change applied
- **THEN** no handler exists and the request is rejected as not found

#### Scenario: Visibility hook narrows the list
- **WHEN** a route visibility hook returns false for a team
- **THEN** `GET /teams` omits it and `GET /teams/:id` answers not found

### Requirement: Snapshot mail is bounded

The team snapshot SHALL contain at most the latest 100 mail entries, and each entry `text` SHALL be capped at 2000 characters with a `truncated` flag.

#### Scenario: Long mail in snapshot
- **WHEN** a mail text is 5000 characters
- **THEN** the snapshot carries its first 2000 characters and `truncated:true`

### Requirement: Configuration and observability

The plugin SHALL read its limits (team, task, message, result and final-text caps, rates, timeouts, TTLs, `extraCwdRoots`, `autoDispatch`, guard switches) from a `configSchema.json`, and SHALL log structured events and counters, exposed in the REST snapshot with a `persist_degraded` flag, without logging mail bodies.

#### Scenario: Config changes limits
- **WHEN** the operator sets `maxTeammates` to 3
- **THEN** a fourth `TeammateSpawn` fails with `team_full`

#### Scenario: Mail bodies are not logged
- **WHEN** a message is delivered
- **THEN** the log line carries ids, sender, recipient and size but not the text

#### Scenario: Persistence failure is visible
- **WHEN** a team file write fails
- **THEN** state stays in memory, the next mutation retries and the REST snapshot shows `persist_degraded`

### Requirement: Lane handlers are hub-local and use the caller meta

Every request-lane handler of this plugin SHALL register as hub-local only and resolve the caller from the lane `meta.sessionId`. A call from a session that is not hub-local and locally admitted SHALL fail with `origin_denied` and SHALL NOT create, lead or change any team.

#### Scenario: Remote-origin session is refused
- **WHEN** a remote-origin session calls `TeamCreate`
- **THEN** the call fails with `origin_denied` and no team exists afterwards

#### Scenario: Caller comes from meta
- **WHEN** a handler runs
- **THEN** it authorizes by `meta.sessionId` and never by a payload field

### Requirement: Confined sessions cannot lead

A session confined by another plugin (a confinement env, or a host record whose plugin refs include another plugin) SHALL NOT register team tools, and the server SHALL refuse its `TeamCreate` and `TeammateSpawn` with `lead_confined`.

#### Scenario: Persona session cannot spawn
- **WHEN** a session spawned by another plugin calls `TeammateSpawn` on the lane
- **THEN** the call fails with `lead_confined` and nothing is spawned

### Requirement: Member names are validated and reserved

A member name SHALL match `^[a-z][a-z0-9-]{0,31}$` and SHALL NOT be `lead`, `server`, `system`, `all` or `user`; such names fail with `name_reserved`. Names of `gone` or `failed` members SHALL be reusable by a fresh spawn.

#### Scenario: Reserved name refused
- **WHEN** the lead spawns a member named `lead`
- **THEN** the call fails with `name_reserved` and no member is created

#### Scenario: Name reused after exit
- **WHEN** a `gone` member's name is spawned again without `resume`
- **THEN** a fresh member record replaces it and `TeamStatus` shows the new status

### Requirement: Bridge reports member activity

The bridge SHALL send `hello {isIdle, toolsActive, guardActive, policyHash, confined, sessionFile}` at every session start and on lane reconnect, and a `busy` report when a run starts. The server SHALL dispatch only to members whose last confirmed report is idle, SHALL treat a member as `busy` after emitting a waking mail only provisionally (reverting to the last confirmed state after `wakeConfirmMs` without a report) and SHALL drop a member's role when it answers `not_in_team`.

#### Scenario: User-started run marks busy
- **WHEN** the user chats with a teammate session and a run starts
- **THEN** the member becomes `busy` and receives no auto-claimed task

#### Scenario: Waking mail produces no turn
- **WHEN** the server emitted a waking mail and no `busy` or idle report arrives within `wakeConfirmMs`
- **THEN** the member returns to its last confirmed state and the dispatcher may claim for it again

#### Scenario: Hello mid-run
- **WHEN** a bridge reconnects while its agent is running
- **THEN** `hello` reports `isIdle:false` and the member is `busy`

#### Scenario: Session replaced
- **WHEN** a teammate session is replaced by `/new` and the server answers `not_in_team`
- **THEN** the bridge drops the team tools and guard in that process

### Requirement: Team without a bound lead

A team MAY exist with status `starting` and no `leadSessionId` but an explicit `leadCwd`. All lead notices and dispatch SHALL queue until a lead binds, and the lead-bound transition SHALL emit a store event.

#### Scenario: Starting team queues notices
- **WHEN** a member goes idle while the team is `starting`
- **THEN** the notice is queued and delivered after the lead binds

### Requirement: Typed store events and a mode registry

The store SHALL keep a per-team `rev` and expose typed events `change`, `team_created`, `lead_bound`, `task_completed`, `member_status` and `team_closed`; a throwing listener SHALL NOT affect the commit. A mode registry SHALL map `mode` to a member driver and an optional per-caller `available(callerSessionId?)` predicate, with `session` registered; an unknown or unavailable mode SHALL fail with `mode_unavailable`.

#### Scenario: Subscriber sees completion
- **WHEN** a task is completed
- **THEN** a `task_completed` event carrying the team and task is emitted after the store change

#### Scenario: Absent mode resolves from config
- **WHEN** `TeamCreate` carries no `mode` and config `teammateMode` is unset
- **THEN** the team uses `session`

#### Scenario: Unknown mode refused
- **WHEN** `TeamCreate {mode:"x"}` names an unregistered mode
- **THEN** it fails with `mode_unavailable`

### Requirement: Driver results and server actor operations

`MemberDriver.abort` SHALL return `{ok, reason?}` and `deliver` SHALL return whether the mail was handed over. When abort is not ok, the urgent path SHALL deliver the mail as a normal steer with `details.degraded:"urgent_as_steer"` and a user `abortMember` SHALL report `interrupt_unavailable`. `ops.ts` SHALL export server-only `requestShutdown(team, name, {actor:"server"})`, `sendServerMail(team, to, {kind, text, wake})` and `enqueueLeadNotice(team, {text, wake})`.

#### Scenario: Abort unavailable
- **WHEN** a driver's abort returns `{ok:false}` for an urgent mail
- **THEN** the mail is delivered as a steer and the result carries `degraded:"urgent_as_steer"`

#### Scenario: Server shutdown request
- **WHEN** the server requests shutdown of a member
- **THEN** the mail is `from server` and the lead is woken only if the member rejects or times out

### Requirement: Owner, lead spawn and per-member committer

`createTeam` SHALL accept an optional `owner`, kept by `bindLead` over the lead's `principalOwner`. The session driver SHALL expose a lead-role spawn with `pluginRef` `{"agent-teams": {teamId, role:"lead"}}`, and `onSessionResolved` SHALL bind such a session to its `starting` team through `bindLead`. `TrustedSpawnOptions.committer` SHALL apply to that member only; `Team.committer` stays `lead`.

#### Scenario: Server-started team keeps its owner
- **WHEN** a team is created with `owner` and its lead later binds
- **THEN** `Team.owner` is still the supplied owner

#### Scenario: Member committer is per member
- **WHEN** one member is spawned with `committer:"member"`
- **THEN** only that member's git-write guard and prompt variant change

### Requirement: Extension points for later changes

The plugin SHALL route every host spawn, emit, abort and shutdown call through a member driver, and SHALL expose empty-by-default registries for mail kinds, spawn-spec contributors, op gates, dispatch eligibility and route visibility. Contributors SHALL only narrow `tools`/`skills` and SHALL NOT change `cwd`.

#### Scenario: Registries are inert
- **WHEN** nothing registers
- **THEN** behaviour equals the plain session-mode flow

#### Scenario: Eligibility hook skips a member
- **WHEN** a registered dispatch eligibility returns false for an idle member
- **THEN** the dispatcher does not claim a task for it

#### Scenario: Trusted spawn option is not on the lane
- **WHEN** a lane call carries a trusted cwd option
- **THEN** the option is ignored and confinement applies

### Requirement: Ratified defaults

The plugin SHALL default `autoDispatch` to true (per-team override in `Team.overrides`), `orphanTtlMs` to 30 minutes and register the extra tool `TeamStatus` for lead and teammates. A teammate SHALL be an ordinary visible session the user can open and chat with. REST reads SHALL use the `observe` tier, with owner filtering left to the route visibility hook.

#### Scenario: Defaults on a fresh install
- **WHEN** the plugin loads with no configuration
- **THEN** `autoDispatch` is true, `orphanTtlMs` is 1 800 000 and `TeamStatus` is in the lead and teammate tool sets

#### Scenario: Teammate is a normal session
- **WHEN** a teammate is spawned
- **THEN** its spawn spec carries no hidden flag and the user can open it and send it messages

### Requirement: Lead role is released on close

When a team closes, its lead SHALL lose the lead role: the lead-only tools SHALL be unregistered and the same session MAY create a new team with `TeamCreate`.

#### Scenario: New team after close
- **WHEN** a lead's team was closed by `TeamDelete` or the orphan TTL and the lead calls `TeamCreate`
- **THEN** a new team is created and the old team's lead-only tools are gone

### Requirement: Limits are clamped and counted

A configured `maxTeammates` outside 1–10 SHALL be clamped into that range with one log line. `maxActiveTeams` SHALL count teams in status `starting`, `active` and `orphaned`, never `closed`.

#### Scenario: Out-of-range cap
- **WHEN** `maxTeammates` is configured as 0 or 11
- **THEN** the effective cap is 1 or 10 and one log line is written

#### Scenario: Closed teams do not count
- **WHEN** 2 teams are active and 1 is closed with `maxActiveTeams` 3
- **THEN** a new `TeamCreate` succeeds and a further one fails with `team_cap_reached`

### Requirement: Orphaned teams keep operating

While a team is `orphaned`, every team operation SHALL still work; mail and notices for the lead SHALL queue and flush on re-bind, and only dispatch SHALL pause. A lead `hello` SHALL re-bind the team only when elapsed time is below `orphanTtlMs`; at the TTL the team SHALL close with `closeReason: orphan_ttl`.

#### Scenario: Teammate works while orphaned
- **WHEN** a teammate completes a task or messages the lead while the team is `orphaned`
- **THEN** the completion is recorded, the mail is queued for the lead and no new task is dispatched

#### Scenario: Hello exactly at the TTL
- **WHEN** the lead `hello` arrives when elapsed equals `orphanTtlMs`
- **THEN** the team is closed with `closeReason: orphan_ttl` and is not re-bound

### Requirement: Unreadable team files are quarantined

A team file that is corrupt or has a newer `schemaVersion` SHALL be skipped on load, renamed `<id>.json.corrupt` or `<id>.json.future`, logged once and listed by REST as unavailable, while all other teams load.

#### Scenario: Newer schema
- **WHEN** `teams/x.json` has `schemaVersion` 2
- **THEN** it is renamed `x.json.future`, REST lists it as unavailable and other teams load

### Requirement: Compaction, retention and closing resume

Mail-log compaction at `maxMailLogBytes` SHALL keep every unacked entry plus the newest ones until the log is at most 50 % of the cap. `closedRetentionDays` SHALL default to 7. A team persisted as `closing` SHALL be resumed at startup so a lost grace timer cannot leave it open.

#### Scenario: Unacked mail survives compaction
- **WHEN** the log exceeds the cap while some entries are unacked
- **THEN** all unacked entries remain and the log shrinks to at most 50 % of the cap

#### Scenario: Closing team after restart
- **WHEN** a team persisted as `closing` is loaded
- **THEN** shutdown is re-requested, sessions end after `shutdownGraceMs` and the team closes once

### Requirement: Text limits and sanitising

Lengths SHALL be counted in code points. C0/C1, ANSI and bidirectional control characters SHALL be stripped silently (`\n` and `\t` are kept in mail bodies). An over-limit title (200), description (2000), `TeamCreate` name (40) or a member name failing the name regexp SHALL fail with `invalid_args`; only `result` and `finalText` SHALL be truncated.

#### Scenario: Over-limit title
- **WHEN** `TaskCreate` carries a 201-character title
- **THEN** the call fails with `invalid_args` and no task is created

#### Scenario: Code points not UTF-16 units
- **WHEN** a message of 4000 emoji (8000 UTF-16 units) is sent with `maxMessageChars` 8000
- **THEN** it is accepted

### Requirement: Shared helpers and constants are exported once

The `shared` entry SHALL export the member-name regexp and maximum length, the `parseEnvelope` limits, the line-cap helper and truncation marker, `maxFinalTextChars`, the mail-id comparator, the coalesce window and the REST rate-limit constants, so later changes import them and never copy them.

#### Scenario: Single source
- **WHEN** a later change needs the member-name grammar
- **THEN** it imports it from the `shared` entry and the server enforces the same value

### Requirement: REST limits, visibility and totals

REST reads SHALL be limited per principal (client address when unauthenticated) to 8 requests per second with a burst of 16, from constants exported by `shared` together with the write limit (2 per second, burst 5) for later routes. A route visibility hook that throws or times out SHALL fail closed. The snapshot SHALL carry `mailTotal`, the real mail count, next to the bounded `mail` list.

#### Scenario: Hook failure fails closed
- **WHEN** the visibility hook throws for a team
- **THEN** `GET /teams` omits it, `GET /teams/:id` answers 404 and the error is logged

#### Scenario: Mail total
- **WHEN** a team has 250 mail entries
- **THEN** the snapshot has at most 100 `mail` entries and `mailTotal` is 250

### Requirement: Actor operation semantics

`teamDelete {force}` SHALL be forced for the `lead` and `user` actors alike: a visible notice precedes shutdown and sessions end after `shutdownGraceMs` even if a member rejected; for the user actor the lead session stays open. `abortMember` SHALL abort only the in-flight run: the member's tasks stay `in_progress`, the member is not woken and the lead gets one waking notice.

#### Scenario: Forced delete by the user
- **WHEN** the `user` actor force-closes a team in which a member rejected shutdown
- **THEN** that member's session ends after the grace period and the lead session stays open

#### Scenario: Stop a member
- **WHEN** the `user` actor aborts a busy member that owns an `in_progress` task
- **THEN** the run is aborted, the task stays `in_progress`, the member starts no new turn and the lead gets one waking notice
