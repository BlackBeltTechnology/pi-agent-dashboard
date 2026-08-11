# Tasks — fix-automation-stamp-correlation

## 1. Host: token-exact automation-run stamping

- [x] 1.1 `pending-automation-run-registry.ts`: entries carry an optional
  `spawnToken`; add `bindToken(cwd, runId, spawnToken)`; `consume(cwd, spawnToken?)`
  resolves exact-token → oldest-unbound → null.
- [x] 1.2 `pi-gateway.ts`: `onSessionRegistered(sessionId, cwd, spawnToken?)`.
- [x] 1.3 `event-wiring.ts`: pass the register's `spawnToken` into `consume`.
- [x] 1.4 `server.ts` spawn hook: `bindToken` once `spawnPiSession` resolves.

## 2. Automation engine: bounded undelivered reap

- [x] 2.1 `EngineConfig.undeliveredRunTimeoutMs` (default 60 s, `<= 0` disables),
  read from plugin config in `index.ts`.
- [x] 2.2 Track `startedAt` per `RunContext`; sweep undelivered runs on the reap timer.
- [x] 2.3 Reap sweep interval 60 s → 15 s.
- [x] 2.4 Both reap paths terminate the spawned run via `abortSpawnedRun`.

## 3. Tests

- [x] 3.1 Registry unit tests: exact-token claim, foreign-token refusal, unbound
  fallback, legacy tokenless FIFO, bind-after-enqueue race.
- [x] 3.2 Engine regression: a completed run settles without waiting for max age.
- [x] 3.3 Engine regression: two consecutive runs both settle; the first never
  blocks the second.
- [x] 3.4 Engine regression: an undelivered (cold-start-race) run is reaped on the
  short bound and the next fire starts.
- [x] 3.5 Cross-plugin stamp regression: two spawns into one cwd each claim their
  own stamp.

## 4. Gates

- [x] 4.1 `npm test` green.
- [x] 4.2 `npm run lint` (tsc --noEmit) clean.
- [x] 4.3 `openspec validate --strict` green.
- [x] 4.4 Directory `AGENTS.md` rows updated for every touched file.
