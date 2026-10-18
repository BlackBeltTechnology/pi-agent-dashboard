# SKILL.md — anti-slop-frontend index

Pull-only condensed map. Source: packages/anti-slop/.pi/skills/anti-slop-frontend/SKILL.md. Mechanical, countable AI-tell checklist for generated frontend. Advisory only.

Triggers: "does this look AI-generated", "anti-slop pass", "remove the AI tells", "why does this look templated", "design review for slop".

## Scope
- Advisory; never a gate. WCAG-AA + severity gates (frontend-mockup-loop) win.
- Standalone in any React/Tailwind/HTML project.
- Override path: brief explicitly asks for banned thing → allowed, done with intent.
- Suite: `anti-slop-frontend` (review/generate), `anti-slop-redesign` (existing surface), `anti-slop-image-direction` (opt-in marketing/new-site images), `anti-slop-brandkit` (opt-in brand board).

## Design Read (declare first)
- Line: `Design Read: <profile> · <audience> · <mood> · VARIANCE <n> / MOTION <n> / DENSITY <n>`.
- Profiles: `product-ui` (A only; redesign `preserve`; images forbidden) · `marketing` (A+B, B7; `preserve`; images opt-in) · `new-site` (A+B, B7; `greenfield`; images opt-in).
- Never infer profile silently. Ambiguous → ask one question. No Design Read → Verification fails.
- Dials 1-10: VARIANCE (1 symmetry), MOTION (1 static), DENSITY (1 airy). Dashboards: high DENSITY, low VARIANCE/MOTION.

## Part A — universal (all surfaces)
- A1 Color: no AI-purple/blue default glow; neutral (Zinc/Slate/Stone) + ONE accent; accent saturation < 80%; one neutral temperature; no pure `#000`/`#fff`.
- A2 Type: Inter discouraged as default (Geist, Outfit, Cabinet Grotesk, Satoshi). Serif very discouraged; banned defaults Fraunces, Instrument Serif. Emphasis = same family italic/bold. One radius scale per page.
- A3 Em-dash ban: zero `—`, zero `–` separator. Use `.`, `,`, `:`, `()`, line break, or ` - `. Ranges use plain hyphen. Check: grep rendered output.
- A4 Fake data: no John Doe/Sarah Chan/Jack Su; no Acme/Nexus/SmartFlow/Cloudly; no 99.99%/50%/1234567; no fake specs (`5.8mm`, `4.1×`) unless real or labeled mock; no Elevate/Seamless/Unleash/Next-Gen/Revolutionize; no egg/default avatars.
- A5 Assets: no div-built fake screenshots; no hand-rolled SVG icons; one icon family (Phosphor/HugeIcons/Radix/Tabler), uniform stroke; Lucide only on request; images `picsum.photos/seed/{seed}/{w}/{h}` or generated; no dead Unsplash.
- A6 States: loading/empty/error exist; skeletons match layout; CTA text WCAG AA vs own bg; form contrast AA; label above input (no placeholder-as-label).
- A7 Motion: each animation justified in one sentence; `MOTION > 4` → page moves; banned `window.addEventListener('scroll', …)` and React-state scroll/rAF loops; use scroll-driven CSS, IntersectionObserver; reduced-motion for `MOTION > 3`.
- A8 Layering: z-index only from one documented layer scale (base, sticky, dropdown, overlay, modal, toast); no `z-[9999]`/`z-50` sprinkles; grain/noise/blur only on fixed `pointer-events-none` layers; animate only `transform`/`opacity`; no wrapper-div towers (>4 layout-only divs).

## Part B — marketing only (skip for dashboards/product UI)
- B1 Hero: fits viewport; headline ≤ 2 lines; subtext ≤ 20 words / ≤ 4 lines; CTA above fold; hero top padding ≤ `pt-24`; max 4 hero text elements (eyebrow/brand strip, headline, subtext, CTAs); no version labels unless launch.
- B2 Eyebrow: small uppercase tracked label above headline. Max 1 per 3 sections (hero counts). Check: fail if > ceil(sections/3). No section-number eyebrows (`00 / INDEX`). Default: drop it.
- B3 Layout: no 3 equal feature cards; max 2 consecutive image+text splits; ≥ 4 layout families per 8 sections; no split-header; bento N items → N cells, ≥2-3 with visual variation; max one marquee.
- B4 CTA: one label per intent (no "Get in touch"/"Let's talk"/"Contact us" mix); no CTA wrap at desktop; logo wall under hero, logos only, real SVG marks (Simple Icons / devicon) or monograms.
- B5 Decoration banned: hero bottom strip (`BRAND. MOTION. SPATIAL.`); locale/time/weather strips; scroll cues; version footers (`v1.4.2`, `Build 0048`); `·` max 1 per metadata line; decorative status dots; pills on images; photo-credit captions; poetic labels ("From the field"); hairline `border-t`+`border-b` per row in lists >5 items.
- B6 Copy: re-read every string; fix broken phrasing, unclear referents, AI-cute wordplay.
- B7 Layout discipline: nav one line ≥ 1024px; nav height ≤ 80px (default 64-72px); hero CTA visible at 1440×900 and 1024×768; every multi-column section declares < 768px fallback.

## Theme parity (T)
- T1: zero added raw colour literals (`#hex`, `rgb(`, `rgba(`, `hsl(`, `hsla(`) on `+` diff lines in `*.tsx|*.jsx|*.css|*.html|*.vue|*.svelte`. Exclude tests, fixtures, stories, `*.svg`, token-definition files. Use theme tokens.
- Diff check: `git diff -U0 origin/main...HEAD -- <globs> | grep -E '^\+[^+]' | grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\('` (adjust base ref).
- T2: token guard (if project has one) reports no new violation; else N/A.
- T3 screenshots: `product-ui` = default dark + default light + one non-default palette; `marketing` = light + dark; `new-site` = one per shipped mode. Human judgment = non-gating note.

## Mechanical pre-flight
- Em-dash; AI-purple; accent lock (one hex family); default font not Inter (serif not Fraunces/Instrument Serif); no Doe/Acme/99.99%/Elevate; no div-built UI or hand-rolled icon paths; CTA/input AA; no `addEventListener('scroll')` + reduced-motion; marketing-only: eyebrow count, zigzag ≤ 2, CTA intent, decoration strips, layout discipline (B7); z-index scale + no animated layout props; T1, T2, T3.
- Unverifiable box = flagged item → fix step.

## Pitfalls
- Advisory, not hard gates. Part B never on dashboards. Tell never justifies violating cited public rule. Honor override path.

## Verification
- Design Read declared; dials reasoned from brief; only profile's groups applied; pre-flight run; Part B only on marketing; T1-T3 recorded; no tell overrides WCAG-AA or severity-4.

Upstream: Leonxlnx/taste-skill @ 18dfc92 (MIT). Section map: `packages/anti-slop/UPSTREAM.md`.
