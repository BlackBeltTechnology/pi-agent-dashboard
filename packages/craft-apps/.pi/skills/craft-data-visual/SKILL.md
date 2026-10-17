---
name: craft-data-visual
description: Turn data into a finished visual with ArtCraft apps - GridCraft workbook with a cell read-back check for formula errors, chart export, a VectorCraft badge and DesignCraft infographic, a DeckCraft slide; verified and resumable. Use for "make a chart from this spreadsheet", "build an infographic from these numbers", "put the revenue chart on a slide", "check that my formulas have no errors before charting".
---

# craft-data-visual — data → workbook + read-back → chart → infographic → slide

GridCraft computes and charts, VectorCraft makes an accent graphic, DesignCraft lays the infographic out, DeckCraft puts it on a
slide. **GridCraft prints formula errors with exit 0**, so the chart's source range is read back before anything is exported.
Read `gridcraft`, `vectorcraft`, `designcraft` and `deckcraft` first. Resumable-job rules are in the `craft-studio` router,
section **Craft jobs**.

## Step table

| # | Step | Tool | Input → Output | Gate |
|---|---|---|---|---|
| 0 | Preflight + job | agent | request → `job.json` | `check: job` |
| 1 | Workbook + read-back | GridCraft | data → `01-data/data.xlsx` | `check: readback` |
| 2 | Chart | GridCraft + PdfCraft + PhotoCraft | workbook → `02-chart/chart.pdf`, `chart.png` | `pi-craft verify --pages --text-contains`, `--size` |
| 3 | Infographic | VectorCraft + DesignCraft | chart + figure → `03-infographic/infographic.pdf` | `pi-craft verify --pages --text-contains`, `--size` |
| 4 | Slide | DeckCraft | infographic → `04-slide/slide.pptx`, `slide.pdf` | `pi-craft verify --pages --text-contains` |

Hand-off formats: `xlsx` between 1 and 2, `png` for the chart and every placement, `svg` only for the VectorCraft accent (gated
through its `png` preview, never passed to `pi-craft verify`), `pdf` for delivery. GridCraft has no chart image command: the
chart comes from its **PDF** export (`run --in x.xlsx --out x.pdf`), rendered by PdfCraft and trimmed by PhotoCraft.

### Step 0 — Preflight and job

**Output:** `craft-jobs/<slug>/job.json` (created or loaded).
**Gate:** `check: job`.

No sibling skills are referenced: the apps are provisioned by `pi-craft` itself, so there is no degraded path — if an app cannot
be provisioned, stop and report it. Ask for the data (a file or numbers), the chart type and the title. Set up the job
(**Craft jobs** in `craft-studio`: slug rule, `job-helper`) and run **Resume**.

```bash check: job
# run from the directory that contains craft-jobs/ (SLUG set as in step 0)
jq -e '.name and .workflow and (.steps | type == "object")' "craft-jobs/$SLUG/job.json"
```

### Step 1 — Workbook and read-back

**Output:** `01-data/data.xlsx` (data, formulas and the chart object) and `01-data/readback.out`.
**Gate:** `check: readback` — the chart's source range contains none of `#NAME?` `#DIV/0!` `#REF!` `#VALUE!` `#N/A` `#NUM!`
`#NULL!`. A hit stops the step: fix the formula (`pi-craft gridcraft exec cat data.xlsx --formulas` shows the source) and **no chart is exported**.

`range.setValues` types data and formulas (strings starting with `=` are formulas, `null` is empty), `insert.chart` adds the
chart (`range`, `type` column|bar|line|pie|…, `title`, `at` the anchor cell, `width`/`height` px). Anchor it at `A1`: the chart
then covers the data, so the page export shows the chart alone. `pi-craft gridcraft exec commands --search chart` lists the options.

```bash
pi-craft gridcraft exec run --cmd 'range.setValues={"range":"A1","values":[["Quarter","Revenue"],["Q1",120],["Q2",150],["Q3",90],["Q4",200]]}' \
  --cmd 'insert.chart={"range":"A1:B5","type":"column","title":"Revenue by quarter","at":"A1","width":480,"height":300}' --out "$JOB/01-data/data.xlsx"
```

```bash check: readback
# run inside the step directory: cd "$JOB/01-data"; SRC_RANGE is the chart's source range (default A1:B5)
pi-craft gridcraft exec cat data.xlsx --range "${SRC_RANGE:-A1:B5}" > readback.out
test -s readback.out && ! grep -qE '#(NAME\?|DIV/0!|REF!|VALUE!|N/A|NUM!|NULL!)' readback.out
```

### Step 2 — Chart

**Output:** `02-chart/chart.pdf` and `02-chart/chart.png` (the chart only).
**Gate:** `pi-craft verify chart.pdf --pages 1 --text-contains "<chart title>"`, then `pi-craft verify chart.png --size <WxH>` with the size
`image.trim` reported.

Export the workbook to pdf (`gridcraft-cli` `convert` rejects `.pdf`; `run --in … --out x.pdf` works), render the page at 100 dpi
with PdfCraft, and let PhotoCraft trim the white margin (`image.trim` `basedOn: topLeft`); it reports the exact size.

```bash
pi-craft gridcraft exec run --in "$JOB/01-data/data.xlsx" --out "$JOB/02-chart/chart.pdf"
pi-craft verify "$JOB/02-chart/chart.pdf" --pages 1 --text-contains "Revenue by quarter"
pi-craft pdfcraft exec render "$JOB/02-chart/chart.pdf" --page 1 --dpi 100 --out "$PWD/$JOB/02-chart/page.png"
SZ=$(pi-craft photocraft exec run "$JOB/02-chart/page.png" --cmd image.trim --params '{"basedOn":"topLeft"}' --out "$JOB/02-chart/chart.png" \
  | jq -Rr 'fromjson? | select(.command=="image.trim") | "\(.result.width)x\(.result.height)"')
pi-craft verify "$JOB/02-chart/chart.png" --size "$SZ"
```

### Step 3 — Infographic

**Output:** `03-infographic/badge.svg` (+ preview `badge.png`), `03-infographic/infographic.pdf` and `infographic.png`.
**Gate:** `pi-craft verify` — the badge preview `--size --alpha`; the pdf `--pages 1 --text-contains "<headline>"`; the png `--size`.

VectorCraft draws the accent (a KPI badge; `shape.ellipse`, `paint.setFill`, `text.create`) and exports `svg`; the **png preview**
(`vectorcraft-cli convert`) is what gets gated and placed. DesignCraft `script` lays out the page: a text frame (`frame.create`
`content:"text"`, then `story.setText`), and one graphic frame per image (`content:"graphic"`, then `file.place` into
`$N.id` — the result of step N, 0-based). `--export x.png` rasterises at 2× (A4 → 1191×1684).

```bash
pi-craft vectorcraft exec run --cmd file.new --params '{"width":200,"height":200}' --cmd shape.ellipse --params '{"x":10,"y":10,"width":180,"height":180}' \
  --cmd paint.setFill --params '{"color":"#16607f"}' --cmd text.create --params '{"x":40,"y":105,"text":"+67%","size":40}' --export "$JOB/03-infographic/badge.svg"
pi-craft vectorcraft exec convert "$JOB/03-infographic/badge.svg" "$JOB/03-infographic/badge.png"
pi-craft verify "$JOB/03-infographic/badge.png" --size 200x200 --alpha
cat > "$JOB/03-infographic/layout.script" <<EOF
file.new={"preset":"A4","title":"Revenue infographic"}
frame.create={"rect":[50,50,545,100],"content":"text"}
story.setText={"story":"\$1.story","text":"Revenue by quarter"}
frame.create={"rect":[50,130,500,420],"content":"graphic"}
file.place={"path":"$PWD/$JOB/02-chart/chart.png","frame":"\$3.id"}
frame.create={"rect":[50,450,200,600],"content":"graphic"}
file.place={"path":"$PWD/$JOB/03-infographic/badge.png","frame":"\$5.id"}
EOF
pi-craft designcraft exec script "$JOB/03-infographic/layout.script" --export "$JOB/03-infographic/infographic.pdf" --export "$JOB/03-infographic/infographic.png"
pi-craft verify "$JOB/03-infographic/infographic.pdf" --pages 1 --text-contains "Revenue by quarter"
pi-craft verify "$JOB/03-infographic/infographic.png" --size 1191x1684
```

### Step 4 — Slide

**Output:** `04-slide/slide.pptx` and `04-slide/slide.pdf`.
**Gate:** `pi-craft verify slide.pdf --pages 1 --text-contains "<slide title>"` (the pptx is verified through its pdf).

DeckCraft: a blank deck, one `titleOnly` slide, the infographic `png` with `insert.picture`. For a slide in an existing deck use
`craft-deck`.

```bash
pi-craft deckcraft exec run --cmd 'file.new={"blank":true}' --cmd 'slide.new={"layout":"titleOnly","title":"Revenue by quarter"}' \
  --cmd "insert.picture={\"path\":\"$PWD/$JOB/03-infographic/infographic.png\"}" --save "$JOB/04-slide/slide.pptx"
pi-craft deckcraft exec convert "$JOB/04-slide/slide.pptx" "$JOB/04-slide/slide.pdf"
pi-craft verify "$JOB/04-slide/slide.pdf" --pages 1 --text-contains "Revenue by quarter"
```

## Resume

Follow the **Craft jobs** convention in `craft-studio`: read `craft-jobs/<slug>/job.json` as data, confirm the job name, and start
at the first step with no passing report **or** whose recorded inputs (path, size, mtime) changed — a new data file, an edited
workbook. Re-run every step downstream of it (new data re-checks, re-charts, re-lays out and re-slides) and reuse the verified
outputs before it. Record each step with the `job-helper` snippet after its gate passed (the read-back passes with a
`readback.out` of clean cells).

## When a gate fails

Stop at the failed gate; never continue past it. Re-discover the commands you used (`pi-craft gridcraft exec commands --search
<word>` — GridCraft has no `describe`, its `params` column is the schema; `pi-craft designcraft exec describe <id>`; `pi-craft
deckcraft exec describe <id>`), repeat the step and re-run the gate. At most 2 retries per step; after the second failure stop and
report the verify output and what was tried. A read-back failure is **not** retried by re-exporting: fix the source cells first.
`pi-craft verify` exit `3` means a probe tool is missing (PdfCraft cannot be provisioned, or `ffprobe`): stop and report the
missing tool — never treat it as a pass.

## Recipes

```bash recipe: data-visual-core
# Workbook with a chart -> read-back (no formula errors) -> chart png -> badge + infographic -> slide.
mkdir -p 01-data 02-chart 03-infographic 04-slide
pi-craft gridcraft exec run --cmd 'range.setValues={"range":"A1","values":[["Quarter","Revenue"],["Q1",120],["Q2",150],["Q3",90],["Q4",200]]}' \
  --cmd 'insert.chart={"range":"A1:B5","type":"column","title":"Revenue by quarter","at":"A1","width":480,"height":300}' --out 01-data/data.xlsx
pi-craft gridcraft exec cat 01-data/data.xlsx --range A1:B5 > 01-data/readback.out
test -s 01-data/readback.out && ! grep -qE '#(NAME\?|DIV/0!|REF!|VALUE!|N/A|NUM!|NULL!)' 01-data/readback.out

pi-craft gridcraft exec run --in 01-data/data.xlsx --out 02-chart/chart.pdf
pi-craft verify 02-chart/chart.pdf --pages 1 --text-contains "Revenue by quarter"
pi-craft pdfcraft exec render 02-chart/chart.pdf --page 1 --dpi 100 --out "$PWD/02-chart/page.png"
SZ=$(pi-craft photocraft exec run 02-chart/page.png --cmd image.trim --params '{"basedOn":"topLeft"}' --out 02-chart/chart.png \
  | jq -Rr 'fromjson? | select(.command=="image.trim") | "\(.result.width)x\(.result.height)"')
pi-craft verify 02-chart/chart.png --size "$SZ"

pi-craft vectorcraft exec run --cmd file.new --params '{"width":200,"height":200}' --cmd shape.ellipse --params '{"x":10,"y":10,"width":180,"height":180}' \
  --cmd paint.setFill --params '{"color":"#16607f"}' --cmd text.create --params '{"x":40,"y":105,"text":"+67%","size":40}' --export 03-infographic/badge.svg
pi-craft vectorcraft exec convert 03-infographic/badge.svg 03-infographic/badge.png
pi-craft verify 03-infographic/badge.png --size 200x200 --alpha
cat > 03-infographic/layout.script <<EOF
file.new={"preset":"A4","title":"Revenue infographic"}
frame.create={"rect":[50,50,545,100],"content":"text"}
story.setText={"story":"\$1.story","text":"Revenue by quarter"}
frame.create={"rect":[50,130,500,420],"content":"graphic"}
file.place={"path":"$PWD/02-chart/chart.png","frame":"\$3.id"}
frame.create={"rect":[50,450,200,600],"content":"graphic"}
file.place={"path":"$PWD/03-infographic/badge.png","frame":"\$5.id"}
EOF
pi-craft designcraft exec script 03-infographic/layout.script --export 03-infographic/infographic.pdf --export 03-infographic/infographic.png
pi-craft verify 03-infographic/infographic.pdf --pages 1 --text-contains "Revenue by quarter"
pi-craft verify 03-infographic/infographic.png --size 1191x1684

pi-craft deckcraft exec run --cmd 'file.new={"blank":true}' --cmd 'slide.new={"layout":"titleOnly","title":"Revenue by quarter"}' \
  --cmd "insert.picture={\"path\":\"$PWD/03-infographic/infographic.png\"}" --save 04-slide/slide.pptx
pi-craft deckcraft exec convert 04-slide/slide.pptx 04-slide/slide.pdf
pi-craft verify 04-slide/slide.pdf --pages 1 --text-contains "Revenue by quarter"
```
