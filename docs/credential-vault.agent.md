# credential-vault.md — credential vault index

Pull-only condensed map. Source: `docs/credential-vault.md`. Part 1 of 3: static `key` accounts, env delivery. Changes: add-credential-vault, retro-ux-credential-vault.

## 1. What it is
- Store `~/.pi/dashboard/vault.json`, mode `0600`. Atomic, `locked-json-file`, `createIfMissing: false`.
- Accounts kind `key`. Several per provider. Min value 8 chars (entry + import).
- Env binding: name → default `key` account. Names validated (§3).
- Grants per project, default deny. Checkout confirmation per (device, dir, repoKey).
- Unknown fields/kinds preserved on write.
- Corrupt → byte-exact backup, writes refused. Error shows backup path only.

## 2. Settings → Vault
- Path: Settings → Network → Vault (`SettingsPanel` page `vault`, `VaultSection`).
- Tabs `Variables` (default) · `Accounts` · `Import`. APG tablist. Not in URL. Panels stay mounted.
- Testids: `vault-panel-bindings`, `vault-panel-accounts`, `vault-panel-import`.
- Corrupt: error callout, write controls `disabled`.

### Variables
- Card `vault-binding-<NAME>`. Grant rows `vault-grant-row`: `data-state` = server (`ok`|`no-account`), `data-status` = page status.
- Default change shows impact: `Used by N projects that don't pick their own account`.
- Revoked override → `no-account`. Never falls back to binding default.
- Plugin approval switch `vault-plugin-approve`, row `vault-plugin-<pluginId>-<NAME>`.
- Confirmed checkouts `<details>` under repo grant. Orphans: `Other confirmed checkouts`.

| `data-status` | Pill | Meaning |
|---|---|---|
| `delivering` | success | grant ok + account; folder, or repo with ≥1 confirmed checkout |
| `pending` | warning | repo grant, no confirmed checkout |
| `no-default` | warning | no override, binding no default |
| `no-account` | error | override account missing |

### Destructive (two-step)
- `Delete variable`, `Revoke account`: re-fetch, then `alertdialog` `vault-confirm-impact`.
- Delete: grants + plugin approvals removed. Sessions lose within seconds. Running processes keep value.
- Revoke: bindings lose default; overrides → `no-account`; plugin approvals read nothing.
- Re-fetch fails → confirm disabled. Esc cancels.
- `Rotate`: running-process note inline, no dialog.
- Server applies state at confirm, not preview. Hub push ≤ 150 ms.

### Accounts
- Groups: keys; `Sign-in accounts` (oauth), `Services` (`service:*`) when present.
- Value never shown after save. Client checks: reserved/invalid name, value < 8.
- Add key proposes `<PROVIDER>_API_KEY` (non `[A-Z0-9]` → `_`), only if `isDeliverableEnvName`.
  - No binding → `Create the variable X` → `createBinding`.
  - Binding exists → `Make it the default of X` → `setBindingDefault` (only if default missing or same provider).
- Partial failure: account kept + Retry. Retry finding binding set = success.

### Import
- Fixed server-side locations, existence check. Opaque ids; client never sends path.
- Upload ≤ 64 KiB. Proposal names only. Values < 8 skipped. Each name → `import/confirm`. Sources never modified.

### Project picker
- `open`: sessions by `(deviceId, dir)`. Untrusted / `transport-insecure` → `blocked: <outcome>`, not grantable.
- `recent`: `vault-projects.json`, minus `open`, newest first. `Not listed?` → manual repo/folder.
- Repo normalised by `normalizeOrigin`. Older server (404 `not_found`) → manual entry only.
- `vault-projects.json` `0600`. Entry `{deviceId, dir, repoKey?, lastSeenAt}`. No values or names.
- Bounds: 200 total, 100 per device, 90 days. `dir` ≤ 4096, `repoKey` ≤ 512.
- Recorded from `deliver()` (trusted only). Fire-and-forget. ≤ 1 write/key/h. Corrupt → `list()` empty.
- Trade-off: trusted session can plant entry. Repo grant still needs confirmation.

### Session chip
- `GET /api/session/:id/vault-bindings` adds `ungranted: string[]` (manage callers only).
- Section `vault-ungranted`, rows `vault-ungranted-row`, button `vault-grant-from-session`.
- Subject `repo:<repoKey>` else `dir:<deviceId>:<dir>`. Repo → `pending-confirmation` (poll ≤ 2.5 s).
- Confirm `vault-confirm`: `Confirm and deliver N keys`. Applies to every session in checkout.
- Chip `Vault: confirm` (`data-pending="true"`) while pending.

| State | Pill |
|---|---|
| `delivered` | success |
| `pending-confirmation`, `revoked`, `hub-unreachable`, `vault-unavailable` | warning |
| `no-account`, `blocked-name` | error |
| `local-override`, `inherited`, other | neutral |

Row text from `vault.stateHelp.<state>`.

## 3. Grants and project key
- Repo key = normalised `origin`. Fallback dir key `(deviceId, realpath cwd)`, exact dir only.
- Normalise: strip scheme/userinfo. scp and `ssh://` → `host/path`. Drop default port (22, 443, 80). Lower host. Strip `/`, then `.git`.
- `file://`, local path, git failure → dir key.
- Env name `^[A-Z_][A-Z0-9_]*$` (case-insensitive). Checked at create + delivery.
- Deny exact: `PATH PATHEXT HOME USERPROFILE SHELL COMSPEC SYSTEMROOT PS4 SSH_AUTH_SOCK SSH_ASKPASS LOCPATH GCONV_PATH JAVA_TOOL_OPTIONS _JAVA_OPTIONS JDK_JAVA_OPTIONS CLASSPATH DOTNET_STARTUP_HOOKS LESSOPEN LESSCLOSE OPENSSL_CONF ENV BASH_ENV BASHOPTS SHELLOPTS PROMPT_COMMAND IFS CDPATH ZDOTDIR TMPDIR EDITOR VISUAL PAGER HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY SSL_CERT_FILE SSL_CERT_DIR CURL_CA_BUNDLE REQUESTS_CA_BUNDLE`.
- Deny prefix: `LD_ DYLD_ NODE_ NPM_CONFIG_ PI_ PYTHON PERL RUBY GIT_ BASH_FUNC_ ELECTRON_ CONTEXT_MODE_ XDG_`.
- Grants are scope, not security boundary.
- Source: `packages/shared/src/vault-delivery.ts`, `packages/shared/src/vault-project-key.ts`.

## 4. Checkout confirmation
- `origin` lives in `.git/config`. Clone can claim any origin.
- Repo grant honoured only for confirmed (device, dir, repoKey). Re-pointed origin → new confirmation.
- Unconfirmed → nothing delivered. Residual: confirmed checkout replaced under same origin.

## 5. Delivery
- Bridge sets `process.env` only. No files on session machine.
- Connect + every `session_start`: `vault sync` (cwd, origin, tracked names) → `vault_snapshot` (complete set).
- Push debounced 150 ms (`pushDelayMs`, `packages/server/src/vault/vault-delivery-hub.ts`).
- Tracked: name → SHA-256. Rotate/revoke only while hash matches. User-overwritten → untracked.
- Pre-existing untracked name → skipped, `local-override`. Running processes keep old env.
- Nested pi: `PI_DASHBOARD_VAULT_DELIVERED` (names only). Child masks as `inherited`; never updates/removes.
- Outcomes: `delivered`, `disabled`, `untrusted`, `transport-insecure`, `no-project`, `vault-unavailable`.
- Project change / unreadable cwd / withdrawal → withdraw all. Registry `process` survives reload.
- Trust gate: hub-local (device `hub`) or paired device over TLS. Remote delivery OFF: gateway plain `ws`, TLS at proxy; `X-Forwarded-Proto` not evidence → `transport-insecure`.
- Order: config switch → trust → vault health → project.

## 6. Offline grace, downgrade, emergency off
- `vault.offlineGraceHours` (`~/.pi/dashboard/config.json`). Default 24. Clamp 1–168.
- Elapsed = max(monotonic, wall-clock). Expired → withdraw.
- Hub feature `vault-delivery` in `dashboard_identity.features`. Missing → bridge withdraws.
- Hub corrupt → `vault-unavailable` (not empty snapshot).
- Emergency off: `vault.deliveryEnabled=false`. Checked first. Default `true`.

## 7. Redaction
- Exact match → `[REDACTED:<NAME>]`. Longest first.
- `tool_result`: masks `content`, `details`, `structuredContent`; rewrites `details.fullOutputPath`.
- `message_end`: text + tool-call args. Keeps `role`, `usage`.
- `user_bash`: wraps `createLocalBashOperations`. Hold-back, streaming UTF-8 decoder.
- Forwarder: deep copy, mask. pi event objects never mutated.
- Hold-back trailing L−1 chars. Flushed before later session events.
- Residuals: encoded/transformed; local TUI; spill files (plaintext while running; `0600` pi 1.1.0); imported copies; running processes; plugins; foreign `user_bash` handler first bypasses wrapper.

## 8. Plugins
- Manifest `vaultBindings: string[]`. User approves per declaration.
- `ctx.vault.read(name)` → default-account value. Server-wide, not project-scoped.
- Not isolation. Unchanged: `ctx.credentials`, `plugin-credentials.json`, `ctx.providerAuth`.

## 9. Import sources
- Skill `.env` files, `~/.pi/agent/system-one/auth.json`. Read on selection only.
- `packages/server/src/vault/vault-import.ts`: local mirror of nano-banana `parseEnvFile`.

## 10. Routes and authority
- `/api/vault*`: operate tier, any network position. `canManageVault`:
  - device bearer / login session: `principalTier === "operate"`.
  - identity: operator or `HostActions.vaultManage` (`vault.manage`) on `hostResource.vault()`.
  - no credential: local trust (`hasOperateAuthority`).
- 403 `operate_required`: `reason` `tier-too-low` | `no-credential`. `remedies` order `use-host, re-pair, request-access, sign-in` (`OPERATE_REMEDY_ORDER`, `packages/shared/src/operate-required.ts`).
- `request-access` iff no verified credential, no local proof, knock gates pass (`knockPeerGate`).
- Body keys exactly: `success,error,message,reason,remedies`. No addresses or names.
- Client target `requestAccessTarget` (`packages/client/src/lib/pairing/request-access-target.ts`).
- Follow-up `retire-trusted-networks-bypass`. See change: add-request-access-remedy.
- No response carries a stored value.
- Routes: `GET /api/vault`, `GET /api/vault/projects` (`{open, recent}`), `POST|PUT|DELETE /api/vault/accounts[/:id[/value]]`, `POST|PUT|DELETE /api/vault/bindings[/:name[/default]]`, `POST|DELETE /api/vault/grants|confirmations`, `PUT|DELETE /api/vault/plugin-approvals/:pluginId/:bindingName`, `GET /api/vault/import/candidates`, `POST /api/vault/import/propose|confirm`.
- Unknown `/api/*` → JSON 404 `not_found`. Path truncated 200 chars.
- Source: `packages/server/src/vault/vault-routes.ts`.

## 11. Rollback
1. `vault.deliveryEnabled=false` in `config.json` (withdraws).
2. Delete `vault.json` if needed.
3. Downgraded dashboard keeps unknown fields. Bridges withdraw on reconnect.
- No accounts before change → no behaviour change.
