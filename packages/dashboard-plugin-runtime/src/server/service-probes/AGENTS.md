# DOX — packages/dashboard-plugin-runtime/src/server/service-probes

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `pi-model-proxy.ts` | Exports `detectPiModelProxy({config})` (reads dashboard config, probes localhost proxy port), `probePiModelProxy()` (boolean availability via `requirement-probes`), `pickProxyDefaultModel(catalogue)` (preference walk: anthropic→first overall→hardcoded fallback). Plugins consume via `requirement-probes` cache. See change: add-plugin-activation-ui. |
