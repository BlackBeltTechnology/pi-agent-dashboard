## MODIFIED Requirements

### Requirement: Pairing-QR transport gate and link QR
The device-pairing payload `{ v, id, code, urls[] }` SHALL contain ONLY TLS endpoints (`https://` / `wss://`), including MagicDNS names that carry a provisioned `tailscale cert`. No-TLS (`http://`) endpoints — mesh `100.x`/`10.x` IPs and LAN — SHALL NOT enter the pairing payload. For such no-TLS endpoints the UI SHALL instead offer a separate **link QR** that encodes the bare URL string only, which opens the dashboard directly WITHOUT invoking the pairing handshake. This keeps `qr-device-pairing` D14 intact.

The "Connect a device" view SHALL present **exactly one QR code at a time**, chosen through a **network selector** listing every available endpoint (each tagged by `kind` and by mode — `pairing` for TLS endpoints, `link` for no-TLS endpoints). The selector SHALL default to the public TLS pairing endpoint when one exists; when no TLS endpoint exists, it SHALL default to the first available link endpoint. The view SHALL NOT render multiple QR codes simultaneously. The QR content for the selected endpoint SHALL follow the transport gate above unchanged: a TLS selection encodes the pairing payload, a no-TLS selection encodes the bare URL string only.

#### Scenario: no-TLS endpoint excluded from pairing payload
- **WHEN** an active endpoint has `tls: false` (e.g. `http://100.101.22.7:8000`)
- **THEN** it SHALL NOT appear in the pairing payload `urls[]`
- **AND** the UI MAY offer it as a link QR encoding only the URL string

#### Scenario: TLS MagicDNS name is a pairing endpoint
- **WHEN** a MagicDNS name has a provisioned TLS cert (`https://host.tailnet.ts.net`)
- **THEN** it SHALL be eligible for the pairing payload `urls[]` like any other TLS endpoint

#### Scenario: link QR does not carry a secret
- **WHEN** a link QR is generated for a no-TLS http endpoint
- **THEN** its content SHALL be the URL string only, carrying no one-time code, bearer, or pairing payload

#### Scenario: exactly one QR shown at a time
- **WHEN** the "Connect a device" view renders with a tunnel plus multiple no-TLS endpoints
- **THEN** exactly one QR code SHALL be visible
- **AND** a selector SHALL list every endpoint so the user can switch which one the QR encodes

#### Scenario: tunnel is the default selection
- **WHEN** the view opens and at least one TLS pairing endpoint exists
- **THEN** the selector SHALL default to the public TLS endpoint and the QR SHALL encode its pairing payload

#### Scenario: default falls back to a link when no TLS endpoint exists
- **WHEN** the view opens and no TLS endpoint exists (tunnel off, no https URL)
- **THEN** the selector SHALL default to the first available no-TLS endpoint and the QR SHALL encode its bare URL

#### Scenario: selecting a link endpoint swaps the pairing controls out
- **WHEN** the user selects a no-TLS `link` endpoint in the selector
- **THEN** the QR SHALL encode that endpoint's bare URL
- **AND** the pairing-only controls (copy-string, confirmation-code input, expiry countdown) SHALL be hidden in favour of a "opens the dashboard directly, no pairing" note
