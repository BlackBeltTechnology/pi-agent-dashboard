# shared-config Specification Delta

## ADDED Requirements

### Requirement: A live tunnel URL may be offered for gateway registration, never added silently
When a provider is `connected` and its live URL is absent from the `gateways` records, the
Gateway surface SHALL offer an action to register that URL as a gateway record. When the URL
is already present, the row SHALL indicate that instead of offering the action again.

Registration SHALL NOT happen automatically on connect. A gateway record carries `authModes`,
and a record with none is rejected outright — *"a gateway with none is either unreachable or
unprotected"*. The auth mode cannot be inferred from the tunnel: defaulting to
`trusted-network` would publish an address protected by a CIDR the operator never chose,
while `pairing` and `oauth` are illegal on a non-TLS URL. The offer is automatic; the
decision is the operator's.

The action SHALL state that registering publishes an address the dashboard answers on and
that becomes a CORS-allowed origin.

**Selecting `oauth` moves the sign-in origin and SHALL be gated accordingly.**
`buildGatewayAddPatch` writes `auth.redirectBaseUrl = <url>` whenever `oauth` is among the
selected modes. That is the single value `resolveRedirectBase()` returns, from which both
the minted redirect URI and the session-cookie `Secure` flag derive. Registering a
**non-primary** tunnel URL with `oauth` would therefore re-point the sign-in origin away
from the primary — the same consequence that designating a new primary carries, and which
is confirm-gated there. Offering it unguarded here would route around that gate.

Therefore: when the URL being registered is not the primary provider's URL, `oauth` SHALL
be presented as unavailable with that reason. Registering the **primary's** URL with
`oauth` SHALL carry the same confirmation as designating a primary, naming the redirect-URI
consequence.

#### Scenario: Offered when a connected URL is unregistered
- **WHEN** a provider is `connected` and its URL matches no entry in `gateways`
- **THEN** the row SHALL offer to register that URL

#### Scenario: Not offered when already registered
- **WHEN** the live URL already matches a `gateways` entry
- **THEN** the row SHALL indicate it is registered
- **AND** SHALL NOT offer to add it again

#### Scenario: Not offered for a provider that is not connected
- **WHEN** a provider is `not-installed`, `not-set` or `disconnected`
- **THEN** no registration action SHALL be offered, because there is no live URL to register

#### Scenario: Registration requires an auth mode
- **WHEN** the user attempts to register with no auth mode selected
- **THEN** the registration SHALL be refused with the existing `no-auth-mode` reason

#### Scenario: Connecting never writes a gateway record by itself
- **WHEN** a tunnel connects and its URL is unregistered
- **THEN** `gateways` SHALL be unchanged until the operator completes the action

#### Scenario: oauth is unavailable when registering a non-primary URL
- **GIVEN** zrok is the primary and tailscale is also connected
- **WHEN** the operator registers the tailscale URL
- **THEN** `oauth` SHALL be unavailable, citing that it would move the sign-in origin off the primary
- **AND** `auth.redirectBaseUrl` SHALL NOT be written

#### Scenario: oauth on the primary URL is confirmed, not silent
- **GIVEN** the URL being registered is the primary provider's URL
- **WHEN** the operator selects `oauth`
- **THEN** the action SHALL require the same confirmation as designating a primary
- **AND** SHALL name that the redirect URI is re-minted and previously-registered URIs will be rejected until re-registered

#### Scenario: Registering without oauth never touches the auth origin
- **WHEN** a URL is registered with only `trusted-network` and/or `pairing`
- **THEN** `auth.redirectBaseUrl` SHALL be unchanged

### Requirement: Offered auth modes are gated by the URL's scheme
The registration action SHALL present every auth mode, marking those the URL cannot legally
carry as unavailable together with the reason, rather than hiding them. Hiding a mode leaves
the operator unable to tell an unavailable option from a forgotten one.

For a non-TLS (`http:`) URL, `pairing` and `oauth` SHALL be unavailable and `trusted-network`
SHALL be required, along with at least one address or CIDR.

#### Scenario: TLS URL offers all three modes
- **WHEN** the live URL is `https:` with publicly-trusted TLS
- **THEN** `trusted-network`, `pairing` and `oauth` SHALL all be selectable

#### Scenario: http mesh URL restricts to trusted-network
- **WHEN** the live URL is `http:` (for example a raw mesh IP)
- **THEN** `pairing` SHALL be unavailable citing the TLS requirement
- **AND** `oauth` SHALL be unavailable citing provider refusal of a non-TLS redirect URI
- **AND** `trusted-network` SHALL be required with a non-empty CIDR

#### Scenario: Unavailable modes are shown, not hidden
- **WHEN** a mode is unavailable for the URL
- **THEN** it SHALL still be rendered, marked unavailable, with its reason

#### Scenario: Registering without oauth does not change the sign-in origin
- **WHEN** a gateway URL is registered with only `trusted-network` and/or `pairing`
- **THEN** the OAuth redirect base SHALL be unaffected, because `publicBaseUrls` is never an OAuth redirect source
- **AND** this SHALL NOT be read as a guarantee for the `oauth` path, which writes `auth.redirectBaseUrl` and is governed by the primary-only + confirmation rules above
