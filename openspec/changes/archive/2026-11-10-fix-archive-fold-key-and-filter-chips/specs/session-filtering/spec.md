## MODIFIED Requirements

### Requirement: Show hidden toggle

The sidebar SHALL include a `Show hidden` toggle inside the sidebar header's filter-funnel popover, next to the Include archive toggle. The toggle SHALL show an eye-off icon and the label `Hidden`. It SHALL span the popover width and SHALL show a check mark while on, so that it renders in the same style as the `Archived` toggle. The toggle SHALL expose its pressed state, and the funnel trigger SHALL show how many funnel filters (Include archive, Show hidden) are on; tag filters are counted by their own bar. Hidden sessions are auto-hidden headless workers only; there is no manual hide. When enabled, hidden sessions SHALL reappear in the list with a muted visual style (reduced opacity). Hidden sessions SHALL also show resume/fork buttons. No unhide button SHALL be rendered.

The previous companion `Active only` toggle SHALL be removed; ended sessions are now visible by default inside their folder's collapsible ended-sessions group rather than hidden behind a toggle.

#### Scenario: Show hidden is the only filter chip in the header
- **WHEN** the user opens the sidebar header's filter funnel
- **THEN** the popover SHALL contain a `Show hidden` toggle and an `Include archive` toggle and SHALL NOT contain an `Active only` toggle
- **AND** the filter row itself SHALL show no `Show hidden` chip

#### Scenario: Funnel toggles share one style
- **WHEN** the user opens the sidebar header's filter funnel
- **THEN** the `Hidden` toggle SHALL show an icon, a Title-Case label and full popover width, as the `Archived` toggle does
- **AND** turning `Hidden` on SHALL show a check mark and set `aria-pressed="true"`, and turning it off SHALL remove the check mark
- **AND** the `Archived` toggle SHALL follow the same icon, label-case, width and check-mark rules
- **AND** the Sessions/Folders search-scope toggles SHALL render without an icon or a check mark

#### Scenario: Funnel counts its own filters
- **GIVEN** `Show hidden` and `Include archive` are both off
- **WHEN** the user turns `Show hidden` on
- **THEN** the funnel trigger SHALL show a badge of 1 and its accessible name SHALL state that one funnel filter is on
- **AND** an active tag filter SHALL NOT change the funnel badge
- **AND** with both toggles off the trigger SHALL show no badge

#### Scenario: Reveal hidden sessions
- **WHEN** the user enables `Show hidden`
- **THEN** all hidden sessions SHALL appear in the list with reduced opacity and resume/fork action buttons
- **AND** no unhide button SHALL be present

#### Scenario: Unhide a session
- **WHEN** a hidden session is revealed via `Show hidden`
- **THEN** no unhide `[↩]` button SHALL be rendered and no browser message SHALL be able to clear `hidden`; the only way out of the hidden set is the session ending and being archived
