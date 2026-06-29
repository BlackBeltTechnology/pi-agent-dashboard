# @blackbelt-technology/anti-slop-frontend

A pi package — **skill only, no tools** — that catches the concrete signatures
an undirected model emits when it tries to "look designed."

It is a flat, **mechanical** checklist: every rule is countable or binary, so you
verify pass/fail instead of arguing taste. "It looks better" is not a check;
`eyebrow count > ceil(sections/3)` is.

Generic: works in any React/Tailwind/shadcn (or plain HTML) project.

## Install

```bash
pi install npm:@blackbelt-technology/anti-slop-frontend
# or try without installing:
pi -e npm:@blackbelt-technology/anti-slop-frontend
```

This registers:

- **Skill** `anti-slop-frontend` — the AI-tell catalog (load via
  `/skill:anti-slop-frontend`). No tools, no commands.

## What it catches

| Part | Scope | Examples |
|------|-------|----------|
| **A — Universal** | every surface, dashboards included | AI-purple glow, Inter-as-default, the em-dash ban, "Jane Doe / Acme / 99.99%" fake data, div-based fake screenshots, hand-rolled SVG icons, happy-path-only states, unmotivated motion |
| **B — Marketing only** | landing / portfolio / about | hero discipline, eyebrow-per-section, equal-3-card rows, zigzag cap, bento rhythm, decoration/locale/scroll-cue strips, duplicate CTA intent |

Part B is **skipped for product UI** (dashboards, data tables, wizards, editors).

Every rule has an **override path**: when the brief explicitly asks for the
"banned" thing, it is allowed — done with intent, not by default-reaching.

## Relationship to `frontend-mockup-loop`

Separate, complementary skills:

| | frontend-mockup-loop | anti-slop-frontend |
|---|---|---|
| Shape | ground→contract→mockup→test→fix→learn **loop** | flat **checklist** |
| Basis | cite an **external public rule** (Nielsen, WCAG, Laws of UX) | codified **AI-tell catalog** |
| Authority | owns the **hard gates** (WCAG-AA, severity-4) | **advisory only** |

When both run: the loop's a11y floor and cite-a-source rule **win**; this skill
feeds concrete failing items into the loop's FIX step and never overrides a gate.

## Attribution

Adapted from [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill)
(`design-taste-frontend`, MIT). Distillation of its **countable** rules:
stack-coupling (Next RSC / Motion / GSAP / next/font) removed, rules re-scoped
into universal vs marketing-only, reframed as an advisory catalog. The upstream
repo holds the full prose corpus and GSAP code skeletons.

## License

MIT
