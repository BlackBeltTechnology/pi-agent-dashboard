## MODIFIED Requirements

### Requirement: Paired-server entry persistence

The keyring SHALL store each paired server as an entry keyed by its pinned server fingerprint, retaining that server's identity and durable credential across sessions.

#### Scenario: Add a paired server

- **WHEN** a server is added to the keyring
- **THEN** the entry is stored keyed by its pinned fingerprint id
- **AND** the entry retains its label, its list of URLs, its pinned public key, its pinned fingerprint, its bearer token and, when one was created, its device key

#### Scenario: Overwrite an existing entry

- **WHEN** a server is added whose id matches an entry already in the keyring
- **THEN** the stored entry for that id is replaced with the newly added entry
