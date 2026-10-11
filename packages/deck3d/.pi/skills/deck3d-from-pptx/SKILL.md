---
name: deck3d-from-pptx
description: 'Turn an existing .pptx into a styled deck3d 3D presentation, tutorial-style: import, reference renders, then nine steps (fidelity, placement, frame, brand-art, icons, hero, worlds, media, transitions) where each step authors 2-4 variants, shows a contact sheet, asks the user, records the pick, then builds and compares. Use on "make a 3D deck from this pptx", "convert my PowerPoint to deck3d", "turn these slides into a 3D presentation", "match the original slides in 3D".'
---

# deck3d-from-pptx

Take a real `.pptx` and rebuild it as a deck3d presentation whose slides **match the
original when the camera stops** and move through 3D space between slides. Every
creative decision is **the user's**: you generate variants, show them, ask, and record
the answer in `style.json`. The deck3d rules of the [`deck3d`](../deck3d/SKILL.md) tune
loop still apply: never edit `deck.html`, never edit derived IR fields (only
`overrides`), no randomness, timers or network in local effects, and finish with
`deck3d check deck.html --style` clean — or every remaining warning explained (a derived
`credits` slide counts as explained).

Detail per step (what to read, how to author variants, which samples, the question):
[`reference/steps.md`](reference/steps.md).

## 0. Import and reference renders (always first)

```
deck3d pptx import talk.pptx -o talk [--ref exports/]
```

writes `talk/pptx/layout.json` (1920-unit slide space, items with stable ids
`sNN-iMMM`), `talk/pptx/media/`, a baseline `deck.md` and `deck.json` whose
`overrides.assets` pin the layout and every media file. Unsupported constructs (charts,
SmartArt, tables, EMF/WMF, WordArt, gradient fills…) become visible **fallback** items —
a crop of the reference render, else an outlined placeholder — each with one warning.

**Reference renders come first.** Ask the user (`ask_user`) for a PNG export of the deck
(PowerPoint: *File → Export → PNG, all slides*; Keynote and `Slide1.PNG` names work) and
pass the folder as `--ref`. Skip the question only when LibreOffice (`soffice`) and
`pdftoppm` are on PATH. **If the user declines**, say so once, and from then on every step
reports *snapshot review* (`deck3d snapshot`, eyeballing, `check`) **instead of**
`compare` scores — never pretend a score exists.

Then build the baseline: `cd talk && deck3d build deck.md -o deck.html` (a native deck3d
slide per pptx slide). Re-importing later keeps your tuning: `deck3d pptx import
talk.pptx -o talk --force` matches slides by content, backs up `deck.json.bak`, and
`deck3d variants replay` re-applies every recorded pick.

## The nine steps (fixed order)

| # | step id | question |
|---|---|---|
| 1 | `fidelity` | exact 2D layer · 3D panel · native deck3d |
| 2 | `placement` | glass panel · free-floating · frame in space |
| 3 | `frame` | master chrome and its transition animation |
| 4 | `brand-art` | logos, wordmarks, headline in 3D |
| 5 | `icons` | pictograms as 3D objects, optionally on cards |
| 6 | `hero` | hero illustrations rebuilt as 3D scenes |
| 7 | `worlds` | per-slide background worlds from slide text, plus haze |
| 8 | `media` | images replaced by video |
| 9 | `transitions` | transition and camera-path variety |

**Native path.** If the user picks `native` at `fidelity`, **skip steps 2, 3 and 5**
(placement, frame, icons) — no `slide-layer`, `frame-chrome` or `icon3d` effect may appear
in `deck.json`. Then: brand art goes beside the native title; hero scenes and worlds become
slide backgrounds; media becomes a video screen; transitions are unchanged. The `worlds`
step gives **every** slide a non-default background, so a native deck also clears
`check --style`.

## Every step: variants → sheet → ask → record → verify

1. **Author** the step into `style.json` (`version: 1`, ordered `steps[]`): `id`, `title`,
   `question`, `slides` (sample slide ids that cover the step's affected kinds), `round`,
   and **2–4 variants** `{ name, label, overrides }` built from the imported layout and the
   slide text. A fragment is in the `overrides` grammar and **arrays replace**, so each
   fragment must **carry forward the effects of earlier steps** on the same scope.
   `deck3d validate deck.json` checks it.
2. `deck3d variants render --step <id>` → `variants/<id>/r<round>/contact.png` (reference
   column, one labelled column per variant). `deck.json` is not touched.
3. Open `contact.png` on the canvas **and** put the live link in the question:
   `deck3d serve deck.md` then `http://127.0.0.1:<port>/?variant=<step>:<name>` (`V` cycles
   the step's variants; Save/Apply are disabled while a variant is shown).
4. **Ask** with `ask_user` — a single choice listing the variants by label, free text
   allowed. **Do not pick for the user** while the question tool is available.
5. Variant answer → `deck3d variants pick <step> <name>` (add `--drop <id>` /
   `--replace-step <step>` only when the user means to remove an effect; the ownership
   guard refuses silent drops). Free-text answer → `deck3d variants note <step> --note
   "<their words>"`, then author a **new round** from the note and repeat from 1.
6. `deck3d build deck.md -o deck.html`, then `deck3d compare deck.html` and report the
   per-slide scores (or the snapshot review when there are no reference renders).

**Headless mode** is entered only when the run prompt says so explicitly (never
inferred from a missing UI): pick the **first variant in array order** with
`deck3d variants pick <step> <first> --note auto`.

## Creative assets: scaffold, preview, never invent in core

For `hero` and `worlds`, scaffold per-deck **local effects** (`deck3d fx scaffold <name>
--for <slideId>`) whose content comes from the slide's text and pictures — each variant a
different take on the **same content** (a literal scene, a metaphor, a minimal motif).
Preview each (`deck3d fx preview local:<name>`) before offering it. Traced art and icons:
`deck3d art trace|icon|cutout`; pin the outputs as assets (`overrides.assets`).

## Pitfalls — check after each step

- **Floor z-fighting**: objects resting on the floor are lifted above it (a `lift` / y
  offset), never left coplanar with it.
- **Halos**: text halos use **normal blending** on light themes (additive glows wash out).
- **Chrome**: master chrome uses the persistent `frame-chrome` effect at deck scope,
  not per-slide overlays.
- **Wrap drift**: font-metric differences wrap text differently. For **every multi-line text
  box**, compare against the reference and fix with `widen` (or a `font-<name>` asset); a
  closing line wrapping onto two lines while the reference has one → set `widen` for that
  item, re-run `compare`. `compare` lists `font-fallback <name>` for every missing font.
- **Scores**: the deck's output tone mapping dims pure white to about 221, so a faithful
  match scores about 0.9 (default threshold 0.85), not 0.99 — judge by the margin and by eye.
- **In-place file replacement**: after replacing a file in place that `serve` may miss,
  **rebuild manually** (`deck3d build deck.md -o deck.html`).
- **Verification**: verify at the user's **actual viewport** (`--viewport WxH`) and also
  capture mid-transition frames with **`compare --transition`**.

## Delivery

Render the final deliverable with `deck3d render deck.json -o deck.html --embed-video`
whenever **any slide uses a video screen**, so the single file plays offline. A `file://`
deck without embedding cannot play its clips (the browser refuses them as a texture
source) — say so if the user wants to send the file.

## Command cheat sheet

| need | command |
|---|---|
| import | `deck3d pptx import talk.pptx -o talk [--ref dir] [--force]` |
| sheet | `deck3d variants render --step <id> [--viewport WxH] [--ref dir]` |
| decide | `deck3d variants pick <step> <name> [--note t] [--drop id] [--replace-step s]` · `deck3d variants note <step> --note t` |
| re-apply | `deck3d variants replay` |
| verify | `deck3d compare deck.html [--strict] [--transition] [--viewport WxH]` |
| art | `deck3d art trace <img> --palette #a,#b` · `art icon <svg>` · `art cutout <img> --bg #hex --split` |
| live | `deck3d serve deck.md` (`?variant=<step>:<name>`, `V`) |
