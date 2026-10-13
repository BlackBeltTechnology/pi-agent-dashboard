## MODIFIED Requirements

### Requirement: Lock metadata sidecar read

The app SHALL read the per-HOME dashboard lock metadata sidecar from the same `$HOME`-honouring dashboard directory the server writes it to (`<HOME>/.pi/dashboard`, see `home-lock-single-instance` "Lock and metadata paths"). It SHALL return null on any missing, corrupt, or invalid content.

#### Scenario: Valid lock metadata
- **WHEN** the sidecar at `<HOME>/.pi/dashboard/server.lock.meta.json` parses to an object with numeric `pid` and `httpPort`, and string `identity` and `url`
- **THEN** the parsed lock metadata is returned

#### Scenario: Missing or corrupt sidecar
- **WHEN** the sidecar is absent, unreadable, non-JSON, or lacks the required fields
- **THEN** null is returned

#### Scenario: Reader and server agree under a HOME override
- **WHEN** the app runs with `HOME=<tmp>`
- **THEN** it SHALL read `<tmp>/.pi/dashboard/server.lock.meta.json`, the path a server started with the same `HOME` writes
