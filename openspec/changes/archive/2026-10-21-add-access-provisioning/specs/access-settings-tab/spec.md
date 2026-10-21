## MODIFIED Requirements

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

## ADDED Requirements

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
