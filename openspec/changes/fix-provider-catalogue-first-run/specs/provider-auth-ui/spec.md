## MODIFIED Requirements

### Requirement: Catalogue-unavailable is distinguished from no-credentials

API-key rows come from a bridge catalogue pushed by a connected pi session or, when there is none, from the server's built-in runtime fallback (see `provider-auth-server` "Catalogue availability signal"). The section SHALL read `GET /api/provider-auth/catalogue-ready` and SHALL handle three states:

- **ready** (`ready: true`): no notice.
- **fallback** (`ready: false`, `fallback: true`): the api-key catalogue counts as available. The connected list and the empty state follow the normal rules: only providers that hold a credential are listed, and with none the "nothing configured" empty state renders. The section SHALL add an informational notice, scoped to the api-key portion, stating that the Add-provider picker offers pi's built-in providers and that providers added by extensions, plus environment-variable hints, appear once a pi session is running. The notice SHALL NOT use the warning severity.
- **unavailable** (`ready: false`, `fallback` false or absent): the section SHALL NOT report that nothing is configured. It SHALL render a warning notice scoped to the api-key portion of the list, stating that the API-key provider list is unavailable and MAY be out of date. Every row whose source does not depend on the catalogue SHALL still render.

A response without the `fallback` field (an older server) SHALL be treated as the unavailable state when `ready` is `false`.

No notice SHALL replace the list. The Add-provider control SHALL remain rendered beside it, because it is the only path to adding a credential and these states are precisely when an operator is likely to need it.

#### Scenario: No catalogue with stored keys
- **WHEN** the catalogue-availability signal reports `{ ready: false, fallback: false }` and `auth.json` holds API keys
- **THEN** the section SHALL NOT render the "nothing configured" empty state
- **AND** SHALL render the unavailable warning notice

#### Scenario: Fallback catalogue on first run
- **WHEN** the signal reports `{ ready: false, fallback: true }`
- **AND** no provider holds a credential
- **THEN** the section SHALL render the "nothing configured" empty state and the informational fallback notice
- **AND** SHALL NOT render the unavailable warning
- **AND** the Add-provider picker SHALL offer the api-key providers from the status response (for example `deepseek`)

#### Scenario: Older server without the fallback field
- **WHEN** the signal reports `{ ready: false }` with no `fallback` field
- **THEN** the section SHALL render the unavailable warning notice

#### Scenario: Add control remains available while the catalogue is unavailable
- **WHEN** the catalogue is unavailable or served from the fallback
- **THEN** the Add-provider control SHALL still render
- **AND** the picker SHALL still offer the Custom endpoint entry

#### Scenario: No catalogue with an OAuth credential
- **WHEN** the catalogue is unavailable and an OAuth provider is connected
- **THEN** its Subscription row SHALL still render
- **AND** the notice SHALL be scoped beside the list, not substituted for it
