# session-list-filters Specification

## Purpose
TBD - created by archiving change polish-header-logo-and-card-stripes. Update Purpose after archive.

## Requirements

### Requirement: Filter row carries no pin-folder button
The sidebar header's filter row SHALL NOT render a pin-folder or add-folder button. Adding folders SHALL stay reachable from the session scroll list as specified by `dashboard-add-buttons`.

#### Scenario: Filter row has no pin button
- **WHEN** the sidebar header renders with a non-null `onPinDirectory` callback
- **THEN** the filter row SHALL contain no element with `data-testid="pin-dir-dialog-btn"` and no "Add folder" button
