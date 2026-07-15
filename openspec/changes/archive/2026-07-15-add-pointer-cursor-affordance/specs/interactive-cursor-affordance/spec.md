# interactive-cursor-affordance — delta

## ADDED Requirements

### Requirement: Enabled interactive controls show a pointer cursor

The client SHALL apply `cursor: pointer` to every enabled push-target
app-wide via a single global `@layer base` rule in the shared stylesheet
(`packages/client/src/index.css`), covering the client, all plugin client
bundles, and dialogs/modals that render into the same DOM. The rule SHALL
cover `<button>`, `[role="button"]`, `[role="tab"]`, `<summary>`,
checkbox/radio `<label>`s, and `<select>`. Disabled controls
(`:disabled` / `[aria-disabled="true"]`) SHALL keep the default arrow cursor.
The rule SHALL live in the base layer so explicit `cursor-*` utilities
override it.

#### Scenario: Hovering an enabled button shows a pointer

- **WHEN** the pointer hovers an enabled `<button>` or `[role="button"]`
- **THEN** the cursor SHALL be `pointer`

#### Scenario: Disabled control keeps the default cursor

- **WHEN** the pointer hovers a control that is `:disabled` or has
  `aria-disabled="true"`
- **THEN** the cursor SHALL remain the default arrow (not `pointer`)

#### Scenario: Explicit utility overrides the base rule

- **WHEN** a control carries an explicit `cursor-*` utility (e.g.
  `cursor-not-allowed` on a loading button)
- **THEN** that utility SHALL win over the base-layer pointer rule

#### Scenario: Plugin buttons are covered without per-file edits

- **WHEN** a plugin client bundle renders an enabled `<button>` into the
  shared DOM
- **THEN** it SHALL receive the pointer cursor from the global rule with no
  component-level `cursor-pointer` class required
