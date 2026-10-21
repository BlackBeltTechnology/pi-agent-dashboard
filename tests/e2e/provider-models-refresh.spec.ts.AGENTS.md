# provider-models-refresh.spec.ts — index

L3 for add-provider-models-refresh (test-plan #F6). Stages `/api/providers` (row `edge-proxy`, cached modelCount 3) via `routeProviderData`; `/api/providers/edge-proxy/refresh` answers modelCount 9. Click `provider-refresh-models` → `health-pill` converges to 9 models, button re-enabled, exactly one refresh POST. Server + bridge halves are L1 (`provider-routes-refresh`, `provider-register-reload`). See change: add-provider-models-refresh.

Summary (moved from directory AGENTS.md row): L3: Refresh models row.
