---
name: anti-slop-brandkit
description: "Opt-in, paid brand board for a new site with no existing brand: confirm count, backend and cost, generate one 3x3 board (logo concept, palette, type, image direction) with pi-nano-banana plus a written brand.md. A proposal for the user to approve, never an auto-applied identity. Triggers: \"make a brand kit\", \"brand board for this new site\", \"propose a visual identity\"."
license: MIT
metadata:
  author: blackbelt-technology
  version: "0.1"
  adapted_from: "Leonxlnx/taste-skill@18dfc92 (brandkit, MIT), reduced to a proposal-only board behind a paid-generation confirm. Section map: packages/anti-slop/UPSTREAM.md."
---

# anti-slop-brandkit

A site with no brand gets a generic one by default: purple gradient, Inter,
a letter-in-a-circle logo. This skill proposes a deliberate starting identity
instead. The output is a **proposal**: a board image plus a written brief that
the user approves before anything enters the project.

**Authority: advisory.** Findings feed the frontend-mockup-loop FIX step and
never override a WCAG-AA or severity gate. A proposed palette that fails AA
contrast is fixed in the brief, not defended.

## When it applies

All of these must hold, otherwise generate nothing:

1. The declared profile (`anti-slop-frontend` Design Read) is `new-site`.
2. The project has no existing brand assets (logo, palette, type). With a
   brand, use `anti-slop-redesign` instead.
3. Explicit request: the user asked for a brand kit / board.
4. The user confirmed the plan in step 1.

## Proposal, not identity

- Never write brand values into project tokens or UI contracts before the user
  approves `brand.md`. Output lands in the mockup folder only.
- After approval, frontend-mockup-loop CONTRACT (`init_ui_contract`) adopts
  the values; this skill never edits token files itself.
- Logos are labelled concepts, never final marks. The board and `brand.md`
  both say "logo concept".

## Procedure

Image generation uses the same runner, backends, headless rule and fallback
as `anti-slop-image-direction` (read its "Images are experimental" section for
how to resolve `$NB`).

### 1. Plan, then confirm

- Resolve `<mockupDir>` exactly as `anti-slop-image-direction` does.
- Write the strategy first, in three lines: what the product does, for whom,
  and the one feeling the brand must carry.
- Confirm with `ask_user`, stating: the image count (1 board unless the user
  asks for variants), the backend (`gemini` or `pi`), and that generation is
  paid. No confirmation → generate nothing.
- A backend change requires a new confirmation; never switch the backend
  silently.
- **Headless rule:** if the `ask_user` tool is absent from your tool list, the
  run is headless: generate nothing and write the text-only brief.

### 2. Generate

One board image per confirmed count (default 1), each a 3×3 panel layout in a
single image, each written to its own numbered file so variants never
overwrite each other:

| | | |
|---|---|---|
| logo concept | logo construction | digital application |
| brand essence | colour system | typography |
| physical application | image direction | system detail |

```bash
$NB "<board prompt>" --output <mockupDir>/brand/board-<nn>.png   # nn = 01..count
```

The prompt carries the strategy lines, the Part A bans (no purple/violet glow,
no neon gradient, no pure black / pure white, no Inter as the default face, no
em-dashes in rendered text), and describes any wording instead of quoting it.
Text visible in the board is a placeholder and is never transcribed.

### 3. Brief → `brand.md`

Write `<mockupDir>/brand/brand.md`:

- **Palette**: neutral ramp + one accent, as hex, each pair checked for
  WCAG-AA text contrast.
- **Type pairing**: display + text family, with the reason (not Inter or a
  banned serif by default, `anti-slop-frontend` A2).
- **Logo concept rationale**: the concept method (monogram, product action,
  metaphor, negative space, construction geometry) and what it means.
- **Image direction**: one line on photography / illustration style.
- **Observed tells** in the board, excluded from the brief.

## Fallback

When the runner is not resolvable or the backend has no usable credentials:
report the reason in one line, write `brand.md` text-only (palette, type
pairing, logo concept rationale in words) using the variation axes section of
`anti-slop-image-direction` for the image-direction line, and continue. Do not
fail the task. A headless run or a declined confirmation produces the same
text-only `brand.md`.

## Pitfalls

- Do NOT run for `marketing` or `product-ui`, or when a brand already exists.
- Do NOT present a generated logo as final, or vectorise it unasked.
- Do NOT edit `index.css`, a tokens file or `ui-contract.md`.

## Verification

- Profile `new-site`, no existing brand, explicit request.
- The confirmation (count, backend, paid) precedes the board.
- `brand/` holds exactly the confirmed number of `board-<nn>.png` files.
- `brand.md` has palette hex with contrast notes, type pairing, logo concept
  rationale and image direction.
- Project tokens and UI contracts are unchanged.
