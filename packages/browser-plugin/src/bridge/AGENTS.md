# DOX — packages/browser-plugin/src/bridge

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | Bridge entry (pi extension). `createBrowserTools()` → pi tools `browser_show_in_pane {instanceId, tabId?}` and `browser_await_human {instanceId, reason}`; default `activate(ctx)` registers both via `pi.registerTool`. Both call `requestPluginServer("browser","browser/open",{kind,instanceId,tabId?})` — only these fields travel, session id comes from the request lane. `browser_await_human`: no `ctx.hasUI` → `cancelled`/`no-ui` (nothing opened); open refusal → `cancelled` + cause; else `ctx.ui.confirm("Browser: your turn", reason, {pluginMeta:{pluginId:"browser",kind:"browser-takeover",instanceId}})` → `done`/`cancelled`. See change: add-browser-editor-pane-tab. `browser_connect {target?}` → `connectBrowser(params)` → `browser/connect` (only `target` travels; spoofed `sessionId` dropped; lane error → error result). `browser_await_human` additionally signals `browser/await-state {instanceId,pending}` (best effort, `finally` clears) so the idle sweep holds the instance. See change: add-dedicated-agent-browser. |

Files in `__tests__/`:

| File | Purpose |
|------|---------|
| `bridge.test.ts` | Tool registration (now incl. `browser_connect`); `browser_connect` sends ONLY `target` (spoofed `sessionId` dropped), `unavailable` policy result is a normal result, lane error → error result; `browser/await-state` pending around the confirm and cleared in `finally`, failing signal never breaks the tool (#E20). See change: add-dedicated-agent-browser. |
