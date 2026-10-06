# session-move.ts — index

`createMoveCoordinator()` + `MOVE_TIMEOUT` (30s) — owns TWO connections so a move is a handover, not a gap (`updateUrl()` tears the origin down first). Send ownership is explicit state, never inferred from socket liveness: exactly one owner at every instant (task 9.3c). Commit is the single swap instant; refusal/identity-mismatch/timeout all keep the origin serving. See change: add-pi-gateway-transport-identity (9.3b).

Option `onServerMessage` receives `dashboard_identity` / `path_yolo_result` / `path_grant_result` frames from the move target (otherwise dropped); bridge wires it to `pathGate.onServerMessage`. See change: yolo-covers-agent-path-gate.
