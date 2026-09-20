## ADDED Requirements

### Requirement: Embedded live servers may download
The live-server viewer SHALL permit downloads initiated by the embedded application, and SHALL continue to deny it a readable origin. The iframe sandbox SHALL include `allow-downloads` and SHALL NOT include `allow-same-origin`.

#### Scenario: Export from an embedded app reaches the user
- **WHEN** an app served on loopback and viewed in the live-server pane triggers a file download
- **THEN** the browser performs the download rather than dropping it silently

#### Scenario: Origin isolation is unchanged
- **WHEN** the live-server iframe is rendered
- **THEN** its sandbox omits `allow-same-origin`, so the embedded app cannot read the dashboard token or call `/api/*`
