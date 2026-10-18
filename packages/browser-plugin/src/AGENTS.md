# DOX — packages/browser-plugin/src

Files in this directory. One row per source file. See change: add-browser-relay.

| File | Purpose |
|------|---------|
| `i18n.ts` | i18n catalog — UNPREFIXED leaf keys, `{ "zh-CN": {...}, hu: {...} }` with IDENTICAL key sets (parity test `src/client/__tests__/i18n.test.ts`). Covers settings (token/zeroDialog/allowedDomains/kill switch/capability), audit, live-view overlays, badge. Merged under `plugin.browser.*`; `useT()` auto-prefixes. Task 4.4. Keys `noSessionOverlay`, `reopenLiveView`. See change: fix-browser-live-view-subscribe-and-reopen. Adds pane-tab / badge-menu keys (`paneTabGone`, `inputOn/Off`, `fit`, `oneToOne`, `done`, `textBridge`, `tabFallback`, `state*`, `badgeMenu`, `openInPane`, `openAllInPane`); drops `liveViewTitle`/`noTabs`/`reopenLiveView`. See change: add-browser-editor-pane-tab. Adds Agent browsing / dedicated profile / password-manager / audit-cause keys (task 7.5; parity-tested #F14). See change: add-dedicated-agent-browser. |

Files in `__tests__/`:

| File | Purpose |
|------|---------|
| `__tests__/config-schema.test.ts` | `configSchema.json` accepts pre-dedicated and new configs; new defaults applied (`defaultBrowser` `@dedicated`, `onUnavailable` `ask`, `idleDisconnectMinutes` 30, `openLiveViewOnConnect` true, `allowedDomains` `[]`). Task 1.1. See change: add-dedicated-agent-browser. |
| `__tests__/manifest.test.ts` | Scenario E31/7.31. `validateManifest` accepts; id `browser`; `defaultEnabled:false`; claims `settings-section`+`session-card-badge`+`content-view` resolve to EXPORTED components from the client entry (imports the barrel); `token` writeOnly in configSchema; `allowMultipleInstancesPerProfile` boolean present. |
