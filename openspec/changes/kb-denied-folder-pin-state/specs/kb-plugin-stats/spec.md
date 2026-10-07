## MODIFIED Requirements

### Requirement: Folder KB stats retrieval

The stats endpoint SHALL return the current knowledge-base statistics for a validated folder without creating any file or directory, and the client SHALL expose them for display.

#### Scenario: Stats shape for a folder

- **WHEN** stats are requested for an allowed folder
- **THEN** the response contains `files`, `chunks`, `indexed`, `staleCount`, `indexing`, and `jobStatus`
- **AND** `indexed` is true only when `chunks` is greater than 0
- **AND** `staleCount` reports the number of drifted source files
- **AND** `indexing` is true only while a reindex job is running for that folder
- **AND** `jobStatus` is one of `idle`, `running`, or `error`
- **AND** `folderMissing` is true only when the folder does not exist as a directory
- **AND** `sourceCount` is the number of source specs in the folder's resolved KB config (project, global and default layers merged), and `0` when `folderMissing` is true

#### Scenario: Folder not allowed

- **WHEN** stats are requested with the `cwd` parameter absent, or for a folder that is not an admitted folder
- **THEN** the request is rejected before any store is opened
- **AND** no stats are returned

#### Scenario: No selected folder on the client

- **WHEN** the client has no current folder
- **THEN** no stats are fetched and the displayed stats are cleared

#### Scenario: Reading stats has no filesystem side effects

- **WHEN** stats are requested for an allowed folder that has no index database, whose index database is unreadable or uses an outdated schema, or that does not exist
- **THEN** stats are returned with zero counts
- **AND** no directory or database file is created

### Requirement: Live polling while indexing

The client SHALL poll the stats endpoint at a fixed interval while a reindex job is running and SHALL stop polling once the job settles, or as soon as a stats fetch is refused as a cwd-admission refusal (`403 { error: "cwd not allowed" }`), regardless of job state.

#### Scenario: Polling starts and continues during a job

- **WHEN** a stats fetch reports `indexing` true and no poll is active
- **THEN** the client begins polling the stats endpoint every 1 second

#### Scenario: Polling stops when the job settles

- **WHEN** a stats fetch reports `indexing` false
- **THEN** the client stops polling and displays the settled stats

#### Scenario: Polling stops on a cwd refusal mid-job

- **WHEN** a stats poll during a running job responds `403 { error: "cwd not allowed" }`
- **THEN** the client stops polling and surfaces the folder's denied state
- **AND** the job's outcome becomes visible on the first successful stats fetch after the folder is admitted again

### Requirement: Optimistic reindex acknowledgement

The client SHALL synchronously acknowledge a reindex request with a pending state that resolves to a definitive outcome, so a job that completes before the first poll never wedges the view on a permanent spinner.

#### Scenario: Reindex click sets pending immediately

- **WHEN** the user triggers a reindex for the current folder
- **THEN** the client enters a pending state synchronously
- **AND** the reindex request is sent to the reindex endpoint

#### Scenario: Real job takes over the spinner

- **WHEN** a stats poll reports `indexing` true after a reindex was triggered
- **THEN** the pending state is cleared and the running job drives the spinner

#### Scenario: Job settled before the first poll

- **WHEN** the reindex request neither was rejected nor was observed as `indexing` true within a bounded guard window of a few poll intervals
- **THEN** the pending state is cleared and fresh stats are refetched

#### Scenario: Reindex request rejected

- **WHEN** the reindex request itself is rejected, for a reason other than a cwd-admission refusal or a `409` precondition refusal, so no job started
- **THEN** the pending state is cleared and a reindex error is surfaced immediately

#### Scenario: Reindex request refused by a precondition

- **WHEN** the reindex request responds `409 { error: "folder missing" }` or `409 { error: "no sources configured" }`
- **THEN** the pending state is cleared without surfacing a reindex error
- **AND** fresh stats are fetched so the folder's missing or no-sources state is shown

#### Scenario: Reindex request refused for cwd admission

- **WHEN** the reindex request responds `403 { error: "cwd not allowed" }`
- **THEN** the pending state is cleared and the folder's denied state is surfaced immediately, with no reindex error
- **AND** any previously surfaced reindex error or stats error for that folder is cleared, so re-admission resolves to the state derived from fresh stats

### Requirement: Bounded poll-miss tolerance and error surfacing

The client SHALL tolerate a bounded run of consecutive stats-poll failures without abandoning the live view, and SHALL surface a persistent stats error only after the tolerance is exceeded. A cwd-admission refusal (`403 { error: "cwd not allowed" }`) is definitive, not transient: it SHALL NOT count toward the failure run, SHALL stop polling immediately, and SHALL surface the folder's denied state instead of a stats error. The stats endpoint SHALL report a failed job's error.

#### Scenario: Transient poll miss keeps polling

- **WHEN** a stats poll fails but fewer than 3 consecutive failures have occurred
- **THEN** the client keeps retrying and does not surface a stats error
- **AND** the last successful stats (including an in-progress spinner) remain displayed

#### Scenario: A successful poll resets the miss run

- **WHEN** a stats poll succeeds after one or more prior failures
- **THEN** the consecutive-failure count is reset and any stats error is cleared

#### Scenario: Sustained outage surfaces an error

- **WHEN** 3 consecutive stats polls fail
- **THEN** the client stops polling and surfaces a stats error

#### Scenario: Cwd refusal is definitive

- **WHEN** a stats fetch for a folder responds `403 { error: "cwd not allowed" }`
- **THEN** the client stops polling that folder after that single response, without retrying
- **AND** no stats error is surfaced, and any earlier stats error or reindex error for that folder is cleared; the folder's denied state is surfaced instead
- **AND** a `403` with any other body is treated as an ordinary poll failure under the bounded tolerance

#### Scenario: Last job error reported in stats

- **WHEN** no job is running and the last reindex job for the folder ended in error
- **THEN** the stats response includes `lastError` with the job's error message and `jobStatus` is `error`

### Requirement: Shared per-folder stats state across consumers

All concurrently mounted consumers of a folder's KB stats SHALL observe one identical shared state per folder — stats snapshot, optimistic pending, reindex error, poll-outage error, cwd-admission refusal, and pin-wait — instead of each consumer holding an independent copy. A reindex triggered from any one consumer SHALL be reflected in every consumer of the same folder, live through the indexing window and after settle. A pin wait SHALL NOT be represented as optimistic reindex pending, so it never disables or suppresses reindex in any consumer.

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

- **WHEN** a reindex trigger is rejected for a folder for a reason other than a cwd-admission refusal or a `409` precondition refusal (`folder missing` / `no sources configured`)
- **THEN** every consumer of that folder observes the reindex error (the failure is real folder state, not private to the consumer that clicked)
- **AND** a subsequent reindex from any consumer clears it

#### Scenario: Refusal and pin-wait are shared

- **WHEN** a folder's stats fetch or reindex trigger is refused with `403 { error: "cwd not allowed" }`, or a pin wait starts for that folder from any consumer
- **THEN** every consumer of that folder observes the same denied state, refusal reason, and pin-wait flag
- **AND** the optimistic reindex pending flag is not set by the pin wait
- **AND** a successful stats fetch clears the denied state and pin-wait flag for every consumer
