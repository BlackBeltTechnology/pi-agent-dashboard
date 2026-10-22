## MODIFIED Requirements

### Requirement: Core gates run before plugin delegation

For a plugin-registered scope the upgrade handler SHALL apply, in order: host admission (unchanged); origin admission — when `admitOrigins` is non-empty the request Origin MUST exactly equal one entry (the dashboard origin policy is NOT consulted), when empty the dashboard origin policy applies unchanged; then the peer MUST be genuinely local: loopback remote address, request `Host` naming a loopback host (`127.0.0.1`, `[::1]`, `localhost`, any port), and no proxy-forwarding header present (`x-forwarded-for`, `x-forwarded-host`, `x-forwarded-proto`, `x-forwarded-server`, `x-forwarded-port`, `x-real-ip`, `forwarded`, `via`). Session cookies, the local IPC token, single-use tickets, and trusted-CIDR bypass SHALL NOT be evaluated for plugin scopes — the plugin's `handleUpgrade` is responsible for its own per-connection credential. When `requireLocalProof` is in effect (the default), the genuinely-local peer check SHALL additionally require local proof, unless the registration declares `peerCredential: "plugin"`; such a registration asserts that its `handleUpgrade` verifies a single-use, short-lived per-connection credential, and the core gate then skips only the proof requirement (host, origin and genuinely-local checks still apply).

#### Scenario: Pinned origin admitted

- **WHEN** an upgrade to a plugin scope with non-empty `admitOrigins` carries a listed Origin from a loopback peer
- **THEN** the origin gate SHALL pass and the upgrade SHALL reach `handleUpgrade`

#### Scenario: Loopback page origin rejected on a pinned scope

- **WHEN** an upgrade to a plugin scope with non-empty `admitOrigins` carries `Origin: http://localhost:5173` (which the dashboard origin policy would admit) from a loopback peer
- **THEN** the upgrade SHALL be rejected with HTTP 403

#### Scenario: Cookie holder without the plugin secret

- **WHEN** a loopback peer presents a valid dashboard session cookie on a plugin scope but `handleUpgrade` rejects its per-connection credential
- **THEN** the upgrade SHALL be rejected — the cookie SHALL NOT substitute for the plugin credential

#### Scenario: Tunnel Host rejected deterministically

- **WHEN** an upgrade to a plugin scope arrives from a loopback remote address but with a non-loopback `Host` (e.g. the tunnel's public hostname) or with any `x-forwarded-*` / `forwarded` / `via` header
- **THEN** the upgrade SHALL be rejected with HTTP 403 regardless of whether the tunnel injects other markers

#### Scenario: No auth secret configured

- **WHEN** the dashboard runs without `authConfig.secret` and a trusted-CIDR peer (non-loopback) attempts a plugin-scope upgrade
- **THEN** the upgrade SHALL be rejected with HTTP 403 (the no-secret CIDR fallback does not apply to plugin scopes)

#### Scenario: Pinned origin on a core scope is not admitted

- **WHEN** the same Origin is presented on `/ws` (core `browser` scope)
- **THEN** the existing origin policy SHALL apply unchanged and the upgrade SHALL be rejected

#### Scenario: Ticket presented to plugin scope

- **WHEN** an upgrade to a plugin scope presents a valid ticket minted for that scope name
- **THEN** the ticket SHALL NOT be accepted and `POST /api/ws-ticket` SHALL refuse to mint tickets for plugin scopes

#### Scenario: Plugin-credential scope skips only the proof requirement
- **WHEN** `requireLocalProof` is unset and a bare loopback upgrade with no proof reaches a scope registered with `peerCredential: "plugin"`
- **THEN** the core gate SHALL pass it to `handleUpgrade` after host, origin and genuinely-local checks, and `handleUpgrade` SHALL decide on its own credential

#### Scenario: Ordinary plugin scope needs proof under the default
- **WHEN** `requireLocalProof` is unset and a bare loopback upgrade with no proof reaches a plugin scope registered without `peerCredential`
- **THEN** the core gate SHALL refuse it before delegation
