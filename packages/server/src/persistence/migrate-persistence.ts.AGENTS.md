# migrate-persistence.ts — index

Migration utility: converts `sessions.json` + `state.json` → per-session `.meta.json` + `preferences.json`. Exports `MigrationResult`, `MigrationPaths`, `needsMigration`, `runMigration`. Idempotent; applies hidden flags, scans session dirs for orphaned UUIDs, renames old files to `.bak`. Runs on first startup when old files detected.
