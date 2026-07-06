## ADDED Requirements

### Requirement: LiveServerViewer auto-launches a preset target

`LiveServerViewer` SHALL accept a preset target through `ViewerProps.path` encoded as a `live:<url>` sentinel. When `path` carries a concrete `http(s)` loopback URL, the viewer SHALL parse its host and port, call `startLiveServer` immediately, and embed the proxied preview WITHOUT first showing the target-picker screen. The embedded iframe `src` SHALL include the original URL's `pathname` and `search` appended to the proxied `/live/<id>/` mount, so a deep link opens the linked page rather than the app root.

The existing picker entry point (`path === "live:preview"`, or no url payload) SHALL be unchanged: the viewer boots to its target picker as today.

#### Scenario: preset target launches without the picker
- **GIVEN** the `live-server` viewer opened with `path="live:http://localhost:50452/report.html"`
- **WHEN** the viewer mounts
- **THEN** `startLiveServer` SHALL be called with host `localhost` and port `50452`
- **AND** the target picker SHALL NOT be shown
- **AND** the iframe `src` SHALL include the path `/report.html`

#### Scenario: picker entry point unchanged
- **GIVEN** the `live-server` viewer opened with `path="live:preview"`
- **WHEN** the viewer mounts
- **THEN** the target-picker screen SHALL render as today

#### Scenario: preset target still gated by the server SSRF check
- **GIVEN** a preset `path` whose host is not loopback (a mis-route)
- **WHEN** the viewer attempts to launch it
- **THEN** the server `validateLiveTarget` SHALL reject it
- **AND** the viewer SHALL show its existing error state (no embed)

### Requirement: In-viewer escape to the system browser

The `LiveServerViewer` preview header SHALL provide an affordance that opens the currently previewed target in the system browser (`target="_blank"`), so a user who auto-opened a loopback link in the split viewer can still hand it to a full browser.

#### Scenario: open-in-browser from the viewer header
- **GIVEN** a loopback target previewed in the `live-server` viewer
- **WHEN** the user activates the header's open-in-browser affordance
- **THEN** the target SHALL open in a system-browser tab
