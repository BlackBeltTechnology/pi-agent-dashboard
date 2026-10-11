## MODIFIED Requirements

### Requirement: Capture-before-send streaming gate prevents idle-message false-chip

Pi flips `isAgentStreaming` synchronously inside `pi.sendUserMessage` on an idle session (via `agent_start` emission to the extension runner). Therefore the bridge SHALL capture `wasStreaming = isAgentStreaming` **before** calling `pi.sendUserMessage`, and SHALL only record to the shadow queue when `wasStreaming === true`.

Call sites:

- `command-handler.ts` passthrough branch: capture before `sendUserMessageWithImages`, fire `onSteerSent` / `onFollowupSent` only if captured-true.
- the bridge's `sessionPrompt` fallback (slash-route follow-up/steer): same pattern.
- the bridge's `edit_followup_slot` / `edit_followup_entry` handler: same pattern.

The internal gate inside `recordSteerSent` / `recordFollowupSent` SHALL also check `isAgentStreaming` as defense-in-depth.

#### Scenario: Initial idle send produces no chip
- **WHEN** the agent is idle (`isAgentStreaming === false`)
- **AND** the bridge receives `send_prompt { text: "hello", delivery: "steer" }`
- **AND** pi flips `isAgentStreaming` to `true` synchronously inside `pi.sendUserMessage` (via agent_start)
- **THEN** the bridge SHALL NOT append to `bridgeSteering`
- **AND** the bridge SHALL NOT emit `queue_update` with a chip
- **AND** the message SHALL be processed by pi as a fresh turn

#### Scenario: Mid-stream steer produces a chip
- **WHEN** `isAgentStreaming === true` at the moment of `send_prompt {delivery:"steer"}`
- **THEN** the bridge SHALL append to `bridgeSteering`
- **AND** the bridge SHALL emit `queue_update` with the new entry
