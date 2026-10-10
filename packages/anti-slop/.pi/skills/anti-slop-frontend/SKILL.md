---
name: anti-slop-frontend
description: "A mechanical, countable anti-slop checklist for AI-generated frontend. Catches the specific signatures an undirected model defaults to: AI-purple glows, Inter-everywhere, em-dashes, div-based fake screenshots, eyebrow-on-every-section, beige+brass \"premium\" palettes, generic Jane Doe / Acme data. Advisory layer that pairs with frontend-mockup-loop (which owns the cite-a-source loop plus WCAG gates) but works standalone in any React/Tailwind/HTML project. Triggers: \"does this look AI-generated\", \"anti-slop pass\", \"remove the AI tells\", \"why does this look templated\", \"design review for slop\"."
license: MIT
metadata:
  author: blackbelt-technology
  version: "0.2"
  adapted_from: "Leonxlnx/taste-skill@18dfc92 (taste-skill / design-taste-frontend, MIT) - countable rules distilled, stack-coupling removed, scoped by surface profile. Section map: packages/anti-slop/UPSTREAM.md."
---

# anti-slop-frontend

A flat, **mechanical** checklist of the concrete signatures an undirected model
emits when it tries to "look designed." Every rule here is **countable or
binary** - you can mechanically verify pass/fail, not argue taste. That is the
whole point: "it looks better" is not a check; "eyebrow count > ceil(sections/3)"
is.

## What this is, and is NOT

- **IS** an advisory catalog of AI-tells, scoped by surface kind.
- **IS** standalone - works with no tooling, in any React/Tailwind/HTML project.
- **IS NOT** a design philosophy, a loop, or a gate. It scores; it never blocks.

### Relationship to `frontend-mockup-loop`

Different jobs, intentionally separate:

| | frontend-mockup-loop | anti-slop-frontend (this) |
|---|---|---|
| Shape | ground→contract→mockup→test→fix→learn **loop** | flat **checklist** |
| Basis | cite an **external public rule** (Nielsen, WCAG, Laws of UX) | codified **AI-tell catalog** |
| Authority | owns the **hard gates** (WCAG-AA, severity-4) | **advisory only**, drives the fix list |
| Domain | product UI, dashboards, flows | universal tells + marketing-surface tells |

When both are present: the loop's a11y floor and cite-a-source rule **win**.
This skill feeds concrete failing items into the loop's FIX step. It never
overrides a gate, and a tell here is never a reason to violate a cited rule.

**Authority: advisory.** Findings feed the frontend-mockup-loop FIX step and
never override a WCAG-AA or severity gate. When a recommendation conflicts
with a gate result, the gate result stands and the recommendation is recorded
as overridden.

### The suite

| Skill | Use for |
|---|---|
| `anti-slop-frontend` (this) | review or generate any surface; the tell catalog |
| `anti-slop-redesign` | change an existing surface (mode, audit, levers, protected list) |
| `anti-slop-image-direction` | opt-in reference images for `marketing` / `new-site` |
| `anti-slop-brandkit` | opt-in brand board for a `new-site` with no brand |

> **Honesty note:** these rules are curated *taste*, hardened into countable
> form. They are good defaults, not laws of nature. Every rule has an **override
> path**: when the brief explicitly asks for the "banned" thing, it is allowed -
> execute it with intent, not by accident.

---

## Design Read and surface profile (declare first)

Before reviewing or generating, state ONE line:

```
Design Read: <profile> · <audience> · <mood> · VARIANCE <n> / MOTION <n> / DENSITY <n>
```

Example: `Design Read: marketing · technical buyers · calm, precise · VARIANCE 4 / MOTION 3 / DENSITY 5`.

Audience and mood are declared context, not checks. The **profile** is the
switch that decides which rule groups fire:

| Profile | Part A | Part B | Layout discipline (B7) | Redesign default | Image direction |
|---|---|---|---|---|---|
| `product-ui` | ✓ | ✗ | ✗ | `preserve` | forbidden |
| `marketing` | ✓ | ✓ | ✓ | `preserve` | opt-in |
| `new-site` | ✓ | ✓ | ✓ | `greenfield` | opt-in |

- `product-ui`: dashboards, admin panels, data tables, editors, wizards, any
  app screen.
- `marketing`: an existing landing / portfolio / about / docs-home page.
- `new-site`: a site with no shipped design yet.

Never infer the profile silently. An undeclared profile is how marketing rules
leak into dense UI. If the brief is ambiguous, ask exactly one question. A
review or generation reported without a Design Read fails Verification.

---

## The three dials (set once, up front)

State these before reviewing or generating. They gate which rules fire and how hard.

- **`VARIANCE` (1-10)** - 1 = perfect symmetry, 10 = artsy chaos
- **`MOTION` (1-10)** - 1 = static, 10 = cinematic/physics
- **`DENSITY` (1-10)** - 1 = art-gallery airy, 10 = cockpit/packed-data

Infer from the brief; don't silently use a baseline. Dashboards/data UI live high
on DENSITY and low on VARIANCE/MOTION. Landing/portfolio live the opposite.

---

## PART A - Universal tells (apply to EVERY surface, dashboards included)

These fire regardless of surface kind. A dense admin panel is just as guilty of
AI-purple and Inter-everywhere as a landing page.

### A1. Color
- **No AI-purple/blue glow as default.** No automatic violet button glows, no
  random neon gradients ("the Lila tell"). Neutral base (Zinc/Slate/Stone) +
  ONE high-contrast accent. *Override:* brand literally is purple.
- **Max 1 accent color, saturation < 80% default.** Lock it: the same accent on
  the whole page. A warm-grey UI does not grow a blue CTA in section 7.
- **One neutral temperature per project.** Don't drift warm-grey ↔ cool-grey.
- **No pure `#000000` / pure `#ffffff`.** Off-black (zinc-950) and off-white;
  pure values kill depth.

### A2. Typography
- **Inter is discouraged as the *default*.** Reach past it (Geist, Outfit,
  Cabinet Grotesk, Satoshi) unless the brief wants neutral/Linear-style or is
  accessibility-first. *Override exists.*
- **Serif is very discouraged as default.** "Feels premium/creative" is not a
  reason. Specifically banned as defaults: **Fraunces, Instrument Serif**.
  Serif only when the brief names one or the family is genuinely
  editorial/luxury/heritage.
- **Emphasis = italic/bold of the SAME family.** Never inject a random serif
  word into a sans headline for "visual interest."
- **One corner-radius scale per page** (all-sharp / all-soft / all-pill), or a
  documented rule followed everywhere.

### A3. The em-dash ban (the #1 tell)
- **Zero `—` and zero `–`-as-separator anywhere visible.** Headlines, labels,
  pills, body, quotes, attribution, captions, buttons, alt text. No "sparingly."
  Replace with a period, comma, colon, parentheses, line break, or a spaced
  hyphen ` - `. Ranges use a plain hyphen (`2018-2026`, `€40-80k`).
- Mechanical check: grep the rendered output for `—`/`–`. Any hit = fail.

### A4. Fake data ("Jane Doe" effect)
- **No generic names.** "John Doe / Sarah Chan / Jack Su" → realistic,
  locale-appropriate names.
- **No generic brand names.** "Acme / Nexus / SmartFlow / Cloudly" → contextual
  names that sound real.
- **No fake-perfect numbers.** `99.99%`, `50%`, `1234567` → organic values
  (`47.2%`, real-looking phone formats). Fake-precise engineering specs
  (`5.8mm`, `4.1×`) are banned unless from real data or labeled mock.
- **No filler verbs.** "Elevate / Seamless / Unleash / Next-Gen / Revolutionize"
  → concrete verbs.
- **No generic avatars** (SVG "egg", default user glyph) → believable placeholders.

### A5. Assets & icons
- **No div-based fake screenshots.** Building a fake dashboard/terminal/task-list
  out of styled `<div>`s is the single biggest tell. Use a real screenshot, a
  generated image, a real mini component preview, or nothing.
- **No hand-rolled SVG icons.** Use one icon family (Phosphor / HugeIcons /
  Radix / Tabler), standardized stroke width. Lucide only on explicit request.
- **No hand-rolled decorative SVG illustrations** as default.
- **No broken image links.** Use `picsum.photos/seed/{descriptive}/{w}/{h}` or
  generated assets, never dead Unsplash URLs.

### A6. Interactive states (the "happy-path only" tell)
- **Loading / empty / error states exist**, not just the static success state.
  Skeletons match final layout shape; avoid generic spinners.
- **Button contrast (a11y).** Every CTA's text passes WCAG AA against its own
  background. No white-on-white, no transparent button on same-color bg with no
  border. *(This one is also a hard gate when frontend-mockup-loop runs.)*
- **Form contrast (a11y).** Inputs, placeholders, focus rings, helper, error text
  all pass AA against the section bg. Label above input; never placeholder-as-label.

### A7. Motion must be motivated
- **Every animation justifies itself in one sentence** - hierarchy, storytelling,
  feedback, or state-transition. "It looked cool" is not valid. Motion-for-show
  is amateur.
- **Motion claimed = motion shown.** If `MOTION > 4`, the page actually moves; if
  you can't ship working motion, drop the dial and ship clean static.
- **Banned mechanism: `window.addEventListener('scroll', …)`** and React-state
  scroll/rAF loops. Use scroll-driven CSS, IntersectionObserver, or a motion
  library's scroll primitives.
- **Reduced-motion honored** for anything above `MOTION 3`.

### A8. Layering and DOM cost
- **No arbitrary z-index.** Every `z-*` / `z-index` value comes from one
  documented layer scale (e.g. base, sticky, dropdown, overlay, modal, toast).
  Mechanical check: count distinct z-index values in the diff; any value not in
  the project's scale = fail. `z-[9999]` / `z-50` sprinkled to "win" a stacking
  fight is the tell.
- **Grain / noise / blur filters only on fixed, `pointer-events-none` layers**,
  never on a scrolling container (continuous repaint).
- **Animate only `transform` and `opacity`.** Animating `top` / `left` /
  `width` / `height` = fail.
- **No wrapper-div towers.** A component that nests > 4 layout-only `<div>`s to
  place one element is flagged; flatten with grid/flex on the parent.

---

## PART B - Marketing-surface tells (landing / portfolio / about ONLY)

Skip Part B entirely for dashboards, data tables, wizards, editors, product UI.
These rules govern hero-driven marketing pages, where the model's worst
templating habits live.

### B1. Hero discipline
- **Hero fits the initial viewport.** Headline ≤ 2 lines, subtext ≤ 20 words and
  ≤ 4 lines, CTA visible without scroll. A 4-line headline is a font-size error.
- **Hero top padding ≤ `pt-24` desktop** (content must not float mid-viewport).
- **Max 4 text elements in the hero**: (eyebrow OR brand strip), headline,
  subtext, CTAs. Banned in hero: trust micro-strip, pricing teaser, tagline
  under CTAs, feature bullets, avatar row - those move to sections below.
- **No version labels** (`V0.6`, `BETA`, `INVITE-ONLY`) unless the brief is a launch.

### B2. The eyebrow tell (#1 violated rule)
- An "eyebrow" = small uppercase wide-tracking label above a section headline
  (`text-[11px] uppercase tracking-[0.18em]`).
- **Max 1 eyebrow per 3 sections** (hero counts as 1). Mechanical check: count
  `uppercase tracking` micro-labels above headlines; fail if > ceil(sections/3).
- **No section-number eyebrows** (`00 / INDEX`, `001 · Capabilities`, `06 · how it
  works`). The section's position already categorizes it.
- **Default fix: drop the eyebrow.** The headline alone is enough.

### B3. Layout repetition
- **No 3 equal feature cards.** The "three identical horizontal cards" row is the
  default. Use asymmetric grid, zig-zag, or a different family.
- **Zigzag cap: max 2 consecutive image+text splits.** The 3rd in a row is a fail.
- **Section-layout-repetition ban.** A layout family appears at most once. 8
  sections → ≥ 4 distinct families.
- **No split-header** ("big left headline + small right floating paragraph") as
  default. Stack headline over body instead.
- **Bento: exact cell count, real rhythm, background diversity.** N items → N
  cells (no empty tiles); ≥ 2-3 cells have real visual variation (image,
  gradient, pattern), not all white-on-white text cards.
- **Marquee: max one per page.**

### B4. CTA & social proof
- **No duplicate CTA intent.** "Get in touch" + "Let's talk" + "Contact us" on one
  page = fail. One label per intent, everywhere.
- **No CTA wraps to 2+ lines at desktop** (shorten label or widen button).
- **Logo wall lives UNDER the hero, is logos only** (no industry labels beneath),
  uses real SVG marks (Simple Icons / devicon) or generated monograms, not plain
  text wordmarks.

### B5. Decoration tells (banned by default)
- **No decoration text strip** at hero bottom (`BRAND. MOTION. SPATIAL.`).
- **No locale / city / time / weather strips** (`LIS 14:23 · 18°C`) unless the
  brief is genuinely place- or timezone-focused.
- **No scroll cues** (`Scroll`, `↓ scroll`, `Scroll to explore`).
- **No version footers** (`v1.4.2`, `Build 0048`, `last sync 4s ago`) on
  marketing pages - those are devtool fixtures.
- **The middle-dot `·` is rationed** (max 1 per metadata line; not the default
  separator for everything).
- **No decorative status dots** before every nav item / row / badge. Only for
  real semantic state, sparingly.
- **No pills/labels overlaid on images** and **no pretentious photo-credit
  captions** (`Field study no. 12 · Ines Caetano`) on stock/placeholder images.
- **No poetic section labels** ("From the field", "Field notes", "On our desks")
  → plain functional labels or none.
- **No `border-t` + `border-b` on every row** of a long list/spec table. Long
  lists (>5 items) use a real component (grouped chunks, card grid, tabs,
  scroll-snap), not a hairline-per-row `<ul>`.

### B6. Copy self-audit
- Re-read every visible string. Flag and rewrite: grammatically broken phrases,
  unclear referents, cute-but-wrong wordplay, fake-craftsman micro-meta. Plain
  functional copy beats AI-cute copy.

### B7. Layout discipline (`marketing` / `new-site` only)
- **Nav renders on one line at desktop** (≥ 1024px). Two lines = fail; condense
  labels, drop secondary items, or collapse to a menu.
- **Nav height ≤ 80px at desktop** (default 64-72px).
- **Hero CTA visible without scrolling** at 1440×900 and 1024×768 (see B1).
- **Every multi-column section declares its < 768px fallback** in the same
  component.

---

## Theme parity (T)

A change must hold in every theme the project ships, not only the default.
Each item is pass/fail. Human visual judgment of the screenshots is a
**non-gating** note: record it, it never fails the review.

### T1. Zero added raw colour literals (all profiles)
- Count `#hex`, `rgb(`, `rgba(`, `hsl(`, `hsla(` on **added** lines only (the
  `+` lines of the change's diff) in shipped UI source
  (`*.tsx|*.jsx|*.css|*.html|*.vue|*.svelte`). Any hit = fail; use a theme
  token instead.
- Excluded: tests, fixtures, stories, `*.svg`, and the token-definition files
  themselves (the files that declare the tokens).
- Diff-scoped command (adjust the base ref):

  ```bash
  git diff -U0 origin/main...HEAD -- '*.tsx' '*.jsx' '*.css' '*.html' '*.vue' '*.svelte' \
    ':!**/__tests__/**' ':!**/*.test.*' ':!**/*.spec.*' ':!**/fixtures/**' ':!**/*.stories.*' \
    | grep -E '^\+[^+]' | grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\('
  ```

  Also exclude your token-definition files with extra `':!<path>'` entries.

### T2. Token guard clean (`product-ui`)
- If the project has a theme-token guard (a script that flags undeclared or
  misused tokens), it reports no **new** violation. No guard = item N/A.

### T3. Screenshot set per profile
- `product-ui`: three screenshots: the default theme in dark, the default
  theme in light, and one non-default palette. A missing non-default palette
  screenshot = fail.
- `marketing`: screenshots in light and dark, both recorded in the review.
- `new-site`: one screenshot per shipped mode.

---

## Mechanical pre-flight (the grep-able subset)

The rules below can be checked by string-search, not judgment. Run them last.

- [ ] **Em-dash:** zero `—` / `–`-as-separator in rendered output (A3).
- [ ] **AI-purple:** no default violet glow/gradient unless brand-justified (A1).
- [ ] **Accent lock:** one accent hex family across all sections (A1).
- [ ] **Default font:** not Inter (unless justified); serif is not Fraunces /
      Instrument Serif (A2).
- [ ] **Fake data:** no "Doe / Acme / 99.99% / Elevate" (A4).
- [ ] **Fake screenshots:** no div-built product UI; no hand-rolled icon paths (A5).
- [ ] **CTA/form contrast:** every CTA + input passes WCAG AA (A6).
- [ ] **Motion:** no `addEventListener('scroll')`; reduced-motion present (A7).
- [ ] *(marketing only)* **Eyebrow count** ≤ ceil(sections/3) (B2).
- [ ] *(marketing only)* **Zigzag** ≤ 2 consecutive splits; ≥ 4 layout families (B3).
- [ ] *(marketing only)* **CTA intent** not duplicated; no CTA wrap at desktop (B4).
- [ ] *(marketing only)* no decoration/locale/scroll-cue/version strips (B5).
- [ ] *(marketing only)* **Layout discipline:** nav on one line, nav ≤ 80px,
      hero CTA visible without scroll (B7).
- [ ] **Z-index:** every z-index value is on the documented layer scale; no
      animated layout properties (A8).
- [ ] **Theme parity:** zero added raw colour literals in shipped UI source (T1).
- [ ] **Theme parity:** token guard reports no new violation, if one exists (T2).
- [ ] **Theme parity:** profile screenshot set exists (T3).

If a box can't be honestly ticked, it's a flagged item - feed it to the fix step.

---

## Pitfalls

- Do NOT treat these as hard gates. They are advisory; the WCAG/severity gates
  (owned by frontend-mockup-loop) are the only hard blockers.
- Do NOT apply Part B to dashboards/product UI - it will fight dense, correct UI.
- Do NOT cite a tell from this catalog as justification to violate an external
  documented rule. When the two conflict, the cited public rule wins.
- Do NOT forget the override path: when the brief explicitly asks for the
  "banned" thing, allow it - done with intent, not by default-reaching.

## Verification

- A one-line Design Read (profile, audience, mood, dials) was declared before
  the review or generation; the dials were reasoned from the brief, not defaulted.
- Only the rule groups the profile enables were applied.
- The grep-able pre-flight subset was run; every hit is either fixed or has a
  documented brief-driven override.
- Part B was applied only to marketing surfaces; skipped for product UI.
- Theme parity items T1-T3 were recorded for the declared profile.
- No advisory tell was used to override a WCAG-AA or severity-4 gate.

---

*Adapted from [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill)
(`design-taste-frontend`, MIT) at commit `18dfc92` (2026-10-08); the
per-section map lives in `packages/anti-slop/UPSTREAM.md`. This is a distillation of its countable rules:
stack-coupling (Next RSC / Motion / GSAP / next/font) removed, rules re-scoped
into universal vs marketing-only, and reframed as an advisory catalog that pairs
with - never overrides - frontend-mockup-loop's cite-a-source loop and hard
gates. Original taste, original author's eye; full prose corpus and GSAP code
skeletons live in the upstream repo.*
