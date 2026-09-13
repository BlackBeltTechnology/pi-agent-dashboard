# DOX — packages/dashboard-plugin-runtime/src/server/service-probes

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `model-proxy.ts` | Exports `probeModelProxy(deps)` — the closed-registry service probe for the dashboard's own model proxy. Satisfied iff the host wired `isModelProxyEnabled` AND boot-time `modelProxy.enabled` was true (`probe not wired` / `model proxy disabled` otherwise). Performs NO HTTP: `/v1/*` is behind the proxy auth gate, so a self-fetch would 401; route registration is boot-frozen, so the probe mirrors `modelProxyMounted`. Plugins consume via `requirement-probes` cache. See change: remove-pi-model-proxy-upstream-references. |
