## MODIFIED Requirements

### Requirement: InputEvent streaming-behavior rendering

The reducer SHALL recognize `eventType === "input"` events from pi 0.77+ and render the `streamingBehavior` field as user-visible state in the transcript when the input came from interactive user typing during a streaming turn.

Specifically, for `data.source === "interactive"`:

- `data.streamingBehavior === "steer"` SHALL produce a transcript affordance indicating the message will interrupt and steer the current turn.
- `data.streamingBehavior === "followUp"` SHALL produce a transcript affordance indicating the message is queued and will deliver after the current turn ends.
- `data.streamingBehavior === undefined` (idle input) SHALL produce no transcript affordance — the subsequent `message_start { role: "user" }` covers the message.

For `data.source !== "interactive"` (RPC dispatches, extension-synthesized inputs), the reducer SHALL NOT render a streaming-behavior affordance to avoid duplicating signal that already appears via command_feedback / extension messages.

The exact rendering shape (typed status row vs. inline badge on the user-message row) is delegated to design.md; both shapes satisfy this requirement.

#### Scenario: Mid-stream steer renders affordance

- **WHEN** an `input` event arrives with `source: "interactive"` and `streamingBehavior: "steer"`
- **THEN** the transcript SHALL include an affordance indicating the user's message will steer the current streaming turn

#### Scenario: Mid-stream followUp renders affordance

- **WHEN** an `input` event arrives with `source: "interactive"` and `streamingBehavior: "followUp"`
- **THEN** the transcript SHALL include an affordance indicating the user's message is queued for delivery after the current streaming turn

#### Scenario: Idle input produces no affordance

- **WHEN** an `input` event arrives with `source: "interactive"` and `streamingBehavior` undefined
- **THEN** the reducer SHALL NOT add a streaming-behavior affordance to the transcript
- **AND** the subsequent `message_start { role: "user" }` event SHALL render the user message normally

#### Scenario: Non-interactive source produces no affordance

- **WHEN** an `input` event arrives with `source: "rpc"` or `source: "extension"`
- **THEN** the reducer SHALL NOT add a streaming-behavior affordance regardless of the `streamingBehavior` value

#### Scenario: Pi <0.77 input event is harmless

- **WHEN** the connected pi version predates 0.77 and the `streamingBehavior` field is always absent
- **THEN** the reducer SHALL treat all interactive `input` events as idle (no affordance) without error
