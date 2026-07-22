## 1. Spawn env passthrough (process-manager) — TDD

- [ ] 1.1 Write a failing faux test: `buildSpawnEnv` with a caller `extraEnv` map places each supplied key in the returned env (extend existing process-manager env test).
- [ ] 1.2 Write a failing faux test: when a caller env and a guard env share a key, the guard value wins; distinct keys from both survive.
- [ ] 1.3 Write a failing faux test: no caller env ⇒ returned env byte-identical to today (no-op guard).
- [ ] 1.4 Add optional `env?: Record<string,string>` to `SpawnOptions`.
- [ ] 1.5 In `spawnPiSession`, fold caller `opts.env` INTO the resolved guard map (caller first, then guard) so `buildSpawnEnv(..., { extraEnv })` receives one merged map with guard precedence.
- [ ] 1.6 Run the new tests → green.

## 2. Plugin spawnSession host hook forwards env (server) — TDD

- [ ] 2.1 Write a failing faux test: the plugin `spawnSession` hook forwards `opts.env` into `spawnPiSession`.
- [ ] 2.2 Forward `opts.env` from the host hook into the `spawnPiSession` options (additive; absent ⇒ unchanged).
- [ ] 2.3 Run the new test → green.

## 3. Session-link sets the per-invoice scope (invoicebot-plugin) — TDD

- [ ] 3.1 Write a failing faux test: `spawnAndBind` with a bound `invoiceId` calls `spawnSession` with `env: { IB_TOOLSET: "scoped-invoice", IB_INVOICE_ID: invoiceId }`.
- [ ] 3.2 Write a failing regression test: `spawnAndBind` with NO `invoiceId` calls `spawnSession` with no `env` (Ask session unchanged).
- [ ] 3.3 Add optional `env?: Record<string,string>` to `SessionLinkDeps.spawnSession` opts.
- [ ] 3.4 In `spawnAndBind`, pass the scope env only when an `invoiceId` is bound.
- [ ] 3.5 Run the new tests → green.

## 4. End-to-end scope assertion (faux, offline)

- [ ] 4.1 Write a faux test proving a scoped spawn reaches the spawned process env such that the active profile resolves to `scoped-invoice` (only the scoped-invoice surface registers).
- [ ] 4.2 Write a regression proving the unscoped (Ask) spawn resolves to the default full-surface profile.
- [ ] 4.3 Run the full faux suite → green.

## 5. Verify + gate

- [ ] 5.1 `npm test` (faux, zero-network) green across touched packages.
- [ ] 5.2 `npm run build` clean.
- [ ] 5.3 Update the affected directory `AGENTS.md` rows (session-link `guard`/spawn row, process-manager env row) per the doc protocol.
