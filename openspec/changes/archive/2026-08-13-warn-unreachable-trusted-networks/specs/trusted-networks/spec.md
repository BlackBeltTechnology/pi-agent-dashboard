## MODIFIED Requirements

### Requirement: Network interfaces API endpoint
The server SHALL expose `GET /api/network-interfaces` as a localhost-only endpoint. It SHALL return `{ success: true, data: [...] }` where `data` is an array of detected non-internal IPv4 network interfaces. Each entry SHALL include `name` (interface name), `address` (IPv4 address), `netmask`, and `cidr` (computed CIDR notation, e.g. `192.168.1.0/24`). The CIDR SHALL be computed from the address and netmask.

The endpoint SHALL return **one entry per detected address** and SHALL NOT drop or merge entries. It has two consumers with opposing needs: the listen-interface picker requires every distinct bind address to remain selectable, while the trusted-networks dropdown wants one offer per range. Deduplication is therefore a **presentation** concern owned by the consumer, never by the endpoint.

Each entry SHALL additionally include:
- `label` — a human-meaningful name for the interface, used in place of the raw device name in the UI. A device carrying an address in `100.64.0.0/10` SHALL be labelled as a tailnet interface. When no meaningful label can be derived, `label` SHALL fall back to the device `name`, so the field is always populated.
- `pointToPoint` — `true` when the netmask is `255.255.255.255`. This is a netmask-derived flag, not an interrogation of the OS point-to-point interface flag; any `/32`-configured interface SHALL be treated the same way. A `/32` `cidr` matches exactly one address — the host itself — so it SHALL NOT be presented as a trustable network without a wider alternative.
- `suggestions` — the trust entries offered for this interface, each `{ value, label, wide }`, derived from the same well-known-range table as the block-event trust banner so the two paths never disagree about **which range** contains an address. They may still differ on the `wide` tier, which is contextual — see the `settings-panel` capability. For a non-point-to-point interface the netmask-derived `cidr` SHALL be the sole suggestion, marked `wide: false`. For a point-to-point interface the netmask-derived network is a single address, so the containing well-known range SHALL be offered and SHALL be marked `wide: true`, because it is broader than the interface's own network.

#### Scenario: Machine with Wi-Fi and Ethernet
- **WHEN** the machine has `en0` at `192.168.1.100/255.255.255.0` and `en7` at `10.0.0.50/255.255.0.0`
- **THEN** the endpoint SHALL return entries with `cidr: "192.168.1.0/24"` and `cidr: "10.0.0.0/16"`
- **AND** each SHALL carry a single narrow suggestion equal to its own `cidr`

#### Scenario: Remote request to endpoint
- **WHEN** a request to `GET /api/network-interfaces` arrives from a non-loopback IP
- **THEN** the server SHALL return 403

#### Scenario: Tailscale point-to-point interface is not offered as itself
- **GIVEN** the machine has `utun4` at `100.97.246.31` with netmask `255.255.255.255`
- **WHEN** the endpoint is called
- **THEN** the entry SHALL have `pointToPoint: true`
- **AND** it SHALL NOT offer `100.97.246.31/32` as a trustable suggestion
- **AND** it SHALL offer `100.64.0.0/10` as a wide suggestion
- **AND** its `label` SHALL identify it as a tailnet interface rather than `utun4`

#### Scenario: WireGuard point-to-point interface behaves the same
- **GIVEN** the machine has a `/32` interface whose address is in a well-known private range
- **WHEN** the endpoint is called
- **THEN** the entry SHALL have `pointToPoint: true`
- **AND** its suggestion SHALL be the containing range, marked wide

#### Scenario: Point-to-point address outside any well-known range
- **GIVEN** the machine has a `/32` interface whose address falls in no well-known private or CGNAT range
- **WHEN** the endpoint is called
- **THEN** the entry SHALL have `pointToPoint: true`
- **AND** it SHALL offer no suggestion, because no truthful range can be derived

#### Scenario: Endpoint keeps every address so the picker stays complete
- **GIVEN** the machine has `en0` at `192.168.10.123/255.255.255.0` and `en7` at `192.168.10.224/255.255.255.0`
- **WHEN** the endpoint is called
- **THEN** it SHALL return two entries, one per address
- **AND** both `192.168.10.123` and `192.168.10.224` SHALL remain selectable as specific bind addresses

#### Scenario: Label falls back to the device name
- **GIVEN** an interface whose address matches no well-known range
- **WHEN** the endpoint is called
- **THEN** its `label` SHALL equal its device `name`

#### Scenario: Range table agrees across both paths
- **GIVEN** an address in `100.64.0.0/10` on a `/32` point-to-point interface
- **WHEN** the containing range is derived for it from the interface AND from a block event
- **THEN** both SHALL name `100.64.0.0/10`

#### Scenario: Malformed trusted entry is ignored, never offered
- **GIVEN** a stored trusted entry that parses as neither exact IP, wildcard, nor CIDR
- **WHEN** suggestions and the reachability predicate are computed
- **THEN** the entry SHALL be skipped rather than reported unreachable or offered
