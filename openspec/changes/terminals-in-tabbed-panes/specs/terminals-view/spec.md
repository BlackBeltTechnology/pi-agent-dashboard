# terminals-view

The standalone full-screen terminals view is removed; its tabbed-terminal behavior is provided by `terminal-viewer-tab` inside the editor pane. Tab behaviors (keep-alive, close, rename, single-mount-per-id) carry forward under that capability.

## REMOVED Requirements

### Requirement: Tabbed terminal container

**Reason**: The bespoke `TerminalsView` tab container is replaced by the editor-pane tab strip hosting `term:<id>` tabs.
**Migration**: Terminals appear as tabs in the folder-scoped pane / session split (see `terminal-viewer-tab`).

### Requirement: New terminal button in tab bar

**Reason**: The standalone view's new-terminal button is replaced by the pane's new-terminal affordance.
**Migration**: Use the pane's "+ Terminal" control (see `split-editor-workspace`).

### Requirement: Folder path header

**Reason**: `TerminalsView`'s folder-path header is removed with the standalone view; the pane provides its own chrome.
**Migration**: N/A — the pane header conveys context.

### Requirement: Terminal creation navigates to tab view

**Reason**: Creating a terminal no longer navigates to `/folder/:cwd/terminals` (route removed); it opens a `term:<id>` tab in the pane.
**Migration**: The sidebar `[Terminals(N)]` button opens the folder-scoped pane, which auto-surfaces cwd terminals as tabs.
