## ADDED Requirements

### Requirement: A filesystem write hold is answered like a filesystem read hold

A held filesystem denial raised by a text-document write (`action: "write"`) SHALL be treated exactly as a read denial: under YOLO, when prompt-eligible, suspendable and within a YOLO root, it SHALL be auto-answered allow-once, admitting only that write and persisting no grant. Otherwise (ineligible, outside every root, or after an explicit refusal) it SHALL NOT be auto-answered.

#### Scenario: YOLO auto-allows an outside text-document save once
- **GIVEN** YOLO is active with a root covering `/Users/u/Downloads` and a prompt-eligible save targets `/Users/u/Downloads/x.md` outside the session cwd with no write grant
- **WHEN** the write hold is raised
- **THEN** it SHALL be answered allow-once, that one write SHALL proceed, no grant SHALL be recorded and the verdict SHALL NOT apply to a later write

#### Scenario: A default-scoped YOLO session does not auto-allow an outside write
- **GIVEN** YOLO is active with only its default root (the session cwd) and a save targets a file outside the cwd
- **WHEN** the write hold is raised
- **THEN** it SHALL be prompted or refused exactly as though YOLO were inactive

#### Scenario: Ineligible write is not auto-answered
- **GIVEN** YOLO is active and the write caller is a bare loopback request without proof
- **WHEN** the write is refused
- **THEN** no automatic verdict SHALL be produced and the response SHALL be `403`
