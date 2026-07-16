# editor-manager

Entire capability removed: the server-side `code-server` lifecycle manager, its REST endpoints, reverse proxy, status broadcast, and PID registry are deleted.

## REMOVED Requirements

### Requirement: Spawn code-server per folder

**Reason**: The external editor launcher is removed.
**Migration**: Files open in the client-side internal Monaco pane; no server spawn.

### Requirement: Stop instance

**Reason**: No spawned instances exist to stop.
**Migration**: N/A.

### Requirement: Idle timeout

**Reason**: No editor process to idle-reap.
**Migration**: N/A.

### Requirement: Max concurrent instances

**Reason**: No editor processes to cap.
**Migration**: N/A.

### Requirement: Reverse proxy route

**Reason**: The `/editor/<id>/` HTTP + WS proxy is removed.
**Migration**: N/A — no proxied editor.

### Requirement: Editor status broadcast

**Reason**: No `editor_status` events (no lifecycle to report).
**Migration**: Clients drop the `editor_status` subscription.

### Requirement: REST API endpoints

**Reason**: `/api/editor/*` endpoints are removed.
**Migration**: Remove all callers; internal pane needs no editor API.

### Requirement: Persistent editor PID registry

**Reason**: No editor PIDs to persist across restarts.
**Migration**: N/A.

### Requirement: Orphan code-server cleanup on server boot

**Reason**: No editor processes to sweep on boot.
**Migration**: N/A.

### Requirement: Boot sweep runs before new editor starts are accepted

**Reason**: No editor starts to gate.
**Migration**: N/A.
