## MODIFIED Requirements

### Requirement: Unified Access settings surface

The dashboard SHALL provide a `Settings → Access` page listing every access grant across all nine stores: path-anchor grants, `config.trustedNetworks`, `auth.bypassHosts`, CORS origins, pinned directories, KB source trust, worktree-init hook trust, project trust, and preview-egress origins. Each entry SHALL show its subject and the store it belongs to. Preview-egress entries SHALL also show the project they apply to.

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

#### Scenario: Preview-egress origin listed with its project

- **GIVEN** `https://cdn.tailwindcss.com` is granted for project `/p`
- **WHEN** the Access page is opened
- **THEN** it SHALL list that origin under the preview-egress store with project `/p`

## ADDED Requirements

### Requirement: Revoking a preview-egress grant takes effect on the next preview load

Revoking a preview-egress entry SHALL remove that origin from its project's list in the preview-egress store. The next load of any restricted preview in that project SHALL block the origin again.

#### Scenario: Revoked CDN is blocked again

- **GIVEN** `https://cdn.tailwindcss.com` granted for `/p` and revoked from the Access page
- **WHEN** an auto-opened preview under `/p` is reloaded
- **THEN** the CDN is blocked and listed in the viewer's blocked-origins banner
