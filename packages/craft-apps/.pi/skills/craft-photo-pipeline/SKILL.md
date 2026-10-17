---
name: craft-photo-pipeline
description: Process a photo from RAW to delivery with ArtCraft apps - LightCraft develop and denoise, PhotoCraft retouch (content-aware removal, or generative replace-region when credentials exist), PNG/JPG/WebP/TIFF export set; verified and resumable. Use for "develop this RAW and retouch it", "remove the object and export for web and print".
---

# craft-photo-pipeline — RAW → develop/denoise → retouch → export set

One photo through three apps: **LightCraft** develops (exposure, colour, noise reduction) and writes a lossless `png`;
**PhotoCraft** retouches (a region removed or, with image credentials, regenerated); PhotoCraft exports the delivery set.
Read `lightcraft` and `photocraft` first. Resumable-job rules are in the `craft-studio` router, section **Craft jobs**.

## Step table

| # | Step | Tool | Input → Output | Gate |
|---|---|---|---|---|
| 0 | Preflight + job | agent | request → `job.json` | `check: job` |
| 1 | Develop + denoise | LightCraft | RAW/`jpg`/`png` → `01-develop/dev.png` | `pi-craft verify --size` |
| 2 | Retouch (optional) | PhotoCraft | `dev.png` → `02-retouch/retouched.png` | `pi-craft verify --size --frame-diff` |
| 3 | Export set | PhotoCraft | master → `03-export/photo-<w>.webp`, `photo-print.tif`, `photo.jpg` | `pi-craft verify --size` |

Hand-off formats: `png` (lossless, 8-bit) between steps — never re-compress through `jpg` before the last step; `tiff` for
print, `webp`/`jpg` for screens. `--alpha` is not asserted in this workflow (photos have none).

### Step 0 — Preflight and job

**Output:** `craft-jobs/<slug>/job.json` (created or loaded).
**Gate:** `check: job`.

| Sibling | Package | Check | If missing |
|---|---|---|---|
| `pi-nano-banana` | already a dependency of craft-apps | usable credentials (`GEMINI_API_KEY`, or `--backend pi`) | no credentials: skip the generative `replace-region` and tell the user; use the content-aware removal of step 2, or stop when the request needs generated pixels |

Camera RAW (DNG, ARW, NEF, RAF…) and `png`/`jpg`/`tif` inputs work; the synthetic DNGs from `lightcraft-cli synth-merge` are what
this skill was checked with, so say so if a real camera RAW misbehaves. Ask for the delivery targets (web width, print) up
front. Set up the job (**Craft jobs** in `craft-studio`: slug rule, `job-helper`) and run **Resume**. API keys are never written
to `job.json` or reports.

```bash check: job
# run from the directory that contains craft-jobs/ (SLUG set as in step 0)
jq -e '.name and .workflow and (.steps | type == "object")' "craft-jobs/$SLUG/job.json"
```

### Step 1 — Develop and denoise

**Output:** `01-develop/dev.png`.
**Gate:** `pi-craft verify` — `--size` (the long edge you asked for, aspect ratio of the source).

`lightcraft-cli render` develops one file and writes the result; the original is never modified. Slider ids come from
`pi-craft lightcraft exec controls`, never from memory; out-of-range values are clamped silently. Classic denoise is two
sliders (`detail.nrLuminance`, `detail.nrColor`, 0–100). `--size N` is the long edge; without it you get the full size.

```bash
pi-craft lightcraft exec controls | grep -i -E "exposure|nrLuminance|nrColor"
pi-craft lightcraft exec render "$SRC" -o "$JOB/01-develop/dev.png" --size 3000 \
  --set light.exposure=0.3 --set detail.nrLuminance=30 --set detail.nrColor=25
pi-craft verify "$JOB/01-develop/dev.png" --size 3000x2000
```

AI denoise is a separate, opt-in model path (`denoise.models.install` / `denoise.models.download` need the user's explicit licence
acceptance, `acknowledged: true`, and a model file or pinned download): offer it only if the user asks, never acknowledge a
licence on their behalf, and gate its output the same way. `pi-craft verify --frame-diff` compares luma only: a pure colour
edit can read ~0 % different — prove it with exposure or a derived property.

### Step 2 — Retouch (optional)

**Output:** `02-retouch/retouched.png`.
**Gate:** `pi-craft verify` — `--size` (unchanged) and `--frame-diff 0:<dev.png>>0.1` (the retouch changed pixels).

Selections live inside one `run`: select and fill in the same invocation. **Remove** (no generation, always available):
`select.rect`, grow it a few px (`select.modify.expand`), `edit.contentAwareFill`. **Replace** (needs credentials):
`pi-photocraft replace-region` — only the padded crop goes to the generator, pixels outside it stay identical; see `photocraft`
for the options. With no credentials skip it and say so.

```bash
pi-craft photocraft exec run "$JOB/01-develop/dev.png" \
  --cmd select.rect --params '{"x":100,"y":100,"width":200,"height":150}' \
  --cmd select.modify.expand --params '{"radius":6}' --cmd edit.contentAwareFill --params '{}' \
  --out "$JOB/02-retouch/retouched.png"
pi-craft verify "$JOB/02-retouch/retouched.png" --size 3000x2000 --frame-diff "0:$JOB/01-develop/dev.png>0.1"
```

No retouch wanted? Skip the step and use `dev.png` as the master of step 3.

### Step 3 — Export set

**Output:** `03-export/photo-1200.webp`, `03-export/photo-print.tif`, `03-export/photo.jpg`.
**Gate:** `pi-craft verify` — `--size` on every file.

PhotoCraft opens the master and writes each format by extension (`--format`/`--quality` for lossy ones); resize first with
`image.imageSize` (keep the aspect ratio exactly). One `--out` per run: one run per file.

```bash
pi-craft photocraft exec run "$JOB/02-retouch/retouched.png" --cmd image.imageSize --params '{"width":1200,"height":800}' --out "$JOB/03-export/photo-1200.webp" --format webp --quality 85
pi-craft photocraft exec run "$JOB/02-retouch/retouched.png" --out "$JOB/03-export/photo-print.tif"
pi-craft photocraft exec run "$JOB/02-retouch/retouched.png" --out "$JOB/03-export/photo.jpg" --format jpg --quality 92
pi-craft verify "$JOB/03-export/photo-1200.webp" --size 1200x800
pi-craft verify "$JOB/03-export/photo-print.tif" --size 3000x2000
```

## Resume

Follow the **Craft jobs** convention in `craft-studio`: read `craft-jobs/<slug>/job.json` as data, confirm the job name, and start
at the first step with no passing report **or** whose recorded inputs (path, size, mtime) changed — a re-shot source, changed
slider values. Re-run every step downstream of it (a new develop re-retouches and re-exports) and reuse the verified outputs
before it. Record each step with the `job-helper` snippet after its gate passed; keep the slider values in the step directory
so a result is reproducible.

## When a gate fails

Stop at the failed gate; never continue past it. Re-discover the commands you used (`pi-craft lightcraft exec controls` /
`commands`; `pi-craft photocraft exec commands --filter <word>` — LightCraft and PhotoCraft have no `describe`), repeat the step
and re-run the gate. At most 2 retries per step; after the second failure stop and report the verify output and what was
tried. `pi-craft verify` exit `3` means a probe tool is missing (`ffprobe`/`ffmpeg`): stop and report the missing tool — never
treat it as a pass.

## Recipes

```bash recipe: photo-pipeline-core
# A synthetic DNG developed with denoise sliders -> a blemish removed (content-aware fill) -> webp/tif/jpg export set.
mkdir -p 01-develop 02-retouch 03-export
pi-craft lightcraft exec synth-merge hdr -o brackets
pi-craft lightcraft exec render brackets/bracket-1.dng -o 01-develop/dev.png --size 900 \
  --set light.exposure=0.3 --set detail.nrLuminance=30 --set detail.nrColor=25
pi-craft verify 01-develop/dev.png --size 900x600

# stand-in for a blemish: a red box drawn on the developed frame, then removed again by PhotoCraft
ffmpeg -v error -y -i 01-develop/dev.png -vf drawbox=x=100:y=100:w=200:h=150:color=red:t=fill blemish.png
pi-craft photocraft exec run blemish.png \
  --cmd select.rect --params '{"x":100,"y":100,"width":200,"height":150}' \
  --cmd select.modify.expand --params '{"radius":6}' --cmd edit.contentAwareFill --params '{}' \
  --out 02-retouch/retouched.png
pi-craft verify 02-retouch/retouched.png --size 900x600 --frame-diff 0:blemish.png\>0.1

pi-craft photocraft exec run 02-retouch/retouched.png --cmd image.imageSize --params '{"width":600,"height":400}' --out 03-export/photo-600.webp --format webp --quality 85
pi-craft photocraft exec run 02-retouch/retouched.png --out 03-export/photo-print.tif
pi-craft photocraft exec run 02-retouch/retouched.png --out 03-export/photo.jpg --format jpg --quality 92
pi-craft verify 03-export/photo.jpg --size 900x600
pi-craft verify 03-export/photo-print.tif --size 900x600
pi-craft verify 03-export/photo-600.webp --size 600x400
```
