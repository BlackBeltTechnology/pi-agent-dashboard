# provisioning.ts — index

Provisioning registry (design D1-D9, D14). Pure: `now`, grant store, mirror, D7 readers, fs resolver, log sink all injected via `ProvisioningDeps`; no timer, no routes. Never touches `PendingGrantRegistry`, never consults YOLO.

## API
- `new ProvisioningRegistry(deps)`: `create({projectRoot, lines, remote})` → `{ok,request}` | `ProvisionFailure{status,error,reason?,requestId?,retryAfterMs?}`. Order: D7 ladder → shape/`empty`/`too-many-lines` (raw line count) → root D8 (`invalid-root`+reason) → `pending-exists` → `capacity` (4) → `cooldown` → per-root 60 s `rate-limited` → global 3/10 min `rate-limited`. Every refusal bumps `refused`, logs `refused`.
- `settle(id, {lines})` async: 404 `not-found`; 409 `already-settled`; 400 `invalid-response`; ladder re-check fail → failure returned, request stays pending. Phase 1 async: root re-validate (`root-changed`), re-resolve approved lines. Phase 2 sync, no `await`: realpath compare (`changed`), net-new capacity (`capacity`, never evicts), `recordGrant({scope:"project",via:"provision",origin:root,evict:false})`, per-line `failed` on write error, then pi-trust `mirror().setChoice("accessGrants", subject, piTrust===true)` for `granted` project-root lines only. `covered` at settle stays acceptable (idempotent). Subject differing after write → revoke (if net-new) + `changed`.
- `dismiss(id)`, `dismissAll()`, `expire()` (lazy; every read also sweeps), `get(id)` (pending or last 50 ended), `list()` (pending), `stats()`, `recordDroppedResponse()`, `checkEligibility()`.
- `deps.onTerminal(id, "settled"|"dismissed"|"expired")` fires once per terminal transition: wiring sends `provision_dismiss` there.
- Helpers: `validateProjectRoot(root,{fs,env})` (D8: `not-absolute|missing|not-directory|forbidden|no-marker`), `sanitizeWhy`, `capText`, `toProvisionRequestMessage(view, now)`, `createDefaultProvisioningGrantStore()`, `defaultProvisioningFs`, constants `PROVISION_*`.

## Contracts
- Classification D4 first match: invalid, missing (file counts), forbidden, sensitive (D5a, ancestor either way, macOS Keychains), in-root, covered (project-scope grants only), grantable. Equal real paths collapse (first `why` kept); `invalid` lines never collapse.
- `why`: control chars removed, 200 code points + `…`; absent/blank → `PROVISION_NO_REASON`. Logs JSON-quote project, path, why; one `[access-provision] line …` per line at create.
- Cooldown (5 min from end; expiry ends at `expiresAt`) starts unless operator approved ≥1 line. Only `granted` lines count `approved`; grantable rejected/omitted lines on a settled request count `rejected`.
- `deps.limits.globalRateMax` test seam: the pending cap 4 is unreachable under global 3/10 min.
- Caller owns capability/tier check (D3), operator-socket delivery, HTTP mapping, expiry timer.

See change: add-access-provisioning.
`provisioning-wiring.ts` (same dir) is the caller-side wiring: operator-socket delivery, `provision_dismiss`, expiry timer, capability-gated `onResponse`.
