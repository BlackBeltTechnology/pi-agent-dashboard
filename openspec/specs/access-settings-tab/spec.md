# access-settings-tab Specification

## Purpose
TBD - created by archiving change add-access-grants-and-review. Update Purpose after archive.

## Requirements

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

### Requirement: Stores are read in place, not migrated

The Access page SHALL read each grant store at its existing location and SHALL NOT consolidate, rewrite, or relocate any existing store. In particular pi's own project-trust store SHALL be read through pi's API and never rewritten by the dashboard except through that API.

#### Scenario: Opening the page does not rewrite stores

- **WHEN** the Access page loads
- **THEN** no grant store file SHALL be modified

#### Scenario: Existing store formats are unchanged

- **WHEN** this capability ships
- **THEN** `worktree-init-trust.json`, `kb-source-trust.json`, `config.trustedNetworks`, `cors.allowedOrigins`, pinned directories, and the pi project-trust store SHALL retain their current formats

### Requirement: Every listed grant is revocable

Each listed entry SHALL offer a revoke action that removes the grant from its own store, with one explicit carve-out: project trust, when the underlying pi contract cannot express deletion (see the project-trust requirement below), SHALL be listed read-only and marked as managed by pi.

Two stores have no revoke capability today — the worktree-init hook trust store and the KB source trust store expose only trust-check and record operations — so each SHALL gain a revoke operation. Project trust is the one exception, governed by its own requirement below. Revocation SHALL clear both the persisted entry and any in-memory session-scoped trust for that subject, so a revoked grant does not survive in memory for the life of the process.

#### Scenario: Revoking a path anchor

- **WHEN** a path-anchor grant is revoked from the Access page
- **THEN** the entry SHALL be removed from `access-grants.json`
- **AND** it SHALL disappear from the list

#### Scenario: Revoking a trusted network

- **WHEN** a trusted-network entry is revoked
- **THEN** it SHALL be removed via the existing config write path

#### Scenario: Revoking a store that had no revoke path

- **GIVEN** a worktree-init hook trust entry and a KB source trust entry
- **WHEN** either is revoked from the Access page
- **THEN** it SHALL be removed from its store
- **AND** any in-memory session-scoped trust for that subject SHALL also be cleared

#### Scenario: Revocation is reflected without restart

- **WHEN** any grant is revoked
- **THEN** the corresponding gate SHALL enforce the revocation on the next request without a server restart

### Requirement: The Access page reviews and revokes; it does not create grants

The Access page SHALL NOT offer a way to create a new grant for a subject the operator types or picks. A path-anchor grant SHALL originate only from the remedy surface attached to an actual denial, from an agent path-gate confirmation, or from a provisioning line the operator approved, so every grant traces back to a refused request, an agent confirmation, or a provisioning line the operator approved. The page's write capability SHALL be limited to revocation and to answering pending requests it lists.

#### Scenario: No add affordance is present

- **WHEN** the Access page is opened
- **THEN** it SHALL offer no control that creates a grant for an arbitrary subject

#### Scenario: Grants originate at a denial

- **WHEN** a filesystem grant is created other than from an approved provisioning line or an agent path-gate confirmation
- **THEN** it SHALL have been created from the remedy surface of a denial, and the denied subject SHALL be what is granted

#### Scenario: Session-scoped grants appear alongside persisted ones

- **GIVEN** a session-scoped path grant is in effect
- **WHEN** the Access page is opened
- **THEN** it SHALL be listed with its subject, scope, grant time and origin, and SHALL offer revoke

### Requirement: Project-trust entries are revoked through the existing pi write wrapper

Project-trust entries SHALL be listed on the Access page. Revocation SHALL go through the repository's existing wrapper over pi's trust write path (`persistTrustDecision`), which is already the write path used by resource activation. The dashboard SHALL NOT write pi's project-trust store by any other means.

Revocation SHALL remove the entry rather than record a standing negative decision. The update contract is `{ path, decision: boolean | null }`, and whether `null` deletes the entry SHALL be confirmed before the revoke action is wired, because recording a persistent refusal instead of a deletion would enrol state the existing decline path deliberately avoids creating.

If deletion cannot be expressed through that contract, the entry SHALL be listed read-only and marked as managed by pi, and revocation SHALL be deferred rather than emulated by writing a negative decision.

#### Scenario: Revoke is routed through the existing wrapper

- **WHEN** a project-trust entry is revoked from the Access page
- **THEN** the revocation SHALL be performed through the existing pi trust write wrapper
- **AND** no other code path SHALL write pi's store

#### Scenario: Deletion cannot be expressed

- **GIVEN** the pi update contract cannot express removing an entry
- **WHEN** a project-trust entry is listed
- **THEN** it SHALL render read-only, marked as managed by pi
- **AND** no negative decision SHALL be written in place of a deletion

#### Scenario: Revoking removes rather than refuses

- **WHEN** a project-trust entry is revoked
- **THEN** the entry SHALL be absent from the store afterwards
- **AND** no standing negative decision SHALL be recorded in its place

### Requirement: KB source trust entries are displayable

The KB source trust store records only a hash of each trusted source specification, so an entry's subject cannot be recovered from the store as it exists. The store SHALL record the source subject alongside the hash so entries are displayable. This SHALL be an additive field: an entry written before this change and carrying no subject SHALL render as its opaque hash rather than causing an error, and no rewrite of existing entries SHALL be performed.

#### Scenario: New entries display their subject

- **WHEN** a KB source is trusted after this change
- **THEN** its Access-page entry SHALL display the source reference

#### Scenario: Pre-existing entries degrade gracefully

- **GIVEN** a trust entry written before this change, carrying only a hash
- **WHEN** the Access page lists it
- **THEN** it SHALL render as an opaque hash with a revoke action, and SHALL NOT error

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

### Requirement: The Access surface states when prompting is unavailable

When configuration prevents a denial from raising a dialog, the Access page
SHALL state that prompting is unavailable and name the reason, rather than
silently behaving as though no denial occurred.

#### Scenario: Reporting-mode Host admission is surfaced

- **GIVEN** the Host-admission gate is in reporting mode
- **WHEN** the Access page is opened
- **THEN** it SHALL state that no dialog will be raised on any plane, and why
- **AND** it SHALL state that recorded denials remain reviewable and answerable there
- **AND** the prompting toggle SHALL render inert rather than hidden

#### Scenario: A browser issued no prompt capability is surfaced

- **GIVEN** the current browser was issued no prompt capability
- **WHEN** the Access page is opened
- **THEN** it SHALL state that this browser will not receive dialogs, and why

#### Scenario: Prompting disabled is surfaced

- **GIVEN** prompting is disabled by configuration or environment
- **WHEN** the Access page is opened
- **THEN** it SHALL state that no dialog will be raised, and that recorded denials remain answerable there

### Requirement: Revoking a preview-egress grant takes effect on the next preview load

Revoking a preview-egress entry SHALL remove that origin from its project's list in the preview-egress store. The next load of any restricted preview in that project SHALL block the origin again.

#### Scenario: Revoked CDN is blocked again

- **GIVEN** `https://cdn.tailwindcss.com` granted for `/p` and revoked from the Access page
- **WHEN** an auto-opened preview under `/p` is reloaded
- **THEN** the CDN is blocked and listed in the viewer's blocked-origins banner

### Requirement: The Access page lists and answers pending provisioning requests

The Access page SHALL list every pending provisioning request with its project root, its lines and their classifications, and SHALL let the operator answer it line by line with the same choices and the same defaults as the provisioning dialog. An answer given here SHALL carry the page's prompt capability and operate tier; without them the page SHALL show the request read-only and SHALL say why.

#### Scenario: A pending request is answerable from the Access page

- **GIVEN** a pending provisioning request whose dialog was dismissed in another tab
- **WHEN** the operator opens the Access page in a tab that holds a prompt capability
- **THEN** the request SHALL be listed with approve controls per grantable line, none preselected

#### Scenario: Without a capability the request is read-only

- **GIVEN** a browser tab that holds no prompt capability
- **WHEN** it opens the Access page while a provisioning request is pending
- **THEN** the request SHALL be listed without approve controls and with the reason

### Requirement: The Access page dismisses all pending provisioning requests at once

The Access page SHALL offer "Dismiss all pending", available under the same capability and tier conditions as answering. It SHALL dismiss every pending provisioning request, and each dismissal SHALL count toward that project root's cooldown.

#### Scenario: Dismiss all pending

- **GIVEN** three pending provisioning requests and an operate-tier tab holding a capability
- **WHEN** the operator chooses "Dismiss all pending"
- **THEN** all three SHALL end `dismissed` and no grant SHALL be recorded

### Requirement: Provisioned grants are labelled with their project

The Access page SHALL label each provisioned grant as provisioned and SHALL name the project root it was provisioned for, distinct from prompted and agent-prompted grants.

#### Scenario: A provisioned grant shows its project

- **GIVEN** a grant provisioned for `/w/app`
- **WHEN** the Access page is opened
- **THEN** the grant SHALL be shown as provisioned for `/w/app` with a revoke control
