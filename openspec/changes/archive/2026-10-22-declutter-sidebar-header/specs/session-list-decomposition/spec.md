## REMOVED Requirements

### Requirement: Session list toolbar extraction
**Reason**: Never implemented. No `SessionListToolbar` exists; the sidebar header has always been rendered inside `SessionList.tsx` and is governed by the `sidebar-header` capability. The `theme-system` literal scan also locates header regions (`ToggleButton`, `search-include-archive`) inside `SessionList.tsx`, so extracting a toolbar would silently break that scan.
**Migration**: None. Header composition requirements live in `sidebar-header`; no code depends on a `SessionListToolbar` component.
