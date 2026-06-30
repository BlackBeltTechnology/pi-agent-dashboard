## MODIFIED Requirements

### Requirement: PathPicker component
The PathPicker (Pin Directory dialog) SHALL browse directories via `GET /api/browse` and render an inline error region on failure. When the failure is a network-guard denial (HTTP 403 with `error: "network_not_allowed"`), the PathPicker SHALL render the server-supplied `hint` and an affordance to Settings → Servers — NOT a bare "Access denied" string. Other failures (e.g. directory not found, transport error) SHALL keep their existing error copy.

#### Scenario: Browse denied by network guard
- **WHEN** `GET /api/browse` returns HTTP 403 with `{ error: "network_not_allowed", hint }`
- **THEN** the PathPicker SHALL render the `hint` (remedy) text instead of a bare "Access denied"
- **AND** SHALL offer a link/affordance to Settings → Servers to add the network to `trustedNetworks`

#### Scenario: Browse non-denial error unchanged
- **WHEN** `GET /api/browse` fails for a non-403 reason (directory not found, transport error)
- **THEN** the PathPicker SHALL render its existing error copy for that case
