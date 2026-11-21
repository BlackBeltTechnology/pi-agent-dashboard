# openspec-shared-skills-layout.spec.ts

L3 slice of change `fix-openspec-readiness-shared-skills` (#1165; test-plan
#F1 #F2 #F3). A project whose OpenSpec skills live only under the shared
`.agents/skills/openspec-explore/` (no `.pi/skills/`) must not read as
`STALE · missing-skills`: folder pill clears without a server restart, session
card keeps its OpenSpec controls enabled, and removing the shared skills brings
`skills missing` back on the next poll (no cached READY).

## Mechanics

- Dirs `/fixtures/e2e-ssl-<RUN>-<name>` created via `docker exec` on the
  container resolved by `publish=<dashboardPort>`.
- Setup: pin + expand, REST init (real CLI writes `.pi/skills`), then
  `rm -rf .pi` and/or `mkdir -p .agents/skills/openspec-explore` out-of-band.
- Config: poll interval dropped to the 5s clamp, snapshot-restored in afterAll;
  global profile primed to `core` so init writes skills; `/fixtures` pre-trusted
  for spawned sessions. Helpers copied from the `openspec-init-affordances-*`
  specs (repo convention: self-contained specs).
- F2 spawns a real session (`spawnSessionIn`); ids shut down in afterEach.
- Tests are NOT `fixme`d (the init-affordances specs are quarantined, #683).
