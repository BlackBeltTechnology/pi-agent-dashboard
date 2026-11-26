## ADDED Requirements

### Requirement: Read routes are owner-filtered through core's visibility hook

The plugin SHALL register `canViewTeam` with core's `setRouteVisibility`. When identity is not enforced every team is visible. When enforced, a caller may view a team when it is the local operator or its principal equals `Team.owner`; a team without an owner SHALL be hidden from everyone else, including teams persisted before owners were recorded. A throw or timeout in the hook SHALL fail closed: the team is omitted, its id answers 404 and the error is logged.

#### Scenario: Other user's team
- **WHEN** user B requests the id of user A's team
- **THEN** the response is 404 identical to an unknown id and the list for B omits that team

#### Scenario: Local operator
- **WHEN** the local operator lists teams under enforced identity
- **THEN** all teams are returned

#### Scenario: Identity not enforced
- **WHEN** identity is inactive
- **THEN** every admitted caller sees every team as before

#### Scenario: Ownerless team
- **WHEN** identity is enforced and a team record has no `owner`
- **THEN** only the local operator can see it

#### Scenario: Visibility hook fails
- **WHEN** `canViewTeam` throws or times out while the team is listed or fetched
- **THEN** the team is omitted from the list, its id answers the same 404 as an unknown id and the error is logged once without agent text

### Requirement: Access helpers are shared with later team routes

`server/access.ts` SHALL export `canViewTeam` and `canControlTeam` so that every later team-scoped route (plan decision, hook trust) can reuse the same owner rule and the same 404-for-invisible behaviour. A team created by change 3's REST start already has `owner` set.

#### Scenario: Reuse by a later change
- **WHEN** a later change registers a team-scoped route
- **THEN** it calls the exported helpers instead of re-implementing the owner rule

### Requirement: Session lookup filter on the list route

`GET /teams` SHALL accept `sessionId` and return at most one team summary whose lead or member session id equals it, after owner filtering. When several teams match, a live team SHALL win over a closed one and, within a class, the most recently changed team SHALL win. The match SHALL scan the teams, not the in-memory index. An empty, repeated, array-form, NUL-containing or longer than 128 characters `sessionId` SHALL answer 400 `bad_session_id`.

#### Scenario: Teammate session lookup
- **WHEN** the list is requested with a teammate's session id
- **THEN** exactly that member's team summary is returned

#### Scenario: Lead of a closed and a live team
- **WHEN** a session led a closed team and now leads a live one
- **THEN** the live team is returned

#### Scenario: Invalid session id
- **WHEN** the list is requested with `sessionId=` empty, repeated or longer than 128 characters
- **THEN** the response is 400 `bad_session_id` and no team list is returned

### Requirement: Snapshot states the viewer's capability

The snapshot SHALL include `viewerCanControl`, true only when the caller may control the team under the owner rule (it does not reflect the credential tier). The UI SHALL render controls only when it is true, and the server SHALL re-check on every mutating call.

#### Scenario: Forged control
- **WHEN** a client without control sends the stop request anyway
- **THEN** the server refuses it with the same 404 as an invisible team

### Requirement: User can stop a member's current turn

`POST /api/plugins/agent-teams/teams/:id/members/:name/stop` SHALL, for a `busy` connected member of a controllable team, call core's `abortMember(team, name, {actor:"user"})`, keep its tasks `in_progress`, queue a waking lead notice naming the member and the ids of the tasks it still owns, and answer `{aborted:true}`. No confirmation is asked in the UI.

#### Scenario: Stop a busy member
- **WHEN** the owner stops busy member `alice` who owns task 3
- **THEN** her turn is aborted, task 3 stays `in_progress` and the lead receives a waking notice that she was stopped and still owns task 3

#### Scenario: Stop leaves no silent stall
- **WHEN** the stopped member settles idle
- **THEN** no error is reported for it, nothing is auto-claimed for it, and the lead notice is the visible signal

### Requirement: Stop outcomes are explicit, idempotent and free of agent text

A non-busy member SHALL answer 409 `not_busy`; a `disconnected` or busy-without-connection member 409 `not_connected`; an unknown member 404 with the body of an unknown team; a closing or closed team 409 `team_closed`. A repeat while the abort is pending SHALL answer `{aborted:true}` with no second abort or notice. The notice lists task ids only (max 10, then "+N more"), never titles.

#### Scenario: Stop an idle member
- **WHEN** the member is `idle`
- **THEN** the response is 409 `not_busy` and nothing is aborted

#### Scenario: Abort not dispatched
- **WHEN** the member is `busy` in the store but has no live connection
- **THEN** the response is 409 `not_connected`

#### Scenario: Unknown member or closed team
- **WHEN** the member name is unknown, or the team is closing or closed
- **THEN** an unknown member answers 404 identical to an unknown team and a closing or closed team answers 409 `team_closed`

#### Scenario: Double click
- **WHEN** a second stop arrives while the first abort is still pending
- **THEN** it answers `{aborted:true}`, no second abort is dispatched and no second notice is queued

#### Scenario: Many owned tasks
- **WHEN** the stopped member owns 50 tasks
- **THEN** the notice lists ten task ids followed by "+40 more" and contains no task title

#### Scenario: Orphaned team
- **WHEN** the team is `orphaned` and the user stops a busy member
- **THEN** the route succeeds and the notice is queued for a later lead bind

### Requirement: User can shut the team down

`POST /api/plugins/agent-teams/teams/:id/shutdown` SHALL call core's `teamDelete(team, {actor:"user", force:true})` and answer 202 `{closing:true}` once the team is `closing`, without waiting out `shutdownGraceMs`. A repeat call while `closing` SHALL answer 202 again; a `closed` team SHALL answer 409 `team_closed`. The lead session stays running and gets one non-waking notice "team shut down by the user" (queued for a later bind when the team is orphaned).

#### Scenario: Shut down with live members
- **WHEN** the owner shuts down a team with two live members, one of which would reject
- **THEN** the route answers 202, both members are ended after the grace, the team becomes `closed` and the lead session still runs

#### Scenario: Repeat while closing
- **WHEN** the shutdown route is called again while the team is `closing`
- **THEN** it answers 202 and starts no second shutdown

#### Scenario: Already closed
- **WHEN** the shutdown route is called for a `closed` team
- **THEN** it answers 409 `team_closed`

#### Scenario: Lead is told without a turn
- **WHEN** the user shuts the team down while the lead is live
- **THEN** the lead receives exactly one non-waking notice "team shut down by the user" and no lead turn is triggered by the action

#### Scenario: Closing team after a restart
- **WHEN** the server restarts with a team persisted as `closing` and the route is called
- **THEN** it answers 202 as a no-op because core resumes the closing team at startup and closes it within the grace period

### Requirement: New routes are tiered, rate-limited and kept off the MCP surface

Both POST routes SHALL use the param name `:name` for the member, have `control` rows in `ROUTE_TIERS` (supervision of running work is `control`; plan approval and hook trust of later changes are `operate`), live under core's rate-limited prefix, be covered by the `/api/plugins/agent-teams/` MCP denylist prefix, and log a structured outcome with ids and no agent text.

#### Scenario: Observe-tier token
- **WHEN** a credential limited to `observe` calls a mutating route
- **THEN** the host tier gate refuses it

#### Scenario: Not an MCP tool
- **WHEN** the MCP manifest is built
- **THEN** neither route is exposed as a tool

### Requirement: Control routes are rate limited per principal and observable

Core's limiter SHALL apply per principal (the client IP when unauthenticated): reads 8 requests per second with burst 16, writes 2 per second with burst 5, using core's exported constants. Route outcomes and the counters of frames, refetches, 304s, owner-filtered 404s and stop/shutdown results SHALL be structured log lines with a `counter` field aggregated every 60 s, carrying ids only.

#### Scenario: Many open views
- **WHEN** one principal has ten Team views open on a busy team
- **THEN** 429 answers are handled gracefully with `Retry-After` honoured and no unhandled error

#### Scenario: No agent text in logs
- **WHEN** a stop or shutdown completes for a team whose task text contains a secret marker
- **THEN** the log line carries team id, member name and outcome only
