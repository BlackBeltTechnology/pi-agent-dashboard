# Credential vault

Part 1 of 3. Static `key` accounts, env delivery to sessions. LLM creds/OAuth (change 2) and service secrets (change 3) ship separately.

See change: add-credential-vault. See change: retro-ux-credential-vault (§2, §10).

## 1. What it is

- Hub-owned store: `~/.pi/dashboard/vault.json`. Mode `0600` (POSIX). Encrypted at rest (§12). Atomic, locked (`locked-json-file`, `createIfMissing: false`).
- Entries: accounts, kind `key`. Several per provider allowed.
- Min value length: 8 chars. Enforced on entry and import.
- Env bindings: name → default `key` account. Names validated (see §3, deny list).
- Per-project grants: default deny. Grant picks binding + optional account override.
- Checkout confirmation per (device, dir, repoKey).
- Unknown fields and unknown kinds preserved on write (downgrade-safe).
- Corrupt file: byte-exact backup kept, all writes refused. Error shows backup path only, never `JSON.parse` text.
- Locked file (envelope, no usable data key, or damaged envelope): nothing overwritten. Writes → `vault_locked` 409 with `reason` + remedy (§12).

## 2. Settings → Vault page

Path: Settings → Network group → Vault (`SettingsPanel` page `vault`, `VaultSection`).

### Tabs

- APG tablist: `Variables`, `Accounts`, `Import`. Automatic activation. Arrow keys. `aria-controls`.
- Default tab: Variables. Active tab = component state. Not in URL.
- All three tabpanels stay mounted. Inactive → `hidden`.
- Panel testids: `vault-panel-bindings`, `vault-panel-accounts`, `vault-panel-import`.
- Loading: skeleton, `aria-busy`.
- First run (no accounts, no bindings): three-step guide replaces tab content. Primary: Import when candidates exist, else `Add a key`.
- Corrupt: error callout, backup path only. Locked: error callout with `reason` + remedy. Write controls `disabled`, not hidden.

### Variables tab

- One `VaultVariableCard` per env binding. Wrapper `vault-bindings-list`. Card `vault-binding-<NAME>`.
- Default-account select. Change shows impact before save: `Used by N projects that don't pick their own account`.
- Grant rows `vault-grant-row`: `data-state` = server state (`ok` | `no-account`). `data-status` = page status (table below).
- Row subjects: repository key; folder (device, path); other (`service:<id>`): `Not delivered to sessions` pill, no delivery status.
- Revoked override → `no-account`. Never falls back to binding default.
- `Grant to a project` → picker (below).
- Plugin declarations of this name: checkbox switch `vault-plugin-approve`, row `vault-plugin-<pluginId>-<NAME>`.
- Declaration with no binding: request row above cards, `Create <NAME>` action.
- Confirmed checkouts: `<details>`, collapsed, under their repo grant. Confirmations with no matching grant: `Other confirmed checkouts` at tab end. Revoke in both.

Page status (`data-status`):

| Status | Pill | Meaning |
|---|---|---|
| `delivering` | success | grant `ok`, account resolved; folder grant, or repo grant with ≥1 confirmed checkout |
| `pending` | warning | repo grant, no confirmed checkout |
| `no-default` | warning | no override, binding has no default |
| `no-account` | error | override account missing |

### Destructive actions (two-step)

- `Delete variable`, `Revoke account`: re-fetch overview first. Then inline `role="alertdialog"` (`vault-confirm-impact`) built from fresh data.
- Delete variable impact: projects whose grants are removed; plugin approvals removed; connected sessions lose it within seconds; running processes keep old value.
- Revoke account impact: bindings losing default; grants whose override → `no-account` (no fallback); plugin approvals reading that default (read nothing); running-process note.
- Re-fetch fails: error shown, confirm disabled. Cancel and Retry remain.
- Confirm = danger button. Cancel takes focus. Esc cancels, focus returns to trigger.
- `Rotate`: running-process note inline. No dialog.
- Impact list is preview. Server applies state as it stands at confirm.
- Timing: hub pushes within 150 ms of store change (`credential-delivery` 5 s budget).

### Accounts tab

- Groups: keys first. `Sign-in accounts` (oauth) and `Services` (`service:*`) only when present. Other kinds: count line (`vault-accounts-other`).
- Add, rotate, revoke. Value never shown after save.
- Client checks before call: reserved or invalid name; value < 8 chars. Inline `aria-invalid` + `aria-describedby`. Server errors render in originating form.
- Add key proposes `<PROVIDER>_API_KEY` (provider upper-cased, each char outside `[A-Z0-9]` → `_`). Offered only when valid and not reserved (`isDeliverableEnvName`).
  - No binding of that name → `Create the variable X` (checked by default) → `createBinding`.
  - Binding exists → `Make it the default of X` (unchecked). Offered only when current default missing or same provider → `setBindingDefault`.
- Partial failure: account kept. `Key saved; the variable wasn't created: <reason>` + Retry. Retry finding binding already defaulting to this account = success.

### Import tab

- Known locations: fixed server-side list. Existence check only. Opaque ids; client never sends path.
- Upload: ≤ 64 KiB.
- Proposal: names only. Values never returned.
- Values < 8 chars skipped with notice.
- Each name confirmed (`import/confirm`). Names passing `isDeliverableEnvName` may get a binding. Others listed with reason.
- Done callout: created variables and failures. Sources never modified.

### Project picker

```mermaid
flowchart LR
  H[Delivery hub<br/>connected sessions] -->|open| API[GET /api/vault/projects]
  F[(vault-projects.json)] -->|recent| API
  API --> PK[Picker radio group]
  M[Manual entry] --> PK
  PK -->|repo| G1[createGrant repo:key]
  PK -->|folder| G2[createGrant dir:deviceId:dir]
```

- Radio group. Options hold no interactive content. Search: name, repo key, path.
- `open`: connected sessions grouped by `(deviceId, dir)`. Untrusted or `transport-insecure` sessions: `blocked: <outcome>`, listed by cwd, never grantable, no repo key shown.
- `recent`: remembered projects, minus keys in `open`, newest first.
- Disabled options: already granted to this binding (subject match); blocked. Reason shown.
- Repo choice: note that delivery waits for checkout confirmation.
- `Not listed?` → manual repo or folder entry. Repo normalised by `normalizeOrigin` (`packages/shared/src/vault-project-key.ts`) before compare and grant.
- Already-granted subject: picker says so, sends no second grant (upsert without account would drop override).
- Older server (2xx HTML, or `404` `not_found`): lists hidden, manual entry opens.

Remembered projects file `~/.pi/dashboard/vault-projects.json`:

- Mode `0600`. Written through `locked-json-file`. Reads never create it. First valid record creates it.
- Entry `{ deviceId, dir, repoKey?, lastSeenAt }`. No values, no binding names.
- Bounds: 200 total; 100 per `deviceId`; 90 days (enforced on write and read). Least recently seen evicted first.
- Caps: `dir` 4096 chars, `repoKey` 512 chars. Longer → not recorded.
- Recorded from `deliver()` for trusted sessions. Fire-and-forget; never blocks delivery.
- Write throttle: in-memory map, ≤ 1 write per key per hour. Restart empties map.
- Corrupt: byte copy kept (`readJsonChecked`). `list()` returns empty. Next record replaces file.
- No per-entry delete. Deleting the file clears the list.
- Trade-off: list names projects never granted. A trusted session can plant an entry. Repo grant still needs checkout confirmation.

### Session dialog grant (chip)

- `GET /api/session/:id/vault-bindings` adds `ungranted: string[]` for manage callers only. `[]` when session has no resolved project (untrusted, `transport-insecure`, `no-project`, corrupt vault).
- Chip renders when bindings or ungranted names exist.
- Section `vault-ungranted`, rows `vault-ungranted-row`, Grant button `vault-grant-from-session`.
- Grant subject: `repo:<repoKey>` when session has repo key, else `dir:<deviceId>:<dir>`.
- Project line `vault-project-line`: resolved project, else outcome reason.
- Repo grant → `pending-confirmation` on next poll (≤ 2.5 s). Confirm callout appears in same dialog.
- Confirm callout: repo key, dir, device. Says any clone can claim an origin. Button `vault-confirm`: `Confirm and deliver N keys`. Applies to every session in checkout.
- Chip shows `Vault: confirm` (clock icon, `data-pending="true"`) while pending.

Chip states:

| State | Pill |
|---|---|
| `delivered` | success |
| `pending-confirmation`, `revoked`, `hub-unreachable`, `vault-unavailable` | warning |
| `no-account`, `blocked-name` | error |
| `local-override`, `inherited` | neutral |
| any other | neutral, label as explanation |

- Each row: one-line explanation from `vault.stateHelp.<state>`. `data-state` = machine hook.

## 3. Grants and project key

- Subject: repo key = normalised `origin`. Fallback: dir key = (deviceId, realpath cwd). Dir key matches exact dir only.
- Normalise: strip scheme and userinfo. scp `git@host:path` and `ssh://` → `host/path`. Drop default port (22 ssh, 443 https, 80 http). Keep other ports. Lower-case host, keep path case. Strip trailing `/`, then `.git`.
- `file://` and local-path origins: no repo key. Dir key used.
- Git failure: dir key used.
- Per-project account override. Revoked override → `no-account`. Never falls back to binding default (widening).
- Grants scope, not security boundary. Any process in a confirmed checkout gets granted values.
- Env name rule: `^[A-Z_][A-Z0-9_]*$`, case-insensitive. Checked at creation and at delivery.
- Deny exact: `PATH PATHEXT HOME USERPROFILE SHELL COMSPEC SYSTEMROOT PS4 SSH_AUTH_SOCK SSH_ASKPASS LOCPATH GCONV_PATH JAVA_TOOL_OPTIONS _JAVA_OPTIONS JDK_JAVA_OPTIONS CLASSPATH DOTNET_STARTUP_HOOKS LESSOPEN LESSCLOSE OPENSSL_CONF ENV BASH_ENV BASHOPTS SHELLOPTS PROMPT_COMMAND IFS CDPATH ZDOTDIR TMPDIR EDITOR VISUAL PAGER HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY SSL_CERT_FILE SSL_CERT_DIR CURL_CA_BUNDLE REQUESTS_CA_BUNDLE`.
- Deny prefix: `LD_ DYLD_ NODE_ NPM_CONFIG_ PI_ PYTHON PERL RUBY GIT_ BASH_FUNC_ ELECTRON_ CONTEXT_MODE_ XDG_`. `PYTHON`/`PERL`/`RUBY` over-block on purpose.
- Source: `packages/shared/src/vault-delivery.ts`, `packages/shared/src/vault-project-key.ts`.

## 4. Checkout confirmation

- `origin` lives in checkout `.git/config`. Clone can claim any origin.
- Repo grant honoured only where (device, dir, repoKey) confirmed.
- Confirm via session Vault chip: "Deliver `<NAME>` to `<repo>` at `<dir>` on `<device>`?"
- Re-pointed `origin` → new repoKey → new confirmation.
- Unconfirmed checkout: nothing delivered. Session shows `pending-confirmation`.
- Spoofed `origin` gets nothing.
- Accepted residual: confirmed checkout whose contents are replaced under same origin. Hub cannot verify `origin`.

## 5. Delivery

```mermaid
sequenceDiagram
  participant H as Hub (vault.json)
  participant B as Bridge (session)
  participant E as process.env
  B->>H: vault sync (connect, every session_start reason): cwd, origin, tracked names
  H-->>B: vault_snapshot (complete granted set)
  B->>E: set new names unless local-override
  B->>E: update / remove tracked names only where hash still matches
  H-->>B: vault_snapshot push, debounced 150 ms (on vault write or config change)
  B->>E: same hash-checked apply
```

- Bridge sets `process.env`. Visible from next shell command. No files written on session machine.
- Full snapshot on every connect and every `session_start` reason. Pushes debounced 150 ms (`pushDelayMs` default, `packages/server/src/vault/vault-delivery-hub.ts`), well inside 5 s budget. Snapshot = push = same message: missed push reconciled by next sync.
- Tracked set: name → SHA-256 of delivered value. Rotate/revoke touches a name only while value still matches. User-overwritten name dropped from tracking, left alone.
- Local override: name present before delivery, not tracked, not inherited → skipped, outcome `local-override`.
- Running processes keep old env copy. Only new processes see rotation/revocation.
- Nested pi: delivery sets `PI_DASHBOARD_VAULT_DELIVERED` (comma list of names, no values, no hashes). Nested bridge masks listed names as `inherited`. Never updates, never removes, never reports `local-override`. Inherited copies live as long as the child process.
- Outcomes (`VaultDeliveryOutcome`): `delivered`, `disabled`, `untrusted`, `transport-insecure`, `no-project`, `vault-unavailable`. Plus per-binding `delivered` / `local-override` / `inherited` / `no-account` / `blocked-name` / `pending-confirmation` / `revoked`.
- Project change, unreadable cwd (`ctx.sessionManager.getCwd()`), or any withdrawal reason → withdraw all delivered.
- Registry: `process` (survives jiti cache, extension reload). Holds tracked set and redaction set.

### Trust gate

- Hub observes proof itself. `decideVaultTrust` reads per-session channel record bound at register. Proxy-asserted headers (`X-Forwarded-Proto`) are never evidence.
- Hub-local (device id `hub`) needs local admission: unix socket, local credential proof, or in-process connection.
- Loopback address alone no longer qualifies (legacy token, tokenless grace, deviceless/device ticket). L4 forwarder looks identical. Cause `local-unproven`.
- Remote paired device gets delivery only when ALL hold:
  - upgrade arrived on hub's own TLS socket, no forwarding header (proven TLS, `isProvenTls`).
  - ticket minted same way.
  - device active (not revoked, held, expired).
  - bearer never seen off a proven channel (exposure record `plaintextSeenAt`).
  - bridge declares `certValidation: "enforced"`.
  - `tls.enabled && tls.acceptBridges` live-true.
- Proven channel = proven TLS, or valid local credential proof.
- Bridges reach TLS listener at `/ws/bridge` only when `tls.acceptBridges` on (Gateway → Built-in HTTPS → Accept bridges). Default off. Ticket-only auth. Ticket-admitted connection always attributed to its device.
- Refusal order: config switch → trust → vault health → project.

#### Refusal causes (`trustDetail`)

Session vault chip, token-issue dialog, server log show cause + fix.

| `trustDetail` | Outcome | Fix |
|---|---|---|
| `unattributed` | `untrusted` | Connect as paired device: `PI_DASHBOARD_TOKEN`, tier `operate` |
| `local-unproven` | `untrusted` | Update pi-dashboard on hub machine. Bridge must use local socket or local proof |
| `device-inactive` | `untrusted` | Device revoked, held or expired. Pair again |
| `plain-transport` | `transport-insecure` | Enable Built-in HTTPS + Accept bridges. `PI_DASHBOARD_URL=wss://<name>:<tlsPort>` |
| `bearer-exposed` | `transport-insecure` | Token used without TLS. Issue new token from dashboard opened over HTTPS. Connect only over `wss` |
| `history-unknown` | `transport-insecure` | Token predates TLS tracking. Issue new token as above |
| `ticket-plain` | `transport-insecure` | Use `wss://` endpoint + `https://` `PI_DASHBOARD_HTTP_URL` |
| `bridge-outdated` | `transport-insecure` | Update pi-dashboard on device. Bridge lacks `certValidation: "enforced"` |

- Decision order: `unattributed` → `local-unproven` → `device-inactive` → `plain-transport` → `bearer-exposed` → `history-unknown` → `ticket-plain` → `bridge-outdated` → allow.
- Outcome enum unchanged. `detail` optional, added.
- Log: `[vault] trust session=<id> device=<prefix> outcome=<o> detail=<d>`. One line per change of outcome/detail, never per sync. No value, no bearer.
- `/api/health` → `pairing.exposureWritePending: true` = exposure record write failed. Refuses ALL remote delivery (`bearer-exposed` marked device, `history-unknown` rest). Logged at error level.

#### Deactivation withdraws

- Registry `onChange` → `vaultDelivery.schedulePush()` (150 ms debounce). Affected sessions get `denied`. Bridge withdraws delivered values.
- Revoke, hold, exposure → withdraw ≤ 5 s (~150 ms).
- Expiry → withdraw ≤ 60 s. 30 s sweep pushes only when device left active set.
- Accept bridges off (or `tls.enabled` off) → TLS-admitted bridge sockets closed, `denied` pushed.

#### Non-goals

- Proxy-terminated TLS (zrok, cloudflared, Tailscale Serve, anything adding a forwarding header) stays `plain-transport`.
- TLS on `piPort` (`:9999`) listener. Not added.
- Paired devices before this change read `history-unknown`. Need new token.

See change: prove-vault-bridge-tls.

## 6. Offline grace, downgrade, emergency off

- `vault.offlineGraceHours` in `~/.pi/dashboard/config.json`. Default 24. Clamped 1–168 on hub and bridge.
- Elapsed = max(monotonic, wall-clock) since last successful snapshot. Sleep cannot extend retention.
- Grace expired → bridge withdraws delivered values.
- Hub advertises `vault-delivery` in `dashboard_identity.features`. Bridge holding values connects to hub without feature → withdraw all.
- Hub vault corrupt or locked → answers `vault-unavailable`, not empty snapshot. Bridge treats as unreachable (keeps values within grace).
- Emergency off: `vault.deliveryEnabled=false` in `config.json`. Checked first. Works while `vault.json` corrupt. Pushes withdrawal to all sessions. Default `true`.

## 7. Redaction

Exact-match masking of delivered values → `[REDACTED:<NAME>]`. Longest match first.

Masked points:

1. `tool_result`: deep mask `content`, `details` (incl. `details.truncation.content`), `structuredContent`. Rewrites full-output file at `details.fullOutputPath`. pi applies before recording: transcript and model see masked text.
2. `message_end`: replaces text and tool-call argument strings. Keeps `role`, `usage` (token-stats). Persisted by pi.
3. `user_bash`: wraps `createLocalBashOperations`. Masks `onData` chunks with hold-back. Streaming UTF-8 decoder. Flushes masked tail on exit. Executor full-output file written from masked chunks.
4. Forwarder (dashboard copy): deep copy, mask. Covers `tool_execution_update`, `tool_execution_end` (inlined `result`), `tool_result`, message events, EventBus payloads. pi event objects never mutated.
5. Hold-back: per stream (`toolCallId`, or message id for `message_update`). Delay trailing L−1 chars (L = longest held value). Cumulative snapshots: forward masked snapshot minus tail. Deltas: bounded tail buffer only. Held tails flushed (masked) before any later event of session.
6. Reload: redaction set restored from `process` registry before output.

Residuals (stated):

- Encoded or transformed forms not masked.
- Local TUI not masked.
- Spill files hold plaintext while command runs and after crash. Mode `0600` on pinned pi 1.1.0 (`dist/utils/output-files.js`); default mode on pi 1.0.x. Aborted command rewritten at `tool_execution_end`.
- Imported source files keep their copies. Delete yourself.
- Running processes keep revoked values.
- In-process plugins and other pi extensions read values (trusted code, like `process.env`).
- Confirmed checkout replaced under same origin.
- Handler order: a foreign `user_bash` handler registered first bypasses wrapper. Forwarded copy still masked.

## 8. Plugins

- Manifest: `vaultBindings: string[]`.
- User approves each declaration in Settings. Stored as plugin approval.
- Update adding declaration → new approval for that binding. Existing approvals kept.
- `ctx.vault.read(name)` → default-account value. Server-wide, not project-scoped. Deliberate exception.
- Echoed value into session output → only session-side redaction catches it.
- Not isolation. Plugins are trusted code.
- Unchanged: `ctx.credentials`, `plugin-credentials.json`, `ctx.providerAuth`.

## 9. Import

- Known locations: fixed server-side list (skill package `.env` files, `~/.pi/agent/system-one/auth.json`). Server checks existence only. Reads only on user selection. Opaque ids; client never sends path.
- Upload: ≤ 64 KiB (`MAX_UPLOAD_BYTES`). Parsed by local mirror of nano-banana `parseEnvFile` in `packages/server/src/vault/vault-import.ts` (server must not depend on optional skill package).
- Proposal: names only. Values never returned.
- Values < 8 chars skipped with notice.
- User confirms each name (`import/confirm`).
- Sources never modified.

## 10. Routes and authority

- Management `/api/vault*` (reads and writes): every caller kind needs `operate`, any network position. `canManageVault`:
  - device bearer: `principalTier === "operate"`.
  - login session: `principalTier === "operate"`. Observe-tier session on a trusted network refused.
  - identity principal: operator or local operator, or `HostPolicy.authorize` with `HostActions.vaultManage` (`vault.manage`) on `hostResource.vault()`.
  - no credential: local trust (`hasOperateAuthority`, strict-mode aware).
- Refusal: 403 `operate_required`. `reason` = `tier-too-low` | `no-credential`. `remedies` ⊆ `use-host`, `re-pair`, `request-access`, `sign-in`. Order fixed: `use-host, re-pair, request-access, sign-in` (`OPERATE_REMEDY_ORDER`, `packages/shared/src/operate-required.ts`). Source: `packages/server/src/auth/operate-required.ts`.
- `request-access` present iff all:
  - no verified credential: `authVia` unset. Revoked bearer = none.
  - no verified local credential: token or `pi_dash_local` proof cookie.
  - knock pre-switch gates pass (`knockPeerGate`, `packages/server/src/pairing/knock-admission.ts`): Host admitted (enforce semantics), private on-link raw socket peer, no proxy-forwarding header.
- Thunk `createRequestAccessAvailable(knockPeerDeps, localTrust)` wired in `packages/server/src/server.ts`. Passed to vault + services routes as `requestAccessAvailable`.
- Never reads `pairing.acceptLanRequests` or live-knock state. Discloses only verdict `POST /api/pair/request` already returns to same caller: `host_not_admitted` | `knock_not_lan`. Sole exception to `canDiscloseAccessPosture`. `/api/health` posture stays withheld.
- Body: exactly 5 keys `success,error,message,reason,remedies`. No address, subnet, host, device or vault names.
- Reachable: credential-less callers a trusted-network entry admits. Untrusted LAN browsers get `network_not_allowed` + banner Request access instead.
- Client: Settings → Vault callout row links to refusing server `/pair?request`. Same origin → same tab. Other server → new tab, `noopener`. Target rule `requestAccessTarget` (`packages/client/src/lib/pairing/request-access-target.ts`), shared with `ConnectionStatusBanner`.
- Switch off → landing explains `knock_disabled`.
- Follow-up `retire-trusted-networks-bypass`: extends knock eligibility inside `knockPeerGate` / `knockPeerState`. Remedy follows. See change: add-request-access-remedy.
- `ungranted` follows the same predicate.
- `GET /api/session/:id/vault-bindings`: names and states only. Session-read authority.
- No response carries a stored value.
- Routes: `GET /api/vault`; `GET /api/vault/projects` (`{ open, recent }`); `POST|PUT|DELETE /api/vault/accounts[/:id[/value]]`; `POST|PUT|DELETE /api/vault/bindings[/:name[/default]]`; `POST|DELETE /api/vault/grants`; `POST|DELETE /api/vault/confirmations`; `PUT|DELETE /api/vault/plugin-approvals/:pluginId/:bindingName`; `GET /api/vault/import/candidates`; `POST /api/vault/import/propose`, `POST /api/vault/import/confirm`.
- Unknown `/api/*` → JSON 404 `{ success: false, error: "not_found", message: "No API route for <METHOD> <path>" }`. Dev, production and no-build branches.
- Decided on guard's two path views (`parseGuardTarget`: `raw`, `resolved`). Encoded or dot-segment spellings never reach `index.html`. Unparseable target → same 404.
- Path in message truncated to 200 chars.
- Network guard 403 runs first.
- `--dev`: not forwarded to Vite (Vite proxies `/api` back here; loop).
- Limit: `%2F`, `%3F`, `%23` stay encoded. `/api%2Fx` still gets `index.html`. Matches no route; exposes nothing.
- Source: `packages/server/src/vault/vault-routes.ts`.

## 11. Rollback

Before any downgrade to a pre-encryption build: stop server, run `pi-dashboard credentials decrypt`, then downgrade (§12).

1. Set `vault.deliveryEnabled=false` in `config.json` (pushes withdrawal).
2. Delete `vault.json` if needed. Affects nothing else.
3. Downgraded dashboard: keeps unknown fields. Bridges withdraw on reconnect (no `vault-delivery` feature).

Before change: no accounts → no behaviour change.

## 12. Encryption at rest

Covers `~/.pi/dashboard/vault.json` and `~/.pi/agent/plugin-credentials.json` (plugin `ctx.credentials`).
Code: `packages/shared/src/credential-encryption.ts` (ids, reason codes, remedy table), `packages/server/src/auth/credential-key.ts` (key sources), `packages/server/src/auth/credential-envelope.ts` (codec), `packages/server/src/cli/credentials-command.ts`, `packages/extension/src/credential-guard.ts`.
See change: encrypt-credentials-at-rest.

### 12.1 Envelope format

- Line 1: `pi-dashboard-encrypted:v1`.
- Line 2: one JSON line `{"alg":"A256GCM","kid":"<16 hex>","iv":"<b64 12 B>","tag":"<b64 16 B>","ct":"<b64>"}`.
- AES-256-GCM. Fresh 12-byte random IV per write.
- AAD `pi-dashboard:v1:<fileId>`. `fileId` = `plugin-credentials` | `vault`. Swapped ciphertext fails auth.
- AAD does not bind path. `HOME` moves keep working.
- `kid` = first 8 bytes of SHA-256(`pi-dashboard-kid\0` ‖ key), hex. Separates `key_mismatch` from damage. Reveals no key.
- Reader: strips one leading BOM. Accepts `\r\n` and one trailing newline. Prefix check case-sensitive.
- Any file starting `pi-dashboard-encrypted:` is an envelope. Never classified corrupt, never quarantined, never overwritten.
- Unknown version (`v2`+) → locked `unsupported_format`. Bad `v1` header/base64/lengths/`alg`/extra line → locked `envelope_damaged`.

### 12.2 Key sources

- `PI_DASHBOARD_DATA_KEY_FILE=<abs path>` set → only source. Keychain never consulted. No fallback either way.
  - File: base64 of 32 bytes, optional one trailing newline.
  - Must be owner-only (`checkOwnerOnly`, `chmod 600`).
  - Server never creates it. Create: `openssl rand -base64 32 > <file>; chmod 600 <file>`.
- Unset → OS keychain. Service `pi-dashboard-credential-key`, account `data-key-v1`.
  - macOS Keychain, Windows Credential Manager, Linux Secret Service.
  - Linux: Secret Service only. Kernel keyring never used (non-persistent, lost at reboot).
- Key created lazily. Only for plaintext migration or first credential write. Under `~/.pi/dashboard/credential-key.lock`. Never over an envelope.
- Keychain calls run in a worker thread. One 10 s deadline bounds init → `keychain_timeout`.
- Keychain failure cached per process: no retry loop, no repeat macOS prompts. Lock contention on creation not cached (that write refused only).
- Key stays in server process. Not sent to bridge, plugins, client, logs or child env.
- No plaintext opt-out flag. No keyless fallback to plaintext writes.

### 12.3 Migration

- Startup, after key ready: plaintext JSON object → encrypted in place.
- Steps: encrypt → decrypt in memory → deep-compare → `writeJsonAtomic` (temp + rename, `0600`). Mismatch aborts, plaintext kept.
- No plaintext backup kept.
- Log: `[credential-key] encrypted <basename> (migrated from plaintext)`.
- Any later write also encrypts. Existing `*.corrupt-*` siblings stay byte-exact.

### 12.4 Lock states

| `reason` | Meaning | Remedy (`CREDENTIAL_REASON_REMEDY`) |
|---|---|---|
| `keychain_unavailable` | no keychain, or binding failed to load | set `PI_DASHBOARD_DATA_KEY_FILE`, restart |
| `keychain_timeout` | keychain silent past 10 s | set `PI_DASHBOARD_DATA_KEY_FILE`, restart |
| `key_missing` | keychain entry absent | restore key, or `credentials reset`, re-enter |
| `key_file_missing` | key file absent | create owner-only file, restart |
| `key_file_invalid` | not base64 32 B, directory, or unreadable | fix file, restart |
| `key_file_insecure` | readable by other users | `chmod 600`, restart |
| `key_uninitialized` | key not loaded yet | restart server |
| `key_mismatch` | `kid` differs or tag fails | restore correct key, or `credentials reset` |
| `unsupported_format` | newer envelope version | upgrade dashboard |
| `envelope_damaged` | corrupt envelope | restore from backup, or `credentials reset` |

- Unknown future reason renders as locked, never `ok`.
- Vault, envelope + not ready: `status` → `{state:"locked", reason}`. Writes → 409 `vault_locked` (`reason`, `remedy`). `getKeyValue` → `undefined`.
- Vault, plaintext + no key: `status` → `{state:"ok", writable:false, reason}`. Read works. Writes → 409 `vault_locked`. Page disables write controls.
- Plugin store, envelope + not ready: `get`, `list`, `snapshot` and all writes reject `PluginCredentialError` `store_locked` (carries `reason`).
- Plugin store, plaintext + no key: reads work. Writes → `store_locked`.
- Locked never quarantines, never overwrites.

### 12.5 Recovery

- `pi-dashboard credentials status`: read-only. Basenames, state, `reason`, `kid`. Never creates key. Never prints values.
- `pi-dashboard credentials decrypt [--yes]`: rollback.
  - Refuses if server live: any HTTP reply on `GET /api/health` (incl. `401`), or live PID / lock metadata of this HOME.
  - Confirm or `--yes`. Holds `plugin-credentials.json` lock, then `vault.json` lock.
  - All-or-nothing: decodes every file first. Any locked/damaged file → writes nothing, exit 1.
  - Writes plaintext `0600`. Idempotent.
- `pi-dashboard credentials reset [--vault] [--plugin-credentials] [--yes]`: key loss.
  - Same server check. Same lock order. No flag = both files.
  - Locked file renamed to `<file>.undecryptable-<YYYYMMDDTHHMMSSZ>` (`-N` on collision). Kept.
  - Not-locked file (decrypts, plaintext, absent) untouched → `<basename>: not-locked`, exit 0.
  - Keychain source: creates new key only after store locks released.
  - Key-file source: never creates a key. Prints `openssl rand -base64 32 > <file>; chmod 600 <file>`, exits non-zero.
  - Then re-enter credentials: Vault page, or each plugin's settings.
- Exit codes: `0` ok, `1` refused or failed, `2` usage.

### 12.6 Downgrade

- Run `credentials decrypt` first, server stopped.
- Skipped, old vault: sees corrupt file, refuses writes. Ciphertext kept.
- Skipped, old plugin store: writes byte-exact `.corrupt-*` backup, starts fresh plaintext file. Stored credentials sit in backup.

### 12.7 Docker key volume

- Container has no keychain. Key file `/home/pi/.pi-key/data-key` on named volume `pi-key`, separate from `pi-state` (`/home/pi/.pi`).
- `docker/entrypoint.sh`, when `PI_DASHBOARD_DATA_KEY_FILE` unset: exports default path.
  - Key absent and no envelope in either file → generates 32 random bytes, base64, `umask 077`. Key never in argv.
  - Key absent and an envelope exists → does not generate. Prints restore remedy. Server starts. Files locked `key_file_missing`.
  - Preset custom path → never generated.
  - `/home/pi/.pi-key` not a mountpoint → warning (anonymous volume).
- Custom Compose or `docker run` must mount `pi-key:/home/pi/.pi-key`. Details: `docker/README.md`.
- Copy of `pi-state` alone carries no key.
- Same user runs pi sessions in same container. Key file guards copies of state, not in-container processes.

### 12.8 Agent credential guard

- `credential_guard`: always on, no switch. Best effort. Not a sandbox.
- Path tools (`read`, `edit`, `write`, `ls`, `find`, `grep`): blocked on protected paths.
  - Protected: `plugin-credentials.json`, `vault.json`, `$PI_DASHBOARD_DATA_KEY_FILE` (when set in pi env), plus siblings `<name>.*`.
  - `grep` also blocked on dir directly containing a protected file.
- Command fields, any tool: blocked on protected path, keychain service + keychain verb, `security dump-keychain`, `credentials decrypt`.
- Block result: `{ block: true, reason: "credential_guard: <tool> targets dashboard credential storage" }`.
- Log: `[credential-guard] blocked tool=<name> match=<rule-id>`. Never command text or content.
- Bypassable: relative names from other cwd, variable indirection, encoding, script written then run, keyring call from script, any process outside pi.

### 12.9 Threat model

```mermaid
flowchart LR
  subgraph same_user[Same OS user]
    srv[dashboard server] -->|getPassword| kc[(OS keychain entry)]
    agent[pi agent bash] -.->|Linux or Windows: silent read| kc
    agent -.->|macOS: silent if same signer, else prompt| kc
    agent -->|cat or read| files[(credential files: ciphertext)]
  end
  backup[backups, iCloud, dotfile sync, copied ~/.pi] --> files
```

Protects against:
- Disclosure by agent `cat`, `read`, `grep`: ciphertext only, plus guard.
- Backups, iCloud or dotfile sync, support bundles, copied `~/.pi`.
- Stolen disk image without user's keychain.

Does NOT protect against a same-user process that reads the keychain:
- Linux (Secret Service) and Windows (DPAPI): any same-user process reads the entry.
- macOS, npm arm: silent when reader is same `node` binary or same signer. Spike C16: any nodejs.org-signed `node` reads an entry created by another nodejs.org `node` with no prompt. `/usr/bin/security` and differently-signed binaries prompt.
- macOS, Electron: depends on signature (spike 1.1). Silent when ladder falls back to bundled Node.
- Key file (`PI_DASHBOARD_DATA_KEY_FILE`): owner-only stops other users, not same-user processes. Guard is best effort.
- Key loss = credentials unrecoverable without backup of key. Keep key backup separate from `pi-state`.

Real fix: agent bash sandboxing, follow-up. See `docs/research/agent-bash-sandboxing.md`.

## Code map

| Area | Path |
|---|---|
| Store, grants, routes, import, hub delivery | `packages/server/src/vault/` |
| Bridge delivery, forwarder, redaction, masker | `packages/extension/src/vault-*.ts` |
| Shared constants, env name rule, project key | `packages/shared/src/vault-delivery.ts`, `packages/shared/src/vault-project-key.ts` |
| Settings UI, session chip | `packages/client/src/components/settings/vault/`, `packages/client/src/components/session/VaultBindingsChip.tsx` |
