## ADDED Requirements

### Requirement: OAuth providers without server handler render disabled

The Provider Authentication section SHALL fetch `GET /api/provider-auth/handlers` once on mount and cache the returned `ids` as a Set. For each row in the catalogue whose `flowType !== "api_key"` (i.e. OAuth flow), if its `id` is NOT present in the handler-id set, the UI SHALL render its login button with `disabled` and a `title` tooltip in the form `"OAuth flow not yet supported in dashboard for <displayName>"`. Click handlers SHALL be suppressed for those rows. All other rendering (display name, expiry indicator, sign-out for stored credentials) SHALL be unchanged.

#### Scenario: Extension-registered OAuth provider has no handler
- **WHEN** the catalogue contains `{ id: "custom-llm", displayName: "Custom LLM", hasOAuth: true }` and `GET /api/provider-auth/handlers` returns `["anthropic", "openai-codex", "github-copilot"]`
- **THEN** the row for Custom LLM SHALL render the login button with the `disabled` attribute and a tooltip "OAuth flow not yet supported in dashboard for Custom LLM"

#### Scenario: Built-in provider with handler unaffected
- **WHEN** the catalogue contains `{ id: "anthropic", hasOAuth: true }` and the handler-id set contains `"anthropic"`
- **THEN** the Anthropic row SHALL render the login button enabled, click-handler attached, exactly as before

#### Scenario: Already-authenticated provider with no handler keeps "Sign Out"
- **WHEN** the catalogue contains an OAuth row with no matching handler but `auth.json` has stored credentials for it
- **THEN** the Sign Out button SHALL remain enabled (revoking is a `DELETE /api/provider-auth/credential` call, not a handler-driven flow), and the disabled state applies only to a new login click
