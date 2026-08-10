# settings-panel Specification (delta)

## ADDED Requirements

### Requirement: Notify-level control on the General chat-display section

The chat-display section on the **General** page SHALL render exactly one
control for `displayPrefs.notifyMinLevel`, committed through the existing
`display-prefs` draft source like every other chat-display field. It SHALL be a
4-value selector (`all` / `success` / `warnings` / `errors`), not a toggle, and
SHALL belong to the message-level sub-section.

The per-session chat View popover SHALL expose the same field. That popover
renders boolean rows only today; it SHALL gain a value-selecting row variant
that participates in the existing override-marking and clear-override behavior.

The variant SHALL reuse the popover's existing override plumbing rather than a
parallel path: the same patch callback, widened to carry a string value, and
the same generic overridden-vs-global comparison. Selecting a value equal to
the current global SHALL record an explicit override rather than silently
clearing it, so that a later change to the global does not move the session.

#### Scenario: Single control across the panel
- **WHEN** the settings panel is rendered across all pages
- **THEN** exactly one control for `displayPrefs.notifyMinLevel` SHALL exist
- **AND** it SHALL be on the General page

#### Scenario: Commits through the draft source
- **WHEN** the user changes the notify-level control
- **THEN** the change SHALL be buffered and SHALL mark the General page dirty
- **AND** it SHALL persist only on Save, not on change

#### Scenario: Selecting the global's own value still overrides
- **GIVEN** global `notifyMinLevel = "warnings"` and no session override
- **WHEN** the user selects `"warnings"` for that session in the popover
- **THEN** an explicit session override of `"warnings"` SHALL be recorded
- **AND** a later change of the global to `"all"` SHALL leave that session at `"warnings"`
- **AND** the clear-override action SHALL still return the session to the global

#### Scenario: Popover row marks an override
- **GIVEN** global `notifyMinLevel = "all"`
- **WHEN** the user selects `"warnings"` for one session in the chat View popover
- **THEN** that row SHALL render its overridden marker
- **AND** the popover's clear-override action SHALL restore the session to `"all"`
