# editor-keeper-sidecar

Entire capability removed: the per-editor keeper sidecar process, its socket/pipe command protocol, PID sidecar files, and boot-time adoption are deleted with the external editor launcher.

## REMOVED Requirements

### Requirement: Editor keeper sidecar process per editor instance

**Reason**: No `code-server` child to supervise.
**Migration**: N/A — no editor process exists.

### Requirement: Stable editor id derived from cwd

**Reason**: No editor instance to identify.
**Migration**: N/A. (A separate, unrelated `folderPaneId(cwd)` keys internal-pane state client-side.)

### Requirement: Per-editor UDS socket / Windows named pipe

**Reason**: No keeper IPC channel is needed.
**Migration**: N/A.

### Requirement: PID sidecar file

**Reason**: No editor PID to persist.
**Migration**: N/A.

### Requirement: JSON-line command protocol

**Reason**: No keeper to command.
**Migration**: N/A.

### Requirement: Boot-time adoption replaces kill-orphans

**Reason**: No surviving keepers to adopt on boot.
**Migration**: N/A.

### Requirement: Adoption-aware stop gated by config

**Reason**: No editors to stop on dashboard exit.
**Migration**: N/A.

### Requirement: Keeper failure modes

**Reason**: No keeper process to fail.
**Migration**: N/A.
