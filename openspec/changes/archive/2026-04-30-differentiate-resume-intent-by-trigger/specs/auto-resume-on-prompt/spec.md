## ADDED Requirements

### Requirement: Auto-resume tags front intent so card surfaces
When the server's `handleSendPrompt` detects `status === "ended"` and triggers an auto-resume, it SHALL tag `pendingResumeIntents.record(sessionId, "front")` BEFORE calling `spawnPiSession`. The user is actively interacting with the session by typing into it; the resumed card SHALL surface at the top of the alive tier.

This requirement closes a gap in the prior spec: the prompt-auto-resume path queued the prompt and spawned the pi process but did not participate in the ordering contract, leaving the resumed session in its previous (often mid-bucket) position.

#### Scenario: Prompt to ended session surfaces card at top
- **WHEN** the user types a prompt and submits it for an ended session "s1" that is not currently at index 0 of `sessionOrder`
- **THEN** before `spawnPiSession`, the server SHALL call `pendingResumeIntents.record("s1", "front")`
- **AND** when the bridge re-registers "s1" and the ended→alive transition fires, the server SHALL move "s1" to the front of `sessionOrder`
- **AND** the server SHALL broadcast `sessions_reordered` with the new order

#### Scenario: Prompt to ended session without sessionFile does not tag intent
- **WHEN** an ended session has no `sessionFile` and the user submits a prompt to it
- **THEN** the server SHALL NOT call `pendingResumeIntents.record` (because no resume is attempted; the prompt is dropped per existing behavior)

#### Scenario: Multiple rapid prompts to ended session do not duplicate tags
- **WHEN** the user submits two prompts in quick succession to ended session "s1" before the first auto-resume completes
- **THEN** the second `handleSendPrompt` invocation SHALL early-return on the existing `alreadyResuming` guard
- **AND** the second call SHALL NOT re-tag the registry (the first tag is sufficient and still within TTL)
