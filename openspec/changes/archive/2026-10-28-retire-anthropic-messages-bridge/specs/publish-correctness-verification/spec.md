# Spec Delta

## MODIFIED Requirements

### Requirement: The check carries an explicit, reasoned exception list

The check SHALL support an allowlist of specifiers that are deliberately not
declared, each entry carrying the workspace, the specifier, and a reason string.
The allowlist exists because the check does not read `biome-ignore` comments and
would otherwise flag intentionally-undeclared specifiers.

The allowlist SHALL NOT keep an entry for a workspace that no longer exists.

#### Scenario: An allowlisted specifier is not reported

- **WHEN** the check encounters an allowlisted specifier in the shipped code of the workspace its entry names
- **THEN** the check SHALL NOT report it
- **AND** the allowlist entry SHALL carry a reason string

#### Scenario: An allowlist entry without a reason is rejected

- **WHEN** the allowlist contains an entry with no reason string
- **THEN** the check SHALL exit non-zero, so exceptions cannot accumulate silently
