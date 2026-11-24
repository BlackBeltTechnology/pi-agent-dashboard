# DOX — packages/agent-teams-plugin/src/__tests__/harness

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | Barrel for the harness. |
| `fake-clock.ts` | `FakeClock implements Clock`: `advance`/`advanceAsync`, `pendingCount`, `nextDue`. Timers fire in (due, creation) order. |
| `fake-host-ctx.ts` | `createFakeHostCtx()` (+ `onEmit` listeners): `emitEventToSession`/`spawnSession`/`abortSession`/`shutdownSession`/`getPluginConfig` with recorded calls and scriptable outcomes; config starts from the real `configSchema.json` defaults. |
| `faux-pi-rpc.ts` | `FauxPiProcess`: real `pi --mode rpc` + `qa/fixtures/faux-provider.ext.ts` (JSONL framing, `prompt`, `waitFor`, `stop`). STUB: real bridge entry load, in-process store/lane stub, scripted policies (later sections). `fauxPiAvailable()` gates tests. |
| `store-env.ts` | `createStoreEnv()`: real `TeamStore`+`TeamPersistence` over a temp dir with `FakeClock`; `restart()` = a new instance over the same dir WITHOUT flushing (what a killed process left). `capturingLogger`, `tmpDataDir`, `memberFixture`. |
| `fake-runtime-host.ts` | `createFakeRuntimeHost()`: a `RuntimeHost` for `createTeamsRuntime` (session table, `abortSpawnedRun` log, scriptable `getPiResources`, capturing `registerPiRequestHandler`, resolved/ended/shutdown hooks) + `lane()`/`call()` that invoke handlers with socket-supplied meta (local origin by default). |
| `teams-env.ts` | `createTeamsEnv()`: full runtime over the fake host with the REAL mail engine and a `FakeClock`; `createTeam`, `addMember`, `call/idle/busy/hello/ack` as a session (`"lead"` or a member name), `wireMails`/`mailsTo`/`log`, `flushNotices`, `settle`. |
| `fake-pi.ts` | `FakePi` (tools, active list, `sendMessage`, handlers, `pi.events`), `linkBridge(env, who, {env})`: the REAL bridge entry over the real server lane handlers, host emits → `pi.events`; `flushAsync`. |
