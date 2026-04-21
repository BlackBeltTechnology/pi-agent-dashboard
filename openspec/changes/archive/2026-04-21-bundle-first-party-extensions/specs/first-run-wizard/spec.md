## ADDED Requirements

### Requirement: Bundled status indication
The first-run wizard SHALL visually distinguish recommended extensions that were activated from the bundled payload from those installed dynamically from npm/git.

#### Scenario: Bundled-installed entry
- **WHEN** a recommended extension's install progress reports `output: "Already installed (bundled)"` or was processed by `installBundledExtensions()`
- **THEN** the wizard row SHALL render a "Bundled ✓" badge next to the step name

#### Scenario: System-installed entry
- **WHEN** an entry was skipped because it is already present on the user's system (not from bundle)
- **THEN** the wizard row SHALL render an "Installed" badge, distinct from the "Bundled ✓" badge

#### Scenario: Dynamically-installed entry
- **WHEN** an entry is installed via `installRecommendedExtensions()` during the wizard
- **THEN** the wizard row SHALL show normal running/done progress with no bundled badge
