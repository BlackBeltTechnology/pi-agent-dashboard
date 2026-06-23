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
  | `score_mockup` | Capture full-page screenshots at mobile/tablet/desktop widths via Playwright; returns paths + a scoring rubric. |
  | `init_ui_contract` | Scaffold a token-referencing `ui-contract.md` consistency control plane. |
- **Command** `/mockup-loop` — print the loop and point at the skill.

## Optional dependency

`score_mockup` uses Playwright if present. Enable breakpoint capture with:

```bash
npm i -D playwright && npx playwright install chromium
```

Without it, `score_mockup` returns the rubric plus manual-capture guidance.

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
