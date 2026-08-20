# theme-system Specification Delta

## ADDED Requirements

### Requirement: Accent tokens are declared for every theme
The client SHALL declare a complete accent ramp in `packages/client/src/index.css`
for both the default (dark) `:root` scope and the `[data-theme="light"]` scope.
The ramp SHALL comprise `--accent` (border / ring / focus), `--accent-soft`
(a soft fill painted behind `--text-primary`), `--accent-solid` (a solid fill
painted behind white text) and `--accent-text` (link text on a page background).

`--accent` and `--accent-soft` are currently referenced by component code but
declared nowhere, which is already a violation of "CSS custom properties for
theming". Declaring them SHALL make the existing `var(--accent-soft, …)` call
sites resolve to a theme-aware value instead of their hardcoded fallback.

Each token SHALL meet the contrast floor for the role it serves: `--accent-soft`
against `--text-primary` and `--accent-solid` against white SHALL meet 4.5:1;
`--accent-text` against `--bg-primary` SHALL meet 4.5:1; `--accent` used as a
non-text border or ring SHALL meet 3:1 against the adjacent surface.

#### Scenario: Accent ramp declared in both scopes
- **WHEN** `index.css` is inspected
- **THEN** `--accent`, `--accent-soft`, `--accent-solid` and `--accent-text` SHALL each be declared in `:root` AND in `[data-theme="light"]`

#### Scenario: Soft fill is legible in light mode
- **WHEN** a selected chip or a step action button paints `--accent-soft` behind `--text-primary` under `[data-theme="light"]`
- **THEN** the pair SHALL meet 4.5:1, replacing the 1.52:1 produced by the dark-navy fallback

#### Scenario: Soft fill is legible in dark mode
- **WHEN** the same surface paints `--accent-soft` behind `--text-primary` in the default dark scope
- **THEN** the pair SHALL meet 4.5:1

#### Scenario: Solid fill carries white text in both themes
- **WHEN** a primary action paints `--accent-solid` behind white text in either theme
- **THEN** the pair SHALL meet 4.5:1, because `--accent-primary` measures 3.68:1 against white in BOTH themes and is therefore not a valid solid fill for text

#### Scenario: Selected state is not the least readable element
- **WHEN** a provider or mode chip group is rendered with one chip selected
- **THEN** the selected chip's text SHALL meet a contrast ratio no lower than that of the unselected chips in the same group

### Requirement: Themed paints SHALL NOT rely on an inline fallback literal
A component SHALL NOT paint a themed color through a `var(--token, <literal>)`
fallback. A fallback literal is authored against exactly one theme, so when the
token is undeclared the literal is painted in EVERY theme while the text layered
on it stays theme-aware — the failure is invisible in the theme the literal was
authored for and severe in the other.

This is distinct from an undeclared property with no fallback, which resolves to
the empty string and yields an obviously unset paint. The fallback form fails
silently instead, which is why banning a single token in a single component
(as `shutdown-session-recovery` does for `--accent`) does not address the class.

Every custom property a component references for a color SHALL be declared in
the theme layer.

**The check SHALL be a ratchet, not a sweep — on both of its arms.** The client currently
contains 72 fallback-form color bindings across 19 files (client source, excluding tests),
plus further bindings in the bundled plugins, and separately references
several color properties that are undeclared today (`--border`, `--danger`, `--success`,
`--accent-fg`, `--bg-input`, `--border-focus`). A check that fails on either set fails on
the day it lands and forces exactly the repo-wide reflow this change declares out of scope.

Both the fallback-form rule and the undeclared-token rule SHALL therefore carry an
explicit, enumerated baseline of what exists when the check lands, and SHALL fail only on
a binding **added or modified** thereafter. Entries SHALL be removed from a baseline as
they are repaired; entries SHALL NOT be added. The accent tokens this change declares and
the bindings it repairs SHALL NOT appear in either baseline.

#### Scenario: No NEW fallback literal in a themed paint
- **WHEN** a binding using the `var(--token, #rrggbb)` fallback form for a background, border or text color is added or modified
- **AND** it is not in the recorded baseline
- **THEN** the check SHALL fail, naming the binding and its file

#### Scenario: The pre-existing baseline does not fail the build
- **GIVEN** the 72 fallback-form bindings that exist when the check lands are recorded in the baseline
- **WHEN** the check runs with no source change
- **THEN** it SHALL pass

#### Scenario: The baseline only shrinks
- **WHEN** a baselined binding is repaired and removed from the baseline
- **AND** a later change reintroduces a fallback-form binding at that site
- **THEN** the check SHALL fail

#### Scenario: A NEW undeclared token is caught before it ships
- **WHEN** a component adds or modifies a reference to a color custom property not declared in `index.css`
- **AND** that reference is not in the recorded baseline
- **THEN** the check SHALL fail, naming the property and the referencing file

#### Scenario: Pre-existing undeclared tokens do not fail the build
- **GIVEN** `--border`, `--danger`, `--success`, `--accent-fg`, `--bg-input` and `--border-focus` are referenced but undeclared when the check lands
- **WHEN** the check runs with no source change
- **THEN** it SHALL pass
- **AND** those references SHALL be enumerated in the baseline rather than silently ignored

#### Scenario: Declaring a token repaints its no-fallback references too
- **GIVEN** components reference `var(--accent)` with no fallback, which currently resolves to the empty string
- **WHEN** `--accent` becomes declared
- **THEN** every such reference SHALL be verified to render its intended paint, not merely the previously-unset one

#### Scenario: A solid accent fill under white text uses the solid token
- **GIVEN** a control paints a solid accent background with white text
- **WHEN** the accent ramp is declared
- **THEN** that control SHALL bind `--accent-solid`, NOT `--accent`
- **AND** white on it SHALL meet AA in **both** themes
- **AND** binding `--accent` there SHALL be treated as a defect, since `--accent` carries the 3:1 border/ring role and white on `#3b82f6` measures 3.68:1

#### Scenario: Declaring the token does not by itself clear cause C
- **GIVEN** the four sites reading `bg-[var(--accent,#3b82f6)] … text-white`
- **WHEN** `--accent` is declared and the inline literal removed
- **THEN** those sites SHALL still fail AA until repointed to `--accent-solid`
- **AND** the change SHALL repoint them

#### Scenario: Existing Gateway call sites resolve to theme values
- **WHEN** the Gateway dialog is rendered under `[data-theme="light"]`
- **THEN** the provider chips, mode chips, step action buttons, footer actions and the setup guide link SHALL each resolve their accent paint from a declared token, and each SHALL meet its role's contrast floor
