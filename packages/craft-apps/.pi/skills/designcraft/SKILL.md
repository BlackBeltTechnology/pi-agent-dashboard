---
name: designcraft
description: Headless page layout / desktop publishing with DesignCraft (InDesign-style documents, text frames, stories, styles), provisioned on demand by pi-craft - create a document, flow text, export multi-page PDF or per-page PNGs. Use for "lay out a two-page brochure as a pdf", "put this text in a text frame on an A4 page", "export every page as png".
---

# DesignCraft — headless page layout

DesignCraft is ArtCraft's DTP app (spreads, parent pages, threaded text frames, paragraph/character styles, tables,
swatches, preflight, PDF/EPUB/HTML export; 459 commands). `pi-craft` provisions the headless `designcraft-cli` on
first use (no desktop app). App choice, the discover → execute → save → verify loop and the MCP policy live in
`craft-studio`.

## What it is for / formats

Print and screen layouts. Native project file: `.designcraft`; also opens `.idml`. Exports `pdf` (`file.exportPdf`),
`png`/`jpg` (pages), `idml`, `epub`, `html`, text. For editing an existing PDF use PdfCraft, for a plain document
WordCraft, for free-form illustration VectorCraft.

## CLI dialect

`pi-craft designcraft exec <args…>` passes the arguments to `designcraft-cli`.

```bash
designcraft-cli commands [FILTER]            # JSON list {id, label, params, enabled}; FILTER is POSITIONAL ("--filter" is wrong → prints [])
designcraft-cli describe ID                  # one command: label, menu, params schema (unknown id → "no command", similar ids)
designcraft-cli run [--in FILE | --sample] [--cmd ID[=JSON]]… [--page N] [--scale S] [--pdf-options JSON] [--export OUT]… [--all-pages DIR]
designcraft-cli script [FILE|-] [--in FILE | --sample] [--save OUT] [--export OUT]… [--keep-going]
```

- `--cmd ID=JSON` here (unlike VectorCraft): `--cmd 'frame.create={"rect":[50,50,400,300],"text":"Hi"}'`; a bare `--cmd file.new`
  is fine. Each command prints its JSON result (`{"id":10,"story":11}`), each export a `wrote … (2 pages, N bytes)` line.
- **`script` is the better route for several steps**: one step per line (`command.id {json}`, `command.id={json}`, or a
  JSON object `{"command":…,"params":…}`), `#`/`//` comments, stdin with `-`. Later steps reference earlier results with
  `"$N.path"` (0-based step index, e.g. `"$1.story"`, `"$last.id"`; inside longer strings `"${1.story}"`). A failing step
  stops the script (exit 1, `failedIndex`/`failedCommand`); `--keep-going` records errors and continues.
- `--page`, `--scale`, `--pdf-options` apply **only to the `--export`/`--all-pages` that follow them**; placed after the last
  export they are an error ("--scale has no --export … after it").
- Export extension picks the format: `.pdf .png .jpg` (and `.idml .epub` in `script`).
- Frame coordinates are `rect: [x0,y0,x1,y1]` in points (A4 = 595×842), in **spread** coordinates; `spread` is a
  0-based index (one page per spread unless `facingPages`).

## State between invocations

None implicitly: a run opens `--in FILE` (or starts empty / `--sample`, a 4-page magazine) and **discards the document
at exit**. Persist with `file.save {"path":"doc.designcraft"}` inside `run`, or `script … --save doc.designcraft`; continue
with `--in doc.designcraft`. Without a document every editing command is disabled
(`file.exportPdf … is not available right now: no document open`).

## Discovery first

```bash
pi-craft designcraft exec commands page          # positional substring filter: ids + params; JSON, so pipe through jq if needed
pi-craft designcraft exec describe file.exportPdf # full parameter list of one command
pi-craft designcraft exec commands | jq -r '.[].id' | cut -d. -f1 | sort -u   # namespaces
```

Key ids: `file.new` (`preset: "A4"|"Letter"`, `width height pages facingPages columns margins bleed title`), `file.save`,
`file.open`, `file.exportPdf` (`path pages flatten bleed marks standard …`), `frame.create` (`rect`, `spread`, `content:
"text"`, `text`) → `{id, story}`, `story.setText {story,text}` (`\n` = new paragraph), `layout.pages.insert {count, after}`,
`style.paragraph.create/apply`, `swatch.create`, `text.thread`, `document.inspect` (pages, stories with overset).
`app …` talks to a running desktop app — out of scope.

## Traps

- **`--page N` is 0-based** for png export (`--page 1` = the second page) while `pages` in `--pdf-options`/`file.exportPdf`
  is **1-based** (`"2-3"`). Verified on a 3-page doc: `--page 2` gave the empty third page.
- **Default raster scale differs**: `run` writes 1× (A4 → 595×842), `script --export x.png` writes 2× (1191×1684).
  A 300×200 pt document at `--scale 2` is exactly 600×400; A4 at 2× is 1191×1684 (595.28 pt rounded up).
- `frame.create` places the frame on the spread named by `"spread"` (0-based, default 0): for text on page 2 pass
  `"spread":1`; the png/pdf exports then show glyphs on the right page only (checked with `--all-pages`).
- `commands --filter x` is not an option here; `commands` prints JSON always (`--json` is not needed/valid).
- A failing `--cmd` aborts with exit 1 and **writes no exports**; `script` also skips `--save`/`--export`.
- `layout.pages.insert {"count":2}` appends pages after the last (3 pages total from 1); ids/stories from `frame.create` are
  only meaningful inside the same run — read them from the output or `$N.path`.
- Fonts: text uses installed/bundled fonts; unavailable fonts are substituted, glyph counts are reported by png exports.

## MCP route (opt-in)

`pi-craft designcraft mcp --register` writes a `craft-designcraft` entry into `.pi/mcp.json` (25 tools). The server is
**not path-confined**, so `mcp` / `--register` refuse without `--allow-unconfined` — tell the user first. Use bash
`run`/`script` for the recipes below; `mcp --connect PORT` / `script --connect` need a running app (out of scope).

## Recipes

```bash recipe: brochure-script
# A two-page brochure from a script; "$1.story" feeds the story id of step 1 into step 3.
cat > brochure.dcs <<'DCS'
# step 0: document, step 1-2: frames on page 1 and 2, step 3: rewrite the first story
file.new {"preset":"A4","pages":2,"title":"Brochure"}
frame.create {"spread":0,"rect":[50,50,500,200],"content":"text","text":"Draft title"}
frame.create {"spread":1,"rect":[50,50,500,200],"content":"text","text":"Second page body"}
story.setText {"story":"$1.story","text":"Edited title\nSecond paragraph"}
DCS
pi-craft designcraft exec script brochure.dcs --save brochure.designcraft --export brochure.pdf
pi-craft verify brochure.pdf --pages 2 --text-contains "Edited title" --text-contains "Second page body"
```

```bash recipe: reopen-subset
# Save a project, reopen it, append a page, export only pages 2-3 as pdf and every page as png.
pi-craft designcraft exec run --cmd 'file.new={"preset":"A4","pages":3}' \
  --cmd 'frame.create={"spread":0,"rect":[50,50,400,300],"content":"text","text":"Page one"}' \
  --cmd 'frame.create={"spread":1,"rect":[50,50,400,300],"content":"text","text":"Second page"}' \
  --cmd 'file.save={"path":"doc.designcraft"}'
pi-craft designcraft exec run --in doc.designcraft --cmd 'layout.pages.insert={"count":1}' \
  --pdf-options '{"pages":"2-3"}' --export part.pdf --all-pages pages
ls pages/page-004.png
pi-craft verify part.pdf --pages 2 --text-contains "Second page"
```

```bash recipe: png-2x
# A small custom-size document -> png at 2x (scale must come before its --export).
pi-craft designcraft exec run --cmd 'file.new={"width":300,"height":200}' \
  --cmd 'frame.create={"rect":[10,10,200,100],"content":"text","text":"Tiny"}' \
  --scale 2 --export tiny.png
pi-craft verify tiny.png --size 600x400
```

```bash recipe: sample-pdf
# The built-in 4-page magazine sample (no inputs needed), exported to pdf.
pi-craft designcraft exec run --sample --export sample.pdf
pi-craft verify sample.pdf --pages 4
```
