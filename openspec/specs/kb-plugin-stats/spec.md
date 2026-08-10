# kb-plugin-stats Specification

## Purpose

Fetch and display a folder's knowledge-base statistics, keeping the view live during an active reindex job. While a job runs the client polls the stats endpoint each second, optimistically acknowledges a reindex click, tolerates a bounded run of transient poll failures, and surfaces definitive errors.

## Requirements

### Requirement: Folder KB stats retrieval

The stats endpoint SHALL return the current knowledge-base statistics for a validated folder, and the client SHALL expose them for display.

#### Scenario: Stats shape for a folder

- **WHEN** stats are requested for an allowed folder
- **THEN** the response contains `files`, `chunks`, `indexed`, `staleCount`, `indexing`, and `jobStatus`
- **AND** `indexed` is true only when `chunks` is greater than 0
- **AND** `staleCount` reports the number of drifted source files
- **AND** `indexing` is true only while a reindex job is running for that folder
- **AND** `jobStatus` is one of `idle`, `running`, or `error`

#### Scenario: Folder not allowed

- **WHEN** stats are requested for a folder that is missing or not a known folder
- **THEN** the request is rejected before any store is opened
- **AND** no stats are returned

#### Scenario: No selected folder on the client

- **WHEN** the client has no current folder
- **THEN** no stats are fetched and the displayed stats are cleared

### Requirement: Live polling while indexing

The client SHALL poll the stats endpoint at a fixed interval while a reindex job is running and SHALL stop polling once the job settles.

#### Scenario: Polling starts and continues during a job

- **WHEN** a stats fetch reports `indexing` true and no poll is active
- **THEN** the client begins polling the stats endpoint every 1 second

#### Scenario: Polling stops when the job settles

- **WHEN** a stats fetch reports `indexing` false
- **THEN** the client stops polling and displays the settled stats

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

- **WHEN** the reindex request itself is rejected so no job started
- **THEN** the pending state is cleared and a reindex error is surfaced immediately

### Requirement: Bounded poll-miss tolerance and error surfacing

The client SHALL tolerate a bounded run of consecutive stats-poll failures without abandoning the live view, and SHALL surface a persistent stats error only after the tolerance is exceeded. The stats endpoint SHALL report a failed job's error.

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

#### Scenario: Last job error reported in stats

- **WHEN** no job is running and the last reindex job for the folder ended in error
- **THEN** the stats response includes `lastError` with the job's error message and `jobStatus` is `error`
