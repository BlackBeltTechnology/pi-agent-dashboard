# Spec Delta

## MODIFIED Requirements

### Requirement: Merge preserves unexposed keys
When merging a plugin patch into existing producer settings, the plugin SHALL update only the `inheritContext` and `maxConcurrent` keys present in the patch and SHALL preserve every other key verbatim, including `exposeInheritanceInTool`, `inheritance`, and any user-added keys.

#### Scenario: Patch updates inheritContext
- **WHEN** existing settings hold `inheritContext`, `exposeInheritanceInTool`, `inheritance`, and a user-added key, and a patch sets `inheritContext` to a new value
- **THEN** the merged settings use the patch's `inheritContext`
- **AND** `exposeInheritanceInTool`, `inheritance`, and the user-added key are unchanged

#### Scenario: Patch omits inheritContext
- **WHEN** a patch does not include `inheritContext`
- **THEN** the merged settings leave the existing `inheritContext` and all other keys unchanged

#### Scenario: Patch updates maxConcurrent
- **WHEN** existing settings hold `maxConcurrent: 4` and other keys, and a patch sets `maxConcurrent` to 8
- **THEN** the merged settings use `maxConcurrent: 8` and every other key is unchanged

#### Scenario: Patch omits maxConcurrent
- **WHEN** a patch does not include `maxConcurrent`
- **THEN** the merged settings leave the existing `maxConcurrent` and all other keys unchanged

### Requirement: Startup reconcile from producer file
On plugin startup the plugin SHALL treat the producer settings file as the source of truth for `inheritContext` and `maxConcurrent`. When the file defines a boolean `inheritContext`, or a numeric `maxConcurrent`, the plugin SHALL push that value into the dashboard plugin configuration, clamping `maxConcurrent` to 0 to 64 as the producer does.

#### Scenario: Producer file defines inheritContext
- **WHEN** the plugin starts and the producer settings file contains a boolean `inheritContext`
- **THEN** the dashboard plugin configuration is updated to that `inheritContext` value

#### Scenario: Producer file omits or has non-boolean inheritContext
- **WHEN** the plugin starts and the producer settings file has no `inheritContext` or a non-boolean value
- **THEN** the dashboard plugin configuration is left unchanged

#### Scenario: Producer file defines maxConcurrent
- **WHEN** the plugin starts and the producer settings file contains `maxConcurrent: 6`
- **THEN** the dashboard plugin configuration is updated to `maxConcurrent: 6`

#### Scenario: Producer file has an out-of-range maxConcurrent
- **WHEN** the plugin starts and the producer settings file contains `maxConcurrent: 100`
- **THEN** the dashboard plugin configuration shows `maxConcurrent: 64`, which is what the producer runs, and the file value is not overwritten

#### Scenario: Producer file omits maxConcurrent
- **WHEN** the plugin starts and the producer settings file has no or a non-numeric `maxConcurrent`
- **THEN** the dashboard plugin `maxConcurrent` is left unchanged

### Requirement: Write-through mirror on config change
After the dashboard plugin configuration is successfully persisted, the plugin SHALL mirror the current `inheritContext`, and `maxConcurrent` when it is explicitly set in the plugin configuration, into the producer settings file by merging with the existing file contents and writing atomically, preserving unexposed keys.

#### Scenario: Plugin config POST succeeds
- **WHEN** a `POST /api/config/plugins/subagents` request completes with status 200
- **THEN** the current plugin `inheritContext` and any explicitly set `maxConcurrent` are merged into the existing producer settings
- **AND** the merged settings are written to the producer settings file
- **AND** all unexposed keys in the existing file are preserved

#### Scenario: Unrelated save keeps a hand-set limit
- **WHEN** the producer file holds `maxConcurrent: 100`, the plugin configuration has no explicit `maxConcurrent`, and the user saves only `inheritContext`
- **THEN** the producer file still holds `maxConcurrent: 100`

#### Scenario: Non-matching or failed request
- **WHEN** the request is not a successful `POST` to `/api/config/plugins/subagents`
- **THEN** the producer settings file is not modified

## ADDED Requirements

### Requirement: Max parallel subagents setting

The subagents plugin settings SHALL offer a "Max parallel subagents" integer field from 0 to 64 (`0` = unlimited, default 4) that edits the producer's `maxConcurrent`. Out-of-range or non-integer values SHALL show an inline error. The field SHALL show the heap-limits per-child budget warning for its value against the session heap ceiling.

#### Scenario: Value is loaded from the producer
- **WHEN** the producer settings file holds `maxConcurrent: 12` and the settings page opens
- **THEN** the field shows 12

#### Scenario: Invalid value
- **WHEN** the user enters `-1`, `65` or `2.5`
- **THEN** an inline error is shown, and a global Save fails for this section and writes nothing for it

#### Scenario: Change applies without reload
- **WHEN** 4 subagents run, 3 are queued, and the user saves the limit 6
- **THEN** within 3 seconds 2 queued subagents start, without a reload

#### Scenario: Heap budget too small
- **WHEN** the session heap ceiling is 512 MB and the user sets the limit to 16
- **THEN** the field shows the per-child heap budget warning and the value remains saveable

### Requirement: The setting uses the global save state

The "Max parallel subagents" field SHALL take part in the host's unified settings save state, in the same draft as `inheritContext`. Editing it SHALL mark the settings dirty, and it SHALL be committed by the global Save and discarded by the global Discard. The section SHALL NOT have its own save button, and it SHALL NOT write on change.

#### Scenario: Edit marks the page dirty
- **WHEN** the user changes the field from 4 to 8
- **THEN** the global save state shows unsaved changes, and nothing is written yet

#### Scenario: Global save commits
- **WHEN** the user then presses the global Save
- **THEN** the plugin config and the producer settings file hold `maxConcurrent: 8`

#### Scenario: Global discard reverts
- **WHEN** the user changes the field to 8 and presses the global Discard
- **THEN** the field shows 4 again and nothing is written

#### Scenario: Saved together with inheritContext
- **WHEN** the user changes both `inheritContext` and the field, then presses the global Save once
- **THEN** both values are persisted in one commit
