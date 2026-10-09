# @blackbelt-technology/anti-slop-frontend

A pi package — **skills only, no tools** — that catches the concrete signatures
an undirected model emits when it tries to "look designed", and keeps redesigns
and generated references from reintroducing them.

Every review rule is countable or binary, so you verify pass/fail instead of
arguing taste. "It looks better" is not a check;
`eyebrow count > ceil(sections/3)` is.

Generic: works in any React/Tailwind/shadcn (or plain HTML) project.

## Install

```bash
pi install npm:@blackbelt-technology/anti-slop-frontend
# or try without installing:
pi -e npm:@blackbelt-technology/anti-slop-frontend
```

This registers four skills. No tools, no commands.

| Skill | Use for |
|---|---|
| `anti-slop-frontend` | the AI-tell catalog: Design Read, surface profiles, theme parity, grep-able pre-flight |
| `anti-slop-redesign` | change an existing surface: mode (`greenfield` / `preserve` / `overhaul`), audit first, levers in order, never-change-silently list |
| `anti-slop-image-direction` | **opt-in, paid** reference images for `marketing` / `new-site`, distilled into a written direction brief |
| `anti-slop-brandkit` | **opt-in, paid** brand board for a `new-site` with no brand; a proposal, never auto-applied |

## Surface profiles

Before any review or generation the agent declares a one-line Design Read:
`profile · audience · mood · VARIANCE/MOTION/DENSITY`. The profile decides
which rules fire.

| Profile | Universal tells (A) | Marketing tells (B) | Layout discipline | Redesign default | Image direction |
|---|---|---|---|---|---|
| `product-ui` | ✓ | ✗ | ✗ | `preserve` | forbidden |
| `marketing` | ✓ | ✓ | ✓ | `preserve` | opt-in |
| `new-site` | ✓ | ✓ | ✓ | `greenfield` | opt-in |

Theme parity (T1-T3) applies to every profile: zero added raw colour literals
in the diff, the project's token guard clean, and a screenshot set per profile
(default theme dark + light + one non-default palette for `product-ui`).

## What it catches

| Part | Scope | Examples |
|------|-------|----------|
| **A — Universal** | every surface, dashboards included | AI-purple glow, Inter-as-default, the em-dash ban, "Jane Doe / Acme / 99.99%" fake data, div-based fake screenshots, hand-rolled SVG icons, happy-path-only states, unmotivated motion, arbitrary z-index |
| **B — Marketing only** | landing / portfolio / about | hero discipline, eyebrow-per-section, equal-3-card rows, zigzag cap, bento rhythm, decoration/locale/scroll-cue strips, duplicate CTA intent, nav on one line ≤ 80px |
| **T — Theme parity** | every profile | added colour literals, token guard, per-theme screenshots |

Every rule has an **override path**: when the brief explicitly asks for the
"banned" thing, it is allowed — done with intent, not by default-reaching.

## Image prerequisite (opt-in, paid)

`anti-slop-image-direction` and `anti-slop-brandkit` only generate images on an
explicit request, after the user confirms the image count, the backend and that
generation is paid. Headless runs never generate. Without a backend both skills
fall back to a text-only brief, so the prerequisite is optional.

```bash
pi install npm:@blackbelt-technology/pi-dashboard-nano-banana   # provides pi-nano-banana
export GEMINI_API_KEY=...                                       # or use the pi/OpenRouter backend (--backend pi)
```

**Images are experimental; the text brief is the primary path.** The
`pi-nano-banana` bin is a TypeScript entry and does not run as a plain command
from an npm / `pi install` copy (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`).
Run it through `tsx`:

```bash
npx tsx ~/.pi/agent/npm/node_modules/@blackbelt-technology/pi-dashboard-nano-banana/src/bin/nano-banana.ts "<prompt>" --output out.png
# inside the pi-agent-dashboard monorepo:
npx tsx packages/nano-banana/src/bin/nano-banana.ts "<prompt>" --output out.png
```

## Relationship to `frontend-mockup-loop`

Separate, complementary skills:

| | frontend-mockup-loop | anti-slop suite |
|---|---|---|
| Shape | ground→contract→mockup→test→fix→learn **loop** | checklist + redesign protocol + opt-in references |
| Basis | cite an **external public rule** (Nielsen, WCAG, Laws of UX) | codified **AI-tell catalog** |
| Authority | owns the **hard gates** (WCAG-AA, severity-4) | **advisory only** |

When both run: the loop's a11y floor and cite-a-source rule **win**; the suite
feeds concrete failing items into the loop's FIX step and never overrides a gate.
A direction brief from generated images is one GROUND input, never the source.

## Attribution

Adapted from [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill)
(MIT) at commit `18dfc92` (2026-10-08): `taste-skill`, `redesign-skill`,
`image-to-code-skill`, `imagegen-frontend-web` and `brandkit`. Only countable
rules are kept; stack coupling (Next RSC / Motion / GSAP / next/font) is
removed; generated images are direction, not source. The per-section map and
refresh procedure are in [`UPSTREAM.md`](UPSTREAM.md).

## License

MIT
