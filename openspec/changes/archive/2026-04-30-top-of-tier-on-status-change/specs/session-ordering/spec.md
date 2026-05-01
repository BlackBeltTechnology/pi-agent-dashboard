## ADDED Requirements

### Requirement: Ended-tier sort by endedAt descending
The client SHALL sort session cards within the **ended tier** of a folder group by `(endedAt ?? startedAt)` descending, regardless of `sessionOrder`. The most recently-ended session SHALL appear at the top of the ended tier.

This requirement applies to ended sessions only — the alive tier continues to use the existing `sessionOrder`-then-`startedAt`-desc rule defined in "Client renders sessions in server order".

#### Scenario: ✕ shutdown surfaces card at top of ended tier
- **WHEN** the user clicks the ✕ (shutdown) button on an alive session whose `startedAt` is older than other ended sessions in the same folder
- **THEN** after the alive→ended transition the card SHALL render at the top of the ended tier (because its `endedAt` is the most recent)

#### Scenario: Natural pi exit surfaces card at top of ended tier
- **WHEN** a session naturally ends (pi process exits) while other ended sessions exist in the same folder
- **THEN** the just-ended card SHALL render at the top of the ended tier

#### Scenario: Force-kill surfaces card at top of ended tier
- **WHEN** the user force-kills an alive session via the chat-view force-kill button
- **THEN** after the resulting alive→ended transition the card SHALL render at the top of the ended tier

#### Scenario: Legacy sessions without endedAt fall back to startedAt
- **WHEN** an ended session has no recorded `endedAt` (legacy / pre-migration session) alongside ended sessions that do have `endedAt`
- **THEN** the legacy session SHALL be sorted using its `startedAt` value as if it were `endedAt`, preserving the existing implicit ordering for those entries

## MODIFIED Requirements

### Requirement: Continued sessions keep position
When a session is resumed with `mode: "continue"` via **user intent** (Resume button, drag-to-resume, or REST resume endpoint), the server SHALL move the session id to the **front** of the order array for its cwd, regardless of whether the id was previously present in the order. When a session id transitions from ended to alive via **bridge auto-reattach** (no user-intent tag), the server SHALL NOT mutate the order array.

User intent is signalled by the `pendingResumeIntents` registry: any code path that initiates a resume MUST tag the session id before triggering the spawn. Any ended→alive transition observed without a matching intent tag is treated as bridge auto-reattach.

#### Scenario: User-intent resume moves id to front (first time)
- **WHEN** session "s2" is at position 1 in order `["s0", "s1", "s2"]` and the user clicks Resume on "s2" (or drags it into the alive zone)
- **THEN** the order SHALL become `["s2", "s0", "s1"]`
- **AND** the server SHALL broadcast `sessions_reordered` with the new order

#### Scenario: User-intent resume moves id to front (already at front)
- **WHEN** session "s0" is at position 0 in order `["s0", "s1", "s2"]` and the user resumes "s0"
- **THEN** the order SHALL remain `["s0", "s1", "s2"]`
- **AND** a `sessions_reordered` broadcast MAY be sent (idempotent move-to-front is allowed to broadcast)

#### Scenario: Resume cycle re-prepends every time
- **WHEN** session "s1" goes through end → resume → end → resume in cwd `/project`
- **THEN** after each user-intent resume the id "s1" SHALL be at index 0 of the order array
- **AND** repeated cycles SHALL not cause "s1" to drift to a non-front position

#### Scenario: Bridge auto-reattach preserves layout
- **WHEN** the dashboard server restarts and a previously-ended session "s2" reattaches because its pi process is still alive (no `pendingResumeIntents` tag)
- **THEN** the server SHALL NOT modify `sessionOrder` for the cwd
- **AND** the server SHALL NOT broadcast `sessions_reordered` for that transition

#### Scenario: Continue mode without resume intent (legacy path)
- **WHEN** a session re-registers with the same id without an intent tag (e.g. a long-lived path that pre-dates the intent registry)
- **THEN** the server SHALL leave the session's position in the order array unchanged
- **AND** SHALL NOT broadcast `sessions_reordered` for that transition
