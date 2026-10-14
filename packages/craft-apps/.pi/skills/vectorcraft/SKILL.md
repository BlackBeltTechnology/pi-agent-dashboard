---
name: vectorcraft
description: Headless vector illustration with VectorCraft (Illustrator-style paths, shapes, type, fills/strokes), provisioned on demand by pi-craft - draw shapes and export svg, pdf or png, or convert between vector formats. Use for "draw a logo as an svg", "export this illustration as a pdf", "convert this svg to a png at 2x", "make an icon with a red circle".
---

# VectorCraft — headless vector illustration

VectorCraft is ArtCraft's vector app (artboards, layers, paths, shapes, type, gradients, live effects; 749 commands).
`pi-craft` provisions the headless `vectorcraft-cli` on first use (no desktop app). App choice, the
discover → execute → save → verify loop and the MCP policy live in `craft-studio`.

## What it is for / formats

Vector artwork with artboards. Native project file: `.vectorcraft`. Reads `.vectorcraft .svg .svgz .pdf .ai .eps
.dxf .emf .wmf .psd .png .jpg .gif .webp .tif .bmp` (rasters open as images); writes `.vectorcraft .svg .svgz .pdf
.ai .eps .png .jpg .gif .webp .tif .bmp .dxf .emf .wmf .psd .tga .txt`. The **export format is chosen by the
extension** of the output name. For raster photo work use PhotoCraft, for page layout DesignCraft.

## CLI dialect

`pi-craft vectorcraft exec <args…>` passes the arguments to `vectorcraft-cli`.

```bash
vectorcraft-cli commands                          # all commands as JSON ({id, label, params, enabled, …}); "--json" is accepted and ignored
vectorcraft-cli run [--in FILE] [--cmd ID [--params JSON]]… [--export FILE [--scale N]]…   # headless batch
vectorcraft-cli convert IN OUT [--scale N] [--artboard I | --range R] [--outline-text] [--decimals N]
vectorcraft-cli info FILE                         # JSON summary: artboards, object counts by kind, fonts, import warnings
```

- **A command and its parameters are two arguments**: `--cmd shape.rectangle --params '{"x":20,…}'`. The
  `--cmd ID=JSON` spelling that some other apps use is **rejected** ("unknown command `shape.rectangle={…}`").
  `--params` belongs to the `--cmd` just before it; a command without parameters takes none.
- Steps run in the order given; every step prints one JSON line (`{"command":…,"result":{"id":2}}`), and each
  `--export FILE` writes after all commands, printing `{"bytes":…,"path":…,"warnings":[]}`.
- There is no describe command: the parameter schema is the `params` string of `commands`.
- Without `--in` the batch starts from a default document (612×792 pt). `--cmd file.new --params '{"width":400,"height":200}'`
  starts a sized one. Coordinates are points, origin top-left of the artboard.
- `--scale N` multiplies raster exports (400×200 pt → 800×400 px at `--scale 2`); it works on `convert` too.

## State between invocations

None by default: each `run` starts from `--in FILE` (or a fresh document) and **exits discarding the document**.
Persist with an export to `.vectorcraft` (`--export doc.vectorcraft`) and continue with `--in doc.vectorcraft`;
write `--export` to a *different* name when you need the original untouched. `.svg`/`.pdf` exports reopen as
documents too but lose editing data (live effects, named layers) compared with `.vectorcraft`.

## Discovery first

```bash
pi-craft vectorcraft exec commands | jq -r '.[].id' | grep '^shape\.'          # ids by namespace
pi-craft vectorcraft exec commands | jq -r '.[] | select(.id=="paint.setFill") | .params'   # parameter schema
pi-craft vectorcraft exec info drawing.svg                                      # what a file contains, before editing
```

`commands` prints JSON by default (no `--filter`); filter with `jq`/`grep`. Namespaces worth knowing: `shape`
(`rectangle ellipse polygon star line arc …`), `paint` (`setFill setStroke`), `stroke` (`set` weight/cap/dash),
`text` (`create setStyle …`), `select` (`all …`), `object`, `path`, `artboard`, `file`, `document` (`export`).

## Traps

- **Style commands act on the selection, and a new shape is selected.** `shape.rectangle` then `paint.setFill`
  colours that rectangle; the *next* shape then starts with the same fill/stroke (current style). Verified:
  rect `#ff0000`, ellipse drawn after it is also red until a second `paint.setFill` recolours it alone. To restyle an
  existing file: `--in f.vectorcraft --cmd select.all --cmd paint.setFill --params '{"color":"#00aa00"}'`.
- A shape defaults to **white fill, black 1 pt stroke** (`fill="#ffffff" stroke="#000000"`). Set the stroke
  weight with `stroke.set` (`{"weight":6}`), the colour with `paint.setStroke`; `paint.setFill` `{"none":true}` for no fill.
- **A failing command aborts the run with exit 1 and writes no exports** (`nope.nope` → "unknown command", no
  output file) — safe to trust the exit code, but a typo costs the whole batch.
- Rect/ellipse parameters differ (`x y width height` vs. polygon/star `cx cy radius…`); read the schema.
- `convert` refuses `OUT == IN` when reading IN left something out unless `--replace-lossy`; read `warnings` /
  `importWarnings` in its JSON reply.
- PDF export writes **one page per artboard** (add `artboard`/`range` via `convert --artboard I`). PNG/JPG export
  only the first artboard.
- `file.new` with no `width`/`height` gives US Letter in points; `"width":"210 mm"` strings are accepted.

## MCP route (opt-in)

`pi-craft vectorcraft mcp --register` writes a `craft-vectorcraft` entry into `.pi/mcp.json` (32 tools). It is
confined to the project directory (`--automation-read-root` / `--automation-write-root`; files outside it are
refused, `run`/`convert` via bash are not confined). GUI bridging (`--connect`) to a desktop app is out of scope.

## Recipes

```bash recipe: draw-export
# Two styled shapes -> svg + png (2x) + pdf, and a .vectorcraft project to continue from.
pi-craft vectorcraft exec run --cmd file.new --params '{"width":400,"height":200}' \
  --cmd shape.rectangle --params '{"x":20,"y":20,"width":200,"height":100}' \
  --cmd paint.setFill --params '{"color":"#ff0000"}' \
  --cmd paint.setStroke --params '{"color":"#0000ff"}' \
  --cmd stroke.set --params '{"weight":6}' \
  --cmd shape.ellipse --params '{"x":250,"y":50,"width":100,"height":100}' \
  --export logo.svg --export logo.pdf --export logo.vectorcraft
pi-craft vectorcraft exec run --in logo.vectorcraft --export logo2x.png --scale 2
grep -q 'fill="#ff0000"' logo.svg
pi-craft verify logo2x.png --size 800x400
```

```bash recipe: restyle-saved
# Re-open a saved project, recolour everything, write a new file (the original stays as is).
pi-craft vectorcraft exec run --cmd file.new --params '{"width":300,"height":300}' \
  --cmd shape.star --params '{"cx":150,"cy":150,"radius1":120,"radius2":50,"points":5}' \
  --export star.vectorcraft
pi-craft vectorcraft exec run --in star.vectorcraft --cmd select.all \
  --cmd paint.setFill --params '{"color":"#00aa00"}' --export star-green.svg
grep -q 'fill="#00aa00"' star-green.svg
pi-craft vectorcraft exec convert star-green.svg star-green.pdf
pi-craft verify star-green.pdf --pages 1
```

```bash recipe: convert-svg
# Convert an existing SVG to png (half size) and pdf; info shows what the file contains.
printf '%s\n' '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><circle cx="100" cy="100" r="60" fill="#336699"/></svg>' > in.svg
pi-craft vectorcraft exec info in.svg
pi-craft vectorcraft exec convert in.svg half.png --scale 0.5
pi-craft vectorcraft exec convert in.svg in.pdf
pi-craft verify in.pdf --pages 1
pi-craft verify half.png --size 200x100
```

```bash recipe: text-pdf
# Type on an artboard -> pdf; the text stays searchable text, not outlines.
pi-craft vectorcraft exec run --cmd file.new --params '{"width":400,"height":200}' \
  --cmd text.create --params '{"x":30,"y":100,"text":"Hello VectorCraft","size":24}' \
  --export card.pdf
pi-craft verify card.pdf --pages 1 --text-contains "Hello VectorCraft"
```
