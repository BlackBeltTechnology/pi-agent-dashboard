---
name: anti-slop-image-direction
description: "Opt-in, paid reference images for marketing or new-site work: plan one image per section, confirm count, backend and cost, generate with pi-nano-banana, then distill a written direction brief for the mockup loop. Images are direction, never source. Never for product UI. Triggers: \"generate design references\", \"image direction for this page\", \"show me visual directions\"."
license: MIT
metadata:
  author: blackbelt-technology
  version: "0.1"
  adapted_from: "Leonxlnx/taste-skill@18dfc92 (image-to-code-skill / image-to-code + imagegen-frontend-web, MIT), inverted: images are direction, not source. Section map: packages/anti-slop/UPSTREAM.md."
---

# anti-slop-image-direction

Generated reference images break a model out of its default layouts (centered
hero over dark mesh, three equal cards). They are also paid, slow, and full of
the same tells we ban. This skill keeps the benefit and drops the risk: images
are an **opt-in direction aid**, distilled into a written brief, and the
mockup loop's gates still decide.

**Authority: advisory.** Findings feed the frontend-mockup-loop FIX step and
never override a WCAG-AA or severity gate. The direction brief is one input to
GROUND; documented public rules and the WCAG gates still win over anything an
image suggests.

## When it applies

All of these must hold, otherwise generate nothing:

1. The declared profile (`anti-slop-frontend` Design Read) is `marketing` or
   `new-site`.
2. The user explicitly asked for image direction (or passed an explicit flag).
3. The user confirmed the plan in step 1.

Image direction is forbidden for `product-ui`. When asked for a dashboard,
admin panel, editor or any app screen, refuse image generation, say that image
direction does not apply to product UI, and offer a text-only direction brief
instead.

## Images are experimental; the text brief is primary

The text-only brief (see Fallback) is the primary, always-available path.
Images are an experimental extra. `pi-nano-banana` ships as a TypeScript bin:
a global `npm` / `pi install` copy does **not** run as a plain command
(`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). Resolve the runner like this:

| Where | Runner (`$NB`) |
|---|---|
| pi-agent-dashboard monorepo | `npx --no-install tsx packages/nano-banana/src/bin/nano-banana.ts` (the repo's locked `tsx`) |
| after `pi install npm:@blackbelt-technology/pi-dashboard-nano-banana` | `npx --yes tsx@4.23.12 ~/.pi/agent/npm/node_modules/@blackbelt-technology/pi-dashboard-nano-banana/src/bin/nano-banana.ts` (exact pinned `tsx`) |

Probe: run `$NB` with no arguments; it prints a `usage: pi-nano-banana ...`
line. No usage line → the backend is unavailable → Fallback.

Never run an unpinned `npx tsx` outside the monorepo: `npx` would fetch
whatever `tsx` the registry serves and execute it with your permissions.

Backends: `gemini` (default, needs `GEMINI_API_KEY` in the environment or a
`.env`) or `pi` (`--backend pi`, an OpenRouter credential inside pi; a
different bill).

## Procedure

### 1. Plan, then confirm

- Resolve `<mockupDir>` the same way the mockup loop's MOCKUP step does: in the
  pi-agent-dashboard repo, `openspec/changes/<name>/mockups/` when a change
  exists, else `mockups/<slug>/`; elsewhere, the loop's mockup directory.
  References go in `<mockupDir>/refs/`.
- List the page sections. Plan one image per section.
- Pick the variation axes for each section (below).
- Confirm with `ask_user`, stating: the image count, the backend (`gemini` or
  `pi`), and that generation is paid. No confirmation → generate nothing.
- **Headless rule:** interactivity is judged by whether the `ask_user` tool is
  in your tool list. If it is absent (subagent, CI, headless run), the run is
  headless: generate nothing and write the text-only brief.

### 2. Generate

- One image per planned section, using only the backend named in the
  confirmed plan:

  ```bash
  $NB "<prompt>" --output <mockupDir>/refs/<nn>-<section>.png            # gemini
  $NB "<prompt>" --output <mockupDir>/refs/<nn>-<section>.png --backend pi
  ```

- A backend change requires a new confirmation. If the confirmed backend fails
  (e.g. Gemini key missing) and the other one is available, stop, re-plan
  naming the new backend, and ask again. Never switch the backend silently.
- Re-generating an image, or adding images beyond the confirmed count, also
  needs a new confirmation.
- Every prompt carries its section's variation axes and the Part A bans: no
  purple/violet glow, no neon gradient, no div-style fake dashboard, no stock
  "Jane Doe" faces, no em-dashes in any rendered text.
- Describe copy, never quote it: "a short two-line headline about release
  speed", not the headline itself.

### 3. Analyze → `refs/direction.md`

Read every image and write `<mockupDir>/refs/direction.md` with, per section
and for the set:

- **Layout family** and composition anchor.
- **Spacing rhythm** (tight / regular / airy, section scale).
- **Palette** as hex values sampled from the image.
- **Type character** (geometric sans, grotesk, mono, editorial serif, ...).
- **Observed tells**: every Part A tell seen in an image (e.g. AI-purple glow,
  fake UI panel, pure black). Observed tells are listed and excluded: they
  never carry into the palette or layout direction.
- Consistency across images: one neutral temperature, one accent family.

### 4. Hand-off

`direction.md` becomes one input to frontend-mockup-loop step 1 (GROUND),
next to the shipped UI and the documented public rules. Where the direction
conflicts with a cited rule or a WCAG gate, the rule and the gate win.

## Direction, not source

- Images are direction, never the source of truth. The mockup is built from
  the brief plus cited rules, not traced from pixels.
- Text visible in a generated image is a placeholder and is never transcribed
  into copy, headings, alt text or the brief.
- Part A tells are checked on the images themselves, not only on the code.

## Variation axes

Pick one value per axis per section; vary across the page. This section is
also the text-only brief when no image is generated.

- **Composition anchor**: centered statement · top-left lead · bottom-left text
  over image · left-third caption + two-thirds visual (never twice in a row) ·
  off-grid editorial offset · stacked center · image as canvas with a clean
  text safe area. At least 3 different anchors per page.
- **Hero scale** (per page): giant statement · mid editorial · mini minimalist.
- **Background mode**: solid surface with inline asset · subtle texture or
  grid · full-bleed image with tonal overlay · editorial side image · flat
  colour block + detail crop · low-chroma tonal gradient · duotone image.
  Never the same mode on every section.
- **Type character**: geometric sans · grotesk · mono accent · editorial serif
  (only when the brief names one, `anti-slop-frontend` A2).
- **CTA variation**: primary pill · outline · inline link with arrow ·
  full-width banner · caption under a visual. Vary at least once; the primary
  action stays unmistakable.

## Fallback

When the runner is not resolvable, the probe prints no usage line, or the
backend has no usable credentials: report the reason in one line, write
`<mockupDir>/refs/direction.md` text-only from the variation axes section
above, and continue. Do not fail the task. The same text-only brief is the
output of a headless run and of a declined confirmation.

## Pitfalls

- Do NOT generate for `product-ui`, ever, even when asked twice.
- Do NOT generate before the user confirmed count, backend and cost.
- Do NOT copy a headline, label or number out of an image.
- Do NOT let an image's palette smuggle in a tell (purple glow, pure black).

## Verification

- Profile is `marketing` or `new-site`; the request was explicit.
- The confirmation names image count, backend and paid, and precedes the
  first image; any backend change has its own confirmation.
- `refs/` holds exactly the confirmed number of images, one per section.
- `refs/direction.md` lists layout family, rhythm, palette hex, type
  character and observed tells; no image text appears verbatim in the mockup.
- Headless, declined or unavailable runs produced a text-only brief and zero
  images.
