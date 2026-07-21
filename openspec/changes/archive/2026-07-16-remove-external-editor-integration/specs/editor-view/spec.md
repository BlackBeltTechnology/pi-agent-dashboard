# editor-view

Entire capability removed: the `/folder/:cwd/editor` code-server iframe view (`EditorView`) is superseded by the folder-scoped internal Monaco pane (capability `folder-scoped-editor-pane`).

## REMOVED Requirements

### Requirement: code-server iframe embedding

**Reason**: No `code-server` process or `/editor/<id>/` proxy exists to embed.
**Migration**: The folder `[Editor]` route mounts the internal Monaco pane instead.

### Requirement: Lazy start on first open

**Reason**: There is no editor instance to lazily start; the internal pane mounts client-side.
**Migration**: N/A — internal pane needs no server-side start.

### Requirement: Heartbeat for idle tracking

**Reason**: No server-side editor process to keep alive or idle-reap.
**Migration**: N/A.

### Requirement: Error and install guide states

**Reason**: The `EditorInstallGuide` (code-server-not-found) UX is removed with the launcher.
**Migration**: N/A — no host binary is required.

### Requirement: Theme synchronization

**Reason**: No code-server user-settings file to seed with a theme.
**Migration**: The internal pane already follows the dashboard theme live.

### Requirement: Stop button

**Reason**: No editor instance to stop.
**Migration**: N/A.

### Requirement: Folder path header

**Reason**: The `EditorView` chrome is removed; the internal pane provides its own header.
**Migration**: N/A.
