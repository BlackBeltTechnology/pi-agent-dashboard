## ADDED Requirements

### Requirement: The i18n checks are repaired, then enforced on the ship path

`i18n:lint` and `i18n:parity` SHALL be invoked by `ship-it` step 4.4, so that a
hardcoded user-facing string or a catalog parity gap fails the ship rather than
depending on someone remembering to run the script. Both SHALL be verified
working against the current tree before being wired.

#### Scenario: Parity script repaired before wiring

- **WHEN** `i18n-parity.mjs` is wired
- **THEN** its stale reference to the pre-reorganisation client path has been repaired
- **AND** the script exits 0 on the current tree

#### Scenario: Lint script gates only with --strict

- **WHEN** `i18n-lint.mjs` is wired
- **THEN** it is invoked with `--strict`
- **AND** a hardcoded user-facing string causes a non-zero exit

#### Scenario: Hardcoded string fails the ship

- **WHEN** a change introduces a user-facing string that does not resolve through the catalog
- **THEN** `ship-it` step 4.4 exits non-zero
- **AND** the offending file and string are named

#### Scenario: Catalog parity gap fails the ship

- **WHEN** a key exists in one locale catalog and is missing from another
- **THEN** `ship-it` step 4.4 exits non-zero
- **AND** the missing keys and locales are named

#### Scenario: Scripts stay independently runnable

- **WHEN** `npm run i18n:lint` or `npm run i18n:parity` is run directly
- **THEN** it behaves as it does when `ship-it` invokes it
