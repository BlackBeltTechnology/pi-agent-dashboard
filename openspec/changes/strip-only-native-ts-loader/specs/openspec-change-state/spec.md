## MODIFIED Requirements

### Requirement: ChangeState enum
The shared types SHALL export `ChangeState` as an erasable `as const` object together with a same-named union type, with the string values `PLANNING`, `READY`, `IMPLEMENTING`, `COMPLETE` representing the lifecycle stages of an OpenSpec change. A TypeScript `enum` SHALL NOT be used (see `native-ts-loader` "First-party TypeScript uses only erasable syntax"). `ChangeState.X` SHALL evaluate to the string `"X"`.

#### Scenario: Enum values
- **WHEN** `ChangeState` is imported from shared types
- **THEN** it SHALL have exactly four values: `PLANNING`, `READY`, `IMPLEMENTING`, `COMPLETE`
- **AND** each member SHALL equal its own name as a string (e.g. `ChangeState.READY === "READY"`)
