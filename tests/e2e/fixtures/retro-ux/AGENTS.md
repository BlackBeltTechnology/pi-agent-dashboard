# DOX — tests/e2e/fixtures/retro-ux

One row per file. Non-source area. `page.route` state fixtures for `captureStates`; each exports `UiState[]` (`id`, `label`, `stubs`, `install`, `open`, `root`). See change: retro-ux-identity-connectivity.

| File | Purpose |
|------|---------|
| `context-mode.ts` | Context-mode settings states (loading, load-error, populated, not-created, invalid-dirty) via `/api/plugins/context-mode-settings/config` (real response patched). See change: retro-ux-plugin-settings-forms. |
| `discovery.ts` | Network Discovery states (idle, scanning, scan-error, empty-diagnostic, manual-error, results, adding, updated) via `POST /api/discover-servers`. |
| `gmail.ts` | Gmail settings states (loading, load-error, not-configured, configured, upload-error, flow-waiting, flow-error, alias-error) via `/api/plugins/gmail/*` + `/api/provider-auth/flow/f1`. See change: retro-ux-plugin-settings-forms. |
| `hermes.ts` | Hermes memory states (loading, load-error, populated, invalid-dirty, model-unavailable, raw-json) via `/api/plugins/hermes-memory/config` + `/api/models`. See change: retro-ux-plugin-settings-forms. |
| `kb-pill.ts` | KB folder pill states (loading, populated, stale, indexing, no-sources, not-indexed, denied, pinning, missing, error) via `/api/kb/stats`. See change: retro-ux-plugin-settings-forms. |
| `known-servers.ts` | Known Servers states (list, remove-confirm, row-error, read-only, add-open, add-error, empty, loading, load-error) via `/api/known-servers`. |
| `server-selector.ts` | Header selector states (trigger-connected, trigger-offline, open-probing, open-mixed, switching): stubs cross-origin `/api/health` + `/api/known-servers/probe`. |
| `stubs.ts` | Shared helpers: `stubApi` (same-origin path + method, hit counts via `hitCount`/`resetHits`), `ok`/`fail`/`hold`, `CORS`, `settingsSection`. |
| `users.ts` | Users states (list, unstable, invite-open, copy-failed, revoke-confirm, mutation-error, bootstrap, disabled, loading, load-error) + passkey impact note (`impactStates`) via `/api/users*`. |
