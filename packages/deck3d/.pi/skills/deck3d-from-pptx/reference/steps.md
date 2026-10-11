# deck3d-from-pptx — step reference

How to author each step's variants. Read `pptx/layout.json` for item ids/rects and
`deck.md` for slide text first. Every fragment lives under `variants[].overrides` in
`style.json` and **carries forward earlier steps' effects** on the same scope (arrays
replace). Built-in parameters below; full ranges in [`../../deck3d/reference/effects.md`](../../deck3d/reference/effects.md).

## Built-ins used by the steps

| effect | kind | scope | main params |
|---|---|---|---|
| `slide-layer` | layer (replaces native content) | slide | `layout` (asset id, `pptx-layout`), `slide` (`sNN`), `mode` `screen`·`panel`·`free`, `depths` `{body,icon,title,image}`, `panel` `{material,tilt}`, `halo` 0–1, `skip[]`, `retext{}`, `widen{}` |
| `frame-chrome` | layer, **persistent** | **deck only** | `layers[]` `{asset,anchor tl/tr/bl/br,size,fly,delay,speed,ease}`, `suppress[]` slide ids, `opacity`, `scale` |
| `art3d` | layer | slide | `outline` (asset), `item`, `depth`, `bevel`, `scale`, `x y z`, `sway`, `sweep`, `gradient[]` |
| `icon3d` | layer | slide | `asset` (icon polylines or outline), `item`, `card`, `color`, `rim`, `depth` |
| `haze` | background | slide | `layers`, `near`, `far`, `density`, `drift`, `floor`, `color` |

`slide-layer` places every item within 2 px of the original at rest (modes `screen`/`free`,
and `panel` with `tilt: 0`); text is measured by `check`. List an item in
`slide-layer.skip` when `icon3d`/`art3d` draws it instead.

## 1 · `fidelity`
Inputs: baseline build, `compare` scores. Variants — **A** exact 2D layer
(`slide-layer`, `mode: screen`), **B** 3D panel (`mode: panel`, small `tilt`), **C**
native (no `slide-layer`; the deck3d title/card/diagram). Samples: a text-heavy slide, an
image slide, a diagram/fallback slide. Native → skip 2, 3, 5.

## 2 · `placement`  *(skipped for native)*
**A** glass panel (`mode: panel`, `panel.material: glass`), **B** free-floating text
(`mode: free`, `halo` for legibility), **C** frame in space (`free` + larger
`depths` spread for parallax). Samples: one title, one dense, one image slide.

## 3 · `frame`  *(skipped for native)*
Cut master corner art with `deck3d art cutout <bg> --bg #hex --split`, pin the pieces as
assets, then one `frame-chrome` at **deck scope** (`overrides.effects`). Variants differ in
`fly` direction, `delay`/`speed`/`ease` and `suppress` (e.g. hide on title/closing).
Samples: two consecutive slides + a suppressed one; verify with `compare --transition`.

## 4 · `brand-art`
`deck3d art trace logo.png --palette #dark,#accent` → outline asset → `art3d`. **A**
extruded flat, **B** bevel + `sweep` highlight, **C** `sway`. Native: place beside the
native title (`x/y/z`), not over it. Samples: title slide + one content slide.

## 5 · `icons`  *(skipped for native)*
`deck3d art icon pictogram.svg` → polylines asset → `icon3d` on the item
(`slide-layer.skip` it). **A** tubes, **B** tubes on a glass `card`, **C** extruded outline.
Samples: slides with the most icons.

## 6 · `hero`
Scaffold local effects (`fx scaffold`) that rebuild hero pictures as 3D scenes from the
slide text/picture. Variants: literal scene · metaphor · minimal motif. Native → slide
background. Preview each before offering. Samples: the hero slides.

## 7 · `worlds`
One background world per slide from its text (local effect or corpus card), plus `haze`
so a bold world recedes behind content. Give **every** slide a non-default background.
Variants: literal · atmospheric · minimal. Lift floor objects above the floor.

## 8 · `media`
Replace image items by video: `video-screen` effect (or a local effect) on the slide;
`slide-layer.skip` the still. Render the final deck with `--embed-video`.

## 9 · `transitions`
Per-slide `transition` and `cameraPath` variety (`deck3d fx list --kind transition`).
Variants: calm (dolly) · cinematic (swing/crane) · mixed cycle (`transitionCycle`).
Verify with `compare --transition`.

## The question shape

`ask_user` single choice: title = the step question; options = `<name> — <label>` for each
variant; free text allowed; message = the `contact.png` path (opened on the canvas) and the
serve link `http://127.0.0.1:<port>/?variant=<step>:<name>`.
