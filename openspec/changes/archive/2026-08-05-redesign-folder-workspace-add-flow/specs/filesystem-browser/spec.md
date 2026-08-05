## MODIFIED Requirements

### Requirement: PathPicker component
The PathPicker SHALL browse directories via `GET /api/browse` and render an inline error region on failure. When the failure is a network-guard denial (HTTP 403 with `error: "network_not_allowed"`), the PathPicker SHALL render the server-supplied `hint` and an affordance to Settings → Servers — NOT a bare "Access denied" string. Other failures (e.g. directory not found, transport error) SHALL keep their existing error copy.

The PathPicker SHALL support two selection modes:

1. **Single-select** (existing behaviour, default): activating a row commits it as the answer via `onSelect`.
2. **Multi-select** (opt-in, used by the Add Folders dialog): activating a row navigates INTO it, per-row
   checkboxes accumulate a selection set, and the caller commits the whole set. In this mode the picker SHALL
   NOT commit an answer on row activation.

All row iconography SHALL be rendered from `@mdi/js` paths so glyphs inherit `currentColor` and remain stable
across platform fonts: the parent (`..`) row SHALL use `mdiArrowUp` (replacing the `⬆` emoji), directory rows
SHALL use `mdiFolder` (replacing the `📁` emoji), and the create-here row SHALL use `mdiFolderPlusOutline`
(replacing the `＋` character). The `git` and `pi` flags SHALL remain textual badges, as they are labels rather
than icons.

#### Scenario: Browse denied by network guard
- **WHEN** `GET /api/browse` returns HTTP 403 with `{ error: "network_not_allowed", hint }`
- **THEN** the PathPicker SHALL render the `hint` (remedy) text instead of a bare "Access denied"
- **AND** SHALL offer a link/affordance to Settings → Servers to add the network to `trustedNetworks`

#### Scenario: Browse non-denial error unchanged
- **WHEN** `GET /api/browse` fails for a non-403 reason (directory not found, transport error)
- **THEN** the PathPicker SHALL render its existing error copy for that case

#### Scenario: Single-select mode still commits on activation
- **WHEN** the picker is in single-select mode and the user activates a directory row
- **THEN** `onSelect` SHALL be invoked with that directory's path

#### Scenario: Multi-select mode navigates on activation
- **WHEN** the picker is in multi-select mode and the user activates a directory row
- **THEN** the picker SHALL browse into that directory
- **AND** `onSelect` SHALL NOT be invoked

#### Scenario: Row glyphs are MDI paths
- **WHEN** the picker renders a parent row, a directory row, and a create-here row
- **THEN** each SHALL render an SVG path sourced from `@mdi/js`
- **AND** none SHALL contain the characters `⬆`, `📁`, or `＋`
