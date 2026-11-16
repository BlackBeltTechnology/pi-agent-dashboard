## ADDED Requirements

### Requirement: The app default session denies permissions except a fixed allowlist for the main window's origin

Before any window is created, the app SHALL install handlers on the default session that allow only `clipboard-sanitized-write`, `notifications` and `fullscreen`, only for the main frame at the origin of the main window's current URL when the navigate-to-server allowlist trusts it. A check with no document (a service worker) is judged by its origin and allowed only for `notifications`. All else, including `openExternal`, SHALL be denied and logged once per permission and origin.

#### Scenario: remote main-window content cannot use the camera

- **GIVEN** the main window has loaded a remote server in remote mode
- **WHEN** its page calls `navigator.mediaDevices.getUserMedia({ video: true })` or `navigator.geolocation.getCurrentPosition`
- **THEN** the request SHALL be denied without any in-app prompt

#### Scenario: the dashboard origin keeps its three permissions

- **WHEN** the main frame at the main window's server origin requests `notifications`, `fullscreen` or `clipboard-sanitized-write`
- **THEN** each SHALL be granted

#### Scenario: a subframe or a foreign origin is denied

- **WHEN** an iframe, or a page at any origin other than the main window's server origin, requests `notifications`
- **THEN** the request SHALL be denied

#### Scenario: the grant follows a navigation to another allowed origin

- **GIVEN** the main window was created for one origin and `dashboard:navigate-to-server` then loaded a loopback variant or a known server
- **WHEN** the main frame at the new origin requests `notifications`, and a page at the original origin requests it
- **THEN** the first SHALL be granted and the second denied

#### Scenario: bundled local windows receive no permission

- **WHEN** the doctor, remote-connect, connecting or splash window requests any permission
- **THEN** the request SHALL be denied

#### Scenario: no main window yet

- **WHEN** a permission request arrives while no main window server URL is set
- **THEN** it SHALL be denied

#### Scenario: a service-worker notification check at the dashboard origin is allowed

- **WHEN** the check handler runs for `notifications` with the main window's server origin as `requestingOrigin`, no `requestingUrl` and no main frame
- **THEN** it SHALL return true

#### Scenario: a service-worker check for any other permission is denied

- **WHEN** the check handler runs with no `requestingUrl` for `media` or `clipboard-sanitized-write`
- **THEN** it SHALL return false

#### Scenario: openExternal permission is denied

- **WHEN** a page at the main window's server origin requests the `openExternal` permission
- **THEN** it SHALL be denied, and links SHALL keep reaching the OS only through the http/https/mailto scheme allowlist
