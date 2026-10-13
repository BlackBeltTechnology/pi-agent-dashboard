## Why

PR #882 (`add-credential-vault`) shipped the Settings ▸ Vault page and the session Vault chip without a mockup or a contract check. On 2026-10-13 the page showed "Couldn't load the vault: HTTP 200". The running server predated the vault, so the SPA fallback answered `GET /api/vault` with `index.html`, and `vault-api.ts` swallowed the parse failure. Once the page loads, the user still can't see which projects get a key. Granting needs typed repository keys, device ids and absolute paths. Destructive actions take one click and silently remove grants and approvals. The chip shows states as 10–11 px colour-only text. Two in-flight vault changes (`add-vault-llm-delivery`, `absorb-service-secrets-into-vault`) are about to add more accounts and subjects to this page.

## What Changes

- Mockup: `mockups/vault.html` (27 states, 5 surfaces, as-built vs proposed), approved 2026-10-13 with all decisions D1–D10. D2 takes option B (remembered projects). Measured: the as-built replica has 39 size failures across three themes; the proposed version has 0 contrast, size and focus failures (`mockups/audit.md`). This change uses the method from `retro-ux-identity-connectivity` design D1–D4.
- **Page structure (D1, D9).** Settings ▸ Vault gets tabs Variables / Accounts / Import (component state; not written to the URL). Variables shows one card per env binding: its default account, the projects granted it (each with a status pill, the account it uses, and the confirmed checkouts of a repository grant), "Grant to a project", and the plugin approvals for that name. A plugin that declares a name with no variable gets a "Create <NAME>" prompt. Status pills with icon and text replace colour-only text.
- **Project picker (D2-B).** "Grant to a project" offers projects with connected sessions on this dashboard plus projects the hub has seen before. Sessions on untrusted devices are listed but disabled, with their reason. Manual repository / folder entry stays as a fallback. The hub records each resolved project key in a new bounded file `~/.pi/dashboard/vault-projects.json` (no values, never `vault.json`) and serves both lists from `GET /api/vault/projects` (operate).
- **Combined creation (D3).** Adding a key offers to create the variable `<PROVIDER>_API_KEY` with that key as default, or, if the variable exists, to make the key its default (off by default). Import can create a same-name variable for each new key. These are sequential client calls with no API change, and a partial failure is reported as such.
- **Grant from the session (D4).** The Vault chip dialog lists variables not granted to the session's project, with a Grant action, for callers with vault-manage authority. The chip is shown when the session holds a binding or such a caller has one to offer.
- **Checkout confirmation (D5).** A warning callout states the trust decision (any clone can claim an origin) and offers a primary "Confirm and deliver N keys" action.
- **Destructive actions (D6).** Delete variable and Revoke account take two steps and list their impact first: affected projects, plugin approvals, no fallback to the default, and running processes keeping old values.
- **Errors (D7).** `vault-api.ts` routes through `fetchJsonResponse` (`client-api-response-validation`). A successful but non-JSON reply shows "This dashboard server doesn't have the vault yet… Restart server"; transport and network failures name their cause. The 403 `operate_required` explanation belongs to the in-flight `surface-operate-required-remedy` change; this change adds no 403 copy, and the board's `page-load-error` proposed state is superseded. The server's not-found handlers (dev, production, no build) answer any unmatched `/api/*` request, raw or percent-decoded once, with a JSON 404 instead of `index.html` (in `--dev` such a request is not forwarded to Vite, whose proxy would send it back).
- **States (D8).** A three-step first-run guide, a loading skeleton, a corrupt-file callout that disables writes, and inline field validation (reserved name, value shorter than 8 characters).
- **Vault authority (D11).** Every vault route, including the new ones, requires `operate` authority for every caller kind, bringing the code in line with the base `credential-vault` requirement. Today an observe-tier login session on a trusted network, or any identity principal, can manage the vault: `canManageVault` returns true for `session` and `principal` callers at any tier. Device and local-trust handling is unchanged.
- **Room for later kinds (D10).** The Accounts tab reserves "Sign-in accounts" (`add-vault-llm-delivery`) and "Services" (`absorb-service-secrets-into-vault`) sections with the same row recipe. `add-vault-llm-delivery` gets a Mockup line and a task to design its OAuth, link, pool and failover states on this board before its task 7.6.
- Protected: routes and the Settings nav label "Vault"; every `data-testid` a unit or E2E test references, kept on the element with the same meaning (`vault-section`, `vault-error`, `vault-corrupt`, `vault-grants-list`, `vault-grant-no-account`, `vault-account-*`, `vault-binding-*`, `vault-grant-row` + `data-state`, `vault-confirmation-row`, `vault-plugin-*`, `vault-plugin-approve`, `vault-import-*`, `vault-chip` + `data-pending`, `vault-bindings-dialog`, `vault-binding-row` + `data-state`, `vault-binding-state`, `vault-confirm`, `vault-last-contact`, `vault-revoked-note`, `vault-pending-copy`). The unreferenced `vault-panel-grants`, `vault-panel-confirmations` and `vault-panel-plugins` are retired (design D1). Existing i18n keys keep their meaning, and new copy gets new keys. No stored value appears anywhere (unchanged rule).

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `credential-vault`: ADDED requirements for the vault management page (structure, project picker and remembered projects, combined creation, two-step destructive actions, load-failure and form states); MODIFIED "Values never leave the hub through management surfaces" so a listing may also expose remembered projects (device id, directory, repository key, last seen).
- `credential-delivery`: MODIFIED "Delivery is observable without exposing values". Each state is explained and not shown by colour alone; a pending confirmation is a primary action with trust copy; operators can grant ungranted variables from the session view.
- `url-routing`: MODIFIED "SPA fallback on server". An unmatched `/api/*` request gets a JSON 404, never `index.html`, in production and dev mode.

## Impact

- Client: `packages/client/src/components/settings/vault/*.tsx` (restructure; `VaultBindingsPanel.tsx` split into variable cards plus a picker), `components/session/VaultBindingsChip.tsx`, `lib/vault/vault-api.ts` (`fetchJsonResponse`, `code`, `fetchVaultProjects`), i18n keys in en, zh-CN and hu plus `src/lib/i18n-en-source.json` (`ui-i18n-coverage`), including the existing `vault.*` keys, which no catalogue holds today.
- QA: `qa/tests/20-tunnel-readiness-perf.sh` comment and diagnostic (it explains unknown `/api` paths as `200 text/html`).
- Server: `packages/server/src/vault/vault-projects.ts` (new: bounded seen-projects store), `vault-delivery-hub.ts` (records the resolved project; lists open-session projects), `vault-routes.ts` (`GET /api/vault/projects`; `ungranted` names on `GET /api/session/:id/vault-bindings` for manage callers; `canManageVault` tightened per D11), `server.ts` not-found handlers, `packages/shared/src/route-tiers.ts` (new route, operate).
- Migration: none. `vault-projects.json` is created on the first recorded project and fills from live syncs, so it starts empty after the upgrade. `vault.json` is untouched.
- Compatibility: a login session below `operate`, or a non-operator identity principal, loses vault access (D11); the base spec never allowed it. An older client works against the new server (the new fields are additive). A newer client against an older server gets "server doesn't have the vault yet" (D7) or no remembered list. In that case `GET /api/vault/projects` comes back as HTML (mapped to `server_outdated`) or 404, the picker says the server can't list projects and opens manual entry, and the chip omits the ungranted section. Callers that depend on `/api/*` returning HTML: one QA script's comment and diagnostic, updated by task 2.6 (search recorded in design D7; `dashboard-mcp-server` already requires `/mcp` to not be SPA HTML).
- Overlap: `surface-operate-required-remedy` edits the same `vault-api.ts` (`code`, `remedies`) and `VaultSection.tsx` (403 callout). That change owns the 403 path; whichever lands second rebases onto the other's `code` field.
- Rollback: revert. `vault-projects.json` is then ignored and can be deleted; it holds no secret.

## Non-goals

- Changing vault semantics: grants, confirmations, delivery, the trust gate and redaction stay as they are.
- Remote delivery (still `transport-insecure`; a separate follow-up).
- Designing the OAuth / LLM binding UI itself: it is owned by `add-vault-llm-delivery` and designed on this board through its new task.
- A "forget project" control (not approved). Remembered entries expire by age instead.

## Discipline Skills

- `security-hardening`: D11 tightens vault authority for session and principal callers. The new route and the `ungranted` names expose project paths and binding names behind that authority, and the store holds no values.
- `doubt-driven-review`: before folding, on the `/api/*` not-found change, which applies to every route on the server, and on the D2-B persisted list.
- `review-code`: before commit, because many client components are restructured.
- `observability-instrumentation`: triggered by the new endpoint, applied minimally. `GET /api/vault/projects` reuses the vault routes' error logging (`[vault] route error: <name>`), and the record path logs `[vault] project record failed: <error name>` without paths. There are no new metrics; there is no external call or job.
