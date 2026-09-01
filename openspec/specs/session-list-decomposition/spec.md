# session-list-decomposition Specification

## Purpose

Extracts the session list's directory group header, toolbar, and grouping utility into separate units, so list rendering and grouping logic can be changed and tested independently.

## Requirements

### Requirement: Directory group header extraction
SessionList.tsx SHALL delegate directory group header rendering (collapse toggle, directory name, pin/unpin, git info, editor buttons, spawn/terminal buttons, pi resources button, OpenSpec section) to a `DirectoryGroupHeader` component.

#### Scenario: Group header renders all interactive elements
- **WHEN** a directory group is displayed
- **THEN** DirectoryGroupHeader renders collapse toggle, pin button, editor buttons, spawn session button, create terminal button, and OpenSpec section

### Requirement: Session list toolbar extraction
SessionList.tsx SHALL delegate the top toolbar (home button, theme controls, active-only toggle, show-hidden toggle, pin button, collapse sidebar, install, tunnel, settings) to a `SessionListToolbar` component.

#### Scenario: Toolbar renders all controls
- **WHEN** SessionList mounts
- **THEN** SessionListToolbar renders all filter toggles, theme controls, and navigation buttons

### Requirement: Session grouping utility extraction
SessionList.tsx SHALL delegate pure grouping functions (`groupSessionsByDirectory`, `filterSessions`, `sortSessionsByOrder`, `getUnifiedOrder`) to a `session-grouping` utility module.

#### Scenario: Grouping functions produce correct output
- **WHEN** groupSessionsByDirectory is called with sessions and pinned directories
- **THEN** it returns pinned groups in pinned order and unpinned groups sorted by most recent activity

#### Scenario: Filter function applies active-only and hidden filters
- **WHEN** filterSessions is called with activeOnly=true and showHidden=false
- **THEN** it returns only non-ended, non-hidden sessions
