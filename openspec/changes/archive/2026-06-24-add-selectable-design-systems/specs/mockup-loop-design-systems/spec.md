# mockup-loop-design-systems — delta

## ADDED Requirements

### Requirement: Selectable design-system preset registry

The mockup-loop extension SHALL expose a registry of design-system presets,
selectable by `id`. v1 SHALL include `shadcn`, `mui`, `material-3`, `fluent-2`,
and `apple-hig`. Each preset SHALL declare its platform, generation substrate,
contract source, minimum touch target, spacing scale, and the validator layers
that apply. A `list_design_systems` tool SHALL enumerate the registry.

#### Scenario: List presets

- **WHEN** `list_design_systems` is called
- **THEN** it SHALL return the 5 v1 presets, each with `id`, `label`, `platform`, `substrate`, and `validators[]`.

#### Scenario: Unknown system id rejected

- **WHEN** a tool is called with `system` set to an id not in the registry
- **THEN** it SHALL return an error naming the unknown id and listing valid ids, without throwing.

### Requirement: Per-system DTCG contract with bundled snapshot and refresh

`init_ui_contract` SHALL accept an optional `system` and `refresh`. With
`system`, it SHALL write the selected preset's contract from a bundled snapshot
under `presets-data/<id>/`, normalized to DTCG (`*.tokens.json`). With
`refresh`, it SHALL re-fetch upstream tokens and rewrite the snapshot before
writing. Without `system`, it SHALL write the existing blank template
unchanged. Apple HIG's contract SHALL be a hand-authored rule pack (Apple
publishes no token JSON).

#### Scenario: System contract emitted from snapshot

- **WHEN** `init_ui_contract` is called with `system: "shadcn"`
- **THEN** it SHALL write the shadcn DTCG contract from the bundled snapshot, offline, without network access.

#### Scenario: Back-compat default

- **WHEN** `init_ui_contract` is called with no `system`
- **THEN** it SHALL write the generic blank template, identical to prior behavior.

#### Scenario: Apple HIG uses a rule pack

- **WHEN** `init_ui_contract` is called with `system: "apple-hig"`
- **THEN** it SHALL emit a hand-authored rule pack (semantic colors, Dynamic Type styles, 44pt minimum target, 8pt grid, safe-area insets), not imported token JSON.

### Requirement: Layered validation with gate vs advisory separation

A `validate_mockup` tool SHALL run a layered pipeline parameterized by the
selected `system`: L1 static token-lint (hard gate when a linter exists for the
system), L2 rendered accessibility floor (axe + contrast, hard gate for every
system), L3 named-system conformance auditor (advisory), and L4 vision judge
using the system's boolean rubric (advisory). It SHALL return structured
results separating gate outcomes from advisory scores and an overall `pass`.
Advisory layers SHALL never hard-block; gate layers SHALL determine `pass`.

#### Scenario: L2 floor gates every system

- **WHEN** a mockup with insufficient contrast is validated for any system
- **THEN** L2 SHALL fail and `pass` SHALL be false, regardless of L3/L4 scores.

#### Scenario: Token-lint gates when a linter exists

- **WHEN** a `shadcn` mockup uses an off-token color
- **THEN** L1 (`eslint-plugin-tailwindcss`) SHALL fail and `pass` SHALL be false.

#### Scenario: Advisory layers score but do not block

- **WHEN** L1 and L2 pass but the L4 rubric score is below 100%
- **THEN** `pass` SHALL be true and the advisory score SHALL be reported to drive the fix loop.

### Requirement: Optional validators degrade gracefully

The pipeline SHALL invoke named-system validators (`hig-doctor`, `lumo`,
`material3-mcp`, MUI/Fluent eslint plugins) only if resolvable at runtime. When
an optional validator is absent, its layer SHALL be skipped and noted in the
result, and the pipeline SHALL continue on the remaining layers without error.
Only `@axe-core/playwright`, a contrast checker, and `eslint-plugin-tailwindcss`
SHALL be bundled as hard dependencies.

#### Scenario: Missing optional auditor

- **WHEN** `validate_mockup` runs for `apple-hig` and `hig-doctor` is not installed
- **THEN** L3 SHALL be reported as "skipped (hig-doctor not found)" and the pipeline SHALL still return L2 + L4 results.

### Requirement: Per-system vision rubric with deterministic scoring

`score_mockup` SHALL accept an optional `system`. With `system`, it SHALL use
that preset's boolean rubric (`presets-data/<id>/rubric.json`) of N yes/no
checks instead of the generic anti-slop rubric. The overall score SHALL be
derived in code as `passCount / N`; the vision model SHALL answer each check as
a boolean plus a one-line reason and SHALL NOT emit the aggregate score itself.

#### Scenario: System rubric selected

- **WHEN** `score_mockup` is called with `system: "apple-hig"`
- **THEN** it SHALL present the HIG boolean checks (e.g. tap targets ≥44pt, tab bar ≤5, Dynamic Type honored, safe areas respected) and compute `score = passCount / N` in code.

### Requirement: Apple HIG rendered as HTML approximation in-loop

For `apple-hig`, the mockup substrate SHALL be an HTML approximation (SF Pro
stack, 44pt touch targets, `env(safe-area-inset-*)`, bottom tab bar ≤5 items)
servable by `serve_mockup` and validatable by `hig-doctor` (HTML/CSS). SwiftUI
SHALL be emitted only at the PROMOTE step, validated on source; SwiftUI SHALL NOT
be required for the in-loop preview.

#### Scenario: HIG mockup served and validated in-browser

- **WHEN** an `apple-hig` HTML mockup is served and validated
- **THEN** `serve_mockup` SHALL return a live URL and `hig-doctor` (if present) SHALL audit the HTML against HIG rules without requiring SwiftUI or Xcode.
