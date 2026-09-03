# qr-code-dialog Specification

## Purpose

Lets the user get the dashboard onto a phone without typing an address: a unified tunnel/QR button in the sidebar header, lazily fetched tunnel status, a QR code dialog, and disconnect and setup-navigation actions from within it.

## Requirements

### Requirement: Unified tunnel/QR button in sidebar header
The sidebar header SHALL display a single unified button that combines tunnel status indication and QR code access. The button's icon and behavior SHALL change based on tunnel state.

#### Scenario: Tunnel not set up (zrok unavailable)
- **WHEN** the tunnel status is `"unavailable"` (zrok not installed)
- **THEN** the button SHALL display a tunnel icon in the default muted color
- **AND** clicking SHALL navigate to `/tunnel-setup`

#### Scenario: Tunnel set up but disconnected (inactive)
- **WHEN** the tunnel status is `"inactive"` (zrok installed but tunnel not running)
- **THEN** the button SHALL display a QR code icon in the default muted color
- **AND** clicking SHALL navigate to `/tunnel-setup`

#### Scenario: Tunnel connected (active)
- **WHEN** the tunnel status is `"active"` with a URL
- **THEN** the button SHALL display a QR code icon in green
- **AND** clicking SHALL open the QR code dialog

### Requirement: Tunnel status lazy fetch
The button SHALL fetch tunnel status lazily on first hover (`onMouseEnter`) and on every click, rather than polling continuously. This avoids unnecessary polling when the button is not interacted with.

#### Scenario: First hover fetches status
- **WHEN** the user hovers over the button for the first time
- **THEN** the button SHALL fetch `GET /api/tunnel-status` and update its icon/color

#### Scenario: Click always fetches fresh status
- **WHEN** the user clicks the button
- **THEN** the button SHALL fetch `GET /api/tunnel-status` before deciding the action

### Requirement: QR code dialog display
Clicking the button when the tunnel is active SHALL open a dialog (via DialogPortal) displaying:
1. A QR code image encoding the tunnel URL
2. The tunnel URL as selectable text
3. A copy button to copy the URL to clipboard
4. A close button
5. A disconnect button to stop the tunnel
6. A setup button to navigate to tunnel configuration

#### Scenario: Dialog opens on click when active
- **WHEN** the user clicks the button and tunnel status is `"active"`
- **THEN** a modal dialog SHALL appear with the QR code, URL, and action buttons

#### Scenario: QR code encodes tunnel URL
- **WHEN** the dialog is displayed
- **THEN** the QR code SHALL encode the active tunnel URL

#### Scenario: Copy URL to clipboard
- **WHEN** the user clicks the copy button
- **THEN** the tunnel URL SHALL be copied to the clipboard

#### Scenario: Close dialog
- **WHEN** the user clicks the close button, clicks the backdrop, or presses Escape
- **THEN** the dialog SHALL close

### Requirement: Disconnect from QR dialog
The QR code dialog SHALL include a disconnect button that stops the active tunnel.

#### Scenario: Disconnect tunnel
- **WHEN** the user clicks the disconnect button in the QR dialog
- **THEN** the client SHALL call `POST /api/tunnel-disconnect`
- **AND** the dialog SHALL close
- **AND** the button SHALL refresh its status

### Requirement: Setup navigation from QR dialog
The QR code dialog SHALL include a setup button that navigates to the tunnel setup guide.

#### Scenario: Navigate to setup
- **WHEN** the user clicks the setup button in the QR dialog
- **THEN** the dialog SHALL close
- **AND** the client SHALL navigate to `/tunnel-setup`
