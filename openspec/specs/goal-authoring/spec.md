# goal-authoring Specification

## Purpose
TBD - created by archiving change sophisticate-goal-authoring-and-control. Update Purpose after archive.
## Requirements
### Requirement: Rich goal authoring captures judge, budget, and criteria
The goal create/edit surface SHALL let a user define a goal's acceptance
criteria, turn budget, spend cap, and judge model in addition to the objective.
The `POST /api/folders/goals` and `PATCH /api/folders/goals/:id` endpoints SHALL
accept and validate a `judge?: { provider, modelId, sameModel? }` field
alongside the already-accepted `criteria?` and `budget?` fields. Absent fields
SHALL behave exactly as before this change.

#### Scenario: Create goal with full definition
- **WHEN** a user submits objective + criteria + budget + judge from the create form
- **THEN** the created `GoalRecord` SHALL persist `objective`, `criteria[]`,
  `budget`, and `judge`
- **AND** the response SHALL echo all four

#### Scenario: Malformed judge rejected
- **WHEN** a POST/PATCH body includes `judge` missing `provider` or `modelId`
- **THEN** the server SHALL respond `{ success: false }` with a descriptive error
- **AND** SHALL NOT persist a partial judge

#### Scenario: Legacy record without new fields
- **WHEN** a `GoalRecord` created before this change is loaded
- **THEN** it SHALL load without error
- **AND** `judge` and `verdicts` SHALL be treated as absent (empty UI states)

### Requirement: Live loop controls available from the goal surface
The goal detail surface SHALL expose pause, resume, mark-done, clear, and
add-subgoal controls that dispatch through the existing `plugin_action` channel
(`goalCommandFor` → `/goal …` / `/subgoal …`). No new server control contract is
required; the controls SHALL reuse the existing action mapping.

#### Scenario: Pause from detail page
- **WHEN** the user clicks Pause on an active goal's detail page
- **THEN** a `plugin_action` with `action:"pause"` SHALL be sent for the goal's
  driver session
- **AND** the server SHALL dispatch `/goal pause` into that session

#### Scenario: Add subgoal mid-loop
- **WHEN** the user adds a criterion on an active goal
- **THEN** a `plugin_action` with `action:"subgoal"` and the criterion text SHALL
  be sent
- **AND** the server SHALL dispatch `/subgoal <text>` without resetting the loop

### Requirement: Goal deletion has a UI surface
The goal surface SHALL expose a delete affordance that invokes the existing
`DELETE /api/folders/goals/:id` endpoint. Deletion SHALL require explicit
confirmation and SHALL clear the `goalId` on every previously linked session (the
endpoint already does this server-side). No new server contract is required.

#### Scenario: Delete from detail page with confirm
- **WHEN** the user clicks Delete goal on the detail page and confirms
- **THEN** `DELETE /api/folders/goals/:id` SHALL be called
- **AND** the linked sessions' `goalId` SHALL be cleared
- **AND** the user SHALL be returned to the goals board

#### Scenario: Delete cancelled
- **WHEN** the user clicks Delete goal but dismisses the confirmation
- **THEN** no request SHALL be sent and the goal SHALL remain unchanged

### Requirement: Per-turn judge verdict history is retained and shown
The server SHALL accumulate a bounded, FIFO-capped history of judge verdicts for
each goal, derived from advances in the `goal_status` snapshot stream of the
goal's driver session. The goal detail surface SHALL render this history as a
newest-first timeline.

#### Scenario: Verdict appended on snapshot advance
- **WHEN** a driver session's `goal_status` snapshot advances `turnsUsed` with a
  new `lastVerdict`
- **THEN** a `GoalVerdict { turn, at, verdict, note? }` SHALL be appended to the
  owning `GoalRecord.verdicts`

#### Scenario: History is bounded
- **WHEN** more than the cap (e.g. 50) verdicts accrue
- **THEN** the oldest SHALL be dropped so length never exceeds the cap
- **AND** the newest verdict SHALL always be retained

#### Scenario: Empty timeline when no history
- **WHEN** a goal has no recorded verdicts (legacy or brand-new)
- **THEN** the detail timeline SHALL show an empty state, not an error

### Requirement: Judge/budget loop coupling degrades gracefully
Pushing judge model and budget into the live loop SHALL be gated on the
`@ricoyudog/pi-goal-hermes` command surface detected at runtime. When the
extension cannot accept the configuration, the dashboard SHALL still record the
intent on the `GoalRecord` and SHALL NOT error.

#### Scenario: Extension accepts config
- **WHEN** the probe reports the extension accepts judge/budget configuration
- **THEN** the dashboard SHALL push the configured judge + budget into the loop

#### Scenario: Extension accepts only objective + subgoal
- **WHEN** the probe reports only `/goal <text>` + `/subgoal <text>` support
- **THEN** criteria SHALL be applied via `/subgoal`
- **AND** budget SHALL be enforced dashboard-side (no continuation past the cap)
- **AND** the judge model SHALL be recorded as intent only

#### Scenario: Unknown surface
- **WHEN** the probe cannot determine the command surface
- **THEN** judge + budget SHALL be recorded on the `GoalRecord` with no loop
  coupling
- **AND** no error SHALL be surfaced to the user

