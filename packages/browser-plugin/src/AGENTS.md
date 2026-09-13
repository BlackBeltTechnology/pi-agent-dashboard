# DOX — packages/browser-plugin/src

Files in this directory. One row per source file. See change: add-browser-relay.

| File | Purpose |
|------|---------|
| `i18n.ts` | i18n catalog `catalog: { "zh-CN": {}, hu: {} }` — STUB, zero keys (parity trivially holds). Real entries land with workstream 4. Merged under `plugin.browser.*`. |

Files in `__tests__/`:

| File | Purpose |
|------|---------|
| `manifest.test.ts` | Scenario E31/7.31. `validateManifest` accepts; id `browser`; `defaultEnabled:false`; claims `settings-section`+`content-view` resolve to EXPORTED components from the client entry (imports the barrel); `token` writeOnly in configSchema; `allowMultipleInstancesPerProfile` boolean present. |
