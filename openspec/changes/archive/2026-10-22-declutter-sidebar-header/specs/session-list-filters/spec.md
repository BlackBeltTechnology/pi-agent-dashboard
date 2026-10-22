## REMOVED Requirements

### Requirement: Pin-folder button has explicit text label
**Reason**: The filter-row "Add folder" pin button (`pin-dir-dialog-btn`) no longer exists. Adding folders moved to the scroll list (`dashboard-add-buttons`), and `sidebar-header` forbids a Pin+ button in the header. The requirement contradicted shipped code and the header spec.
**Migration**: None for code. Folder-adding affordances are specified by `dashboard-add-buttons`; the header contract is "Filter row carries no pin-folder button" below.

## ADDED Requirements

### Requirement: Filter row carries no pin-folder button
The sidebar header's filter row SHALL NOT render a pin-folder or add-folder button. Adding folders SHALL stay reachable from the session scroll list as specified by `dashboard-add-buttons`.

#### Scenario: Filter row has no pin button
- **WHEN** the sidebar header renders with a non-null `onPinDirectory` callback
- **THEN** the filter row SHALL contain no element with `data-testid="pin-dir-dialog-btn"` and no "Add folder" button
