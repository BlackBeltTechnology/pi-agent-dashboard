## MODIFIED Requirements

### Requirement: Mobile session card layout is unchanged
The mobile branch of `SessionCard.tsx` (gated by `useMobile()`) SHALL NOT use `SessionSubcard` wrappers. Mobile cards SHALL retain their flat row layout, except that any section resolved hidden by the `session-card-section-visibility` capability SHALL be omitted, and the PROCESS safety chip SHALL apply identically.

#### Scenario: Mobile card renders no subcard panels
- **WHEN** `useMobile()` returns true and a session card is rendered
- **THEN** no element with class token `bg-[var(--bg-surface)]` AND inset border styling characteristic of `SessionSubcard` SHALL appear inside the card
- **AND** no centered uppercase title element with content matching `OPENSPEC|WORKSPACE|PROCESS|MEMORY|FLOWS` SHALL appear

#### Scenario: Mobile card omits hidden sections
- **GIVEN** `useMobile()` returns true and folder `/a` hides `tags` and `process`
- **AND** a session in `/a` has tags and an in-flight bash tool
- **WHEN** its card renders
- **THEN** neither the tags strip nor the process rows SHALL render
