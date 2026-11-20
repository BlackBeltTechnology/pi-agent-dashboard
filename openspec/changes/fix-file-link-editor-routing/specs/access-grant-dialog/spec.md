## ADDED Requirements

### Requirement: A filesystem prompt raised by a write SHALL say that a write was blocked

When a filesystem-plane denial originates from a write (`action: "write"` on the denial facts, from `POST /api/file/write`), the dialog and the Access/denial surfaces SHALL say a write was blocked and that allowing it also allows reading and saving text documents under the chosen folder. It SHALL offer the read prompt's verdicts and ladder; allow-always SHALL record a write-mode grant. Denials with no `action` keep the read wording and record read grants.

#### Scenario: Write denial names a write
- **GIVEN** an un-granted save of `/Users/u/Downloads/x.md` raised a filesystem prompt with `action: "write"`
- **WHEN** the dialog renders
- **THEN** the reason copy SHALL say a write was blocked and SHALL NOT say "A read was blocked"

#### Scenario: Allow-always on a write prompt records a write grant
- **GIVEN** the write prompt above and the operator chooses allow-always for the denied folder or an offered rung
- **WHEN** the verdict is persisted
- **THEN** the grant SHALL carry `mode: "write"`, and the browser reply SHALL NOT carry any mode (it is taken from the server-held entry)

#### Scenario: Read denial keeps the read wording
- **GIVEN** a filesystem prompt raised by `GET /api/file` (no `action`)
- **WHEN** the dialog renders
- **THEN** the existing read wording SHALL show and an allow-always SHALL record a read grant
