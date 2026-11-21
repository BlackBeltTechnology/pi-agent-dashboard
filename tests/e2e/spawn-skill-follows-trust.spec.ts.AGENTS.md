# spawn-skill-follows-trust.spec.ts — index

L3 #F13 (T.107; test-plan R5/R15). One fixture clone under `/fixtures` with `.pi/skills/s/SKILL.md`, one live session at a time.
Legs: unpinned REST spawn → skill not `active`; pin via UI + folder spawn button → `active`; unpin + REST spawn → not `active`.
Reads the loaded skill list via `GET /api/pi-resources?cwd=&refresh=true` (scan joined with the session's `commands_list`; needs exactly one live session in the folder, so each session is shut down over the bus before the next leg).
`contributingSession` must name a new session every leg: proves the join ran and that the session registered (no stall on the trust prompt).
Waits on the dashboard trust snapshot (`~/.pi/dashboard/pi-trust-mirror.json`) before each spawn.
Real-pi half: `packages/server/src/__tests__/pi-headless-trust-outcome.test.ts`. Marker-extension loop: `qa/tests/58-spawn-no-auto-trust.sh`.
No harness seam needed. Authored without a runnable docker harness: first run in CI.
See change: harden-agent-tool-guards.
