# Test Plan — absorb-service-secrets-into-vault

Stage: design   Generated: 2026-10-12

Hard gate passed with no clarifications: every slot is concrete in the specs, and performance is a non-goal (no budget). The user accepted the design after cycle 6 on the condition that its race and crash cases become tests; those are E9–E14, X1–X8.

Exemplars (harness glue to copy):
- **L1 secret store and resolution:** `packages/server/src/services/__tests__/secrets.test.ts` (locked JSON store, corrupt handling, refs).
- **L1 service manager and routes:** `packages/server/src/services/__tests__/routes.test.ts` (add/remove/secret routes, authority).
- **L1 lifecycle:** `packages/server/src/services/__tests__/definitions-store.test.ts` (definitions, removal).
- **L1 CLI:** `packages/server/src/__tests__/cli-service.test.ts` (`service secret set`, `service exec`).
- **L2 process smoke:** `qa/tests/42-managed-services-podman.sh` (a real service start with a mounted secret).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | service-secrets: store (selection) | decision table | L1 | automated | every combination of evidence {sentinel, service account, `.migrated` copy, none} × vault {missing, readable, corrupt} × legacy {absent, valid, corrupt} | `serviceSecretsBackend()` | the result equals the D1 table for each of the 36 cells (vault / legacy / unavailable) |
| E2 | service-secrets: store (migration) | state | L1 | automated | no evidence; legacy file `{version:1, secrets:{"obs/password":"abcdefgh12","obs/pin":"1234"}}` | startup | vault holds `service:obs` `password` and `pin`; sentinel exists; one `services-secrets.json.migrated.<ts>` with the original bytes, mode `0600`; `store:obs/password` resolves to `abcdefgh12` |
| E3 | service-secrets: store (migration) | EP | L1 | automated | legacy file with `{"obs/a":"x1234567","bad":"v","obs/n":42}`; and a file whose `secrets` is `[]` | startup | first: only `obs/a` migrated, the log lists keys `bad`, `obs/n` and count 2 with no values, the file is renamed; second: not migrated, legacy stays, status names the reason |
| E4 | service-secrets: store (migration) | BVA | L1 | automated | legacy file with zero migratable entries, no vault file | startup | sentinel written; `vault.json` does not exist; file renamed; the next startup does not migrate |
| E5 | service-secrets: store (migration) | state | L1 | automated | vault already holds `service:obs/password` = `A`; legacy file has `B`; no sentinel | startup | migration stops; legacy selected; status `migration-conflict` naming `obs` only; no file renamed |
| E6 | service-secrets: store (fresh install) | state | L1 | automated | no evidence, no vault, no legacy file | startup, then add a service with `generate: {bytes: 3}` | sentinel written at startup with no `vault.json`; after the add, the vault holds a 4-character value and `store:` resolves it |
| E7 | service-secrets: store (D4) | decision table | L1 | automated | sentinel present; `services-secrets.json` variants: corrupt / SHA-256 equals `lastExportDigest` / exactly equal to the vault / a subset of the vault / a different value | startup; and separately a status request | startup: conflict (not renamed) / renamed / renamed / conflict / conflict; a status request never renames |
| E8 | service-secrets: store (D4) | state | L1 | automated | `legacy-file-conflict` reported | remove every service, restart | vault is still the backend; conflict still reported; legacy values never resolved |
| E9 | service-secrets: store (deleted sentinel) | state | L1 | automated | vault holds `service:obs`; sentinel deleted; stale legacy file present | startup | sentinel recreated; vault selected; `legacy-file-conflict` |
| E10 | service-secrets: store (deleted vault) | state | L1 | automated | sentinel + `.migrated` copy; `vault.json` deleted | status, then `service secret set obs password` | the status warns and names `vault import-services --from`; the write is stored in a new vault |
| E11 | service-secrets: store (no minimum) | BVA | L1 | automated | migrated vault | `service secret set obs pin` with 1, 5, 7, 8 characters | all stored; foundation `user` account with 5 characters still rejected |
| E12 | service-secrets: store (removal) | decision table | L1 | automated | `neo4j` with secrets `password`, `user`; `app` references `store:neo4j/password`; a grant subject `service:neo4j`; binding default = `service:neo4j/user` | `service remove neo4j` | `password` kept; `user` deleted, so the binding loses its default; the grant deleted; the definition removed |
| E13 | service-secrets: store (removal) | fault | L1 | automated | crash injected after the vault grants/accounts step, before the legacy and definition steps | re-run removal | removal completes; no orphan grant; a same-id re-add has no grant |
| E14 | service-secrets: store (removal) | fault | L1 | automated | vault corrupt; legacy selected | `service remove obs` | 409; nothing deleted from either file |
| E15 | service-secrets: references | decision table | L1 | automated | `vault:GEMINI_API_KEY` with: service grant + key account / no grant / project grant only / `no-account` override / `llm` binding / missing binding | `ensure` | resolved / `secret-unavailable` ×5; no other backend consulted (spy) |
| E16 | service-secrets: references | state | L1 | automated | granted `vault:GEMINI_API_KEY`; `obs` running | rotate the account | `obs` keeps the old value; after restart it gets the new value; the view shows "restart to apply" before the restart |
| E17 | service-secrets: references (keychain) | EP | L1 | automated | `keychain:` ref on linux without a session bus; win32 | `ensure` | `secret-unavailable`; neither the vault nor the legacy file is read |
| E18 | service-secrets: sources explicit | state | L1 | automated | migrated vault | add a service declaring `secrets.password.generate` | value stored in the `obs/password` slot of the vault; the response is `configured: true` with no value |
| E19 | credential-vault: service grants | decision table | L1 | automated | `GEMINI_API_KEY` granted to `service:obs` only / to a project only | session snapshot; `obs` `ensure` | service grant: `obs` resolves, the session gets nothing; project grant: the session gets it, `obs` gets `secret-unavailable` |
| E20 | credential-vault: service grants | state | L1 | automated | `obs` with a service grant | remove `obs`, add `obs` again | no grant; `vault:GEMINI_API_KEY` → `secret-unavailable` |
| E21 | credential-vault (MODIFIED): Account storage | state | L1 | automated | binding `OBS_PIN` defaults to a 6-character `service:obs` account; project grant | session snapshot | `OBS_PIN` absent; state `too-short` |
| E22 | credential-vault: export | state | L1 | automated | vault with `service:obs/password`, `service:obs/pin` | `vault export-services` | file at `0600` holds both; vault accounts/bindings/grants deep-equal before and after; `lastExportDigest` = SHA-256 of the file; stdout matches `/^\d+ secrets? written/` and contains neither value nor `password`/`pin` |
| E23 | credential-vault: export | state | L1 | automated | `services-secrets.json` exists | export without, then with `--force` | refused and unchanged; with `--force` a byte-identical `.bak.<ts>` at `0600`, then overwritten |
| E24 | credential-vault: export | state | L1 | automated | export done; the same version keeps running; `obs/password` rotated | restart | the file is renamed to a `.migrated` copy (digest match); no conflict; `store:obs/password` = rotated value |
| E25 | credential-vault: import | decision table | L1 | automated | vault `obs/password=A`; source `B` | import / `--force` / `--force --exact` with the source lacking `obs/pin` | refused naming `obs` / replaced, with a `.vault-backup.<ts>` holding `A` / also deletes `pin` through revocation (binding loses its default, event emitted) |
| E26 | credential-vault: import | state | L1 | automated | vault deleted; `.migrated` copy | `import-services --from <copy>` | vault holds the copy's secrets; sentinel present; the copy is byte-identical and still present |
| E27 | credential-vault: export/import | invariant | L1 | automated | both commands | check `/api` route table | no HTTP route exposes either command |
| E28 | managed-services (MODIFIED): removal | EP | L1 | automated | as E12 via `DELETE /api/services/neo4j` | REST removal | same outcome as E12 |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | service-secrets: store (migration crash) | fault-injection | L1 | automated | crash after the vault write, before the sentinel | restart | migration repeats; the vault write is a no-op; sentinel written; file renamed; no conflict |
| X2 | service-secrets: store (migration crash) | fault-injection | L1 | automated | crash after the sentinel, before the rename | restart | D4 "equal" renames the file; no conflict |
| X3 | service-secrets: store (race) | concurrency | L1 | automated | a legacy `setSecret` blocked on the legacy lock held by the migration | release the lock | the write raises `BackendChanged`, re-selects, and stores the value in the vault; `services-secrets.json` is not recreated |
| X4 | service-secrets: store (race) | concurrency | L1 | automated | `service exec` resolution started on legacy; the migration renames mid-resolution | resolution completes | values all come from one backend (one locked snapshot); no "not set" error |
| X5 | service-secrets: store (two processes) | concurrency | L1 | automated | two dashboard startups race the migration | both run | exactly one migration; one `.migrated` copy; the second sees the sentinel and stops; `ENOENT` on rename counts as done |
| X6 | service-secrets: store (corrupt) | fault-injection | L1 | automated | legacy file not valid JSON, no evidence | startup, then `service secret set` | not migrated; write refused; the file is byte-identical; `secret-unavailable` names the backup path |
| X7 | service-secrets: store (corrupt vault) | fault-injection | L1 | automated | evidence present; vault corrupt; stale legacy file | `ensure`; `service secret set` | `secret-unavailable` naming the vault backup; write refused; the legacy file is never read (spy) |
| X8 | service-secrets: store (corrupt vault, pre-migration) | fault-injection | L1 | automated | no evidence; valid legacy file; vault corrupt | startup; repair the vault; restart | first start: legacy selected, no migration; after the repair: migrated |
| X9 | service-secrets: delivery | fault-injection | L2 | automated | a real podman service with `store:obs/password` on a migrated dashboard | `service ensure obs` | the container's mounted secret file holds the vault value; `podman inspect` shows no value (extend `qa/tests/42-managed-services-podman.sh`) |
| X10 | credential-vault: export → downgrade → re-upgrade | state | — | manual-only | an older dashboard release installed side by side | export, downgrade, edit a secret, upgrade, import `--force` | [judgment: needs two installed release versions; observed: the edited value resolves and the replaced value is in `.vault-backup`] |

---

## Coverage summary

- Requirements covered: 7 of 7:
  - `service-secrets` (MODIFIED): store, sources, references;
  - `credential-vault` (ADDED): service grants, export/import;
  - `credential-vault` (MODIFIED): Account storage;
  - `managed-services` (MODIFIED): removal.
- Scenarios by class: edge 28 · perf 0 · frontend 0 · error 10
- Scenarios by level: L1 36 · L2 1 · L3 0 · manual 1
- Scenarios by disposition: automated 37 · manual-only 1

## New infra needed

- none (crash injection for X1, X2 and E13 uses a test hook between the steps, in the style of `secrets.test.ts`)
