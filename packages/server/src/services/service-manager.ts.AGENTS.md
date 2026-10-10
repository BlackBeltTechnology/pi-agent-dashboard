# service-manager.ts

`ServiceManager(deps)` — one lifecycle state machine for `managed` (oci:docker, oci:podman, native), `attached`, `external`. Deps injectable: `paths`, `run`, `resolveBinary`, `platform`, `env`, `now`, `sleep`, `log`, `discoverOffers`, `drivers`, `probe`, `exposure`, `detector`, `lockOptions`, `leaseTtlMs`, `startPollMs`, `tickMs`.

- `ensure(id, {holder?, lease?})` → `EnsurePayload` (`id, state, reason?, retryAt?, endpoints?, leaseId?, driver?, exposure?, updateAvailable?, restartRequired?, tried?, hint?`). Never returns a secret.
- Order: corrupt file → `invalid-definition`; unknown id → `not-added` (hint names `service add` when offered); sticky `failed` before `retryAt`, sticky `adoption-uncertain`/`owner-conflict`/`duplicate-instances`, `stop-failed` → returned as-is; secrets resolved (`secret-unavailable`); known instance → probe (healthy | blocked | gone); else under `withLifecycleLock` re-adopt via every driver, then first driver passing offline `presence` starts; all fail → first-preference reason + `tried`.
- Start loop: `startPhaseOutcome` per poll; podman tunnel fallback once; healthy resets backoff; failed sets `retryAt = now + backoffMs(n)`.
- Lease only when `healthy` and `lease !== false`. `start` = ensure without lease; `retry` clears backoff then starts.
- `stop(id,{force})`: external no-op; `adoption-uncertain` and external-started instances need `force`; confirmed by driver observation else `stop-failed`.
- `add({offer|definition, dryRun, update})` → `AddReview` (image/recipe, ports, volumes, binds, secret names, templateHash, diff, needsPrefetch); direct definitions forced `origin:"user"`; `oci-healthcheck` validated against the image; generated secrets created in one lock. `remove(id,{purgeData})`: stop if owned, driver `remove` (volumes only on purge), secrets + run dir + entry deleted.
- `list()` (+ `updateAvailable`/`diff`, exposure, secrets `configured`, corrupt-file backups), `status(id)` (re-probes), `listOffers()`, `runtimes()`, `pin(id,bool)` (marker file, resets idle clock), `prefetch(id)` (native only; OCI → "pull it yourself"), `setSecret(id,name,value)` (store refs only, ≤64 KiB).
- `boot()`: adoption only — no-op without `services.json`; `OciDriver.adoptAll` per referenced runtime (one `ps -a`), native `adopt`; no probe, no network.
- `tick()`: sweep leases → healthy with 0 leases → idle (`idleSince = max(lastLeaseEnd, idleResetAt)`); leased healthy/blocked re-probed (cap 4); `shouldIdleStop` → stop under mutex + lock. `startScheduler()` every 30 s (unref'd), `dispose()`.
- `definitionHash(def)` = runtime-relevant fields → `pi.def-hash`; definition change clears backoff + resets idle clock.

Tests: `__tests__/state-machine.test.ts`, `leases.test.ts`, `adoption.test.ts`, `definitions-store.test.ts`, `oci-driver.test.ts`, `routes.test.ts`, `secrets.test.ts`. See change: add-service-registry-core.
