## ADDED Requirements

### Requirement: Grammar model prompt is readable
The model-required prompt (`data-testid="grammar-model-required"`) SHALL render as a warning-severity callout with an icon at 12 px, not 10 px text, and the grammar model trigger SHALL show a role ref through the shared role-ref display.

#### Scenario: Missing model prompt meets the type floor
- **WHEN** the grammar settings render with no model set
- **THEN** `grammar-model-required` is a warning callout whose text is at least 12 px with colours equal to the active theme's `--severity-warning-*` values
