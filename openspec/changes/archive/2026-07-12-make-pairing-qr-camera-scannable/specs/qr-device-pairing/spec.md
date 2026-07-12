# qr-device-pairing (delta)

## MODIFIED Requirements

### Requirement: Pairing payload rendered as QR and copy-string
The server SHALL produce a pairing payload `{ v, id, code, urls[] }` — protocol
version, public-key fingerprint, a one-time pairing code, and every currently
`wss://`-reachable endpoint — and SHALL render it BOTH as a scannable QR code and
as a copyable text string (camera-less fallback).

The QR code SHALL encode a scannable `https://` deep link of the form
`https://<tls-endpoint>/pair#<payload-string>`, where `<tls-endpoint>` is a
publicly-trusted TLS endpoint from `urls[]` and `<payload-string>` is the same
base64url `pi:pair:v1.…` payload string carried in the URL **fragment**. A phone
camera SHALL therefore recognize the QR as an actionable `https` link and open the
browser pairing view. The one-time pairing code SHALL travel only in the URL
fragment (never the query string), so it is not sent to the server in the landing
request nor emitted in access logs or `Referer` headers. The copyable text string
SHALL remain the bare `pi:pair:v1.…` payload string (unchanged), so an
Electron/native client can paste it directly.

#### Scenario: QR and copy-string presented together
- **WHEN** a user opens the pairing view
- **THEN** the dashboard shows a QR encoding an `https://<tls-endpoint>/pair#<payload>` link AND a copyable string encoding the same payload

#### Scenario: QR is a camera-actionable https link
- **WHEN** a phone camera scans the pairing QR
- **THEN** the encoded value SHALL be an `https://` URL the camera can open in a browser
- **AND** the browser SHALL land on the `/pair` view carrying the payload in the URL fragment

#### Scenario: one-time code stays out of logs
- **WHEN** the pairing QR is generated
- **THEN** the one-time pairing code SHALL appear only in the URL fragment (after `#`) and never in the query string
- **AND** the landing request for `/pair` SHALL NOT transmit the code to the server (it is redeemed only via the `/api/pair/redeem` POST body)

#### Scenario: copy-string stays a bare payload for paste
- **WHEN** an Electron/native client copies the pairing copy-string
- **THEN** the copy-string SHALL be the bare `pi:pair:v1.…` payload (no `https://…/pair#` wrapper), decodable directly

#### Scenario: one QR serves camera and Electron
- **WHEN** an Electron client scans the same `https://<tls-endpoint>/pair#<payload>` QR
- **THEN** the client SHALL extract the payload from the URL fragment and pair using it, identically to pasting the bare copy-string

#### Scenario: Only wss-reachable endpoints listed
- **WHEN** the server generates the payload and the tunnel is active but no TLS LAN URL is configured
- **THEN** `urls[]` contains the tunnel `wss://` URL and omits any plain-`http` LAN address

#### Scenario: No reachable endpoint
- **WHEN** no `wss://`-reachable endpoint exists (no tunnel, no TLS)
- **THEN** the pairing view SHALL explain that a tunnel or TLS is required to pair a remote device
