## MODIFIED Requirements
### Requirement: Status row carries the activity indicator and host pressure
The status row SHALL render the existing `ActivityIndicator` output (Resuming, ended reason, Needs you, Retry N, current tool, Thinking…, Failed, Idle) unchanged in content except that an idle/active session with an unresolved error reads `Failed` instead of `Idle` (`session-card-status`), plus `HostPressureIndicator` right-aligned. The activity container keeps its historic `data-testid="session-card-meta"`: it identifies the status row's activity container, not the meta row.

The activity container SHALL be the shrinking element (`min-w-0`, clipped). The status row SHALL NOT wrap or overflow the card. Variants whose text can be long (current tool, Needs you, Retry) truncate with an ellipsis. The host-pressure indicator SHALL NOT shrink.

When both `ActivityIndicator` and `HostPressureIndicator` render nothing, the status row SHALL NOT render. That includes an ended session whose ended-reason pill renders nothing (moved away, or no `closedReason`). The decision and both indicators SHALL be computed from the same inputs: one `hasWidgetBarPrompt` read and one card-level clock value. The clock ticks only while `session.hostPressure` is present, as today, so idle cards do not re-render on a timer. They SHALL share one implementation of the indicators' complete branch list, so the row never renders empty and never hides content. The host-pressure level SHALL still advance over time without any other re-render trigger.

#### Scenario: Running tool shows in the status row
- **WHEN** a desktop card renders a session with `currentTool: "bash"`
- **THEN** the status row SHALL contain the text `bash`
- **AND** the status row SHALL appear after the title row and before the git row

#### Scenario: Long tool text truncates
- **WHEN** the activity text is wider than the status row
- **THEN** the activity text SHALL be ellipsized on one line
- **AND** the host-pressure indicator, when present, SHALL remain fully visible

#### Scenario: Nothing to show hides the row
- **WHEN** a desktop card renders an ended session with no `closedReason`, not moved away, whose host-pressure derivation is healthy
- **THEN** no status row element SHALL be rendered

#### Scenario: Host pressure appears without another update
- **WHEN** a streaming session's last heartbeat ages past the host-pressure threshold and no session update arrives
- **THEN** the status row SHALL show the host-pressure indicator within one clock tick (≤ 5 s)
#### Scenario: Failed run shows in the status row
- **WHEN** a desktop card renders a session with `status: "idle"`, no `currentTool` and `hasError` true
- **THEN** the status row SHALL contain the text `Failed` and SHALL NOT contain `Idle`
