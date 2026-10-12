## ADDED Requirements

### Requirement: Folder-scoped slot consumers re-evaluate on slot-claims invalidation
The `sidebar-folder-section` and `worktree-card-section` slot consumers SHALL subscribe to the slot-claims invalidation version. They SHALL re-evaluate their claims' predicates whenever the version is bumped, even when no other prop or state of the consumer or its parent has changed.

#### Scenario: Bump alone reveals a gated folder entry
- **GIVEN** a `sidebar-folder-section` claim whose predicate returned `false` for folder `billing` and now returns `true`
- **WHEN** the slot-claims version is bumped and nothing else changes
- **THEN** the claim's entry renders for `billing`
