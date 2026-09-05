# 14-pi-resources-parity.sh — index

P1/X10/X11: `GET /api/pi-resources` p95 across 10 refreshes within `PI_RESOURCES_P95_BUDGET_MS` (default 2000, tighter than the 5s `RESOLVE_TIMEOUT_MS` so a slow-but-not-timed-out regression is caught) and the payload not `degraded`; skill `references/*.md` companion still readable; bundled `pi-dashboard/commands/` command still resolves. See change: fix-skill-discovery-parity.
