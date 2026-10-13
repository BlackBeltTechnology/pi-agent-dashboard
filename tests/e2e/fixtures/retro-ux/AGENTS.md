# DOX — tests/e2e/fixtures/retro-ux

One row per file. Non-source area. `page.route` state fixtures for `captureStates`; each exports `UiState[]` (`id`, `label`, `stubs`, `install`, `open`, `root`). See change: retro-ux-identity-connectivity.

| File | Purpose |
|------|---------|
| `discovery.ts` | Network Discovery states (idle, scanning, scan-error, empty-diagnostic, manual-error, results, adding, updated) via `POST /api/discover-servers`. |
| `known-servers.ts` | Known Servers states (list, remove-confirm, row-error, read-only, add-open, add-error, empty, loading, load-error) via `/api/known-servers`. |
| `server-selector.ts` | Header selector states (trigger-connected, trigger-offline, open-probing, open-mixed, switching): stubs cross-origin `/api/health` + `/api/known-servers/probe`. |
| `stubs.ts` | Shared helpers: `stubApi` (same-origin path + method, hit counts via `hitCount`/`resetHits`), `ok`/`fail`/`hold`, `CORS`, `settingsSection`. |
| `users.ts` | Users states (list, unstable, invite-open, copy-failed, revoke-confirm, mutation-error, bootstrap, disabled, loading, load-error) + passkey impact note (`impactStates`) via `/api/users*`. |
