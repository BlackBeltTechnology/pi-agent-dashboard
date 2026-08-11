# invoicebot-session-profile — delta

## ADDED Requirements

### Requirement: InvoiceBot role assignments are audited against the pinned model

The invoice plugin SHALL declare the InvoiceBot role set it depends on
(`classification`, `extraction`, `bank-intake`, `rule-authoring`, `validation`,
`fast`, `smart`) and SHALL audit the deployment's role map against the resolved
spawn model at activation.

A role SHALL be reported `divergent` when its assigned model is not equal — by
parsed `provider` and `modelId` — to the resolved spawn model, and `unset` when
it carries no assignment. Both the effective role map and the active role preset
SHALL be audited. The audit SHALL report findings only and SHALL NOT rewrite the
operator's role map. Reading the role map SHALL be defensive: a missing,
unreadable or malformed configuration SHALL yield an empty map rather than an
error, and SHALL NOT prevent activation. The audit SHALL read model identifiers
only and SHALL NOT read or log any credential.

#### Scenario: every role pinned to the configured model

- **WHEN** the resolved spawn model is `openai-codex/gpt-5.4` and every declared
  InvoiceBot role is assigned `openai-codex/gpt-5.4`
- **THEN** the audit SHALL report no divergent and no unset roles
- **AND** activation SHALL log that all declared roles are pinned to that model

#### Scenario: a role on another provider is reported

- **WHEN** the resolved spawn model is `openai-codex/gpt-5.4` but
  `rule-authoring` and `validation` are assigned a different provider's model
- **THEN** the audit SHALL report exactly those two roles as divergent, each with
  its offending assigned value
- **AND** the role map SHALL NOT be modified by the plugin

#### Scenario: an unassigned role is distinguished from a wrong one

- **WHEN** a declared role carries an empty assignment
- **THEN** it SHALL be reported as `unset`, not as `divergent`

#### Scenario: a divergent active preset is caught

- **WHEN** the effective role map is fully pinned but the active preset assigns a
  different model to a declared role
- **THEN** the audit SHALL report that preset role as divergent

#### Scenario: malformed configuration cannot break activation

- **WHEN** the role configuration file is absent, unreadable or not valid JSON
- **THEN** the role map SHALL read as empty
- **AND** activation SHALL continue without throwing

#### Scenario: no pinned model means no audit

- **WHEN** no spawn model is configured at all
- **THEN** the audit SHALL be skipped rather than compared against a guess
