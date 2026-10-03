## ADDED Requirements

### Requirement: Catalogue carries pi's auth-source label

Each `providers_list` catalogue entry SHALL carry `authLabel` (string, optional), copied from `modelRegistry.getProviderAuthStatus(id).label` when present. pi 1.0.0 sets it for EVERY environment credential (an env-var credential's label is the variable name); the case that matters is environment auth that has no single API-key variable, e.g. `"workload identity federation"` for Anthropic (pi ≥ 0.99.2: `ANTHROPIC_FEDERATION_RULE_ID` + `ANTHROPIC_ORGANIZATION_ID` + `ANTHROPIC_IDENTITY_TOKEN_FILE`). Such a provider is reported by pi-ai's `findEnvKeys` / `getEnvApiKey` as neither keyed nor `<authenticated>`, so `envVar` and `ambient` stay unset; `configured: true, source: "environment"` plus `authLabel` is the only evidence.

#### Scenario: Anthropic via workload identity federation
- **WHEN** the three Anthropic federation variables are set, no Anthropic key variable is set, and nothing is stored
- **THEN** the `anthropic` catalogue entry SHALL have `configured: true`, `source: "environment"`, `authLabel: "workload identity federation"`, and no `envVar`

#### Scenario: No label, no field
- **WHEN** `getProviderAuthStatus(id)` returns no `label`
- **THEN** the entry SHALL NOT carry `authLabel`
