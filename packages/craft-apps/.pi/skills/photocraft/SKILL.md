---
name: photocraft
description: Headless raster image editing with PhotoCraft (~900 Photoshop-style commands), provisioned on demand by pi-craft - select, crop, resize, colour-grade, mask, composite, content-aware fill, batch-convert. Pair with pi-nano-banana for generative part-replacement (replace-region). Use for "edit/retouch/crop this image", "remove this object from the photo", "resize and sharpen these pictures", "replace just this part of an image".
---

# PhotoCraft — headless raster image editing

PhotoCraft is ArtCraft's Photoshop-class raster editor. `pi-craft` provisions the headless `photocraft-cli`
on first use (no desktop app). Pair it with `pi-nano-banana` (Gemini) when an edit needs *generated* pixels:
PhotoCraft does the precise local part; Gemini only ever sees a crop. Choosing between apps, the
discover → execute → save → verify loop and the MCP policy live in `craft-studio`.

## What it is for / formats

Raster images with layers, masks, selections, adjustments and filters. Reads/writes `png jpg webp tif psd`
(PSD keeps layers); `convert` and `batch` change formats in bulk. For RAW development use LightCraft, for
vector art VectorCraft.

## CLI dialect

`pi-craft photocraft exec <args…>` (alias `pi-photocraft exec`) passes the arguments to `photocraft-cli` verbatim.

```bash
photocraft-cli run (<file> | --new <json>) --cmd <id> [--params <json>] [--cmd …] [--out <file>] [--format <ext>] [--quality 1-100]
photocraft-cli info <file> [--compact]          # size, mode, layers (JSON)
photocraft-cli convert <in> <out>               # .psd .png .jpg .webp .tif
photocraft-cli batch --actions actions.json --in ./originals --out ./exports [--format webp --quality 85]
```

- **One `--out` per run** (last wins). Every `--params` applies to the `--cmd` before it.
- Each command prints one JSON line (`{"command":…,"result":…}`); exit `1` + `error: …` on failure.
- `select.*` bounds are `[x,y,w,h]` (as `x,y,width,height` params for `select.rect`); `file.placeEmbedded` bounds are `[x0,y0,x1,y1]`.

## State between invocations

None: `run` opens the file, applies the commands in order and saves `--out`. **A selection lives only inside
one `run`** — chain the `select.*` command and the command that uses it in the same invocation. To continue
editing later with layers intact, save as `.psd` and open that next time.

## Discovery first

Command ids change between releases — never guess them.

```bash
pi-craft photocraft exec commands --filter feather            # ids by keyword
pi-craft photocraft exec commands --json --filter crop        # parameter schema of the matches
pi-craft photocraft exec info photo.png --compact
```

## Traps

- `select.object` returns `{"selected":false}` on flat synthetic or low-contrast images, and a following
  `select.modify.*` then fails with "no selection". Check the result line, or use `select.rect` for a known box.
- A second `--out` silently replaces the first; split into two runs instead.
- `edit.contentAwareFill` works on the current selection; expand it a few px (`select.modify.expand`) so the fill
  covers the object's fringe.
- Don't send a whole 4K image to Gemini for a small edit — that is what `replace-region` avoids.
- Linux needs glibc ≥ 2.35. `.pi/mcp.json` is only written by `pi-craft photocraft mcp --register` (opt-in).

## MCP route (opt-in)

`pi-craft photocraft mcp --register` writes a `photocraft` entry into `.pi/mcp.json` (merge, never clobber).
The server is confined to the project directory (read and write): **every path passed to `doc_open` /
`doc_save` must lie under the project root** (`exec`/`run` have no such confinement). Call tools one at a
time and wait for each result (`doc_open`, then `command_run`, then `doc_save`). Prefer MCP for multi-step edits
on one open document, bash for one-shot edits, batches and anything outside the project.

## Recipes

```bash recipe: resize-grade
ffmpeg -v error -y -f lavfi -i testsrc=size=1200x800 -frames:v 1 photo.png
pi-craft photocraft exec run photo.png \
  --cmd image.imageSize --params '{"width":600,"height":400}' \
  --cmd image.adjustments.brightnessContrast --params '{"brightness":10,"contrast":15}' \
  --out edited.png
pi-craft verify edited.png --size 600x400
```

```bash recipe: remove-region
# Remove whatever is inside a rectangle with content-aware fill (no generation needed).
ffmpeg -v error -y -f lavfi -i testsrc=size=1200x800 -frames:v 1 photo.png
pi-craft photocraft exec run photo.png \
  --cmd select.rect --params '{"x":100,"y":100,"width":200,"height":150}' \
  --cmd select.modify.expand --params '{"radius":6}' \
  --cmd edit.contentAwareFill --params '{}' \
  --out clean.png
pi-craft verify clean.png --size 1200x800 --frame-diff 0:photo.png\>0.1
```

```bash recipe: crop-export
ffmpeg -v error -y -f lavfi -i testsrc=size=1200x800 -frames:v 1 photo.png
pi-craft photocraft exec run photo.png \
  --cmd image.crop --params '{"x":200,"y":100,"width":800,"height":600}' \
  --out cropped.webp --format webp --quality 85
pi-craft verify cropped.webp --size 800x600
```

Not runnable without a Gemini key — the generative route:

```bash
pi-photocraft replace-region photo.jpg \
  --prompt "the apple is an orange, same lighting" \
  --select object:540,560,210,210 \
  --out photo-orange.jpg [--layered photo-orange.psd]
pi-craft verify photo-orange.jpg --size 1200x800 --frame-diff 0:photo.jpg\>0.2
```

## Generative part-replacement: `replace-region`

Pipeline: locate the region → crop it (plus `--pad`) → `pi-nano-banana` edits **only the crop** → resize back
to the exact crop box → place with a feathered mask → flatten. **Pixels outside the crop box are identical to
the input** (lossless in/out); the layered `.psd` keeps original + masked patch for manual fixes. Needs
`GEMINI_API_KEY` (or `--backend pi`). `replace-region` stays a PhotoCraft subcommand of `pi-photocraft`.

- Region: `--rect x,y,w,h` | `--select subject` | `--select sky` | `--select object:x,y,w,h` (a rough hint
  rectangle; PhotoCraft finds the object inside it).
- `--mask crop` (default): the patch shows whole inside the crop (inset by `pad − feather`) — right when the
  replacement has a **different shape or size**. `--mask selection`: only the original object's outline is
  replaced — right for recolour / texture edits that keep the outline.
- `--pad 32 --feather 8 --min-crop 256` (rule: `pad ≥ 3 × feather`). Raise `--pad` when the new object should be
  larger than the old one; a small region is grown to `--min-crop` for context.
- The report (one JSON line) lists `region`, `crop`, `backend`, `model`, `timings`. On failure nothing is written
  (an existing `--out` is untouched); `--keep-temp` keeps the intermediates.

Insert a generated asset, then verify the result changed where expected:

```bash
pi-nano-banana "a red enamel mug on a plain white background" --output mug.png
pi-craft photocraft exec run scene.jpg \
  --cmd file.placeEmbedded --params '{"path":"/abs/mug.png","fit":false,"scale":40,"center":[640,480]}' \
  --out scene-mug.psd
pi-craft verify scene-mug.psd --size 1200x800
```
