# mid-turn-tool-auth

Courier-mode OAuth for tools invoked mid-turn: detect a tool's auth challenge, surface it in
ChatView, drive the browser/code ceremony, and detect completion — while the external tool
retains ownership of its own credential store. Owner-mode (dashboard-owned vault) is a
separate capability deferred to `add-connector-layer` Phase 2.

## ADDED Requirements

### Requirement: Auth-challenge detection from a headless tool
The system SHALL launch a courier-mode tool in a headless auth mode and classify the
resulting challenge into exactly one kind: `url` (loopback), `device` (device code), `paste`
(out-of-band), `done`, or `none`. Detection SHALL be performed by a per-tool adapter, not a
single universal parser. An adapter SHALL prefer a tool's structured output when available
and fall back to prose parsing otherwise.

#### Scenario: rclone raises a loopback challenge via structured state
- **WHEN** the rclone adapter runs `rclone config create <name> drive --non-interactive --auth-no-open-browser`
- **AND** rclone emits a JSON blob whose `State` begins with `*oauth`
- **THEN** the adapter SHALL classify the challenge as `{ kind: "url", url }` using the authorize URL from rclone output

#### Scenario: gh raises a device-code challenge via prose
- **WHEN** the gh adapter runs `gh auth login` in device mode
- **AND** gh prints a one-time device code and a verification URL
- **THEN** the adapter SHALL classify the challenge as `{ kind: "device", verificationUrl, userCode }`

#### Scenario: Tool is already authenticated
- **WHEN** a courier tool is launched and exits without raising any authorization prompt
- **THEN** the adapter SHALL classify the result as `{ kind: "done" }` and no card SHALL be shown

### Requirement: ChatView card matches the challenge kind
The system SHALL render a ChatView card whose shape matches the detected challenge kind,
reusing the existing `ask_user`/`PromptBus` card path.

#### Scenario: Loopback url card
- **WHEN** the detected challenge is `{ kind: "url" }`
- **THEN** the card SHALL present an "Open in browser" action for the authorize URL

#### Scenario: Device code card
- **WHEN** the detected challenge is `{ kind: "device" }`
- **THEN** the card SHALL display the user code prominently and instruct the user to enter it at the verification URL

#### Scenario: Paste card
- **WHEN** the detected challenge is `{ kind: "paste" }`
- **THEN** the card SHALL show the authorize URL and a field to paste the returned code back

### Requirement: Loopback ceremony is gated to a host-local browser
For the `url` (loopback) kind, the system SHALL open the authorize URL in the system browser
on the server host only when the dashboard is accessed locally, reusing the existing
`system-open-capability` and remote-access gating. Device-code and paste kinds SHALL NOT be
gated, because they carry no loopback that must resolve on the tool's host.

#### Scenario: Local access opens the host browser
- **WHEN** the challenge kind is `url` and the request originates from a loopback/trusted client
- **THEN** the system SHALL open the authorize URL via the existing `openBrowser` helper on the server host

#### Scenario: Remote access blocks the loopback ceremony
- **WHEN** the challenge kind is `url` and the request originates from a remote (tunnel/non-localhost) client
- **THEN** the system SHALL NOT spawn a browser on the server host
- **AND** the card SHALL instruct the user to open the dashboard on the server host to finish connecting

#### Scenario: Remote access permits a device ceremony
- **WHEN** the challenge kind is `device` and the request originates from a remote client
- **THEN** the ceremony SHALL proceed and the card SHALL show the code and verification URL

### Requirement: Credential ownership stays with the tool
In courier mode the system SHALL NOT read, persist, or log the tool's OAuth token. The
external tool's own listener or poll SHALL complete the exchange and write the tool's own
configuration store.

#### Scenario: Token never enters the dashboard
- **WHEN** an rclone courier flow completes successfully
- **THEN** the token SHALL be written only to the tool's own config (e.g. rclone.conf)
- **AND** no dashboard credential store SHALL contain the token

### Requirement: Completion detection resolves the card
The system SHALL detect courier-flow completion from the tool's process exit (or its own
listener/poll signal) and resolve the ChatView card accordingly.

#### Scenario: Success resolves to connected
- **WHEN** the courier tool signals success (exit 0 / listener fired / poll satisfied)
- **THEN** the card SHALL update to a connected state

#### Scenario: Failure or timeout resolves to error
- **WHEN** the courier tool exits non-zero or no completion arrives within the configured timeout
- **THEN** the card SHALL update to an error state describing the failure

### Requirement: rclone is the first courier adapter
The system SHALL ship an rclone adapter as the first courier tool, using rclone's
`--non-interactive` state machine for structured detection and `--auth-no-open-browser` so the
dashboard owns the browser-open hop.

#### Scenario: Connect a Google Drive remote end to end (local)
- **WHEN** a user initiates "connect Google Drive via rclone" from a local ChatView
- **THEN** the rclone adapter SHALL raise a `url` challenge, the dashboard SHALL open the local browser, rclone's own loopback listener SHALL catch the code and write rclone.conf, and the card SHALL resolve to connected
