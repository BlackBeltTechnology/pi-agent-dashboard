# DOX — packages/demo-plugin/src/bridge

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | Demo fixture bridge entry (registered only under `PI_DASHBOARD_FIXTURE_PLUGINS=1`). Registers pi tool `demo_echo({text})` → `requestPluginServer("demo","demo/echo")`; result text `echo: <text>` or `error: <code>`. Plain JSON-schema parameters. See change: expose-plugin-credential-and-oauth-seams. |
