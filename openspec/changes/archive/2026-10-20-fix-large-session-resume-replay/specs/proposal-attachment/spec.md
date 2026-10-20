# Spec Delta

## ADDED Requirements

### Requirement: A bridge replay neither raises nor clears a pending replacement
Replayed events SHALL NOT set `pendingReplaceProposal`: neither marked replayed events (at any time) nor unmarked events received in bridge replay mode. A replay exit SHALL NOT clear or overwrite `pendingReplaceProposal`: a suggestion raised by live events before a bridge reconnect, and a user accept or dismiss made during the replay, SHALL stand after the exit.

#### Scenario: Historical change edit in a long replay raises nothing
- **WHEN** `pendingReplaceProposal` is `null` at register, the replay runs for about 6 s, and a replayed `tool_execution_start` writes to `openspec/changes/change-b/proposal.md`
- **THEN** after `replay_complete` `pendingReplaceProposal` SHALL still be `null`, whether or not the bridge marks replayed events
- **AND** no `session_updated` broadcast SHALL carry `pendingReplaceProposal: "change-b"`

#### Scenario: Live suggestion survives a reconnect
- **WHEN** live events set `pendingReplaceProposal` to `"change-b"`, then the bridge reconnects and replays history
- **THEN** after the replay exit `pendingReplaceProposal` SHALL still be `"change-b"`

#### Scenario: Accept during the replay stands
- **WHEN** `pendingReplaceProposal` is `"change-b"` at register and the user accepts it while the replay is still running
- **THEN** after the replay exit `pendingReplaceProposal` SHALL stay `null` and the accepted attachment SHALL stand
