# implement/scripts/check-mode.ts — index

Print dashboard mode ("dev"/"production") via `GET /api/health`. Reads port from `~/.pi/dashboard/config.json` (default 8000). Prints `not-running` + exits 1 if `fetch` fails or server unreachable (2s timeout). Node built-ins only, cross-platform.
