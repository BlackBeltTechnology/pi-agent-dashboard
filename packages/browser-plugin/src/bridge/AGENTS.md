# DOX — packages/browser-plugin/src/bridge

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | Bridge entry (pi extension). `createBrowserTools()` → pi tools `browser_show_in_pane {instanceId, tabId?}` and `browser_await_human {instanceId, reason}`; default `activate(ctx)` registers both via `pi.registerTool`. Both call `requestPluginServer("browser","browser/open",{kind,instanceId,tabId?})` — only these fields travel, session id comes from the request lane. `browser_await_human`: no `ctx.hasUI` → `cancelled`/`no-ui` (nothing opened); open refusal → `cancelled` + cause; else `ctx.ui.confirm("Browser: your turn", reason, {pluginMeta:{pluginId:"browser",kind:"browser-takeover",instanceId}})` → `done`/`cancelled`. See change: add-browser-editor-pane-tab. |
