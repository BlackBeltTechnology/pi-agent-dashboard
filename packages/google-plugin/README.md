# @blackbelt-technology/pi-dashboard-google-plugin

Google accounts ("Google Connect") for the pi dashboard: the one owner of Google OAuth clients, accounts,
product grants and server-side token leases. See `openspec/changes/add-google-connect/`.

**Status:** phase 1 — store, client selection, connect/consent, leases, return paths, legacy import and the
REST routes are in; the Settings UI, the Gmail delegation and the per-product agent tools follow.

## Model

- **Clients**: the built-in pi-dashboard.dev app (`BUILT_IN`, ships empty until Google verification) or any number of
  own OAuth clients (Desktop or Web) linked to email domains.
- **Accounts**: one per Google identity, bound to ONE client, ONE grant; products (Gmail, Calendar, Drive, Docs,
  Sheets, Slides, Tasks, Contacts) are turned on per account with a level.
- **Consent** always asks for the union of granted + required scopes; a reply narrower than what the account relies on
  changes nothing.
- **Return paths**: loopback / paste (Desktop client), own Web callback, or the static pi-dashboard.dev return page
  (built-in Web client; no restricted scopes).
- **Leases**: `google/lease` (hub-local lane) returns a short-lived access token; refresh tokens never leave the server.

## Operator switches

| Variable | Effect |
|---|---|
| `PI_GOOGLE_DEFAULT_CLIENTS=off` | no built-in app (new sign-ins AND refresh of built-in grants). Set it on server deployments. |
| `PI_GOOGLE_REMOTE_RETURN=off` | no return-page sign-in (new sign-ins only). |

Values `off`, `0`, `false` (case-insensitive) disable.
