# Tasks — Selectable Design Systems

## 1. Preset registry + contract plumbing (foundation)

- [ ] 1.1 Add `src/presets/registry.ts` — `DesignSystemPreset` type (`id`, `label`, `platform`, `substrate`, `contractSource`, `minTouchTarget`, `spacingScale`, `validators[]`) + the 5 v1 entries → verify: `list_design_systems` returns 5 presets.
- [ ] 1.2 Add `src/presets/contract.ts` — load bundled `presets-data/<id>/contract.tokens.json`, normalize to DTCG, `refresh()` re-fetches upstream → verify: unit test loads each snapshot, asserts DTCG shape.
- [ ] 1.3 Add bundled deps to `package.json` (`@axe-core/playwright`, contrast checker, `eslint-plugin-tailwindcss`); add `presets-data/` to `files` → verify: `npm install` clean, `tsc --noEmit` passes.

## 2. Tool surface

- [ ] 2.1 `list_design_systems` tool → verify: smoke test returns the registry.
- [ ] 2.2 Extend `init_ui_contract` with `system?` + `refresh?` → verify: `--system shadcn` writes the shadcn DTCG contract; no `system` still writes the blank template (back-compat test).
- [ ] 2.3 Extend `score_mockup` with `system?` → verify: `--system apple-hig` returns the HIG boolean rubric, not the generic one.
- [ ] 2.4 Add `validate_mockup` orchestrator (signature per design.md) → verify: returns `{ gates, advisory, pass }` shape.

## 3. Validation layers (`src/presets/validators.ts`)

- [ ] 3.1 L2 a11y floor (bundled, all systems): axe-core/playwright + contrast check, hard gate, `--fail-on serious` → verify: a deliberately low-contrast fixture fails L2.
- [ ] 3.2 L1 token-lint runner: shadcn→`eslint-plugin-tailwindcss` (bundled, gate); material-3→generic `stylelint-scales` 8dp; mui/fluent→optional, shell-out-if-present → verify: off-token color fails shadcn L1; missing optional linter → "skipped + noted", no error.
- [ ] 3.3 L3 named-system auditor: shell out to `hig-doctor` (apple-hig) / `material3-mcp` (material-3) if resolvable, advisory only → verify: absent tool degrades gracefully.
- [ ] 3.4 L4 vision judge: per-preset `rubric.json` boolean checks, `score = pass/N` computed in code → verify: rubric loads, score is integer-derived fraction.

## 4. Preset data (P1: shadcn, mui, material-3)

- [ ] 4.1 `presets-data/shadcn/` — CSS-var tokens → DTCG + `rubric.json` → verify: contract round-trips.
- [ ] 4.2 `presets-data/mui/` — MUI default theme → DTCG + `rubric.json`.
- [ ] 4.3 `presets-data/material-3/` — M3 `--md-sys-*` → DTCG + `rubric.json` (8dp grid, 48dp targets).
- [ ] 4.4 Document the snapshot-regeneration step in README (how `--refresh` maps to upstream sources).

## 5. Preset data (P2: fluent-2)

- [ ] 5.1 `presets-data/fluent-2/` — `@fluentui/tokens` DTCG snapshot + `rubric.json` → verify: contract loads; optional `eslint-plugin-fluentui-jsx-a11y` wired in L1.

## 6. Preset data (P3: apple-hig)

- [ ] 6.1 `presets-data/apple-hig/rules.md` + DTCG-shaped rule pack (semantic colors, Dynamic Type, 44pt, safe areas, ≤5 tab bar) + `rubric.json`.
- [ ] 6.2 HIG HTML-approximation guidance in the skill (SF Pro stack, `env(safe-area-inset-*)`, bottom tab bar) → verify: a sample HIG HTML mockup passes `hig-doctor` if installed.
- [ ] 6.3 SwiftUI-on-PROMOTE note in the skill (validated on source by `hig-doctor`/`orchard-hig`; no browser preview).

## 7. Skill + docs

- [ ] 7.1 Update `.pi/skills/frontend-mockup-loop/SKILL.md`: design-system selection step, the gate-vs-advisory model, the 5 presets, `validate_mockup`.
- [ ] 7.2 Update package `README.md`: `--system` flags, dependency posture, optional validators.
- [ ] 7.3 Add file-index rows for new `src/presets/*` + `presets-data/*` files (delegate per docs protocol, caveman style).

## 8. Verification

- [ ] 8.1 `tsc --noEmit` clean; smoke test exercises all tools incl. `--system` for each P1 preset.
- [ ] 8.2 Back-compat: every existing call (no `system`) behaves identically.
- [ ] 8.3 `openspec validate add-selectable-design-systems` passes.
