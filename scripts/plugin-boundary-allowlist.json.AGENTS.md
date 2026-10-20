# plugin-boundary-allowlist.json — index

Ratcheting baseline for `check-plugin-boundary.mjs`: `{ "rows": [...] }`, one row per `(from, to)` known core/plugin edge. Row fields: `from`, `to` (plugin dir under `packages/`), `kind` (`prod|test|pkg|css|host`), `reason`, `disposition`, `removedBy` (task id in `openspec/changes/decouple-plugins-from-core/tasks.md`).
- Seed: 76 rows = prod 11 / test 34 / pkg 6 / css 25.
- Dispositions: `invert`, `generate`, `swap-to-fixture`, `move-to-plugin`, `drop-dep`, `integration-keep` (permanent: core integration tests + setup files + their devDependency), `unassigned` (no task removes it yet).
- `integration-keep` rows: `server/src/__tests__/mcp-manifest-completeness.test.ts`, `host-gate-inject.test.ts`, `server/package.json` → `mcp-server-plugin`.
- Rows only shrink: a fix PR deletes the rows it removes (STALE fails otherwise). Edit via `--write-baseline`, never by hand-adding a row without a reason.
- Do not list manifest-derived exemptions here (generated registry, bundled client deps, fixture plugins in tests).

See change: decouple-plugins-from-core.
