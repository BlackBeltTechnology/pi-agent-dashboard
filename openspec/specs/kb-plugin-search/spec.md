# kb-plugin-search Specification

## Purpose
TBD - created by archiving change improve-kb-settings-sources-and-search. Update Purpose after archive.

## Requirements

### Requirement: Read-only test search over the saved index

The kb-plugin server SHALL expose `GET /api/kb/search?cwd=<abs>&q=<query>[&limit=<n>][&docType=<lane>]`.

- It SHALL search the folder's saved KB index, ranked with the folder's saved config ranking options and with every saved source spec's priority.
- It SHALL open only an existing store and SHALL issue only read queries. It SHALL NOT create the database file, run schema initialization or migration, reindex, or otherwise modify the store.

#### Scenario: Successful search

- **WHEN** an admitted `cwd` and a query of 1–512 characters after trimming are supplied
- **THEN** the response is `200 { hits, tookMs }`
- **AND** each hit carries `root`, `path`, `headingPath`, `chunkId`, `snippet`, `score`, and `docType`, plus `suppressedSections` when the engine reports it
- **AND** the store is closed before the response is sent

#### Scenario: No store side effect

- **WHEN** a search request is served
- **THEN** no indexing runs
- **AND** the store's file and chunk counts are unchanged
- **AND** no database file is created when none existed

#### Scenario: Stale schema is reported, not migrated

- **WHEN** the folder's store predates the current chunk schema
- **THEN** the response is `200 { hits: [], tookMs, needsReindex: true }`
- **AND** no table is dropped or cleared

#### Scenario: Remote source priority honoured

- **GIVEN** the saved config gives a remote source a higher `priority` than a filesystem source
- **WHEN** both roots hold a duplicate of the same section
- **THEN** source-priority dedup prefers the remote root, matching CLI `kb search` ordering

#### Scenario: Invalid query

- **WHEN** `q` is missing, empty after trimming, or longer than 512 characters
- **THEN** the response is `400 { error }` and no store is opened

#### Scenario: Limit clamped

- **WHEN** `limit` is absent, non-numeric, below 1, or above 50
- **THEN** the effective limit is 10 when absent or non-numeric, and otherwise clamped to the range 1–50

#### Scenario: Lane filter

- **WHEN** `docType` is `doc`, `agents`, or `source-md`
- **THEN** only hits of that doc type are returned
- **AND** any other non-empty `docType` value yields `400 { error }`

#### Scenario: No verdict enrichment

- **WHEN** a search request is served
- **THEN** no trust-verdict enrichment runs

#### Scenario: Search during a running reindex

- **WHEN** a reindex job is running for the folder
- **THEN** the search is still served from the store's last committed state

#### Scenario: Unindexed folder

- **WHEN** the folder has no store file or its store has no chunks
- **THEN** the response is `200 { hits: [], tookMs }`
