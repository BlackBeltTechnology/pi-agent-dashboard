# DOX — packages/client/src/lib/live-preview

Files in this directory. One row per source file. See change: improve-canvas-html-and-url-ux.

| File | Purpose |
|------|---------|
| `exposure-store.ts` | External store for the WS `preview_exposure_changed {epoch}` push (`notifyExposureChanged`, `subscribeExposure`, `getPushedExposureEpoch`). |
| `preview-policy.ts` | Pure: provenance→egress, `sandboxFor` (D3 table, never allow-same-origin), `wantedPolicy`/`needsRunScripts`, `parsePresetPath` (`live:`/`static:`), `classifyAddress` (shared `validateAddressPath`), `isLocalOperator`, `localTargetUrl`. |
