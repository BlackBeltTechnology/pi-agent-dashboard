# session-trajectory-harvest Specification

## Purpose
TBD - created by archiving change distill-session-knowledge. Update Purpose after archive.
## Requirements
### Requirement: Incremental harvest of session JSONL

The miner SHALL read session JSONL files from this project's session directory
(`~/.pi/agent/sessions/<cwd-encoded>/`) only, normalize each into a trajectory model,
and process only sessions newer than a persisted watermark. Malformed lines SHALL be
skipped and counted, never aborting the run.

#### Scenario: Only newer sessions processed

- **WHEN** the miner runs after a previous run recorded watermark `W`
- **THEN** it SHALL process only sessions with timestamp greater than `W`
- **AND** SHALL advance the watermark to the newest processed session timestamp

#### Scenario: Re-run over unchanged corpus is a no-op

- **WHEN** the miner runs twice with no new sessions in between
- **THEN** the second run SHALL process zero sessions

#### Scenario: Malformed line tolerated

- **WHEN** a session file contains an unparseable JSONL line
- **THEN** the miner SHALL skip that line, increment a skip counter, and continue

### Requirement: Trajectory normalization and segmentation

The miner SHALL pair each `toolCall.id` with its `toolResult.toolCallId`, expose turns
with role/text/thinking/toolCalls/toolResults, and segment a session into task episodes
at boundaries (new top-level user message, `session_info.name` change, time gap beyond a
threshold, or tool-cluster shift).

#### Scenario: Tool calls pair to results

- **WHEN** a session contains N toolCall blocks
- **THEN** each SHALL be paired to its toolResult or flagged unpaired

#### Scenario: Distinct tasks segmented

- **WHEN** a session contains three distinct user-initiated tasks
- **THEN** the miner SHALL yield three episodes

