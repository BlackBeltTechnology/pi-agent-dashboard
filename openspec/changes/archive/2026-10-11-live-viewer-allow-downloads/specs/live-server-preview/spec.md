## MODIFIED Requirements

### Requirement: Embedded content SHALL be origin-isolated via sandbox

Proxied live-server content SHALL be reverse-proxied on the dashboard's main origin at a
path (e.g. `/live/<id>/`, mirroring `/editor/<id>/`) so it is reachable both locally and
over the single-port remote tunnel. The viewer SHALL embed it with exactly
`sandbox="allow-scripts allow-forms allow-popups allow-downloads"` and SHALL NOT set
`allow-same-origin`, so the browser assigns the framed document a unique opaque origin.
The `allow-scripts` and `allow-same-origin` tokens SHALL NOT both be present. The sandbox
SHALL NOT include `allow-downloads-without-user-activation`. Note that the browser sandbox
does not restrict downloads to user gestures: with `allow-downloads` present, an embedded
app can also trigger a download without a user gesture. Consequently the embedded app SHALL NOT be able
to read the dashboard's `localStorage`/auth token or make same-origin credentialed calls
to the dashboard APIs. Isolation by a distinct port or hostname SHALL NOT be used, because
the remote tunnel exposes a single port/host.

#### Scenario: Embedded app cannot access the dashboard origin
- **GIVEN** a malicious page served by the previewed dev server that reads
  `window.localStorage` and calls `/api/restart`
- **WHEN** it runs inside the live-server iframe
- **THEN** it cannot read the dashboard's `localStorage` (opaque origin)
- **AND** its calls to dashboard APIs are not authenticated with the dashboard session

#### Scenario: Sandbox does not self-disable
- **WHEN** the live-server iframe is rendered
- **THEN** its `sandbox` token set is exactly `allow-scripts`, `allow-forms`, `allow-popups`, `allow-downloads`
- **AND** its `sandbox` attribute does NOT include `allow-same-origin`

#### Scenario: User-initiated export from an embedded app reaches the user
- **GIVEN** a loopback app viewed in the live-server pane whose button triggers a file download (e.g. a blob `<a download>` click)
- **WHEN** the user clicks that button inside the frame
- **THEN** the browser performs the download rather than dropping it silently

