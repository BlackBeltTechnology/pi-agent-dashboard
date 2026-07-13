# server-selector — delta

> Web-path enabler: the trusted-network origin allowance added by the
> `server-cors` delta (§1) is the SOLE server-side change the web dropdown
> needs. Once the target CORS-allows the probing origin, the existing
> ticketless staging + committed sockets already pass the target's WS upgrade
> via its trusted-source-IP short-circuit (`validateWsUpgrade` /
> the no-auth upgrade branch return before any ticket check), so NO WS-ticket
> minting is added by this change.

## ADDED Requirements

### Requirement: Cross-origin CORS-blocked probe is distinct from Unreachable
An availability probe that fails as an opaque cross-origin block (the transport `.catch()` path with no readable response) SHALL be rendered distinctly from a genuine transport-unreachable when the entry's host is a private-LAN address literal (a trusted-network candidate) — surfacing a hint that the remote must allowlist this origin — rather than a bare "Unreachable". The existing HTTP 403 `network_not_allowed` → "Network not allowed" state and the plain transport-failure → "Unreachable" state (for non-LAN hosts) are preserved.

#### Scenario: LAN host with a blocked probe shows an allowlist hint
- **WHEN** an entry whose host is a private-LAN address (RFC-1918, CGNAT, link-local, or an mDNS `.local` name) is probed cross-origin AND the probe throws with no readable response
- **THEN** the entry SHALL render a distinct "CORS-blocked — allowlist this origin on the remote" indicator, NOT "Unreachable"
- **AND** the entry SHALL be disabled (switching blocked until the remote allowlists the origin)

#### Scenario: Existing states unchanged
- **WHEN** a probe returns HTTP 403 with `error: "network_not_allowed"`
- **THEN** the entry SHALL render "Network not allowed"
- **AND** a transport failure for a non-LAN host SHALL still render "Unreachable"
