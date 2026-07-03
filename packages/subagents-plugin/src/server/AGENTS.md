# DOX — packages/subagents-plugin/src/server

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | Plugin server entry. Default-exports `registerPlugin(ctx)`. Startup reconcile: reads producer file, pushes `inheritContext` into plugin config via `ctx.updatePluginConfig`. Write-through mirror: Fastify `onResponse` hook on `POST /api/config/plugins/subagents` 200 merges config into producer file. |
| `producer-file.ts` | Pure helpers for producer settings file at `~/.pi/agent/extensions/pi-dashboard-subagents/config.json`. Exports `ProducerSettings`, `producerFilePath`, `readProducerFile`, `writeProducerFile` (atomic tmp+rename), `mergeIntoProducerSettings` (preserves unexposed keys). Never throws. |
