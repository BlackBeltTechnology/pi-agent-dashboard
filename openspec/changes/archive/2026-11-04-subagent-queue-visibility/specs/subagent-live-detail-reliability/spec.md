# Spec Delta

## ADDED Requirements

### Requirement: A stopped subagent is terminal wherever a completed or failed one is

A subagent ending `status: "stopped"` via a real `subagent_completed` SHALL be terminal under every rule that treats `completed` or `failed` as terminal (snapshot removal, resync, live-tick revival, own-terminal finalization, settle, late-tick reopening); where those say "completed or failed", that includes `stopped`. Its card SHALL finalize non-error and render as stopped, not as a success.

#### Scenario: Retained snapshot removed on stop
- **WHEN** subagent `ag-1` ends `stopped`
- **THEN** its retained running snapshot is removed, and a resync for `ag-1` by either id resolves to nothing

#### Scenario: Stopped subagent is not revived by a live tick
- **WHEN** a live progress tick for `ag-1` arrives after it ended `stopped`
- **THEN** `ag-1` stays stopped and its card is not reopened

#### Scenario: Own terminal event finalizes the card as stopped
- **WHEN** `ag-1`'s `subagent_completed` with status `stopped` arrives and its tool end was dropped
- **THEN** its Agent card finalizes in the stopped presentation, not as a success

#### Scenario: Settle leaves a stopped card alone
- **WHEN** the parent run settles after `ag-1` ended `stopped`
- **THEN** `ag-1`'s card keeps its stopped presentation
