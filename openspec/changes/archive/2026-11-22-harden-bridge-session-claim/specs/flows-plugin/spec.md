## ADDED Requirements

### Requirement: A flow-file report is accepted only from a hub-local session
The flows server SHALL accept the flow-file report only from a hub-local session admitted locally, because it stores absolute paths the bridge claims and later serves them. A report from any other session SHALL be denied by the plugin request lane as `origin_denied` and no path SHALL be stored. The flows bridge SHALL ignore the denial without retrying or logging. The preview routes SHALL answer the existing not-reported response for such a session and SHALL NOT read a path it claimed.

#### Scenario: A hub-local report is stored and served
- **WHEN** a hub-local session admitted on the unix socket sends the flow-file report
- **THEN** the paths SHALL be stored and `GET /api/plugins/flows/file` SHALL serve a reported file as before

#### Scenario: A remote or deprecated-admission report is denied
- **WHEN** a session with a remote origin, or a hub-local session admitted as `grace`, sends the flow-file report
- **THEN** the report SHALL be denied as `origin_denied` and no path SHALL be stored

#### Scenario: The bridge ignores the denial
- **WHEN** the flows bridge receives `origin_denied` for its report
- **THEN** it SHALL NOT schedule a retry and SHALL NOT log or throw

#### Scenario: A preview for a denied session reads nothing
- **WHEN** `GET /api/plugins/flows/file` names a path claimed by a session whose report was denied
- **THEN** the response SHALL be the existing not-reported response
- **AND** the hub SHALL NOT read the path
