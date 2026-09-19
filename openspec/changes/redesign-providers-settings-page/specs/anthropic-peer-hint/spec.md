## MODIFIED Requirements

### Requirement: Hint gated on the authenticated state
The hint SHALL render only on an `anthropic` row that holds a credential. Because the providers
section lists only providers that hold a credential, a signed-out `anthropic` row is no longer
rendered at all; the gate therefore holds by construction, and the hint SHALL NOT be attached to any
surface that represents an unconfigured provider — in particular the Add-provider picker and its
panes.

#### Scenario: Signed-out anthropic row
- **WHEN** `anthropic` holds no credential and the probe reports the peer as not resolving
- **THEN** no `anthropic` row is rendered
- **AND** no hint is rendered

#### Scenario: Hint is absent from the Add-provider surfaces
- **WHEN** the operator opens the Add-provider dialog and selects Anthropic
- **THEN** no missing-peer hint is rendered in the picker or the pane

#### Scenario: Hint renders on the connected anthropic row
- **WHEN** `anthropic` holds an OAuth credential and the probe reports the peer as not resolving
- **THEN** the hint is rendered on that row

### Requirement: Hint is advisory and non-blocking
The hint SHALL NOT gate any existing provider-authentication behaviour: the Connected marker, the
expiry countdown and Sign Out SHALL remain fully available while the hint is shown, and
the hint SHALL NOT be presented as a modal. Sign-in is no longer a row control — it is reached from
the Add-provider dialog — and the hint SHALL NOT gate that path either.

#### Scenario: Row remains usable with the hint shown
- **WHEN** the hint is rendered on the authenticated `anthropic` row
- **THEN** the Sign Out control remains enabled and the Connected marker and expiry are unchanged

