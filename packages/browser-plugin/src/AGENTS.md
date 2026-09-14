# DOX — packages/browser-plugin/src

Files in this directory. One row per source file. See change: add-browser-relay.

| File | Purpose |
|------|---------|
| `i18n.ts` | i18n catalog — UNPREFIXED leaf keys, `{ "zh-CN": {...}, hu: {...} }` with IDENTICAL key sets (parity test `src/client/__tests__/i18n.test.ts`). Covers settings (token/zeroDialog/allowedDomains/kill switch/capability), audit, live-view overlays, badge. Merged under `plugin.browser.*`; `useT()` auto-prefixes. Task 4.4. |

Files in `__tests__/`:

| File | Purpose |
|------|---------|
| `manifest.test.ts` | Scenario E31/7.31. `validateManifest` accepts; id `browser`; `defaultEnabled:false`; claims `settings-section`+`session-card-badge`+`content-view` resolve to EXPORTED components from the client entry (imports the barrel); `token` writeOnly in configSchema; `allowMultipleInstancesPerProfile` boolean present. |
