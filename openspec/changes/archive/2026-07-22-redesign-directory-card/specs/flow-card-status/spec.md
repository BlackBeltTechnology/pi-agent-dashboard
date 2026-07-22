## MODIFIED Requirements

### Requirement: Code and code-decision step cards

The flow card grid SHALL render distinct cards for `code` and `code-decision` step kinds, keyed off the lifecycle event `nodeKind`. Per the pi-flows `surface-node-kind` change, the card type is decided once at `flow_agent_started` (which carries `nodeKind`) and SHALL NOT change at `flow_agent_complete`. A `code` card SHALL show the code badge, the handler path (from the `started` payload), a **Log** preview, and the summary, where: the Log is the step's `flow_assistant_text` `detailHistory` text entries (emitted by `ctx.logger`, keyed to the node's `stepId` — NOT a new channel); the summary is `flow_agent_complete.summary`. The Log preview SHALL render via the shared `LogBlock` primitive in `preview` mode (last N lines, monospace, bounded height) and SHALL expose a copy control (copying the FULL log text) and an expand affordance to reveal the full log — replacing the prior fixed last-3 truncated lines that offered neither copy nor expand. A `code-decision` card SHALL additionally show the chosen branch and, when the edge is backward (a loop), a `↻ n/max` loop pill.

#### Scenario: Code log preview from assistant-text entries
- **WHEN** a code handler calls `ctx.logger("checking record against NAV")` during the step
- **THEN** that text arrives as a `flow_assistant_text` entry keyed to the code step
- **AND** the code card SHALL surface it in the Log preview (no separate log event/channel is required)

#### Scenario: Log preview offers copy and expand
- **WHEN** a code card's Log preview shows the last 3 of many log lines
- **THEN** a copy control SHALL be present that writes the FULL log text to the clipboard
- **AND** an expand affordance SHALL reveal the full log body bounded by a scrollable max height

#### Scenario: Code card renders
- **WHEN** a `flow_agent_started` event arrives with `nodeKind: "code"`
- **THEN** the grid SHALL render a code card with a `code` badge and the handler path

#### Scenario: Code-decision card shows chosen branch
- **WHEN** a `code-decision` step completes with chosen branch `rework` from its typed outputs
- **THEN** the card SHALL display the taken branch `rework`

#### Scenario: Loop pill on backward edge
- **WHEN** a `code-decision` (or `agent-decision`) routes a backward edge on iteration 2 of `max_iterations` 3
- **THEN** the card SHALL display a `↻ 2/3` loop pill
