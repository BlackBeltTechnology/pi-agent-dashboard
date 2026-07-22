## 1. Spawn env passthrough (process-manager) — TDD

- [x] 1.1 Write a failing faux test: `buildSpawnEnv` with a caller `extraEnv` map places each supplied key in the returned env (extend existing process-manager env test).
- [x] 1.2 Write a failing faux test: when a caller env and a guard env share a key, the guard value wins; distinct keys from both survive.
- [x] 1.3 Write a failing faux test: no caller env ⇒ returned env byte-identical to today (no-op guard).
- [x] 1.4 Add optional `env?: Record<string,string>` to `SpawnOptions`.
- [x] 1.5 In `spawnPiSession`, fold caller `opts.env` INTO the resolved guard map (caller first, then guard) so `buildSpawnEnv(..., { extraEnv })` receives one merged map with guard precedence.
- [x] 1.6 Run the new tests → green.

## 2. Plugin spawnSession host hook forwards env (server) — TDD

- [x] 2.1 Write a failing faux test: the plugin `spawnSession` hook forwards `opts.env` into `spawnPiSession`.
- [x] 2.2 Forward `opts.env` from the host hook into the `spawnPiSession` options (additive; absent ⇒ unchanged).
- [x] 2.3 Run the new test → green.

## 3. Session-link sets the per-invoice scope (invoicebot-plugin) — TDD

- [x] 3.1 Write a failing faux test: `spawnAndBind` with a bound `invoiceId` calls `spawnSession` with `env: { IB_TOOLSET: "scoped-invoice", IB_INVOICE_ID: invoiceId }`.
- [x] 3.2 Write a failing regression test: `spawnAndBind` with NO `invoiceId` calls `spawnSession` with no `env` (Ask session unchanged).
- [x] 3.3 Add optional `env?: Record<string,string>` to `SessionLinkDeps.spawnSession` opts.
- [x] 3.4 In `spawnAndBind`, pass the scope env only when an `invoiceId` is bound.
- [x] 3.5 Run the new tests → green.

## 4. End-to-end scope assertion (faux, offline)

- [x] 4.1 Write a faux test proving a scoped spawn reaches the spawned process env such that the active profile resolves to `scoped-invoice` (only the scoped-invoice surface registers).
- [x] 4.2 Write a regression proving the unscoped (Ask) spawn resolves to the default full-surface profile.
- [x] 4.3 Run the full faux suite → green.

## 5. Verify + gate

- [x] 5.1 `npm test` (faux, zero-network) green across touched packages.
- [x] 5.2 `npm run build` clean.
- [x] 5.3 Update the affected directory `AGENTS.md` rows (session-link `guard`/spawn row, process-manager env row) per the doc protocol.
