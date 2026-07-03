# debug-dashboard/scripts/list-sessions.ts — index

List pi sessions via `GET /api/sessions`. Default: active only (filters `status !== 'ended'`). Modes `--all`, `--json`, `--count`. Renders ASCII table (ID-truncated, STATUS, MODEL, CWD). Reports hidden ended-session count. Tolerates `{success,data}` envelope or bare array.
