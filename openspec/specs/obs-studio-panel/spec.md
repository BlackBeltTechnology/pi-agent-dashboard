# obs-studio-panel Specification

## Purpose
A dashboard surface to see and drive provisioned OBS instances remotely, through the authenticated dashboard, without exposing obs-websocket or its password to the browser.

## Requirements

### Requirement: Panel and entry point
The plugin SHALL provide a global panel at `/obs/` rendered in the dashboard content area and as a standalone app, and a settings section showing each OBS service's state, authentication state, OBS version, exposure warning and recovery suspension with a link to the panel. All user-visible strings SHALL be localized in the dashboard's supported catalogs. The panel SHALL let the user pick an OBS instance, list and switch scenes, toggle the virtual camera and recording, and view a preview of the program scene.

#### Scenario: Open from settings
- **WHEN** the user opens the OBS settings section and selects "Open OBS panel"
- **THEN** the panel opens at `/obs/` beside the sidebar

#### Scenario: No OBS provisioned
- **WHEN** no OBS service is defined
- **THEN** the panel and settings section show how to provision OBS and no control is offered

### Requirement: Fixed relay operations, no raw passthrough
The plugin server SHALL expose only fixed operations: list instances, status, program-scene screenshot, scene switch, virtual camera toggle and record toggle. It SHALL NOT accept an arbitrary obs-websocket request type from the browser. The service path parameter SHALL be accepted only for an id recorded as a provisioned OBS instance that still has a service definition, request bodies SHALL be schema-validated, and every route SHALL be rate-limited.

#### Scenario: Unknown service id
- **WHEN** a request targets a service id that is not a provisioned OBS instance, including another service with a websocket endpoint
- **THEN** the route returns 404 and no connection is attempted

#### Scenario: Rate limit
- **WHEN** a client, including a loopback client, exceeds a route's request limit
- **THEN** the route returns 429 and nothing is sent to OBS

#### Scenario: Not exposed as MCP tools
- **WHEN** the dashboard's MCP tool manifest is generated
- **THEN** no OBS panel route appears as a tool

#### Scenario: Invalid body
- **WHEN** a scene-switch request omits the scene name
- **THEN** the route returns 400 and nothing is sent to OBS

### Requirement: Authority and secret isolation
Instance listing and status SHALL require the observe tier. The screenshot (which can show the desktop or webcam) and every mutating operation SHALL require the operate tier through the central route-tier table AND operate authority as decided by the plugin identity seam, the same rule as managed-service mutations; when the seam is unavailable they SHALL be refused. A request that is not operate-authorized SHALL NOT start OBS, open a connection to it, or cause its password to be resolved. No route response, server log or browser state SHALL contain the obs-websocket password, and the dashboard server process SHALL NOT hold it; only the `service exec` child connected to OBS does.

#### Scenario: Observe-tier caller cannot switch scenes
- **WHEN** an observe-tier bearer posts a scene switch
- **THEN** the request is refused with the tier gate's insufficient-scope response and the scene does not change

#### Scenario: Trusted-network caller without credentials cannot drive OBS
- **WHEN** a caller on a trusted network with no credential posts a record toggle or requests the screenshot
- **THEN** the request is refused with the host's operate-required response and OBS is not contacted

#### Scenario: Status poll never starts OBS
- **WHEN** an observe-tier caller polls status while the OBS service is `stopped`
- **THEN** the response reports `stopped`, no OBS process is started and no password is resolved

#### Scenario: Observe-only viewer sees service state
- **WHEN** an observe-tier caller polls status for a healthy OBS while no bridge is open
- **THEN** the response carries the managed-service state and no live OBS data, and no bridge is opened

#### Scenario: Strict local proof
- **WHEN** strict local proof is enabled and an operator requests the screenshot
- **THEN** the plugin still determines the service state and returns the preview

#### Scenario: Observe-tier caller cannot see the preview
- **WHEN** an observe-tier bearer requests the screenshot
- **THEN** the request is refused with the tier gate's insufficient-scope response

#### Scenario: No secret in responses
- **WHEN** every panel route is called against a provisioned service
- **THEN** no response body or server log line contains the password

### Requirement: Preview cost bound
The preview SHALL poll the program-scene screenshot at no more than one frame per second, only while the panel is visible, and SHALL back off after consecutive errors. After the first successful response following a backoff, polling SHALL return to the normal rate. The bridge connection to an OBS instance SHALL close after 60 seconds without panel requests and SHALL close when the dashboard side of its channel goes away, releasing its service lease in both cases. Concurrent panel requests SHALL each receive their own response. A panel request that OBS does not answer within 5 seconds SHALL return 504 with `obs-timeout`, and the bridge SHALL then be restarted on the next request.

#### Scenario: Hidden tab stops polling
- **WHEN** the panel's tab becomes hidden
- **THEN** no further screenshot requests are made until it is visible again

#### Scenario: Dashboard side disappears
- **WHEN** the plugin server process dies while a bridge is open
- **THEN** the bridge exits and its service lease is released

#### Scenario: Concurrent requests
- **WHEN** a screenshot and a scene switch are in flight on the same bridge
- **THEN** each caller receives the response to its own request

#### Scenario: OBS hangs on a panel request
- **WHEN** OBS does not answer a scene switch within 5 seconds
- **THEN** the route returns 504 `obs-timeout`, the bridge exits and releases its lease, and the next request starts a new bridge

#### Scenario: Idle bridge closed
- **WHEN** no panel request arrives for 60 seconds
- **THEN** the bridge child exits and its service lease is released

### Requirement: Lifecycle actions delegate to managed services
When an OBS service is not healthy and not `blocked`, the panel SHALL show its state and reason and offer Start or Retry through the existing managed-services routes. When the service is `blocked`, the panel SHALL explain that OBS is waiting for input on the host and offer no actions. When authentication fails, the panel SHALL show a re-provisioning hint. The panel SHALL NOT offer Stop.

#### Scenario: Blocked on safe-mode prompt
- **WHEN** the service is `blocked`
- **THEN** the panel shows that OBS is waiting for input on the host and offers no actions, including Start and Retry

#### Scenario: Stopped service
- **WHEN** the service is `stopped`
- **THEN** the panel offers Start, which calls the managed-services start route
