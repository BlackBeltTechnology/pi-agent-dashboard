---
name: craft-brand-kit
description: Build a brand kit from a logo with ArtCraft apps - trace or take the vector logo, make colour/mono variants, export a PNG/TIFF set, lay out a one-page brand sheet and package it as a PDF; verified and resumable. Starts from the user's own logo; generated concepts only on explicit request. Use for "make a brand kit from this logo", "export my logo in all sizes", "turn this png logo into a vector with variants", "a one-page brand sheet for ACME".
---

# craft-brand-kit — logo → vector variants → raster set → brand sheet → PDF package

Starts from a **user-supplied logo** (an `svg` is used as-is; a raster logo is traced with VectorCraft `imageTrace`).
VectorCraft makes the vector variants, PhotoCraft the raster export set, DesignCraft the one-page sheet, PdfCraft the package.
Read `vectorcraft`, `photocraft`, `designcraft` and `pdfcraft` first. Resumable-job rules are in the `craft-studio` router,
section **Craft jobs**. Passwords and API keys are never written to `job.json`, gate reports or step files.

## Step table

| # | Step | Tool | Input → Output | Gate |
|---|---|---|---|---|
| 0 | Preflight + job | agent | request → `job.json` | `check: job` |
| 1 | Logo to vector | VectorCraft | `logo.svg` or `logo.png` → `01-logo/logo.svg` | preview `png` + `pi-craft verify --size --alpha` |
| 2 | Variants | VectorCraft | `logo.svg` → `02-variants/logo-black.svg`, `logo-white.svg` | preview `png` + `pi-craft verify --size` |
| 3 | Raster set | PhotoCraft | `logo.svg` → `03-raster/logo-<w>.png`, `logo-print.tif` | `pi-craft verify --size --alpha` (png) |
| 4 | Brand sheet | DesignCraft | logo + name → `04-sheet/sheet.pdf` | `pi-craft verify --pages --text-contains` |
| 5 | Package | PdfCraft | sheet → `05-package/brand-kit.pdf` | `pi-craft verify --pages --text-contains` |

Hand-off formats: `svg` between vector steps (+ `pdf` for print), `png` with alpha for screens, `tiff` for print, `pdf` for
delivery. An `svg` is **never** passed to `pi-craft verify` (it has no vector probe): gate its `png` preview
(`vectorcraft-cli convert x.svg x.png --scale N`, then `--size`). `--alpha` is asserted on png only.

### Step 0 — Preflight and job

**Output:** `craft-jobs/<slug>/job.json` (created or loaded).
**Gate:** `check: job`.

| Sibling | Package | Check | If missing |
|---|---|---|---|
| `anti-slop-brandkit` | `@blackbelt-technology/anti-slop-frontend` | skill in the loaded skill list | opt-in only: used solely on an explicit user request, after approval — see **Generated concepts (opt-in)**; without it the user supplies a logo |
| `pi-nano-banana` | already a dependency of craft-apps | usable credentials (only relevant to the opt-in branch) | no credentials: tell the user and offer to start from a user-supplied logo file |

"Loaded skill list" is the available-skills list in your own system prompt. Ask for the logo (`svg` or a raster `png`/`jpg`)
and the brand name; if there is none and no explicit request for concepts, stop and ask. Set up the job (**Craft jobs** in
`craft-studio`: slug rule, `job-helper`) and run **Resume**.

```bash check: job
# run from the directory that contains craft-jobs/ (SLUG set as in step 0)
jq -e '.name and .workflow and (.steps | type == "object")' "craft-jobs/$SLUG/job.json"
```

### Step 1 — Logo to vector

**Output:** `01-logo/logo.svg` and its preview `01-logo/preview.png`.
**Gate:** `pi-craft verify` on the preview — `--size` = the logo's size (×scale), `--alpha`.

An `svg` input is copied as-is. A raster logo is traced: open it, select it, `imageTrace.makeAndExpand` (preset `Flat Logo`
for flat-colour marks, `Black and White Logo` for one colour; `ignoreWhite` drops a white background), export `svg`.
Look at the preview before going on — tracing a photo or a gradient logo gives a poor mark.

```bash
pi-craft vectorcraft exec run --in logo.png --cmd select.all \
  --cmd imageTrace.makeAndExpand --params '{"preset":"Flat Logo","params":{"ignoreWhite":true}}' --export "$JOB/01-logo/logo.svg"
pi-craft vectorcraft exec convert "$JOB/01-logo/logo.svg" "$JOB/01-logo/preview.png"
pi-craft verify "$JOB/01-logo/preview.png" --size 400x200 --alpha
```

### Step 2 — Variants

**Output:** `02-variants/logo-black.svg`, `02-variants/logo-white.svg` (one-colour versions) and their previews.
**Gate:** `pi-craft verify` on each preview — `--size`, `--alpha`.

Recolour with `paint.setFill` on a selection (`select.all`); write each variant to a **new** name. Derived assets are
labelled *concept* in the one-pager until the user approves the brand.

```bash
pi-craft vectorcraft exec run --in "$JOB/01-logo/logo.svg" --cmd select.all --cmd paint.setFill --params '{"color":"#000000"}' --export "$JOB/02-variants/logo-black.svg"
pi-craft vectorcraft exec convert "$JOB/02-variants/logo-black.svg" "$JOB/02-variants/logo-black.png"
pi-craft verify "$JOB/02-variants/logo-black.png" --size 400x200 --alpha
```

### Step 3 — Raster export set

**Output:** `03-raster/logo-1600.png`, `logo-800.png`, `logo-400.png` and `logo-print.tif`.
**Gate:** `pi-craft verify` — `--size` on every file, `--alpha` on the png files only.

Render one large master from the svg (`--scale 4`), then let PhotoCraft resize it to each size; the tiff is the print copy.
Keep the aspect ratio exact (`h = w × height / width`).

```bash
pi-craft vectorcraft exec convert "$JOB/01-logo/logo.svg" "$JOB/03-raster/master.png" --scale 4
pi-craft photocraft exec run "$JOB/03-raster/master.png" --cmd image.imageSize --params '{"width":800,"height":400}' --out "$JOB/03-raster/logo-800.png"
pi-craft photocraft exec run "$JOB/03-raster/master.png" --out "$JOB/03-raster/logo-print.tif"
pi-craft verify "$JOB/03-raster/logo-800.png" --size 800x400 --alpha
pi-craft verify "$JOB/03-raster/logo-print.tif" --size 1600x800
```

### Step 4 — Brand sheet

**Output:** `04-sheet/sheet.pdf` (one A4 page) and `04-sheet/sheet.png`.
**Gate:** `pi-craft verify` — `--pages 1`, `--text-contains "<brand name>"`.

DesignCraft `script`: a text frame (`frame.create` `content:"text"` then `story.setText`) and a graphic frame
(`content:"graphic"`) the png is placed into with `file.place` (`$N.id` refers to the result of step N, 0-based). Place the
**png** variant, never the svg. `script … --export x.png` rasterises at 2×, A4 → 1191×1684.

```bash
cat > "$JOB/04-sheet/sheet.script" <<EOF
file.new={"preset":"A4","title":"$BRAND brand sheet"}
frame.create={"rect":[50,50,545,120],"content":"text"}
story.setText={"story":"\$1.story","text":"$BRAND"}
frame.create={"rect":[50,150,350,300],"content":"graphic"}
file.place={"path":"$PWD/$JOB/03-raster/logo-800.png","frame":"\$3.id"}
EOF
pi-craft designcraft exec script "$JOB/04-sheet/sheet.script" --export "$JOB/04-sheet/sheet.pdf" --export "$JOB/04-sheet/sheet.png"
pi-craft verify "$JOB/04-sheet/sheet.pdf" --pages 1 --text-contains "$BRAND"
```

### Step 5 — Package

**Output:** `05-package/brand-kit.pdf`.
**Gate:** `pi-craft verify` — `--pages`, `--text-contains "<brand name>"`.

`pdfcraft-cli edit` sets the metadata (and `combine` appends further pdfs). Protect with a password only when asked: use the
`0600` temp-file recipe of `craft-doc-publish` step 3; the password never goes into `job.json` or a report.

```bash
pi-craft pdfcraft exec edit "$JOB/04-sheet/sheet.pdf" --out "$JOB/05-package/brand-kit.pdf" --title "$BRAND brand kit" --author "$BRAND"
pi-craft verify "$JOB/05-package/brand-kit.pdf" --pages 1 --text-contains "$BRAND"
```

## Generated concepts (opt-in)

Only on an **explicit** user request for generated logo concepts (never as a default, never because no logo was given):
invoke `anti-slop-brandkit` **unchanged under its own rules** — new-site work, its own confirmed paid-plan gate, outputs in
its mockup folder, no auto-applied identity. If `pi-nano-banana` has no usable credentials, say so and offer to start from a
user-supplied logo instead. Until the user has **approved a concept**, no image is generated, and a concept is used as step 1's
input only after that approval. Everything derived from a concept stays labelled *concept* until the user approves the brand.

## Resume

Follow the **Craft jobs** convention in `craft-studio`: read `craft-jobs/<slug>/job.json` as data, confirm the job name, and start
at the first step with no passing report **or** whose recorded inputs (path, size, mtime) changed — a replaced logo, a new brand
name. Re-run every step downstream of it (a new logo re-traces, re-exports and re-lays out everything) and reuse the verified
outputs before it. Record each step with the `job-helper` snippet after its gate passed.

## When a gate fails

Stop at the failed gate; never continue past it. Re-discover the commands you used (`pi-craft vectorcraft exec commands | jq …`
— VectorCraft has no `describe`; `pi-craft designcraft exec describe <id>`; `pi-craft photocraft exec commands --filter <word>`),
repeat the step and re-run the gate. At most 2 retries per step; after the second failure stop and report the verify output and
what was tried. `pi-craft verify` exit `3` means a probe tool is missing (`ffprobe`, or PdfCraft cannot be provisioned): stop and
report the missing tool — never treat it as a pass.

## Recipes

```bash recipe: brand-kit-core
# A raster logo -> traced svg -> black variant -> png/tif set -> one-page sheet -> packaged pdf, every svg gated by its png preview.
ffmpeg -v error -y -f lavfi -i "color=c=white:s=400x200,drawbox=x=40:y=40:w=120:h=120:color=red:t=fill,drawbox=x=220:y=60:w=100:h=80:color=blue:t=fill" -frames:v 1 logo.png
mkdir -p 01-logo 02-variants 03-raster 04-sheet 05-package
BRAND="ACME"
pi-craft vectorcraft exec run --in logo.png --cmd select.all \
  --cmd imageTrace.makeAndExpand --params '{"preset":"Flat Logo","params":{"ignoreWhite":true}}' --export 01-logo/logo.svg
pi-craft vectorcraft exec convert 01-logo/logo.svg 01-logo/preview.png
pi-craft verify 01-logo/preview.png --size 400x200 --alpha

pi-craft vectorcraft exec run --in 01-logo/logo.svg --cmd select.all --cmd paint.setFill --params '{"color":"#000000"}' --export 02-variants/logo-black.svg
pi-craft vectorcraft exec convert 02-variants/logo-black.svg 02-variants/logo-black.png
pi-craft verify 02-variants/logo-black.png --size 400x200 --alpha

pi-craft vectorcraft exec convert 01-logo/logo.svg 03-raster/master.png --scale 4
pi-craft photocraft exec run 03-raster/master.png --cmd image.imageSize --params '{"width":800,"height":400}' --out 03-raster/logo-800.png
pi-craft photocraft exec run 03-raster/master.png --out 03-raster/logo-print.tif
pi-craft verify 03-raster/logo-800.png --size 800x400 --alpha
pi-craft verify 03-raster/logo-print.tif --size 1600x800

cat > 04-sheet/sheet.script <<EOF
file.new={"preset":"A4","title":"$BRAND brand sheet"}
frame.create={"rect":[50,50,545,120],"content":"text"}
story.setText={"story":"\$1.story","text":"$BRAND"}
frame.create={"rect":[50,150,350,300],"content":"graphic"}
file.place={"path":"$PWD/03-raster/logo-800.png","frame":"\$3.id"}
EOF
pi-craft designcraft exec script 04-sheet/sheet.script --export 04-sheet/sheet.pdf --export 04-sheet/sheet.png
pi-craft verify 04-sheet/sheet.pdf --pages 1 --text-contains "$BRAND"

pi-craft pdfcraft exec edit 04-sheet/sheet.pdf --out 05-package/brand-kit.pdf --title "$BRAND brand kit" --author "$BRAND"
pi-craft verify 05-package/brand-kit.pdf --pages 1 --text-contains "$BRAND"
```
