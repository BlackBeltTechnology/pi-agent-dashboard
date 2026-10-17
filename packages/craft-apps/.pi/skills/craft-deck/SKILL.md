---
name: craft-deck
description: Turn an outline into a presentation with ArtCraft apps - DeckCraft slides from the outline, optional transition previews, a PdfCraft handout; or, on request, an HTML deck with deck3d instead; verified and resumable. Use for "make a deck from this outline", "build a 6-slide presentation about our Q3 results", "export the deck as a PDF handout", "preview the slide transitions".
---

# craft-deck — outline → DeckCraft slides → pdf handout (or deck3d HTML)

Two **alternative** renderers, chosen by the user: **DeckCraft** (`pptx` + `pdf`, steps below) or **`deck3d`** (an HTML deck, see
**HTML deck with deck3d**). They are never converted into each other. Read `deckcraft` (and `pdfcraft` for step 4) first.
Resumable-job rules are in the `craft-studio` router, section **Craft jobs**.

## Step table

| # | Step | Tool | Input → Output | Gate |
|---|---|---|---|---|
| 0 | Preflight + job | agent | request → `job.json` | `check: job` |
| 1 | Outline | agent | request → `01-outline/outline.md` | `check: outline` |
| 2 | Slides | DeckCraft | outline → `02-deck/deck.pptx`, `deck.pdf` | `pi-craft verify --pages --text-contains` |
| 3 | Transition previews (optional) | DeckCraft | deck → `03-transitions/t1.png` | `pi-craft verify --size` |
| 4 | Handout | PdfCraft | deck pdf → `04-handout/handout.pdf` | `pi-craft verify --pages --text-contains` |

Hand-off formats: `pptx` is the editable deck, `pdf` the delivery (one page per slide), `png` for previews. A `pptx` cannot be
probed directly: gate it through its `pdf` export. `--alpha` is not asserted anywhere in this workflow.

### Step 0 — Preflight and job

**Output:** `craft-jobs/<slug>/job.json` (created or loaded).
**Gate:** `check: job`.

| Sibling | Package | Check | If missing |
|---|---|---|---|
| `deck3d` | `@blackbelt-technology/pi-dashboard-deck3d` | skill in the loaded skill list | only needed when the user asks for an HTML / 3D web deck: otherwise continue with DeckCraft; for an HTML request without it, stop and name the package |

"Loaded skill list" is the available-skills list in your own system prompt. Ask which renderer the user wants when it is not
clear (`pptx`/`pdf` → DeckCraft; "3D web presentation", "HTML deck" → `deck3d`). Set up the job (**Craft jobs** in
`craft-studio`: slug rule, `job-helper`) and run **Resume**.

```bash check: job
# run from the directory that contains craft-jobs/ (SLUG set as in step 0)
jq -e '.name and .workflow and (.steps | type == "object")' "craft-jobs/$SLUG/job.json"
```

### Step 1 — Outline

**Output:** `01-outline/outline.md` — `# Deck title`, then one `## Slide title` per slide with `- bullet` lines.
**Gate:** `check: outline` — a title and at least one slide.

Write the outline with the user (one idea per slide, ≤ 5 bullets). The slide count is the page count the gates expect.

```bash check: outline
# run inside the step directory: cd "$JOB/01-outline" (the file is named as below)
grep -q '^# ' outline.md && test "$(grep -c '^## ' outline.md)" -ge 1
```

### Step 2 — Slides

**Output:** `02-deck/deck.pptx` and `02-deck/deck.pdf` (slides + 1 title slide).
**Gate:** `pi-craft verify deck.pdf --pages N --text-contains "<deck title>"` — `N` = slides in the outline + 1.

One `run`: `file.new` with `"blank":true` (plain `file.new` leaves an empty first slide), one `slide.new` for the title slide
(`layout` `title`, `title`, `body` = subtitle) and one per `## ` section (`titleAndContent`, `title`, `body` with the bullets
joined by `\n`); a picture goes on the slide just created with `insert.picture`. `slide.new` makes the new slide current, so
the order of commands is the order of slides. `--save` writes the pptx, `convert` the pdf.

```bash
pi-craft deckcraft exec run --cmd 'file.new={"blank":true}' \
  --cmd 'slide.new={"layout":"title","title":"Quarterly review","body":"ACME Kft."}' \
  --cmd 'slide.new={"layout":"titleAndContent","title":"Results","body":"Revenue grew\nCosts fell"}' \
  --cmd "insert.picture={\"path\":\"$PWD/chart.png\"}" --save "$JOB/02-deck/deck.pptx"
pi-craft deckcraft exec convert "$JOB/02-deck/deck.pptx" "$JOB/02-deck/deck.pdf"
pi-craft verify "$JOB/02-deck/deck.pdf" --pages 2 --text-contains "Quarterly review"
```

`pi-craft deckcraft exec describe slide.new` lists the layout names. Render a slide to look at it:
`render deck.pptx --slide 1 --scale 1 s1.png` (slide numbers are **0-based**).

### Step 3 — Transition previews (optional)

**Output:** `03-transitions/t1.png` (a still of slide 1 mid-transition) and the deck with its transitions, `03-transitions/deck.pptx`.
**Gate:** `pi-craft verify` on each preview — `--size` (`--width` sets the pixel width; 16:9).

`transition.set` (`kind`, `duration` ms, `index` = the slide it plays **into**) on a copy of the deck, then `render-transition`
at `--t` (0–1) shows the frame. Re-export the pdf only if the deck changed.

```bash
pi-craft deckcraft exec run --in "$JOB/02-deck/deck.pptx" --cmd 'transition.set={"kind":"fade","duration":700,"index":1}' --save "$JOB/03-transitions/deck.pptx"
pi-craft deckcraft exec render-transition "$JOB/03-transitions/deck.pptx" --slide 1 --t 0.5 --width 640 "$JOB/03-transitions/t1.png"
pi-craft verify "$JOB/03-transitions/t1.png" --size 640x360
```

### Step 4 — Handout

**Output:** `04-handout/handout.pdf`.
**Gate:** `pi-craft verify` — `--pages`, `--text-contains "<deck title>"`.

PdfCraft takes the deck's pdf: `edit` sets the metadata and can drop pages (`--delete 2,4` — later numbers refer to the
document after earlier options); `combine` appends an appendix. Protect with a password only when asked, with the `0600`
temp-file recipe of `craft-doc-publish` step 3; the password never goes into `job.json` or a report.

```bash
pi-craft pdfcraft exec edit "$JOB/02-deck/deck.pdf" --out "$JOB/04-handout/handout.pdf" --title "Quarterly review" --author "ACME Kft."
pi-craft verify "$JOB/04-handout/handout.pdf" --pages 2 --text-contains "Quarterly review"
```

## HTML deck with deck3d

When the user asks for a 3D web presentation or an HTML deck, use `deck3d` **instead** of the DeckCraft path: outline → `deck3d`
→ HTML deck, following that skill and its own checks. Skip steps 2–4 above entirely. Do not convert a `pptx` deck into an
HTML one or the other way round; if the user wants both, produce each from the outline.

## Resume

Follow the **Craft jobs** convention in `craft-studio`: read `craft-jobs/<slug>/job.json` as data, confirm the job name, and start
at the first step with no passing report **or** whose recorded inputs (path, size, mtime) changed — an edited outline, a replaced
picture. Re-run every step downstream of it (a changed outline rebuilds the deck, the previews and the handout) and reuse the
verified outputs before it. Record each step with the `job-helper` snippet after its gate passed.

## When a gate fails

Stop at the failed gate; never continue past it. Re-discover the commands you used (`pi-craft deckcraft exec describe <id>` /
`commands <word>` — the filter is positional in DeckCraft; `pi-craft pdfcraft exec tools`), repeat the step and re-run the gate.
At most 2 retries per step; after the second failure stop and report the verify output and what was tried. `pi-craft verify` exit
`3` means a probe tool is missing (PdfCraft cannot be provisioned): stop and report the missing tool — never treat it as a pass.

## Recipes

```bash recipe: deck-core
# Outline check -> 3 slides (one with a picture) -> pdf gate -> transition preview -> pdf handout.
ffmpeg -v error -y -f lavfi -i "color=c=white:s=400x200,drawbox=x=40:y=40:w=120:h=120:color=red:t=fill" -frames:v 1 chart.png
mkdir -p 01-outline 02-deck 03-transitions 04-handout
printf '# Quarterly review\n\n## Results\n- Revenue grew\n- Costs fell\n\n## Outlook\n- Stay the course\n' > 01-outline/outline.md
grep -q '^# ' 01-outline/outline.md && test "$(grep -c '^## ' 01-outline/outline.md)" -ge 1

pi-craft deckcraft exec run --cmd 'file.new={"blank":true}' \
  --cmd 'slide.new={"layout":"title","title":"Quarterly review","body":"ACME Kft."}' \
  --cmd 'slide.new={"layout":"titleAndContent","title":"Results","body":"Revenue grew\nCosts fell"}' \
  --cmd "insert.picture={\"path\":\"$PWD/chart.png\"}" \
  --cmd 'slide.new={"layout":"titleAndContent","title":"Outlook","body":"Stay the course"}' \
  --save 02-deck/deck.pptx
pi-craft deckcraft exec convert 02-deck/deck.pptx 02-deck/deck.pdf
pi-craft verify 02-deck/deck.pdf --pages 3 --text-contains "Quarterly review" --text-contains "Outlook"

pi-craft deckcraft exec run --in 02-deck/deck.pptx --cmd 'transition.set={"kind":"fade","duration":700,"index":1}' --save 03-transitions/deck.pptx
pi-craft deckcraft exec render-transition 03-transitions/deck.pptx --slide 1 --t 0.5 --width 640 03-transitions/t1.png
pi-craft verify 03-transitions/t1.png --size 640x360

pi-craft pdfcraft exec edit 02-deck/deck.pdf --out 04-handout/handout.pdf --title "Quarterly review" --author "ACME Kft."
pi-craft verify 04-handout/handout.pdf --pages 3 --text-contains "Quarterly review"
```
