## MODIFIED Requirements

### Requirement: Unified Access settings surface

The dashboard SHALL provide a `Settings → Access` page listing every access grant across all eight stores: path-anchor grants, `config.trustedNetworks`, `auth.bypassHosts`, CORS origins, pinned directories, KB source trust, worktree-init hook trust, and project trust. Each entry SHALL show its subject and the store it belongs to.

`auth.bypassHosts` SHALL be listed as its own store rather than folded into trusted networks, because it is a separate persisted field that the network guard merges with `trustedNetworks` at runtime, and it is the canonical UI write path for host trust.

When the effective network trust mode (`network.trustMode`, see the `trusted-networks` capability) is `"pair"`, the `config.trustedNetworks` and `auth.bypassHosts` stores SHALL be headed as networks that **may request access**, not as grants of access, because in that mode an entry admits no request. Their entries SHALL remain listed and revocable.

#### Scenario: Grants from every store are listed

- **WHEN** the Access page is opened
- **THEN** it SHALL show entries drawn from each of the grant stores that holds at least one entry

#### Scenario: Empty state

- **WHEN** no store holds any grant
- **THEN** the page SHALL render an empty state rather than an error

#### Scenario: bypassHosts entries are distinguishable from trustedNetworks

- **GIVEN** a host is present in `auth.bypassHosts` and a CIDR is present in `config.trustedNetworks`
- **WHEN** the Access page lists them
- **THEN** each SHALL be labelled with the store it came from, so revoking targets the correct field

#### Scenario: Network stores relabelled in pair mode

- **GIVEN** the effective trust mode is `"pair"` and `auth.bypassHosts` holds `192.168.16.0/24`
- **WHEN** the Access page lists it
- **THEN** its store heading SHALL describe networks that may request access
- **AND** its Revoke action SHALL remain

### Requirement: The Access surface shows pending prompts and recent verdicts

The Access page SHALL list the access requests currently pending a verdict and
the recent verdicts, each showing its plane, subject, and — for a verdict that
created a grant — the grant it produced. A pending entry SHALL be answerable from
this page, so the operator has a prompt-free path to the same outcome.

When the effective network trust mode is `"pair"`, a network-plane denial SHALL
NOT be a pending access request (no network grant exists to answer with); the
refused peer is shown on the Security tab's network access section instead, and
the device obtains access by pairing. Other planes are unaffected.

#### Scenario: A pending request is visible and answerable

- **WHEN** an access request is pending a verdict
- **THEN** it SHALL be listed on the Access page
- **AND** it SHALL be answerable there

#### Scenario: A verdict links to the grant it created

- **WHEN** an allow-always verdict created a grant
- **THEN** the Access page SHALL show which store the grant was written to

#### Scenario: The page works with prompting disabled

- **GIVEN** prompting is disabled
- **WHEN** denials are recorded
- **THEN** they SHALL still be listed and answerable on the Access page

#### Scenario: Network denials are not pending in pair mode

- **GIVEN** the effective network trust mode is `"pair"`
- **WHEN** a network denial is recorded
- **THEN** it SHALL NOT be listed as a pending access request on the Access page
- **AND** a pending CORS-plane request SHALL still be listed and answerable
