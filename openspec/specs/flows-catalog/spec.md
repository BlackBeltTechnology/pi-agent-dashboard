# flows-catalog Specification

## Purpose
TBD - created by archiving change flows-dock-chip-and-panel-actions. Update Purpose after archive.

## Requirements

### Requirement: Sibling sessions follow catalog changes

When the flows plugin server receives a catalog for a session that differs from that session's previous catalog, it SHALL ask every other live session in the same folder to rediscover and report. A session asked to rediscover SHALL have pi-flows re-read its flows from disk before publishing. When the plugin server starts, it SHALL ask every live session to report, and re-ask each session that has not reported at the configured interval (default 5 seconds) for the configured window (default 60 seconds).

#### Scenario: Flow written in one session appears in a sibling
- **GIVEN** sessions A and B share a folder
- **WHEN** session A writes a new flow and publishes a catalog including it
- **THEN** session B SHALL rediscover and publish a catalog including the new flow

#### Scenario: No ask loop
- **WHEN** sibling sessions publish catalogs equal to their previous ones
- **THEN** no further sibling asks SHALL be sent

#### Scenario: Automation after a server restart
- **GIVEN** the dashboard server restarted while a session with flows kept running and no browser is open
- **WHEN** the session's bridge reconnects
- **THEN** the plugin server SHALL obtain that session's catalog without a browser

### Requirement: The flows plugin publishes each session's flow catalog

The flows plugin SHALL deliver a session's available flows as a flow catalog event published by the plugin's own pi-side bridge, through the dashboard's plugin-declared event forwarding with `latest` delivery under one fixed key. Each entry SHALL carry the flow's name, description, source and whether a task is required. The catalog SHALL include every flow pi-flows reports for the session, whatever its source.

#### Scenario: Catalog published at session start
- **WHEN** a session with pi-flows active starts and pi-flows reports `batch:apply` and `ship-it`
- **THEN** a flow catalog event listing `batch:apply` and `ship-it` SHALL reach the session's event stream

#### Scenario: Package flows are included
- **GIVEN** pi-flows reports a flow whose source is inside an installed package
- **WHEN** the catalog is published
- **THEN** that flow SHALL appear in the catalog

### Requirement: Catalog publish triggers

The bridge SHALL publish the catalog when the session starts, when pi-flows rediscovers flows, when a flow completes, when a flows or agents directory is registered or unregistered, when the bridge attaches, and when the plugin server asks the session to report. Triggers within 300 ms of each other SHALL produce one publish. It SHALL re-send its forward declaration on every bridge-ready signal.

#### Scenario: Catalog refreshed after authoring
- **WHEN** a flow is written in the session and pi-flows rediscovers flows
- **THEN** a new catalog event including the new flow SHALL reach the session's event stream

#### Scenario: Server asks for a report
- **WHEN** the flows plugin server asks a session to report
- **THEN** that session SHALL publish its current catalog

### Requirement: Only answered probes are published

The bridge SHALL publish a catalog only when pi-flows answered the probe. When no listener answered (pi-flows absent or not yet loaded), it SHALL publish nothing. An answered empty probe SHALL be published as an empty catalog.

#### Scenario: pi-flows absent or not loaded yet
- **WHEN** the bridge probes and no pi-flows listener answers
- **THEN** no catalog event SHALL be published
- **AND** a previously published catalog SHALL stay the latest

#### Scenario: Last flow deleted
- **GIVEN** the catalog listed only `old-flow`
- **WHEN** `old-flow` is deleted and pi-flows rediscovers and answers with no flows
- **THEN** an empty catalog SHALL be published

### Requirement: The catalog survives late subscribe, reload and server restart

The dashboard SHALL derive a session's flow catalog from the newest flow catalog event in that session's event stream, including replayed events. When a browser views a live session whose catalog is unknown (never seen, trimmed from the event history, or lost in a server restart), the flows plugin client SHALL ask the flows plugin server, which SHALL ask that session's bridge to report. The client SHALL repeat the ask at the configured re-ask interval (default 5 seconds) while the catalog stays unknown, up to the configured attempts per view (default 12), and SHALL ask again whenever the user opens the chip, the session actions menu or a flow picker. The server SHALL send at most one catalog ask per session per configured ask limit (default 2 seconds), counted separately from other asks.

#### Scenario: Browser opens a busy session
- **GIVEN** a session published a catalog with `batch:apply` and is now running a turn
- **WHEN** a browser subscribes to that session
- **THEN** the dashboard SHALL know `batch:apply` is available without the session publishing again

#### Scenario: Browser reload
- **WHEN** the browser reloads while viewing a session whose catalog lists two flows
- **THEN** after replay the dashboard SHALL list the same two flows

#### Scenario: Server restart
- **GIVEN** the dashboard server restarted and holds no catalog for a running session with flows
- **WHEN** a browser views that session
- **THEN** the session SHALL be asked to report and the catalog SHALL become known

#### Scenario: Catalog trimmed from a long session
- **GIVEN** a long session whose catalog event was trimmed from the server's event history
- **WHEN** a browser views that session
- **THEN** the session SHALL be asked to report and the catalog SHALL become known

#### Scenario: Bridge reconnects after the first ask
- **GIVEN** the first ask was sent while the session's bridge was reconnecting
- **WHEN** the catalog is still unknown after the minimum interval
- **THEN** the client SHALL ask again

#### Scenario: Catalog does not render in the chat
- **WHEN** a flow catalog event is in the session's event stream
- **THEN** no chat row or unknown-event row SHALL render for it

### Requirement: Core carries no flow list

The dashboard core (bridge extension, server, client shell, shared protocol) SHALL NOT query, send, store, forward or publish a session's flow list. Only the flows plugin SHALL read or produce the catalog.

#### Scenario: No core flow-list message
- **WHEN** a session with flows connects to the dashboard
- **THEN** no core `flows_list` or `request_flows_refresh` message SHALL be sent between the bridge, server or browser

### Requirement: The plugin server sees the same catalog

The flows plugin server SHALL keep each live session's latest catalog from the same catalog events, and the folder-level flow lookup used by automation SHALL return the union of the flow names in the catalogs of the folder's running sessions.

#### Scenario: Automation lists folder flows
- **GIVEN** a running session in folder `/p` whose catalog lists `batch:apply`
- **WHEN** automation asks which flows `/p` offers
- **THEN** the answer SHALL include `batch:apply`

### Requirement: Catalog timing is set in the flows plugin settings

The flows plugin settings SHALL hold the catalog timings below, each with its default and allowed range. A value outside its range SHALL be rejected on save with a message naming the range, and the stored value SHALL stay unchanged. A saved value SHALL take effect without restarting the dashboard. The 300 ms bridge publish debounce is fixed and is not a setting.

| Setting | Default | Range |
|---|---|---|
| Catalog ask limit per session | 2 s | 0.5–60 s |
| Re-ask interval while unknown (browser) | 5 s | 1–60 s |
| Re-ask attempts per view (browser) | 12 | 1–60 |
| Re-ask interval after server start | 5 s | 1–60 s |
| Re-ask window after server start | 60 s | 10–600 s |

#### Scenario: Defaults apply when nothing is set
- **WHEN** the flows plugin settings hold no timing values
- **THEN** the catalog SHALL behave with the defaults in the table

#### Scenario: Out-of-range value is rejected
- **WHEN** the user saves a re-ask attempts value of 0
- **THEN** the save SHALL be rejected with a message naming the range 1–60
- **AND** the stored value SHALL stay unchanged

#### Scenario: Saved value applies without restart
- **GIVEN** the catalog ask limit is 2 s
- **WHEN** the user saves 10 s
- **THEN** a second ask for the same session within 10 s SHALL be dropped from then on, without a restart
