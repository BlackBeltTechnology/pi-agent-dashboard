## ADDED Requirements

### Requirement: Vault pills, callouts and field errors use the shared status parts

The vault page SHALL render its status, grant-status and binding-state pills through the shared status pill. It SHALL render its callouts (operate-required, stale server) through the shared notice. The generic "Couldn't load the vault: …" line SHALL stay a line, not a notice, as `operate-required-remedy` requires. It SHALL render its field and action errors through the shared inline action error. Visible copy, test ids, state attributes and the confirm-impact flow SHALL be unchanged.

#### Scenario: Operate-required callout keeps its copy
- **WHEN** a device without Operate access opens the vault page
- **THEN** the operate-required callout SHALL render as a shared info notice
- **AND** its title, remedy rows, sign-in link and "Request access" link SHALL be unchanged
- **AND** while it retries it SHALL expose `aria-busy`

#### Scenario: Remedy order survives the migration
- **WHEN** the refusal lists remedies `request-access`, `unknown-value`, `sign-in` in that order
- **THEN** the notice SHALL render the request-access row, then the sign-in row
- **AND** no row SHALL render for `unknown-value`

#### Scenario: Grant pill uses the shared primitive
- **WHEN** a project grant is shown as revoked
- **THEN** its pill SHALL be the shared status pill in the error tone with the existing label
