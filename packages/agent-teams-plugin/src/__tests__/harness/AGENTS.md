# DOX — packages/agent-teams-plugin/src/__tests__/harness

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | Barrel for the harness. |
| `fake-clock.ts` | `FakeClock implements Clock`: `advance`/`advanceAsync`, `pendingCount`, `nextDue`. Timers fire in (due, creation) order. |
| `fake-host-ctx.ts` | `createFakeHostCtx()`: `emitEventToSession`/`spawnSession`/`abortSession`/`shutdownSession`/`getPluginConfig` with recorded calls and scriptable outcomes; config starts from the real `configSchema.json` defaults. |
| `faux-pi-rpc.ts` | `FauxPiProcess`: real `pi --mode rpc` + `qa/fixtures/faux-provider.ext.ts` (JSONL framing, `prompt`, `waitFor`, `stop`). STUB: real bridge entry load, in-process store/lane stub, scripted policies (later sections). `fauxPiAvailable()` gates tests. |
