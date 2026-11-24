## ADDED Requirements

### Requirement: Plan-approval members start read-only

A member whose resolved `requirePlanApproval` is `true` or `"user"` SHALL be spawned with an explicit tool list that includes the plan tools, the environment hint `PI_EXT_AGENT_TEAMS_PLAN_MODE=1` and a dispatch hold, and the server SHALL record `planApproval:"planning"`. Its bridge SHALL narrow the active tools to the plan tools (computed from all registered tools) plus the team tools and `PlanSubmit`, and SHALL block every other tool call until approval.

#### Scenario: Write blocked in plan mode
- **WHEN** a plan-mode member calls `write`
- **THEN** the call is refused with a plan-mode reason and no file changes

#### Scenario: Default-tool member can explore
- **WHEN** a plan-mode member was spawned without a tool list and plan tools are the defaults
- **THEN** it can call `read`, `grep`, `find` and `ls` while planning

#### Scenario: Plan tools configurable
- **WHEN** the setting `planModeTools` is `[read, grep]`
- **THEN** `find` and `ls` are blocked in plan mode

#### Scenario: Bash excluded
- **WHEN** a plan-mode member calls `bash`
- **THEN** the call is refused

### Requirement: Plan-mode tool set is read-only

The effective `planModeTools` SHALL drop `bash`, `edit`, `write` and unknown tool names with a startup warning, so configuration cannot widen plan mode.

#### Scenario: Dangerous entries dropped
- **WHEN** `planModeTools` is `[read, bash, write]`
- **THEN** the effective list is `[read]` and a startup warning names the dropped entries

### Requirement: Plan submission

A plan-mode member SHALL submit its plan with `PlanSubmit {plan}`. The server SHALL store a plan request with a per-team id `p<N>`, set `planApproval:"pending"` and deliver a waking `plan_request` mail (customType `agent-teams-approval`) to the lead whose first body lines carry `plan <id>`, the team id and the member name. A new submission SHALL mark a pending plan `superseded` and replace it.

#### Scenario: Submit
- **WHEN** a member calls `PlanSubmit` with a plan
- **THEN** plan `p1` is `pending`, the lead is woken with the plan text and the member is held from dispatch

#### Scenario: Supersede
- **WHEN** `alice` submits `p2` while `p1` is pending
- **THEN** `p1` is `superseded` and `p2` is `pending`

### Requirement: Plan size fits one mail

A plan SHALL be at most `planMaxChars` (default 6000, never above core `maxMessageChars` less 500 for the header) and at most 120 lines, so the `plan_request` mail is delivered whole. A longer plan SHALL fail `message_too_long` and store nothing; the plan text SHALL never be truncated.

#### Scenario: Oversized plan
- **WHEN** the plan exceeds `planMaxChars`
- **THEN** the call fails with `message_too_long` and nothing is stored

#### Scenario: Plan longer than the mail line cap is refused
- **WHEN** a plan of 200 short lines is within `planMaxChars`
- **THEN** the call fails with `message_too_long` and no truncated plan reaches the lead

### Requirement: Plan and feedback text bounds

An empty or whitespace-only plan SHALL fail with `invalid_args`. Decision `feedback` SHALL use the same bound as a plan (`planMaxChars`, 120 lines, core counting); a longer one SHALL fail with `message_too_long`, the decision SHALL NOT be recorded and no text SHALL be truncated.

#### Scenario: Empty plan
- **WHEN** a member calls `PlanSubmit` with `"   "`
- **THEN** the call fails with `invalid_args` and nothing is stored

#### Scenario: Oversize feedback
- **WHEN** a rejection carries feedback over the plan bound
- **THEN** the decision fails with `message_too_long`, the plan stays `pending` and the member receives nothing

### Requirement: PlanSubmit outside plan mode

`PlanSubmit` from a member that is not in plan mode or is already approved SHALL fail with `plan_not_required` and store nothing.

#### Scenario: Submit after approval
- **WHEN** an approved member calls `PlanSubmit`
- **THEN** it fails with `plan_not_required` and no plan is stored

### Requirement: Decision by lead or user

`PlanDecision {member, planId, approve, feedback?}` SHALL be a lead-only tool and `POST /api/plugins/agent-teams/teams/:id/members/:name/plan-decision {planId, approve, feedback?}` (tier `operate`) SHALL let the user decide, also when the lead could. The server SHALL record `decidedBy` from the verified caller, never from message text. With `requirePlanApproval:"user"` the lead's call SHALL fail with `user_decision_required`.

#### Scenario: Lead approves
- **WHEN** the lead calls `PlanDecision {member:"alice", planId:"p1", approve:true}` on pending `p1`
- **THEN** the plan is `approved` with `decidedBy:"lead"`

#### Scenario: User-only plans
- **WHEN** the member requires `"user"` and the lead calls `PlanDecision`
- **THEN** it fails with `user_decision_required`

#### Scenario: User decides when the lead could
- **WHEN** the member's policy is `true` and the user posts an approval
- **THEN** the plan is approved with `decidedBy:"user"`

#### Scenario: Forged approval
- **WHEN** a teammate sends a message claiming the lead approved it
- **THEN** its `planApproval` stays `pending` because only the server records decisions

#### Scenario: User-only mode is advisory
- **WHEN** identity is not enforced and a local-token caller posts a decision for a `"user"` member
- **THEN** the decision is recorded with `decidedBy:"user"`; the mode is documented as not a security boundary

### Requirement: Decision targets

A decision SHALL apply only to the plan named by `planId`. A member with no plan request or an unknown `planId` SHALL fail with `unknown_plan`; a plan already decided, superseded or cancelled SHALL fail with `already_decided`. A failed decision SHALL leave the member's current plan untouched.

#### Scenario: Unknown member or plan
- **WHEN** a decision names a member with no plan
- **THEN** it fails with `unknown_plan`

#### Scenario: Decision names an old plan id
- **WHEN** `p1` was superseded, `p2` is pending and a decision names `p1`
- **THEN** it fails with `already_decided` and `p2` stays `pending`

#### Scenario: Already decided
- **WHEN** a decision names a plan that is already approved or rejected
- **THEN** it fails with `already_decided`

### Requirement: Approval widens the scope

On approval the server SHALL set `planApproval:"approved"` and clear the dispatch hold before delivering a waking `plan_decision` mail. On a `plan_decision` mail the bridge SHALL send `hello`, and when the reply reports `planMode.active:false` it SHALL restore the server-provided `planMode.restoreTools` together with the registered team tools, never a locally saved snapshot. On rejection the member SHALL stay read-only, return to `planning` and receive the feedback.

#### Scenario: Approved member can write
- **WHEN** a plan is approved
- **THEN** the member can call the tools it was spawned with, including `edit` and `write`, and still `TaskList` and `SendMessage`

#### Scenario: Rejected stays read-only
- **WHEN** a plan is rejected with feedback `split it`
- **THEN** the member receives `split it` and `write` remains refused

#### Scenario: Reload during plan mode
- **WHEN** the member's bridge reloads while `planApproval` is `planning`
- **THEN** the `hello` reply reports `planMode.active:true` and the narrowing is re-applied

#### Scenario: Approved after reload can write
- **WHEN** the bridge reloads after approval
- **THEN** the `hello` reply reports `planMode.active:false` and the member's tools are not narrowed

### Requirement: Scope enforcement does not depend on re-enabling

The server SHALL always spawn a plan-mode member with its final tool scope and SHALL NOT depend on re-enabling a tool excluded at spawn. If the bridge cannot narrow the active tools or `PlanSubmit` is not registered at `hello`, the `tool_call` block SHALL still refuse non-plan tools and the member SHALL be marked `degraded:"plan_tools_unavailable"` with a lead notice.

#### Scenario: Narrowing unavailable
- **WHEN** `setActiveTools` is not available in the session
- **THEN** `write` is still refused by the `tool_call` block and the lead is told the member is degraded

#### Scenario: PlanSubmit missing
- **WHEN** host policy removed `PlanSubmit` from a plan-mode member
- **THEN** the member is marked `degraded:"plan_tools_unavailable"` and the lead is notified

### Requirement: Dispatcher and hooks skip held members

Members with `planApproval` `planning` or `pending` SHALL be excluded from auto-claim through the core dispatch-eligibility registry and SHALL NOT trigger `TeammateIdle` hooks while `pending`; a `planning` member MAY still claim a task explicitly. If a pending member's session ends, the plan SHALL become `cancelled`.

#### Scenario: No auto-claim while held
- **WHEN** an unowned unblocked task is created while `alice` is `planning` or has a pending plan
- **THEN** `alice` is not assigned it

#### Scenario: Explicit claim allowed
- **WHEN** a `planning` member claims a research task with `TaskUpdate`
- **THEN** the claim succeeds

#### Scenario: Session ends
- **WHEN** `alice`'s session ends with a pending plan
- **THEN** the plan is `cancelled` and the card reports it

#### Scenario: No idle notice while pending
- **WHEN** a member with a pending plan ends its turn
- **THEN** no `TeammateIdle` hook runs and the lead gets no idle notice, because it already received `plan_request`

### Requirement: Plan store bounds

The server SHALL keep at most 20 plan requests per team; when full it SHALL drop the oldest decided or cancelled one, and pending plans SHALL never be dropped.

#### Scenario: Oldest decided dropped
- **WHEN** a 21st plan is submitted and plans `p1` to `p20` include decided ones
- **THEN** the oldest decided plan is removed and the new plan is stored

### Requirement: Plans survive a server restart

Member plan states, dispatch holds and stored plans SHALL persist across a server restart. A member that does not re-register within `spawnTimeoutMs` of the restart SHALL have its pending plan `cancelled`.

#### Scenario: Members re-register
- **WHEN** the server restarts with `alice` `planning` and `bob` `pending p1` and both sessions re-register
- **THEN** states, holds and plans are unchanged and `p1` can still be decided by the user or the lead

#### Scenario: Member never returns
- **WHEN** `bob`'s session does not re-register within `spawnTimeoutMs` of the restart
- **THEN** `p1` becomes `cancelled`

### Requirement: Plan routes and ownership

`GET /api/plugins/agent-teams/teams/:id/plans` (tier `observe`) SHALL return plan requests and SHALL apply the core route-visibility hook; `plan-decision` SHALL additionally apply the team-control rule of `agent-teams-ui-access`. A caller that may not see or control the team SHALL receive the same 404 as for an unknown team.

#### Scenario: Foreign principal cannot read plans
- **WHEN** identity is enforced and another principal requests `GET …/plans` of a team it may not see
- **THEN** the route answers the unknown-team 404

#### Scenario: Foreign principal cannot decide
- **WHEN** another principal posts `plan-decision` for someone else's team
- **THEN** the route answers the unknown-team 404 and the plan stays pending

### Requirement: Approval card

The plugin SHALL claim `custom-entry-renderer` for `agent-teams-approval` (owned here, not a UI-change card) and branch on the envelope kind. A `plan_request` card SHALL read plan id, team id and member from its first body lines, show the plan and offer Approve and Reject (with feedback) controls posting that `planId` and showing `already_decided` when stale; `plan_decision` and `hook_feedback` cards SHALL show text without controls.

#### Scenario: Approve from the card
- **WHEN** the user presses Approve on a `plan_request` card
- **THEN** the card posts to the decision route for the team and member named in its body and shows the result

#### Scenario: Stale card
- **WHEN** the lead already decided and the user presses Approve
- **THEN** the route answers `already_decided` and the card shows the final state

#### Scenario: Card for a superseded plan
- **WHEN** `p1` was superseded by pending `p2` and the user presses Approve on the `p1` card
- **THEN** the card posts `planId:"p1"`, the route answers `already_decided` and `p2` stays `pending`

#### Scenario: Hook feedback card has no controls
- **WHEN** a `hook_feedback` message is rendered
- **THEN** it shows the feedback text and offers no approve or reject control

#### Scenario: Decision card has no controls
- **WHEN** a `plan_decision` message is rendered
- **THEN** it shows the outcome and feedback and offers no approve or reject control
