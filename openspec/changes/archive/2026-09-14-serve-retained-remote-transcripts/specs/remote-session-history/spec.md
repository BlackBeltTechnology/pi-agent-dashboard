## ADDED Requirements

### Requirement: Retained remote transcripts are served to the dashboard
A dashboard that retained a remote session's transcript SHALL be able to serve
that transcript back for display, including the portion that predates the
current attachment. The read SHALL be subject to the same read-only boundary as
the write path: it SHALL be addressed by session id only, and SHALL NOT accept
any caller-supplied filesystem path.

#### Scenario: History predating the attach is served
- **WHEN** a client requests the history of a remote-origin session whose
  transcript was retained before the current attachment
- **THEN** the retained entries SHALL be returned in their original order

#### Scenario: An incomplete transfer is not presented as complete
- **WHEN** the retained transcript was never marked complete
- **THEN** the response SHALL report it as incomplete
- **AND** the client SHALL distinguish that state from a session with no history

#### Scenario: The read refuses a caller-supplied path
- **WHEN** a request carries a path-bearing field instead of a session id
- **THEN** the request SHALL be refused
- **AND** no file outside the retention directory SHALL be read
