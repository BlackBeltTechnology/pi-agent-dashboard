## ADDED Requirements

### Requirement: Vault accounts are listed with their provider
When the dashboard has the vault, the provider section SHALL read the vault account overview as a third source, independent of the authentication status and `providers.json` sources. Each `oauth` account, and each `key` account that backs an `llm` binding, SHALL be rendered as its own row with source `vault`, placed directly under the row of its provider id (the base provider for a clone binding's account), or on its own when that provider has no other row. A vault row SHALL show:
- the account label;
- a badge naming the kind in text ("Vault · Subscription" or "Vault · API key");
- its status in text (signed in, needs sign-in) and its expiry or last refresh outcome;
- the projects or bindings that use it, or that none do;
- a "Manage in Vault" link.

A vault row SHALL never show a token or key. When the vault source fails, is refused (403) or is absent on an older server, the section SHALL render no vault rows and SHALL NOT show an error for it; the other two sources are unaffected. The section SHALL state that pi logins and keys work in every session on this dashboard, while vault accounts reach only projects they are granted to.

#### Scenario: Second Anthropic account shown under Anthropic
- **WHEN** `auth.json` holds the `anthropic` subscription and the vault holds `anthropic` account "work", used by binding `anthropic-work` in project video-feliratozas
- **THEN** the section renders the Subscription row for `anthropic` and, under it, a vault row "work" badged "Vault · Subscription" that names `anthropic-work` and video-feliratozas
- **AND** no response or DOM text contains a token

#### Scenario: Vault refused for an observe-tier browser
- **WHEN** the vault overview answers 403 `operate_required`
- **THEN** the section renders the authentication and custom-endpoint rows only, with no vault error

### Requirement: A pi login can be linked to the vault from its row
A Subscription or Account row whose provider has no linked vault account SHALL offer a "Link to vault" action. It SHALL ask for a label, state that nothing is copied and pi keeps renewing the login, and state the identity risk when the provider exposes no account identity. Linking SHALL use the vault's link operation. A row whose login is linked SHALL show the vault label and its usage, with a link to manage it in the vault.

#### Scenario: Link from the Providers page
- **WHEN** the user chooses "Link to vault" on the `anthropic` Subscription row and confirms label "personal"
- **THEN** the vault lists account "personal" with backend `link`, the row shows "Linked to vault as personal", and `auth.json` is byte-identical to before

### Requirement: Vault-only hub is not an empty state
When no authentication or custom-endpoint row exists but vault rows do, the section SHALL NOT render the "No providers configured" empty state. It SHALL render the vault rows with a notice that pi on this dashboard has no login of its own and that only granted projects can run a model.

#### Scenario: Only vault accounts
- **WHEN** `auth.json` is empty, `providers.json` has no entries, and the vault holds `anthropic` account "work"
- **THEN** the section renders the vault row and the vault-only notice, and not the empty state

### Requirement: Provider row text meets the size floor
Provider row badges SHALL be at least 12 px, and row metadata SHALL use the secondary text colour, so that authentication, custom-endpoint and vault rows share one recipe and pass the contrast and size probes in every theme.

#### Scenario: Rows pass the probes
- **WHEN** the section renders Subscription, API key, Environment, Custom endpoint and vault rows in base dark, base light and nord dark
- **THEN** the computed-contrast probes report no contrast, size or focus failure
