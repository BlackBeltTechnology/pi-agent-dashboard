# keeper-log-health.spec.ts — index

L3 (test-plan #F1, #F2): `/api/health` carries `keeperLogs` (7 numeric fields); a sparse 2×-cap `keeper-<uuid>.log` seeded via `docker exec` surfaces as `runawayFiles ≥ 1` after the stats TTL (polls drive the lazy refresh). Cleans up its seeding. See change: fix-runaway-keeper-log-growth.
