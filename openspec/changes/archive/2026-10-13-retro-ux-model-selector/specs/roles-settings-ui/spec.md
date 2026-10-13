## MODIFIED Requirements

### Requirement: Global role→model assignment
The section SHALL list every role from the plugin config and let the user assign a model to each role via the shared model-selector primitive.

#### Scenario: Roles rendered from plugin config
- **WHEN** the plugin config supplies a `roles` map, `models` list, and `builtinRoleNames`
- **THEN** each role renders as a pill showing `@<role>` and its currently effective model through the shared role-ref display
- **AND** roles present in `builtinRoleNames` render under a "Built-in" group and all other roles render under a "Custom" group
- **AND** when `builtinRoleNames` is empty every role renders in one flat grid

#### Scenario: Assigning a model to a role
- **WHEN** the user clicks a role pill and selects a model in the opened model-selector
- **THEN** the picker emits the full `"<provider>/<id>"` label and the pill displays that value with an unsaved (dirty) marker
- **AND** no role-mutation message is sent to the server at selection time

#### Scenario: Unassigned role affordance
- **WHEN** a role has no assigned model
- **THEN** the pill shows the role token and a warning-severity pill "No model assigned" instead of a model label, and activating the pill opens the model picker for that role

#### Scenario: Legacy bare-id value display
- **WHEN** a persisted role value has no `/` separator and a matching model id exists in the `models` list
- **THEN** the pill displays the resolved `"<provider>/<id>"` label without mutating the stored value

## ADDED Requirements

### Requirement: Roles settings conform to the UI contract
Each role pill SHALL render its role and resolution through the shared role-ref display, with the selected pill painted by the `--tint-blue-*` family and an unsaved pill showing a warning-severity "Unsaved" pill (text, not a colour-only dot; `data-testid="roles-row-<role>-dirty"` kept). The setup prompt (`roles-settings-setup-banner`; the warning callout is the banner `dashboard-roles-ownership` requires, keeping its copy "No roles have been set up — set up now…" pinned by `dashboard-roles-ownership`) and the level-drop notice (`roles-level-drop-notice`) SHALL be warning-severity callouts with an icon and no emoji; the level-drop text SHALL read "Thinking level <level> isn't supported by <model>, so the level was dropped.". The unsaved "dirty marker" required elsewhere SHALL be rendered as the "Unsaved" pill. In each "Used by" row the role SHALL render through the shared role-ref display while each entry keeps its "<owner> · <label>" text. Group headings ("Built-in", "Custom", "Used by") SHALL use the section-heading recipe (12 px semibold `--text-secondary`), and the subheading SHALL be 12 px help text. The section SHALL contain no Tailwind palette class, no hex or `rgba(` literal (including `var(--accent-warning, #…)` fallbacks — `--accent-warning` is not a defined token), no `--accent-*` text, and no `--text-muted` information text, and SHALL pass the contrast, size and focus probes in `{base,dark}`, `{base,light}` and `{nord,dark}` with pills (assigned, unsaved, unassigned), the setup prompt, and the role editor with a dropped level.

#### Scenario: Unsaved role is stated in text
- **WHEN** a role's model is changed and not yet saved
- **THEN** its pill shows the text "Unsaved" in a warning-severity pill

#### Scenario: Unassigned pill uses the shared wording
- **WHEN** a role has no model
- **THEN** its pill shows "No model assigned" through the shared role-ref display

#### Scenario: No undefined token fallback paints
- **WHEN** the setup prompt and an unsaved pill render
- **THEN** neither element's class list references `--accent-warning`, and their colours equal the active theme's `--severity-warning-*` values
