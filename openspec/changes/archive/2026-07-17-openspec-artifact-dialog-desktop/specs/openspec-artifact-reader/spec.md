## MODIFIED Requirements

### Requirement: Clickable artifact letters
Each artifact status letter (P, S, D, T) in the change card SHALL be a clickable button that opens the corresponding artifact's markdown content. On non-mobile viewports (`useMobile()` false) the artifact SHALL open in a modal dialog layered over the current view; on mobile viewports it SHALL open in the full-page preview route. The viewport branch SHALL be applied in `App.tsx`, not inside the shared action hook.

#### Scenario: Click artifact letter on a non-mobile viewport
- **WHEN** `useMobile()` is false AND the user clicks the "P" letter on change "my-change"
- **THEN** a modal dialog SHALL open showing the content of `openspec/changes/my-change/proposal.md`
- **AND** the view behind the dialog SHALL remain mounted (no navigation)
- **AND** the browser URL SHALL be unchanged
- **AND** the dialog's tab bar SHALL show all available artifacts with "P" as the active tab

#### Scenario: Switch tabs inside the dialog
- **WHEN** the artifact dialog is open on "P" AND the user clicks the "D" tab
- **THEN** the dialog SHALL show the design artifact active
- **AND** no browser history entry SHALL be pushed

#### Scenario: Close the dialog
- **WHEN** the artifact dialog is open AND the user presses Escape, clicks the backdrop, or activates the reader's back control
- **THEN** the dialog SHALL close AND the underlying view SHALL be revealed unchanged

#### Scenario: Click before OpenSpec data has loaded
- **WHEN** `useMobile()` is false AND a badge is clicked while the OpenSpec map has no entry yet for that folder
- **THEN** the dialog SHALL show a loading state until the data arrives
- **AND** SHALL then render the artifact content without crashing

#### Scenario: Viewport crosses into mobile while the dialog is open
- **WHEN** the artifact dialog is open AND the viewport changes such that `useMobile()` becomes true
- **THEN** the dialog SHALL close automatically

#### Scenario: Click artifact letter on a mobile viewport
- **WHEN** `useMobile()` is true AND the user clicks the "P" letter on change "my-change"
- **THEN** the full-page preview route SHALL open showing `openspec/changes/my-change/proposal.md`
- **AND** the browser Back control SHALL close the preview

#### Scenario: Letter cursor hint
- **WHEN** the user hovers over an artifact letter
- **THEN** the cursor SHALL change to pointer to indicate clickability
