# Proposal: encrypt-credentials-at-rest

## Why

Two host-owned credential files are plaintext JSON at mode 0600: `~/.pi/agent/plugin-credentials.json` (plugin `ctx.credentials`) and `~/.pi/dashboard/vault.json` (credential vault). Any copy of them leaks every secret: a backup, an iCloud or dotfile sync, a support bundle, or an agent tool call such as `read` or `cat`. The pi-hu-connectors spike (`docs/research/SPIKE2.md` in that repo) showed that a pi agent can read `plugin-credentials.json` with `read` and get no prompt, because the path gate treats the pi agent directory as a built-in read root. Third-party terms such as NAV M2M require that secrets are not readable "by anyone". The connector kit (`add-plugin-connector-kit`) depends on this change.

## What Changes

- **Host data key.** The host keeps one random 32-byte data key in the OS keychain: macOS Keychain, Linux Secret Service (libsecret) or Windows Credential Manager. It is read through the native module `@napi-rs/keyring`, in a self-contained worker thread with a 10 s deadline so a keychain prompt or unlock never blocks the server (`keychain_timeout`); a worker that cannot load gives `keychain_unavailable`, never an in-process call. The key is created lazily: only to migrate an existing plaintext file or on the first credential write, never on a host without credentials. An explicit key file (`PI_DASHBOARD_DATA_KEY_FILE`) can replace the keychain for Docker and headless hosts. The host never silently falls back to plaintext.
- **Whole-file envelope.** Both files are stored as one AES-256-GCM envelope at the locked read/write layer. The AAD binds the envelope to the file's identity. The schemas inside are unchanged, so in-flight vault schema changes do not interact with this one. `ctx.credentials` and every vault API keep their shapes. `auth.json` is not touched.
- **Fail closed.** If an encrypted file cannot be decrypted (no key, a different key, an unknown format or a damaged header), the file is **locked**, not corrupt. A file that starts with the envelope magic is never treated as corrupt. A store used before the key is initialised fails closed (`key_uninitialized`). Its bytes are kept, every write is refused, and its values are unavailable. The status names a non-secret reason and a remedy. The host never creates a new key while an encrypted file exists.
- **Migration.** At the first start with a key, each valid plaintext file is encrypted in place. The new file is decrypted and compared before it replaces the old one. No plaintext copy is left behind.
- **Rollback and recovery.** Local-only CLI commands: `pi-dashboard credentials status`, `credentials decrypt` (writes the plaintext back before a downgrade or a key-source switch; refuses while any server answers, holds both locks, decodes all files before writing any) and `credentials reset` (moves a file that cannot be decrypted aside, so the user can enter the credentials again; same running-server refusal and lock order as `decrypt`).
- **Agent credential guard.** A new, always-on handler in the bridge extension blocks agent tool calls that target the credential files, the key file or the host keychain entry. It checks path tools (a missing `path` means the cwd) and, for every tool, the string values of command-bearing and path-like fields only (`command`, `script`, `code`, `args`, `url`, `path`, `file`, `filePath`, `cwd`, `pattern`, `glob`; never `write`/`edit` content), matching only path-like or keychain-command text, never a bare file name. Blocked calls get reason `credential_guard`. It is best-effort and documented as bypassable. It is not a sandbox.
- **Keychain write exception.** `service-secrets` allows exactly one keychain write: the host data-key entry. The `keychain:` resolver stays read-only and refuses to resolve that entry.
- **Cross-change edit.** In `openspec/changes/add-connector-layer/design.md` ("Threat model"), the line that says the vault is "plaintext at 0600 … not at-rest encryption" now points to this change. Already applied; task 13.2 re-checks it at archive.

### Threat model (accepted by the user)

The keychain does **not** make the key readable by the server alone:

- On Linux (libsecret) and Windows (Credential Manager/DPAPI), any process of the same user can read the entry.
- On macOS, the ACL depends on the binary's code signature. On the npm-install arm, the server and the pi sessions usually run on the same `node`, so the agent can read the key without a prompt.
- On packaged Electron, the server runs on the bundled Node. Whether a different `node` triggers a prompt depends on that binary's signature, and a spike task must verify it. When the ladder falls back to the bundled Node, pi sessions run on the same binary as the server.

This change protects against: disclosure through `cat` or the read tool, backups, sync, and copied files. It does not protect against a determined same-user process. The real fix is sandboxing agent bash (`docs/research/agent-bash-sandboxing.md`), which is a named follow-up and out of scope.

### Non-goals

- `~/.pi/agent/auth.json`: pi reads it directly.
- `services-secrets.json`: `absorb-service-secrets-into-vault` moves it into the vault.
- Existing `.corrupt-*` plaintext backups: they are reported, not rewritten.
- Rotating the data key.
- A sandbox for agent processes.

## Capabilities

### New Capabilities
- `credential-at-rest-encryption`: the host data key (sources, creation, failure states), the envelope format, migration, CLI rollback and recovery, and non-secret status.
- `credential-file-guard`: the agent tool-call guard in the bridge. It is separate from `path-containment-guard`, whose rule "SHALL NOT analyse shell command text" still applies to that guard alone, and from the interactive path gate, which cannot override it.

### Modified Capabilities
- `plugin-credential-store`: MODIFIED "Storage file isolation and permissions" (the content is in the encrypted format) and "Corrupt file handling" (a locked file is not corrupt and is never overwritten). ADDED "Records encrypted at rest with an unchanged API".
- `credential-vault`: MODIFIED "Corrupt vault file is preserved" (adds the locked state, the refusal of writes and the vault page behaviour).
- `service-secrets`: MODIFIED "Secret references and resolvers" (the single data-key keychain write; the resolver refuses that entry). **Collision:** `absorb-service-secrets-into-vault` modifies the same requirement. Whichever change archives second rebases a one-sentence delta (`dependencies.yaml` `related`). absorb must treat `vault_locked` like `vault_corrupt`; its plaintext `.migrated`/`.bak` copies are a residual for absorb to address (design Risks).

## Impact

- **Server:** new `packages/server/src/auth/credential-key.ts` (with a keychain worker) and `credential-envelope.ts`; an opt-in codec in `locked-json-file.ts` (off for `auth.json`); `plugin-credential-store.ts` and `vault/vault-store.ts` take a required codec; `vault-routes.ts`, `vault-delivery-hub.ts`; every reader of the vault `corrupt` state (ACME `credentials.ts`, `acme-source.ts`, `gc.ts`, `config-projection.ts`, `acme-routes.ts`); startup order in `server.ts`; a `credentials` command in `cli.ts`; the `keychain:` resolver.
- **Shared:** new `packages/shared/src/credential-encryption.ts` holds the constants for the keychain service, file names and reason codes.
- **Extension:** new `packages/extension/src/credential-guard.ts`, registered in `bridge.ts` before the path gate.
- **Client:** the vault page shows the locked state (`vault-api.ts` status type, `VaultSection`, `VaultVariablesTab`, `VaultAccountsPanel`, `VaultImportPanel`).
- **Dependencies:** `@napi-rs/keyring` 2.1.2 (MIT, N-API, per-platform optional packages). The Electron bundle must ship the signed binding for its target platform. `bundle-server.mjs` gets a GO/NO-GO check (presence, and a valid signature on macOS) and `verify-release-deps.mjs` a floor. A binding that does not load means `keychain_unavailable`, never plaintext.
- **Docker:** a `0600` key file at `/home/pi/.pi-key/data-key` on its own volume, generated by `entrypoint.sh` only while no envelope exists; the entrypoint warns when `/home/pi/.pi-key` is not a mountpoint, and custom Compose files or `docker run` must mount it as a named volume (`Dockerfile`, `entrypoint.sh`, `compose.yml`, `compose.test.yml`, `compose.test.peer.yml`; see design.md D6).
- **Compatibility:** plugin and vault APIs are unchanged. New typed error codes: `store_locked` (plugin credentials) and `vault_locked`, which maps to 409. Older dashboard versions see an encrypted file as corrupt. The vault then refuses writes. The plugin store keeps a byte-exact backup and starts a new plaintext file, so run `credentials decrypt` before a downgrade.
- **Migration:** the migration is irreversible without the key or the decrypt CLI. A key lost from the keychain (reset, or a restore on a new machine) leaves the files locked until the key is restored or the files are reset.
- **Rollback:** `pi-dashboard credentials decrypt`, then install the older version.

## Discipline Skills

- `security-hardening`: key handling, AAD binding, fail-closed states, guard coverage, and no secret in logs, errors or argv.
- `doubt-driven-review`: before the in-place migration and before the format becomes public. Both are irreversible once users have encrypted files.
- `observability-instrumentation`: startup log and status for the key state and each file's state. The key and its value are never logged.
