# @blackbelt-technology/frontend-mockup-loop

A pi package — **extension + skill** — for a disciplined frontend design loop:

```
GROUND → CONTRACT → MOCKUP → TEST → FIX → PROMOTE → LEARN
```

It exists to defeat *distributional convergence*: an undirected agent regresses
to the statistical mean (generic Inter font, purple gradient, centered hero).
The fix — deliberate direction, a consistent token system, and a screenshot
feedback loop — is what this loop enforces.

Generic: works in any React/Tailwind/shadcn (or plain HTML) project.

## Install

```bash
pi install npm:@blackbelt-technology/frontend-mockup-loop
# or try without installing:
pi -e npm:@blackbelt-technology/frontend-mockup-loop
```

This registers:

- **Skill** `frontend-mockup-loop` — the 7-step workflow (load via
  `/skill:frontend-mockup-loop`).
- **Tools** the agent can call:
  | Tool | Purpose |
  |------|---------|
  | `serve_mockup` | Serve a mockup dir over HTTP on `0.0.0.0`; returns clickable **local + LAN** URLs (LAN works on a phone). Zero deps. |
  | `score_mockup` | Capture full-page screenshots at mobile/tablet/desktop widths via Playwright; returns paths + a scoring rubric. With `system`, uses that preset's boolean rubric. |
  | `init_ui_contract` | Scaffold a token-referencing `ui-contract.md` consistency control plane. With `system`, write that preset's DTCG token contract. |
  | `list_design_systems` | Enumerate the selectable design-system presets. |
  | `validate_mockup` | Run the layered validation pipeline for a system (L1+L2 gates, L3+L4 advisory); returns `{ gates, advisory, pass }`. |
- **Command** `/mockup-loop` — print the loop and point at the skill.

## Selectable design systems

The loop runs design-system **agnostic** by default. Pass `--system <id>` (the
tools' `system` param) to target a specific system. v1 presets:

| id | system | platform | substrate |
|---|---|---|---|
| `shadcn` | shadcn/ui + Tailwind | web | HTML + Tailwind |
| `mui` | Material UI | web | HTML |
| `material-3` | Material Design 3 | web | HTML |
| `fluent-2` | Fluent 2 | web | HTML |
| `apple-hig` | Apple HIG | iOS | HTML approximation → SwiftUI on promote |

- `init_ui_contract{system:"shadcn"}` writes the shadcn DTCG contract from a
  **bundled offline snapshot** (`presets-data/<id>/`); no `system` still writes
  the generic blank template (back-compat).
- `validate_mockup{system,dir}` gates on L1 (token-lint) + L2 (axe + WCAG
  contrast) and scores on L3 (named-system auditor) + L4 (boolean rubric).
- Apple HIG ships a hand-authored rule pack (`presets-data/apple-hig/rules.md`);
  rendered as an HTML approximation in-loop, SwiftUI emitted only on PROMOTE.

### Dependency posture

- **Bundled** (hard deps): `@axe-core/playwright` + `eslint-plugin-tailwindcss`
  (shadcn L1). WCAG contrast math is inline (no extra dep).
- **Optional** (shelled out only if installed, else skipped + noted):
  `hig-doctor`, `material3-mcp`, MUI/Fluent eslint plugins, `lumo`.
- `score_mockup` uses Playwright if present — enable breakpoint capture with
  `npm i -D playwright && npx playwright install chromium`; without it,
  `score_mockup` returns the rubric plus manual-capture guidance.

### Refreshing snapshots

Bundled token snapshots (`presets-data/<id>/contract.tokens.json`) are versioned
with the package and lag upstream. `init_ui_contract{system,refresh:true}`
re-fetches the upstream source before writing. Upstream sources per preset:

| preset | upstream source |
|---|---|
| `shadcn` | shadcn CSS variables (default theme) → DTCG |
| `mui` | `@mui/material` `createTheme()` defaults → DTCG |
| `material-3` | Material 3 `--md-sys-*` baseline tokens → DTCG |
| `fluent-2` | `@fluentui/tokens` `webLightTheme` → DTCG |
| `apple-hig` | hand-authored rule pack (no upstream token JSON) |

## Expert UX designer mode

The skill acts as an expert UX designer: **every decision is grounded in an
externally documented, public-facing design rule** (Nielsen's 10 heuristics,
Laws of UX, Gestalt, WCAG 2.2, GOV.UK/USWDS/Material patterns) — never invented.
The full citable rule corpus is bundled at
[`references/ux-best-practices.md`](references/ux-best-practices.md): the source
hierarchy (licensing-safe), universal laws, per-component pattern rules, the
5-step expert evaluation protocol, and a 22-item checkable rubric seed used by
`score_mockup` / `validate_mockup`.

## The design contract

`ui-contract.md` is the single source of truth for cross-screen consistency:
color ramps, spacing/type scales, radius, elevation, motion, component
invariants — **every value references a design token, never a raw hex/px**.
`init_ui_contract` scaffolds it; you fill it from the real tokens captured in
the GROUND step.

## License

MIT
