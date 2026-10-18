## ADDED Requirements

### Requirement: Theme-token guard covers the shared client package

The theme-token guard SHALL scan the shared client package (`packages/client-utils/src`) in addition to its existing roots, with the same ratchet rules: a finding not present in the baseline fails, and the baseline may only shrink.

#### Scenario: New fallback literal in a shared primitive fails
- **WHEN** a change adds `var(--accent-primary, #60a5fa)` to a file under `packages/client-utils/src`
- **THEN** the theme-token guard SHALL report a new violation and exit non-zero

#### Scenario: Fixed sites leave the baseline
- **WHEN** a baselined finding under `packages/client-utils/src` is repaired
- **THEN** its baseline entry SHALL be removed
- **AND** reintroducing it SHALL fail the guard
