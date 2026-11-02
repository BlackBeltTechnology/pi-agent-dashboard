# credential-key.ts — index

Process-wide credential data key (32 B, one per OS user). Held only in memory; never logged / argv / env / HTTP.
- Source: `PI_DASHBOARD_DATA_KEY_FILE` set ⇒ ONLY source (owner-only via `checkOwnerOnly`, b64 of 32 B + at most one `\n`/`\r\n`; `key_file_missing|invalid|insecure`; never created). Else OS keychain `pi-dashboard-credential-key` / `data-key-v1`.
- Keychain jobs run in a `worker_threads` Worker (`credential-key-worker.mjs`), never on the main thread. No in-process fallback: start/load/exit failure ⇒ `keychain_unavailable`. `initCredentialKey` = ONE 10 s total deadline ⇒ `keychain_timeout`, worker `unref()`'d, late answer ignored.
- Lazy (D4): no credential file ⇒ state `deferred`, no keychain access. Envelope on disk + no key ⇒ `key_missing` (never created). Plaintext only ⇒ create under `<home>/.pi/dashboard/credential-key.lock` (`LOCK_OPTIONS`, 2 s retry) with read-back; stored value wins. `ensureCredentialKey()` (own 10 s) does the same for the first write while `deferred`.
- Failure cached for the process, EXCEPT creation-lock contention/EACCES: `ensureCredentialKey` returns `{state:"unavailable",transient:true}`, state stays `deferred`.
- `ensureCredentialKeyForWrite()` = write prologue: throws `CredentialLockedError`. Call BEFORE the store lock.
- `getCredentialCodec(fileId)` = fail-closed singleton codec (reads the live state each call; `key_uninitialized` before init / while deferred).
- Log (D11): `[credential-key] source= state= reason= kid= created=`; `created source=… kid=…`; `keychain detail: <short>`.
- Seams (D9): `entryFactory` (in-process provider), `workerEntry`/`workerData`/`workerFactory` (stub worker), `filesProbe`, `homeDir`, `platform`, `lockTarget`, `deadlineMs`, `keychainService`/`keychainAccount` (spike), `log`. Under `VITEST` with nothing injected ⇒ `keychain_unavailable`, binding never loaded.
See change: encrypt-credentials-at-rest (D4, D5, D6, D9, D11).
- `resetCredentialKeyState()` drops the singleton (cached failure included); production caller: CLI `credentials reset` before creating a fresh key. `_resetCredentialKeyForTests` delegates to it.
