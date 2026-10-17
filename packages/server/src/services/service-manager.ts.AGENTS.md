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
- `tick()`: sweep leases → healthy with 0 leases → idle (`idleSince = max(lastLeaseEnd, idleResetAt)`); leased healthy/blocked re-probed (cap 4); `shouldIdleStop` → stop under mutex + lock. `startScheduler()` every 30 s (unref'd; no-op after `dispose()`), `dispose()`.
- `definitionHash(def)` = runtime-relevant fields → `pi.def-hash`; definition change clears backoff + resets idle clock.

- Audit hardening: `AddReview.secretSources`; `remove` refuses 409 before teardown on a corrupt secrets store and never force-signals (`stopLocked({removing:true})`); exposure cached per port 30 s; `status` carries `tried` when unavailable.

Tests: `__tests__/state-machine.test.ts`, `leases.test.ts`, `adoption.test.ts`, `definitions-store.test.ts`, `oci-driver.test.ts`, `routes.test.ts`, `secrets.test.ts`. See change: add-service-registry-core.

## add-services-settings-ui

- Types moved to shared `services/status.ts` (`ServiceStatus` + `leaseHolders`/`secretRefs`/`volumes`/`drivers`, `ServiceList.canOperate`, `AddReview`).
- `list({canOperate})`; deps `onChange` (coalesced 500 ms; `changeCoalesceMs:0` = raw), `capMs`, `output`, `kill`. `StateCell` + `LeaseTable` hooks, `pin`/`add`/`remove`/`setSecret`/`resetData`/`prune` all `notify()`.
- Start record: `recordStart` writes `start.json` on every dashboard start (any driver); adoption reads it; `restartRequired` = defHash mismatch OR `secretsSavedSinceStart` (`markSecretSaved`).
- `logs(id, tail)`: precedence external → no-output → per-secret fail-closed (`secret-unavailable|secret-too-short`) → digest (`secrets-changed`) → driver `logs` (`runtime-error|duplicate-instances|no-output`) → redact → last N → 512 KiB cut. `stale` = no running instance. `parseTail`: 1–2000 else 400 `invalid-tail`.
- `resetData(id)` (state gate, `no-data`, shared volume guard, plain `rm`), `prune({dryRun}|{ids})` (orphan containers per runtime + dead run dirs; recheck per id under its lifecycle lock; 409 `definitions-missing`). `capOutputs()` sweeps `output.log` every 5 s (`startScheduler`).
- Tests: `__tests__/logs.test.ts`, `output-capture.test.ts`, `reset-prune.test.ts`, `change-notify.test.ts`, `src/__tests__/services-authority.test.ts`.

