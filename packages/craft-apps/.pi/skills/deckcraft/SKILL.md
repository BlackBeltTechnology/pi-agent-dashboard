---
name: deckcraft
description: Headless presentations with DeckCraft (PPTX slides, layouts, shapes, text, tables), provisioned on demand by pi-craft - build a deck from commands, export to PDF, render slides to png. Use for "make a 3-slide presentation", "add a title slide to this pptx", "export this deck to pdf", "render slide 2 as an image".
---

# DeckCraft — headless presentations

DeckCraft is ArtCraft's presentation app (232 commands in 0.7.0). `pi-craft` provisions the headless `deckcraft-cli` on
first use (no desktop app). Choosing between apps, the loop, hand-off formats and the MCP policy live in
`craft-studio`. A slide deck goes to DeckCraft; a flowing document goes to WordCraft; a page-layout job to DesignCraft.

## What it is for / formats

Slides built from layouts (`title`, `titleAndContent`, `sectionHeader`, `twoContent`, `comparison`, `titleOnly`, `blank`,
`contentWithCaption`, `pictureWithCaption`), shapes, text boxes, tables, charts, pictures, animations, transitions.
Project file: `.pptx` (also native `deckcraft`). Export: `pdf` (one page per slide), `png`/`jpeg`, `pptx`, `outline`;
`convert` also writes `odp`. The default slide size is 960×540 pt (16:9).

## CLI dialect

`pi-craft deckcraft exec <args…>` passes the arguments to `deckcraft-cli`.

```bash
deckcraft-cli commands [FILTER]                   # JSON array; FILTER is a POSITIONAL substring (no --filter, no --json)
deckcraft-cli describe <id>                       # label, menu location, params
deckcraft-cli run [--in FILE | --sample] [--cmd ID[=JSON]]… [--save OUT] [--export OUT] [--print]
deckcraft-cli info FILE                           # JSON: slides (index, layout, title, shapes), layouts, slideSize
deckcraft-cli convert IN OUT                      # pptx → pdf | png | odp …, by extension
deckcraft-cli render (FILE | --sample) [--slide N | --all] [--scale S] [--edit] OUT
deckcraft-cli render-transition FILE --slide N --t T[,T…] [--width PX] OUT.png
deckcraft-cli links | --version
```

- `run` takes repeated `--cmd`, each `id` or `id={json}` (single-quote the JSON), executed in order on one in-memory
  presentation. `--in FILE` opens an existing deck; `--save OUT` writes the deck, `--export OUT` writes a pdf/png export.
- Placement is by *current slide*: `slide.new` creates a slide **after the current one and makes it current**; `shape.insert`
  / `insert.textBox` then land on that slide. Rects are `[x,y,w,h]` in pt from the top-left of the 960×540 slide.
- Inside `run`, `file.export={"path":"o.pdf","format":"pdf"}` and `file.saveAs={"path":…}` also work.

## State between invocations

None. Each `run` holds the deck in memory and discards it at exit unless `--save`/`--export` writes a file
(`run --in f.pptx --cmd …` without `--save` silently loses the edit and exits 0). Chain through files:
`run --save a.pptx`, `run --in a.pptx … --save b.pptx`, then `convert`/`render`.

## Discovery first

```bash
pi-craft deckcraft exec commands shape                   # ids whose id/label match "shape", with params
pi-craft deckcraft exec describe slide.new               # parameter hints, e.g. layout names
pi-craft deckcraft exec info deck.pptx                   # slide indices, shape counts, layouts of a real deck
```

In the `commands` output `enabled:false` + `disabled_reason: "no presentation open"` is normal without a deck: it
reflects the empty session, not an unusable command. Families: `slide.*`, `shape.*` (`shape.presets` lists presets),
`insert.*`, `format.*`, `arrange.*`, `design.*` (theme, size), `animation.*`, `chart.*`, `file.*`, `review.*`.

## Traps

- **Initial state.** `run` without `--in` starts with **one empty title slide**: `slide.new` then makes slide 2 and the
  deck has an empty first slide (`info` shows `"title": ""`). For exactly the slides you create, start with
  `--cmd 'file.new={"blank":true}'` (no slides at all) — plain `--cmd file.new` still yields the empty slide.
- `commands --json` is **not** an option: `--json` is taken as the FILTER and returns `[]`. Output is always JSON; filter positionally.
- **Slide numbers in `render --slide N` are 0-based** (`--slide 0` = first; `--slide 3` on a 3-slide deck →
  "no slide 3 (the deck has 3)", exit 1). `info` `index` is 0-based too.
- `render` default is scale 2 (1920×1080 px for a 960×540 slide); `--scale 1` → 960×540. `render --all OUT` makes
  **a directory** `OUT/` containing `slide-01.png`, `slide-02.png`, … (so don't name it `x.png` unless you want that).
- `slide.new` inserts after the current slide, not at the end: running `slide.new` on `--in` of a 2-slide deck (current slide 0)
  put the new slide at index 1. Pass `"at": <index>` to place it explicitly.
- Title/body text come from `slide.new` (`title`, `body`) for a layout with placeholders; `titleOnly`/`blank` have fewer.
  Free text goes to `insert.textBox` (`text`) or `shape.insert` (`text` inside the shape); both are exported to the pdf text layer, so `--text-contains` finds them.
- A failing `--cmd` (unknown id, bad JSON) aborts `run`: exit 1 and the `--save` file is not created.
- `convert deck.pptx out.png` writes a single png (one slide); use `render --all` or `convert … pdf` for all slides.

## MCP route (opt-in)

`pi-craft deckcraft mcp` is **unconfined** (the server can read and write any path the user can), so `mcp` and
`mcp --register` refuse without `--allow-unconfined`; tell the user first. The bash route here needs none of that.
GUI bridging (`app`, `--connect`) is out of scope.

## Recipes

```bash recipe: deck-pdf
# A blank deck, 2 slides, a shape and a text box on the last slide; export to pdf and check pages/text.
pi-craft deckcraft exec run \
  --cmd 'file.new={"blank":true}' \
  --cmd 'slide.new={"layout":"title","title":"Quarterly Review","body":"Team update"}' \
  --cmd 'slide.new={"layout":"titleOnly","title":"Results"}' \
  --cmd 'shape.insert={"preset":"ellipse","rect":[100,300,220,110],"text":"RoundShape"}' \
  --cmd 'insert.textBox={"rect":[420,320,300,60],"text":"BoxText"}' \
  --save deck.pptx
pi-craft deckcraft exec info deck.pptx
pi-craft deckcraft exec convert deck.pptx deck.pdf
pi-craft verify deck.pdf --pages 2 --text-contains "Quarterly Review" --text-contains RoundShape
```

```bash recipe: render-slide
# Render slide index 1 (the second slide, 0-based) at default and half scale.
pi-craft deckcraft exec run \
  --cmd 'file.new={"blank":true}' \
  --cmd 'slide.new={"layout":"title","title":"Cover","body":"Sub"}' \
  --cmd 'slide.new={"layout":"titleOnly","title":"Agenda"}' \
  --save deck.pptx
pi-craft deckcraft exec render deck.pptx --slide 1 agenda.png
pi-craft deckcraft exec render deck.pptx --slide 1 --scale 1 small.png
pi-craft verify agenda.png --size 1920x1080
pi-craft verify small.png --size 960x540
```

```bash recipe: add-slide-pdf
# Re-open a saved deck (--in), add a third slide, export pdf in the same run with --export.
pi-craft deckcraft exec run --cmd 'file.new={"blank":true}' \
  --cmd 'slide.new={"layout":"title","title":"Cover","body":"Sub"}' \
  --cmd 'slide.new={"layout":"titleOnly","title":"Middle"}' --save two.pptx
pi-craft deckcraft exec run --in two.pptx \
  --cmd 'slide.new={"layout":"titleOnly","title":"Closing remarks","at":2}' \
  --save three.pptx --export three.pdf
pi-craft verify three.pdf --pages 3 --text-contains "Closing remarks"
```
