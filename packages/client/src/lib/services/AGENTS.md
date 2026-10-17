# DOX — packages/client/src/lib/services

Client model + REST client of managed services (Settings → Services pages).

| File | Purpose |
|------|---------|
| `services-api.ts` | `/api/services*` helpers (`listServices`, `getService` (probes), `listOffers`, `getRuntimes`, `runVerb`, `addService(dryRun)`, `removeService(id, purgeData)` (`purgeData` sent only when true), `setSecret`, `getLogs`, `resetData`, `prune`). Every call resolves to `ServicesResult` (`ok,status,data,error,code,remedies?,reason?`), never throws; 2xx non-JSON → `server_outdated`. See change: add-services-settings-ui. |
| `services-model.ts` | Pure model: `STATE_META`/`stateMeta` (glyph + text + tone), `reasonSentence`, `logsReasonSentence`, `whySentence`, `groupServices` (attention → running → stopped), `needsAttention`, `actionsFor` (design D9 gating table), `untilText`. Tests: `components/settings/services/__tests__/services-model.test.ts` (E33, E34). See change: add-services-settings-ui. |
