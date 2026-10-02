## ADDED Requirements

### Requirement: Environment rows name pi's auth mechanism

An Environment-badged row with no `envVar` SHALL show the row's `authLabel` as its mechanism when present, and SHALL fall back to the generic ambient mechanism text only when `authLabel` is absent.

#### Scenario: Federation row names federation
- **WHEN** the `anthropic-api` status row reports `configured: true`, `source: "environment"`, `authLabel: "workload identity federation"` and no `envVar`
- **THEN** the row SHALL carry the **Environment** badge and the text "workload identity federation"
- **AND** SHALL NOT show "application default credentials"

### Requirement: OAuth rows distinguish subscription from account sign-in

This refines the Subscription badge of "Provider authentication section in Settings". An OAuth row SHALL carry the **Subscription** badge when its status row reports `subscription: true`, and an **Account** badge otherwise. The badge's status and actions (relative expiry, Sign out) are unchanged. A client SHALL treat a missing `subscription` field (older server) as `true`, so existing rows keep their badge.

#### Scenario: Subscription-backed provider
- **WHEN** the `anthropic` OAuth row reports `subscription: true`
- **THEN** its badge text SHALL be "Subscription"

#### Scenario: Non-subscription OAuth sign-in
- **WHEN** the `openrouter` OAuth row reports `subscription: false`
- **THEN** its badge text SHALL be "Account" and the Sign out action SHALL remain

#### Scenario: Older server
- **WHEN** an OAuth row carries no `subscription` field
- **THEN** its badge text SHALL be "Subscription"
