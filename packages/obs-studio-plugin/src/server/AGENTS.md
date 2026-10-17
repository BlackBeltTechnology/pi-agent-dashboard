# DOX — packages/obs-studio-plugin/src/server

Plugin server. Password never enters this process. See change: add-obs-studio-plugin.

| File | Purpose |
|------|---------|
| `__tests__/helpers.ts` | `obsApp` (routes + fake bridge children), `stateCli`. |
| `__tests__/host-gates.test.ts` | E17 behind real tier gate + bearer auth + network guard + real identity seam. |
| `__tests__/real-serve.test.ts` | X3 real `pi-obs serve --stdio` behind `fixtures/stub-exec.mjs`. |
| `__tests__/routes.test.ts` | E16–E18, X2, X4, X6, P2; review follow-ups (failed state read not cached, endpoint change reopens bridge). |
| `bridge.ts` | `BridgeManager`: lazy piped `service exec … serve --stdio` child per instance; id-correlated; 5 s → `obs-timeout` + terminate; stdin-EOF dispose then kill after 5 s; `restarts`/`lastError`. |
| `dashboard-cli-argv.ts` | `dashboardCliArgv`: server `process.execPath` + `--import` loader args + CLI entry (`PI_DASHBOARD_BIN` overrides). |
| `index.ts` | Server entry: wires bridge manager, 5 s state reader, routes, standalone page; disposes bridges on shutdown. |
| `routes.ts` | `/api/plugins/obs-studio/{instances,:service/status,screenshot,scene,virtualcam,record}`. Operate authority via `identity.hasOperateAuthority` (absent = refuse) before membership/state read. Encapsulated `@fastify/rate-limit`, `global:false`, no loopback allowList. Bridge opens only when state `healthy`. |
| `service-state.ts` | `pi-dashboard service status --json` reader, 5 s cache; never ensures/starts. |
| `standalone.ts` | `/apps/obs/` page + `app.js` from memory; same routes; catalog strings. |
