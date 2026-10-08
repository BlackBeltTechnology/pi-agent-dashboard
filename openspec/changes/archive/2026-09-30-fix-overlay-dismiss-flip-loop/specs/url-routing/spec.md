## ADDED Requirements

### Requirement: Nested overlay dismissal SHALL unwind without cycling

When a route-backed overlay is opened from another route-backed overlay of a different surface, the launching overlays SHALL form a stack. Returning to the top launcher's surface, whether by dismissal or by browser Back, SHALL consume that launcher and SHALL NOT record the overlay just left as a new launcher. Each dismissal SHALL unwind exactly one level. Dismissing the outermost overlay SHALL return to the base route captured when the first overlay opened. Dismissal SHALL NOT push a browser history entry. It SHALL pop history when the tracked predecessor is the dismissal target, and otherwise SHALL replace the current entry.

#### Scenario: Two dismissals leave both overlays without flipping

- **GIVEN** the user opened `/settings/gateway` from `/session/abc`
- **AND** then opened `/tunnel-setup` from `/settings/gateway`
- **WHEN** the user dismisses the tunnel wizard
- **THEN** the URL SHALL return to `/settings/gateway`
- **WHEN** the user then dismisses settings
- **THEN** the URL SHALL return to `/session/abc`
- **AND** `/tunnel-setup` SHALL NOT be re-opened

#### Scenario: Returning into the launching overlay keeps the original underlay

- **GIVEN** the user opened `/settings/gateway` from `/session/abc` and then `/tunnel-setup` from settings
- **WHEN** the user dismisses the tunnel wizard back to `/settings/gateway`
- **THEN** the underlay beneath settings SHALL still render `/session/abc`

#### Scenario: Browser Back into the launcher consumes it

- **GIVEN** the user opened `/tunnel-setup` from `/settings/gateway`, which was opened from `/session/abc`
- **WHEN** the user presses browser Back and lands on the settings surface
- **AND** then dismisses settings
- **THEN** the URL SHALL return to `/session/abc`

#### Scenario: Deeper nesting unwinds one level per dismiss

- **GIVEN** the chain `/session/abc` → `/settings/gateway` → `/tunnel-setup` → `/pi-view?url=…`
- **WHEN** the user dismisses three times
- **THEN** the URLs SHALL be `/tunnel-setup`, then `/settings/gateway`, then `/session/abc`

#### Scenario: Dismissal does not grow browser history

- **GIVEN** the tracked predecessor of the current overlay is the dismissal target
- **WHEN** the user dismisses the overlay
- **THEN** the dashboard SHALL pop history (`history.back()`) rather than push
- **AND** when the predecessor is anything else, the dashboard SHALL replace the current entry
