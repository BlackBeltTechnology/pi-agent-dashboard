# kb-plugin-stats — delta

## ADDED Requirements

### Requirement: Shared per-folder stats state across consumers

All concurrently mounted consumers of a folder's KB stats SHALL observe one identical shared state per folder — stats snapshot, optimistic pending, reindex error, and poll-outage error — instead of each consumer holding an independent copy. A reindex triggered from any one consumer SHALL be reflected in every consumer of the same folder, live through the indexing window and after settle.

#### Scenario: Reindex in one surface updates another

- **WHEN** the KB settings panel and the folder KB section are both mounted for the same folder and a reindex is triggered from the settings panel
- **THEN** the folder KB section reflects the optimistic pending state, the live `indexing` state, and the settled post-reindex counts, without being remounted

#### Scenario: One poll loop per folder

- **WHEN** two or more consumers are mounted for the same folder while a reindex job is running
- **THEN** the stats endpoint is polled once per interval for that folder, not once per consumer

#### Scenario: Busy state shared for double-submit prevention

- **WHEN** a reindex is in flight (pending or `indexing` true) for a folder
- **THEN** every consumer of that folder observes the busy condition, so no consumer can submit a second reindex

#### Scenario: Distinct folders stay independent

- **WHEN** consumers are mounted for two different folders and a reindex runs for one of them
- **THEN** the other folder's consumers observe no pending, error, or stats change from that job

#### Scenario: Settled stats visible after a consumer remounts

- **WHEN** a reindex completes while only the settings panel observes it, and the folder KB section for that folder mounts afterwards
- **THEN** the section displays the settled post-reindex stats, not a stale pre-reindex snapshot

#### Scenario: New subscriber on a live folder revalidates in the background

- **WHEN** a consumer mounts for a folder whose shared state already holds a snapshot
- **THEN** the retained snapshot is displayed immediately
- **AND** a background stats fetch is issued so externally-caused changes are observed, coalesced with any fetch already in flight for that folder (no duplicate concurrent request)

#### Scenario: Error channels are shared

- **WHEN** a reindex trigger is rejected for a folder
- **THEN** every consumer of that folder observes the reindex error (the failure is real folder state, not private to the consumer that clicked)
- **AND** a subsequent reindex from any consumer clears it
