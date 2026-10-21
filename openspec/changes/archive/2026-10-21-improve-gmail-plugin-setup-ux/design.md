## Context

See proposal.md (Why). Requirements: `specs/gmail-plugin/spec.md`.

Current state that shapes the approach (paths under `packages/gmail-plugin/src/` unless noted):
- `client/wizard.ts:23` `consoleLinks(projectId)` adds `?project=` for any non-empty value; `client/wizard.ts:41` `gcloudCommands(projectId)` returns a 2-element array and falls back to `<project-id>`; `isValidProjectId` (`:36`) is private. Tests pin both shapes (`client/__tests__/wizard.test.tsx`).
- `client/GmailSettings.tsx:189` seeds the project-id field from `state.client.projectId` (the uploaded JSON's id) and keeps edits in `useState` only; `:192` destructures `[cmdCreate, cmdEnable]`; `:711` holds the `consentHint` copy (`gmail-consent-hint`), asserted by `client/__tests__/panel.test.tsx:296`.
- `shared/client-json.ts:51` keeps the JSON's `project_id` only when it matches `^[a-z][a-z0-9-]{4,62}$`; otherwise it is dropped.
- Persistence: secrets live in `ctx.credentials` namespace `gmail` via `server/accounts.ts` `AccountStore` (records `client`, `acct:<sub>`). The runtime also offers plugin config: `ctx.getPluginConfig()` / `ctx.updatePluginConfig(partial)` (`packages/dashboard-plugin-runtime/src/server/server-context.ts:1131-1132`), persisted under `plugins.gmail`.
- Every `/api` route must be triaged in `packages/shared/src/route-tiers.ts` (gmail routes at `:74,217,281,393,397,398,475`, all `operate`); `packages/server/src/__tests__/mcp-manifest-completeness.test.ts` boots the server and fails an `/api` route missing there. That test also needs each route bound or denylisted in the MCP manifest; the `/api/plugins/gmail/` prefix is already denylisted (`packages/mcp-server-plugin/src/server/tools.denylist.ts:70`), so the new routes need no manifest row.
- The bridge's account row type is `AccountInfo` (`shared/protocol.ts:19`), produced by `summarize()` (`server/accounts.ts`).
- `server/accounts.ts:214` `upsertFromSignIn` spreads the previous record, so unknown fields (e.g. a future `filters`) survive, while `scopes` is overwritten by the new grant.
- `server/routes.ts:63` `startSignIn(reply, tier, expect?)`; `persist` (`:107`) checks only `scopesCoverTier`; the level route (`:179`) fast-paths when `scopesCoverTier(acct.scopes, tier)`; re-auth (`:190`) passes `acct.tier`.
- `shared/scopes.ts`: `Op` / `isOp` (`:55`) / `OP_TIER` / `OP_SCOPE` know five ops; `authScopeParam(tier)` (`:86`). `server/lease.ts:30` `LeaseErrorCode` union; bridge re-checks with `tierAllows` (`bridge/lease-client.ts:13,53`).
- Writes go through `confirmWrite` (`bridge/tools.ts:152`), blocked without UI; reads set `details.untrusted`.
- i18n: `src/i18n.ts` holds zh-CN and hu; English is the inline `t()` fallback. `errScopeMissing`, `consentHint`, `audienceHelp` exist in both catalogs and win over the English fallback.

## Goals / Non-Goals

**Goals:**
- Keep `wizard.ts` the single pure source of links and commands; validators shared by client and server.
- Add filters without changing the meaning of the three existing levels.

**Non-Goals:**
- Server-side cloud API calls to look up project names or ids.
- Remembering the new/existing project choice across reloads (derived, D2).
- Filter update (Gmail has no filter update API; delete + create covers it).
- Supporting legacy domain-scoped project ids (`example.com:proj`) in links/commands.

## Decisions

### D1 — Persist `projectId` / `ownerAccount` in plugin config `plugins.gmail`
New route `PUT /api/plugins/gmail/setup { projectId?, ownerAccount? }` (guarded, rate-limited scope; tier `operate` in `route-tiers.ts`) normalizes (trim; owner email lower-cased), validates with the shared validators, and writes via `ctx.updatePluginConfig`; empty string clears a value. It logs `[gmail] setup saved` with no values. `src/configSchema.json` (today `properties: {}`, `additionalProperties: false`) declares both keys as optional strings, so the generic `POST /api/config/plugins/gmail` route accepts the stored keys and the schema keeps describing the stored config; `ctx.updatePluginConfig` itself does not validate, and `redactPluginConfigForClient` passes undeclared keys through, so the setup route works either way. `GET /state` adds `setup` read from `ctx.getPluginConfig()`. The client saves on field blur and seeds the field from `state.setup.projectId ?? state.client.projectId`.
- Why config over the credential store: both values are non-secret; config keeps them out of the secrets file and matches how other plugins store settings. The server's `updatePluginConfig` (`packages/server/src/server.ts:4111`) merges a snapshot taken before its awaits, so two interleaved partial writes can drop a key; `PUT /setup` therefore serializes its writes through one in-process promise chain. It validates every provided key before any write (omitted keys stay untouched; with both invalid, `invalid_project_id` is returned first).
- Validators move to new `shared/setup.ts`: `normalizeProjectId` / `normalizeEmail` (trim; email lower-case), `PROJECT_ID_RE` (the existing `^[a-z][a-z0-9-]{4,28}[a-z0-9]$` from `wizard.ts:34`, now also used by `shared/client-json.ts:51` in place of its looser `{4,62}` rule, so a JSON id is either usable everywhere or absent), `classifyProjectId(v) → "ok" | "empty" | "looks_like_name" | "invalid"` (`looks_like_name` = contains an uppercase letter or whitespace after trim), `isEmail` (`^[^\s@]+@[^\s@]+\.[^\s@]+$` — `a@b` is invalid). Client and server validate, save, compare and render the normalized value.

### D2 — Project mode is derived, not stored
Step 1 radio "New project / Existing project", default `existing` when a saved `projectId` exists. Presentational only: `new` shows the create link + command; `existing` shows `gcloud projects list` + the project-list link. The Gmail-API enable link + command show in both modes.

### D3 — Links and commands from one builder (breaking internal signatures)
- `consoleLinks(projectId, owner?)` → `{ projectCreate, projectList, gmailApi|null, branding|null, audience|null, clientCreate|null }`. Project links are `null` unless `classifyProjectId === "ok"`. `projectList` = `https://console.cloud.google.com/cloud-resource-manager`. Query via `URLSearchParams` (`project`, `authuser`); `authuser` on every link when the owner is valid — URL-encoded (`%40`); the decoded value equals the email.
- `gcloudCommands(projectId, owner?)` → `{ authLogin: string|null, projectsList: string, create: string|null, enable: string|null }`. `authLogin` = `gcloud auth login <email>` only with a valid owner; `--account <email>` appended to every other non-null command. No placeholder. `authuser` goes on every non-null link, including `projectCreate` and `projectList`; those two never carry `project` (only the four project-scoped links do). The `authuser` value is the URL-encoded email, so its decoded value equals the email as the spec scenarios state.
- Call site `GmailSettings.tsx:191-192` and `wizard.test.tsx` expectations change with it; null project links render the "valid project id needed" statement.

### D4 — Mismatch / adopt on the client, after upload
`PUT /client` already returns `projectId` (`server/routes.ts:163`); it still answers `409 client_in_use` when a different client is uploaded while accounts exist (`routes.ts:158-159`), in which case no comparison happens. Before uploading, the client flushes a valid, unsaved typed id with `PUT /setup` (removes the blur/upload race; a failed flush aborts the upload with the usual save error, so the comparison never runs against a stale id; this flush `PUT` may precede a `409 client_in_use`, only the post-upload compare `PUT` is skipped then). After a successful upload it compares the reply with that id:
- JSON id absent → nothing.
- saved id absent → `PUT /setup { projectId: jsonId }` (adopt).
- both present and different → notice `gmail-project-mismatch` naming both, button "Use <jsonId>" → `PUT /setup`.
Field timing: `error` is set only on blur and cleared on the change that makes the value valid, never set while typing; links and commands derive from the current trimmed input (valid or not, no blur needed), while save and compare use the normalized value. Invalid project id: rendered through the shared `TextField` `error` prop (`packages/dashboard-plugin-runtime/src/settings-fields.tsx:58` — sets `aria-invalid`, links via `aria-describedby`) with `testIds.error = "gmail-project-error"`; the project-list link for `looks_like_name` sits in the field's hint. Mismatch: `SettingsNotice` with error severity. Both fields get a real `hint` (settings-panel forbids `hint={null}` for non-term-of-art fields; `GmailSettings.tsx:237` currently passes `null` for the project id; the owner field is new).

### D5 — Consent and publishing copy (English pinned; zh-CN/hu translated in the same change)
Catalog entries override the English fallback (`src/i18n.ts:16,19,49` zh-CN, `:111,115,157` hu), so every rewritten key is rewritten in both catalogs too; codes and `errorStep` unchanged.
- `errScopeMissing`: "Google did not grant the Gmail permission. Google asks for it either as a checkbox you must tick, or on a second screen (\"wants additional access\") you must accept — finishing after the first screen only signs you in. Remove this app's access at myaccount.google.com/connections, then add the account again."
- `consentHint`: "Google asks for the Gmail permission either as a checkbox (tick it) or on a second screen saying the app \"wants additional access\" (accept it). Stopping after the first screen only signs you in."
- `audienceHelp` appends: "Publishing the app removes the 7-day token expiry. An unverified app shows Google's warning and admits at most 100 users. Accounts added while in Testing need one re-auth after publishing."
- New keys (all need zh-CN + hu): project mode labels, project-id/owner hints, `errProjectLooksLikeName`, `errProjectInvalid`, `errOwnerInvalid`, `needValidProjectId`, `authLoginNote`, mismatch notice + button, filters toggle label/help, filters-disabled/invalid-filter/forward-refused tool messages.

### D6 — Filters as an orthogonal per-account flag
- `AccountRecord.filters?: boolean` (absent = off); `AccountSummary.filters`.
- `scopes.ts`: `SCOPE.settingsBasic`; ops `filters_read` (min `readonly`), `filters_write` (min `send`) added to `Op`, `isOp`, `OP_TIER`, `OP_SCOPE` (both → `settingsBasic`, no implication from `modify`); `scopesCoverFilters(granted)`; `authScopeParam(tier, opts?: { filters?: boolean })`.
- `startSignIn(reply, tier, expect?, opts?: { filters?: boolean })` passes `filters` to `createGoogleLoginFlow` and `persist`. In `server/google-oauth.ts`, `GoogleLoginOptions` gains `filters?: boolean` and the authorization-URL builder (`:102`, `q.set("scope", authScopeParam(p.tier))`) becomes `authScopeParam(p.tier, { filters: p.filters })`. `persist` requires `scopesCoverTier && (!filters || scopesCoverFilters)` else `scope_missing`, and upserts with `filters` set explicitly. Because `persist` throws before `upsertFromSignIn`, a partial grant leaves the stored record untouched.
- Every sign-in call site passes the account's flag: level route uses `opts.filters = acct.filters`, and its fast path becomes `status === "ok" && scopesCoverTier(...) && (!acct.filters || scopesCoverFilters(acct.scopes))`; re-auth passes `acct.filters`; add-account passes nothing (off).
- Route `POST /accounts/:sub/filters { enabled: boolean }`: `false` → `store.setFilters(sub, false)` immediately; `true` → immediate when status ok and the grant already covers tier + filters, else `startSignIn(tier, expect, { filters: true })`.
- Lease (`server/lease.ts`): for `filters_*` ops, refuse with new code `filters_disabled` (added to `LeaseErrorCode`) unless `acct.filters === true`, checked before tier and scope.
- Bridge defence-in-depth: `AccountSummary` (`server/accounts.ts`) and `AccountInfo` (`shared/protocol.ts:19`) gain `filters?: boolean`, emitted by `summarize()`; filter tools resolve the account summary first and refuse `filters_disabled` / `tier_denied` BEFORE `confirmWrite`, so the user is never asked to confirm a write that will be refused. The lease stays authoritative.
- `upsertFromSignIn` input gains `filters?: boolean`: when defined it is written; when undefined the previous value is kept (an Add-account sign-in of an existing `sub` never changes the flag).
- Level route (`routes.ts:179`): a LOWER tier applies immediately via `setTier` regardless of status or filters (fixes the baseline gap where a `reauth_required` account had to re-consent to lower; safe because the lease refuses every op while `reauth_required`). A raise applies immediately only when `status === "ok"` and the stored grant covers the new tier (and filters when on); otherwise it re-consents with `filters = acct.filters`. Lowering never requests the filter scope.
- New codes and copy: `filters_disabled` (lease + bridge pre-check), `invalid_filter`, `forward_refused` (bridge). Each tool error carries a one-sentence message: enable filters for the account in Gmail settings / which field is not allowed / forwarding filters are not supported.
- Lease refusal precedence (all `filters_*` ops): `filters_disabled` → `tier_denied` → `scope_missing` → `reauth_required` (the existing tier → scope → status order with `filters_disabled` first). A filters-on account whose grant lacks `gmail.settings.basic` (e.g. re-added through "Add account", which keeps the flag) is refused `scope_missing` on the next filter use and the panel shows the permission-not-granted guidance.
- Why not a fourth tier: `readonly` accounts may list filters; `send` accounts must not gain filter power by default.

### D7 — Three filter tools, matching the guard declarations
The guard registry declares tools by name as `untrusted` (`READ_TOOLS`) or `selfConfirming` (`WRITE_TOOLS`, `bridge/tools.ts:24`, pushed in `bridge/index.ts:24-25`). A mixed read/write tool cannot be declared correctly, so:
- `gmail_filters_list { account }` → `READ_TOOLS`; `details.untrusted = true`. Order: require explicit `account` → account-summary pre-check (`filters_disabled`) → `filters_read` lease → `GET users/me/settings/filters`.
- `gmail_filter_create { account, criteria, filterAction }` and `gmail_filter_delete { account, id }` → `WRITE_TOOLS`.
- Validation (create), fail-closed before summary check, lease or confirm: `criteria` keys ⊆ {`from`,`to`,`subject`,`query`,`negatedQuery`,`hasAttachment`}; `filterAction` keys ⊆ {`addLabelIds`,`removeLabelIds`} (string arrays); ≥1 criterion with a value non-empty after trim and ≠ `*` (`hasAttachment` counts only when `true`); ≥1 label id across actions; `addLabelIds` must not contain `TRASH`/`SPAM`. Any `forward` key → `forward_refused`; anything else → `invalid_filter`.
- Order for both writes: validate input → account-summary pre-check (`filters_disabled`, `tier_denied`) → no-UI `blocked` check → (delete only) GET the filter with a `filters_read` lease → `confirmWrite` → `filters_write` lease → REST call. Nothing reaches Google before the pre-checks pass.
- Create confirm lists account, criteria, actions, "applies to all future matching mail"; delete confirm shows the fetched criteria/actions. REST (new `GmailApi` methods, none exist today): create `POST users/me/settings/filters` with body `{ criteria, action }` where the tool's `filterAction` maps to the API's `action`; delete `GET` then `DELETE users/me/settings/filters/{id}`; list `GET users/me/settings/filters`. The pre-confirm `GET` is a read (it takes a `filters_read` lease); the "nothing reaches Google" guarantee covers writes and every call before the pre-checks pass.

### Assumptions (verify during implementation)
- Gmail filter create/delete/list accept `gmail.settings.basic` and are not covered by `gmail.modify` (Gmail API reference, `users.settings.filters`).
- Forwarding addresses require `gmail.settings.sharing`, never requested here.
- The console honours `authuser=<email>`; failure degrades to today's behaviour.

## Risks / Trade-offs

- [`gmail.settings.basic` is a restricted scope; new consent warnings] → opt-in, off by default; settings text says why it is requested.
- [Filter forwarding as exfiltration] → fail-closed allowlist; no forward field reachable; `settings.sharing` never requested.
- [One confirm creates a standing rule] → confirm text states it applies to all future matching mail with exact criteria/labels; blank/`*` criteria and `TRASH`/`SPAM` additions refused. A broad but non-trivial query (e.g. `in:anywhere`) can still pass — the confirmation is the last line, accepted.
- [Legacy domain-scoped ids / ids rejected by the tightened rule] → treated as absent: no adopt, no mismatch; the summary falls back to the client id. Tightening `client-json.ts` changes nothing for valid GCP ids (6–30 chars, Google's documented format).
- [Re-auth with filters on now asks for an extra scope] → intended; a partial grant leaves the account as it was.
- [`updatePluginConfig` broadcasts `plugin_config_update` to every subscribed browser (dashboard-plugin-loader "Reactive plugin config broadcast")] → project id and owner email reach all dashboard tabs; both are non-secret operator settings already shown in the panel. The client may also read them through `usePluginConfig`, but `GET /state` stays the panel's source so one fetch carries client + accounts + setup.

## Migration Plan

Additive: optional `plugins.gmail.{projectId,ownerAccount}` config, optional `filters` account field, two routes, three tools, two ops. No data migration. Rollback = revert; old code ignores the config keys and `filters` (`asAccount` checks only required fields), and a `settings.basic` grant is harmless. Rebuild: extension → `npm run reload`; server/shared → `/api/restart`; client → `npm run build` + restart.
