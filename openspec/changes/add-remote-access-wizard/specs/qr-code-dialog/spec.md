## MODIFIED Requirements

### Requirement: Unified tunnel/QR button in sidebar header
The sidebar header SHALL display a single **Remote access** button that summarises who can reach this machine. It SHALL use a network glyph (access point with network), not a QR glyph, plus a state dot, and SHALL carry the same state as text in its accessible name and title ("Remote access: <state>[, N device(s) waiting]"). States, highest first:
- **failed** (red dot) — a planned tunnel provider's connection failed or dropped;
- **partial** (amber dot) — at least one but not all planned providers are connected;
- **internet** (green dot) — every planned provider is connected;
- **network** (blue dot, title "listening on the network") — the running server's bind host is not loopback-only;
- **this computer only** (grey dot) — none of the above (including zero of N planned providers connected with no failure).

When the bind host cannot be read (for example the browser lacks access to the guarded configuration), the network state SHALL be treated as unknown: the dot SHALL reflect only the tunnel states and the title SHALL say the network status is unknown.

When pairing requests are waiting, the button SHALL show their count as a badge. Clicking the button SHALL always open the Remote access dialog on its status landing, whatever the state.

#### Scenario: Tunnel not set up (zrok unavailable)
- **GIVEN** no tunnel provider is installed and the server binds loopback only
- **WHEN** the header renders
- **THEN** the button SHALL show the network glyph with a grey dot and the title "Remote access: this computer only"
- **AND** clicking SHALL open the Remote access dialog landing

#### Scenario: Tunnel set up but disconnected (inactive)
- **GIVEN** zrok is installed and enabled but not connected, and the server binds loopback only
- **WHEN** the header renders
- **THEN** the button SHALL show a grey dot
- **AND** clicking SHALL open the Remote access dialog landing

#### Scenario: Tunnel connected (active)
- **GIVEN** a tunnel provider is connected
- **WHEN** the header renders
- **THEN** the button SHALL show a green dot and the title "Remote access: internet on"
- **AND** clicking SHALL open the Remote access dialog landing

#### Scenario: Devices waiting
- **GIVEN** two pairing requests are pending
- **WHEN** the header renders
- **THEN** the button SHALL show a badge reading 2
- **AND** its accessible name SHALL include "2 devices waiting"

### Requirement: Tunnel status lazy fetch
The button SHALL read tunnel status when it mounts, on every click, and every 30 seconds while mounted, and SHALL update its network state from the server's reachability broadcast without polling the guarded configuration. Pending-request counts SHALL come from the app-wide pairing approval state, not from a separate poll.

#### Scenario: First hover fetches status
- **WHEN** the button mounts
- **THEN** it SHALL fetch `GET /api/tunnel-status` and update its state

#### Scenario: Click always fetches fresh status
- **WHEN** the user clicks the button
- **THEN** it SHALL fetch `GET /api/tunnel-status` and open the Remote access dialog

#### Scenario: Reachability broadcast updates the state
- **GIVEN** the button shows "this computer only"
- **WHEN** a `reachability_updated` message reports a non-loopback resolved bind host
- **THEN** the button SHALL show the network state without a further request

### Requirement: QR code dialog display
The pairing QR SHALL be shown inside the Remote access dialog, as the Open it on the device step of the Let a phone or laptop in task, not as the dialog's first view. On a TLS road it SHALL encode the camera-scannable pairing link for the selected endpoint and show that link as copyable text. The dialog SHALL close on its close button, backdrop click or Escape.

#### Scenario: Dialog opens on click when active
- **GIVEN** a tunnel provider is connected
- **WHEN** the user clicks the Remote access button
- **THEN** the dialog SHALL open on the status landing, not on a QR code

#### Scenario: QR code encodes tunnel URL
- **GIVEN** the Open it on the device step is current on a TLS road
- **WHEN** it renders
- **THEN** the QR SHALL encode the pairing link whose base is the selected TLS endpoint

#### Scenario: Copy URL to clipboard
- **WHEN** the user activates the copy control next to the link
- **THEN** the same link the QR encodes SHALL be copied to the clipboard

#### Scenario: Close dialog
- **WHEN** the user clicks the close button, clicks the backdrop, or presses Escape
- **THEN** the dialog SHALL close

### Requirement: Disconnect from QR dialog
When the Internet road is on, its row on the Remote access landing SHALL offer Disconnect, which stops the tunnels this server connected.

#### Scenario: Disconnect tunnel
- **GIVEN** the Internet row reads On
- **WHEN** the user activates its Disconnect action
- **THEN** the client SHALL request the tunnel disconnect
- **AND** the Internet row and the header button SHALL refresh to the disconnected state

### Requirement: Setup navigation from QR dialog
The Remote access landing SHALL link to the full network settings (Settings ▸ Network ▸ Gateway), which remain the expert view for every option the wizard sets.

#### Scenario: Navigate to setup
- **WHEN** the user activates "All network settings" on the landing
- **THEN** the dialog SHALL close
- **AND** the client SHALL navigate to `/settings/gateway`
