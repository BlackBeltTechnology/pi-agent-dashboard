## ADDED Requirements

### Requirement: Role-backed model states what follows the role
When a role is selected as the automation's model, the editor SHALL show the trigger through the shared role-ref display and, below it, the hint (`data-testid="create-model-role-level-hint"`) "Follows @<role>: model and thinking level change when the role changes. Edit it in Settings → Roles." in 12 px `--text-secondary`.

#### Scenario: Hint names both followed values
- **WHEN** the user picks `@coding` as the automation model
- **THEN** the hint names `@coding` and says that both the model and the thinking level follow the role
