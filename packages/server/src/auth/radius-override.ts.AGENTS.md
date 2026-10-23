# radius-override.ts — index

`isRadiusOverridden()` — true iff Pi-global `models.json` has `providers.radius` `oauth:"radius"` + non-default `baseUrl` (pi's `configureRadiusProviders` rule). Ports pi `stripBom`/`stripJsonComments`; 1 s result cache; read error → false. `setAgentDirSource`, `isRadiusRuntimeAvailable`, `applyRadiusOverride`. Drift-tested vs real `ModelRuntime`. See change: add-radius-provider-login. `getRuntimeAgentDir()` exposes the wired runtime `getAgentDir` (undefined when unavailable/throws). See change: update-pi-core-1-1-adopt-apis; pi-settings-full-coverage.
