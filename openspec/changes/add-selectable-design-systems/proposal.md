## Why

`@blackbelt-technology/frontend-mockup-loop` (`packages/mockup-loop/`) ships a
generic ground→contract→mockup→test→fix→learn loop, but it is **design-system
agnostic**: `init_ui_contract` emits a blank template and `score_mockup` scores
a single generic anti-slop rubric. Users want to target a **specific** design
system (Material 3, MUI, Apple HIG, Fluent 2, shadcn/Tailwind) and have the
agent both generate to that system's conventions and **validate adherence** to
it.

Research (4 parallel streams, 2025/2026 sources) established two facts that
shape the design:

1. **Token contracts are asymmetric.** 9 of the 10 best-known design systems
   publish machine-readable tokens (DTCG/JSON or CSS vars); **Apple HIG
   publishes none** — it resolves semantic tokens at OS runtime. So the feature
   needs two contract sources: imported tokens, and a hand-authored rule pack.

2. **Validation is layered, not one tool.** No single validator covers a system.
   The field converged on: token ground-truth → static token-lint → rendered
   a11y floor → named-system conformance auditor → vision judge with a BOOLEAN
   rubric (LLM design scores skew positive on floats; derive `score = pass/N`
   deterministically). Strong shell-callable validators exist (`hig-doctor`,
   `lumo`, `@axe-core/playwright`, `eslint-plugin-tailwindcss`).

## What Changes

Add a **selectable design-system** capability to the mockup-loop package:

- **Preset registry** — 5 systems in v1: `shadcn`, `mui`, `material-3`,
  `fluent-2`, `apple-hig`. Each preset declares platform, generation substrate,
  contract source, touch-target minimum, spacing scale, and the validator layers
  that apply.
- **Contract normalization to DTCG** — `init_ui_contract --system <id>` emits the
  selected system's contract from a **bundled snapshot** (`presets/<id>/`),
  with `--refresh` to re-fetch upstream. Token-publishing systems import real
  tokens; Apple HIG uses a hand-authored rule pack.
- **Per-system validation pipeline** — new `validate_mockup --system <id>`
  orchestrates: L1 static token-lint (**hard gate** when a linter exists),
  L2 rendered a11y floor (axe + contrast, **hard gate**, all systems),
  L3 named-system conformance auditor (advisory), L4 vision judge with the
  system's boolean rubric (advisory). L3/L4 drive the fix loop; L1/L2 gate.
- **`score_mockup --system <id>`** swaps the generic rubric for the system's
  boolean checks. **`list_design_systems`** enumerates presets.
- **Apple HIG in a browser-first loop** — rendered as an HTML approximation
  (SF Pro, 44pt targets, safe areas, ≤5 tab bar) validatable by `hig-doctor`
  (HTML/CSS); SwiftUI emitted only on PROMOTE.

**Dependency posture:** bundle `@axe-core/playwright` + a contrast CLI +
`eslint-plugin-tailwindcss` as real deps (the L2 floor + shadcn L1). All
named-system validators (`hig-doctor`, `lumo`, `material3-mcp`, MUI/Fluent
eslint) are shelled out **only if present**, else the loop falls back to the
boolean rubric.

**Phasing:** P1 `shadcn` + `mui` + `material-3` (web) → P2 `fluent-2` →
P3 `apple-hig` (HTML approx + `hig-doctor` first; SwiftUI-on-promote last).

### Out of scope (v1)

- The other 5 researched systems (Carbon, Ant, Polaris, SLDS, Atlassian, Primer,
  Spectrum) — registry is extensible; they land in a follow-up.
- Bundling heavy validators (`hig-doctor`, `lumo`) as hard deps.
- Figma MCP / live token sync.
