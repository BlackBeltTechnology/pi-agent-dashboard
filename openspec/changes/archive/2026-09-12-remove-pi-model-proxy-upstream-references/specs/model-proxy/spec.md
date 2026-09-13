## REMOVED Requirements

### Requirement: Coexistence with upstream pi-model-proxy
**Reason**: The upstream `@blackbelt-technology/pi-model-proxy` extension is no longer recommended, tracked as a core package, or detected by the dashboard. The built-in proxy supersedes it; the dashboard takes no position on whether an unrelated extension also binds `:9876`.
**Migration**: None for the proxy itself. Users still running the upstream extension may keep it; the settings advisory banner simply no longer appears.
