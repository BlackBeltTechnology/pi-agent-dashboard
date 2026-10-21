# agent-yolo.ts — index

`handlePathYoloRequest(connSession, msg, deps)` → `path_yolo_result` (session-bound; verdict from lazy `decideAgentPath`; malformed/mismatch/unwired → `decline`); `handlePathGateRefusal` (fire-and-forget): session bind → registry `select` consume → subject re-derived from path → `recordRefusal("agent-path", subject)`. Log control chars stripped. See change: yolo-covers-agent-path-gate.
