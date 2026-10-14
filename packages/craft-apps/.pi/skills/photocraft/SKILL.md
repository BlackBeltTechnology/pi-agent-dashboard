---
name: photocraft
description: Headless image editing with PhotoCraft (~900 Photoshop-style commands), provisioned on demand by pi-photocraft - select, crop, resize, colour-grade, mask, composite, batch-convert. Pair with pi-nano-banana for generative part-replacement (replace-region), object removal, asset insertion. Use for "edit/retouch/crop/mask this image" or "replace just this part of an image".
---

# PhotoCraft — headless local image editing

`pi-photocraft` downloads and verifies the headless `photocraft-cli` binary on first use
(no desktop app) and gives two routes to it. Pair it with `pi-nano-banana` (Gemini) when
an edit needs *generated* pixels: PhotoCraft does the precise, local part; Gemini only
ever sees a crop.

## Setup

```bash
pi-photocraft ensure          # provision + JSON report (version, asset, cacheHit, binary)
pi-photocraft path            # just the absolute binary path
```

- Env: `PHOTOCRAFT_VERSION` pins a release (default: latest), `PHOTOCRAFT_BIN` uses your own
  binary, `PHOTOCRAFT_HOME` moves the cache, `GITHUB_TOKEN` avoids API rate limits.
- Linux needs glibc ≥ 2.35 (not Alpine/musl, not Ubuntu 20.04). macOS and Windows: nothing extra.
- "Latest" can rename command ids between releases → **always discover ids first** (below).

## Discover, then edit (bash route)

`pi-photocraft exec <args…>` passes the arguments to `photocraft-cli` verbatim.

```bash
pi-photocraft exec commands --filter feather            # find command ids
pi-photocraft exec commands --json --filter crop        # parameter schema of the matches
pi-photocraft exec info photo.jpg --compact             # size, layers, mode (JSON)

# ONE --out per run (last wins); every --params applies to the preceding --cmd
pi-photocraft exec run photo.jpg \
  --cmd image.imageSize --params '{"width":1600,"height":1067}' \
  --cmd image.adjustments.brightnessContrast --params '{"brightness":10,"contrast":15}' \
  --out edited.jpg

pi-photocraft exec convert edited.psd flat.png           # format conversion (.psd/.png/.jpg/.webp/.tif)
pi-photocraft exec batch --actions actions.json --in ./originals --out ./exports   # whole folder
```

Each command prints one JSON line (`{"command":…,"result":…}`); exit code 1 + `error: …` on
failure. Selections live only inside one `run`: chain `select.*` and the command that uses it
in the same invocation. `select.*` bounds are `[x,y,w,h]`; `file.placeEmbedded` bounds are
`[x0,y0,x1,y1]`.

## MCP route (opt-in)

```bash
pi-photocraft mcp --register     # writes a "photocraft" entry into .pi/mcp.json (merge, never clobber)
```

- Absolute paths in the entry → machine-specific; don't commit it for a team.
- pi loads project MCP servers **only for a trusted project**, and **only when pi was started in
  the project root** (a session in a subdirectory ignores `.pi/mcp.json`).
- The server is confined to the project directory (read and write). **Every path you pass to
  `doc_open` / `doc_save` must lie under the project root.** (`exec`/`run` have no such confinement.)
- Issue MCP tool calls **one at a time and wait for each result** (`doc_open`, then
  `command_run`, then `doc_save`). The wrapper serializes pipelined calls as a safety net, but
  results depend on order.
- Prefer MCP for multi-step edits on one open document; prefer bash for one-shot edits, batches
  and anything outside the project directory.

## Generative part-replacement: `replace-region`

```bash
pi-photocraft replace-region photo.jpg \
  --prompt "the apple is an orange, same lighting" \
  --select object:540,560,210,210 \
  --out photo-orange.jpg [--layered photo-orange.psd]
```

Pipeline: locate the region → crop it (plus `--pad`) → `pi-nano-banana` edits **only the crop** →
resize back to the exact crop box → place with a feathered mask → flatten. **Pixels outside the
crop box are identical to the input** (lossless in/out); the layered `.psd` keeps original +
masked patch for manual fixes. Needs `GEMINI_API_KEY` (or `--backend pi`).

- Region: `--rect x,y,w,h` | `--select subject` | `--select sky` | `--select object:x,y,w,h`
  (a rough hint rectangle; PhotoCraft finds the object inside it).
- `--mask crop` (default): the patch shows whole inside the crop (inset by `pad − feather`) —
  right when the replacement has a **different shape or size** than the original.
  `--mask selection`: only the original object's outline is replaced — right for recolour /
  texture edits that keep the outline.
- `--pad 32 --feather 8 --min-crop 256` (rule: `pad ≥ 3 × feather`). Raise `--pad` when the new
  object should be larger than the old one; a small region is grown to `--min-crop` for context.
- The report (one JSON line) lists `region`, `crop`, `backend`, `model`, `timings`.
- On failure nothing is written (an existing `--out` is untouched); `--keep-temp` keeps the
  intermediates.

## Recipes

1. **Replace part of an image** → `replace-region` (above). Describe the *result* in the prompt
   and say what to keep ("same lighting, same perspective").
2. **Remove an object** (no generation needed):
   ```bash
   pi-photocraft exec run photo.jpg \
     --cmd select.object --params '{"rect":[x,y,w,h]}' \
     --cmd select.modify.expand --params '{"radius":6}' \
     --cmd edit.contentAwareFill --params '{}' \
     --out clean.jpg
   ```
   (check `commands --json --filter contentAwareFill` / `expand` for the current schema). If the
   fill looks wrong, fall back to `replace-region` with a prompt like "empty table surface".
3. **Insert a generated asset**:
   ```bash
   pi-nano-banana "a red enamel mug on a transparent-looking plain white background" --output mug.png
   pi-photocraft exec run scene.jpg \
     --cmd file.placeEmbedded --params '{"path":"/abs/mug.png","fit":false,"scale":40,"center":[640,480]}' \
     --out scene-mug.psd           # layered: move/mask the mug later
   ```
4. **Background swap**: `select.subject` → `select.inverse` → `layer.layerMask.hideSelection`
   on a duplicate, or generate the new background with `pi-nano-banana --file`, place it below, and
   mask the subject; or `replace-region --select sky|subject` for a generated replacement.
5. **Finishing / batch export**: put the steps (resize, sharpen, colour) in an actions JSON
   (`[["image.imageSize",{"width":1600,"height":1200}], …]`) and run
   `pi-photocraft exec batch --actions actions.json --in ./originals --out ./exports --format webp --quality 85`.

## Don'ts

- Don't guess command ids or parameter names — discover them with `commands --filter/--json`.
- Don't pass `--out` twice in one `run`; split into two runs instead.
- Don't send a whole 4K image to Gemini for a small edit — that is what `replace-region` avoids.
- Don't expect `.pi/mcp.json` to be written unless the user asked for `mcp --register`.
