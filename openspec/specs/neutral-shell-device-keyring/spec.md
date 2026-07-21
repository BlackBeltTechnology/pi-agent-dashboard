# neutral-shell-device-keyring Specification

## Purpose

The device keyring persists paired-server credentials on the shell device so a user can reconnect to previously paired servers without re-pairing. Each entry pins a server's cryptographic identity (fingerprint and public key) and stores the durable bearer token minted at pairing time, backed by IndexedDB with a transparent in-memory fallback.

## Requirements

### Requirement: Paired-server entry persistence

The keyring SHALL store each paired server as an entry keyed by its pinned server fingerprint, retaining that server's identity and durable credential across sessions.

#### Scenario: Add a paired server

- **WHEN** a server is added to the keyring
- **THEN** the entry is stored keyed by its pinned fingerprint id
- **AND** the entry retains its label, its list of URLs, its pinned public key, its pinned fingerprint, and its bearer token

#### Scenario: Overwrite an existing entry

- **WHEN** a server is added whose id matches an entry already in the keyring
- **THEN** the stored entry for that id is replaced with the newly added entry

### Requirement: Keyring retrieval and removal

The keyring SHALL support listing all stored entries and removing an entry by its id.

#### Scenario: List paired servers

- **WHEN** the stored servers are listed
- **THEN** all currently stored paired-server entries are returned

#### Scenario: List when empty

- **WHEN** the stored servers are listed and none have been added
- **THEN** an empty result is returned

#### Scenario: Remove a paired server

- **WHEN** a server is removed by its id
- **THEN** that entry is no longer present in a subsequent listing
- **AND** other stored entries remain unaffected

### Requirement: Storage backend with in-memory fallback

The keyring SHALL persist entries in IndexedDB when it is available, and SHALL fall back to an in-memory store exposing the same add, list, and remove behavior when IndexedDB is unavailable.

#### Scenario: IndexedDB available

- **WHEN** IndexedDB is available in the environment
- **THEN** add, list, and remove operations are applied against the persistent IndexedDB object store

#### Scenario: IndexedDB unavailable

- **WHEN** IndexedDB is not available in the environment
- **THEN** add, list, and remove operations are applied against an in-memory store
- **AND** the same entry shape and add/list/remove behavior are observed as when IndexedDB is available

### Requirement: Keyring view

The keyring view SHALL display the stored paired servers and let the user connect to or remove each one, reflecting connection outcomes.

#### Scenario: Empty keyring view

- **WHEN** the keyring view loads and no paired servers are stored
- **THEN** an empty-state message inviting the user to pair a server is shown

#### Scenario: List paired servers in the view

- **WHEN** the keyring view loads with one or more stored servers
- **THEN** each server is shown with its label and pinned fingerprint
- **AND** each server offers a Connect action and a Remove action

#### Scenario: Connect to a server

- **WHEN** the user triggers Connect for a server entry
- **THEN** the entry's connect action is initiated and its control indicates an in-progress state until it completes
- **AND** the resulting connection log is shown for that server, indicating success, failure, or an identity mismatch

#### Scenario: Remove a server from the view

- **WHEN** the user triggers Remove for a server entry
- **THEN** that server is removed from the keyring
- **AND** the displayed list is refreshed to reflect the removal
