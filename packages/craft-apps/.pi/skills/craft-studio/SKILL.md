---
name: craft-studio
description: Router for the ArtCraft craft apps (PhotoCraft, VectorCraft, FilmCraft, LightCraft, PdfCraft, EffectCraft, DesignCraft, FigCraft, WordCraft, SoundCraft, DeckCraft, CADCraft, GridCraft) driven headless via pi-craft. Use to choose which app fits a job and run the discover-execute-save-verify loop - "which craft app should I use", "edit a video/audio/image/PDF headless", "make a title card".
---

# craft-studio — pick the right ArtCraft app, drive it headless, verify the result

ArtCraft ships thirteen native creative apps. Each has a headless `<app>-cli` with a self-describing
command registry (≈6 000 commands in total) and a stdio MCP server. `pi-craft` provisions those CLIs on
first use (checksum-verified, no desktop app, nothing installed system-wide) and gives you one command
surface for all of them. **This skill chooses the app and owns the loop; each app has its own skill
for its dialect, traps and recipes — read it before running anything in that app.**

```bash
pi-craft apps                 # the 13 apps (offline)
pi-craft status               # what is installed, cache size, active source (never downloads)
pi-craft install soundcraft filmcraft     # optional pre-provisioning; every <app> command also provisions on demand
pi-craft <app> exec <args…>   # run <app>-cli with <args…> verbatim — the bash route
pi-craft verify <file> …      # mechanical output checks (below)
```

## Which app for which job

| App | Use it for | Reads / writes | Skill |
|---|---|---|---|
| `photocraft` | raster editing: crop, resize, colour, masks, layers, content-aware fill; pairs with `pi-nano-banana` | png jpg webp tif psd | `photocraft` |
| `lightcraft` | RAW development, exposure/colour grading, denoise, HDR/panorama merge | dng/raw → jpg png tif | `lightcraft` |
| `vectorcraft` | vector illustration, logos, icons, SVG/PDF export | svg pdf png | `vectorcraft` |
| `figcraft` | UI/interface design: frames, components, export of assets | fig, svg png pdf | `figcraft` |
| `designcraft` | page layout / DTP: stories, styles, multi-page PDF | pdf png | `designcraft` |
| `filmcraft` | video editing: import, sequence, timeline, h264 export | mp4 mov (in) → mp4 | `filmcraft` |
| `effectcraft` | motion graphics: comps, animated text, effects, **alpha** renders | project → mov ProRes 4444 / mp4 / png | `effectcraft` |
| `soundcraft` | audio editing, mixing, gain, bounce with loudness/peak report | wav aiff (in/out) | `soundcraft` |
| `pdfcraft` | PDF combine, split, extract, edit, render, text, audit | pdf → pdf png txt | `pdfcraft` |
| `wordcraft` | word processing: DOCX/ODT/RTF documents, conversion, PDF export | docx odt rtf html md pdf | `wordcraft` |
| `deckcraft` | presentations: slides, shapes, tables, export | pptx → pdf png | `deckcraft` |
| `gridcraft` | spreadsheets: formulas, evaluation, conversion | xlsx csv | `gridcraft` |
| `cadcraft` | 2D CAD drawings: entities, layers, export | dxf dwg → pdf png svg | `cadcraft` |

Picking rules: one app per file format family; if two apps could do it, take the one whose *native*
format the input already has (a DOCX goes to WordCraft, never through DeckCraft). Cross-app jobs
(title card over a video, narration under a clip) are a chain of single-app steps with the hand-off
formats below — no app embeds another.

## Workflow skills — chains of apps for whole jobs

When a job spans several apps or sibling skills, use a workflow skill instead of improvising the chain. Each
one has a step table (input → output), a `pi-craft verify` gate after every artefact step, a step 0 that checks
which sibling skills are available, and the **Craft jobs** convention below for resuming.

| Workflow skill | Use it for | Drives |
|---|---|---|
| `craft-video-post` | footage / Veo clips → (redaction) → assembly with alpha overlays → captions from an SRT → mix → mp4 delivery | FilmCraft, SoundCraft, EffectCraft |
| `craft-beat-cut` | cut footage on the music's downbeats with camera punches on the hits (`music-hits/1`) | FilmCraft, SoundCraft |
| `craft-podcast-master` | recording → per-speaker tracks, cleanup, loudness-targeted master, optional chapters | SoundCraft (+ FilmCraft mux) |
| `craft-motion-titles` | names / lines from an SRT or speaker-id → lower-third / title alpha overlays on a video | EffectCraft, FilmCraft |
| `craft-brand-kit` | a logo (svg, or a raster traced to vector) → colour/mono variants, png/tiff export set, one-page brand sheet, pdf package | VectorCraft, PhotoCraft, DesignCraft, PdfCraft |
| `craft-doc-publish` | Markdown + frontmatter + the company template → templated DOCX and PDF with TOC, images and Mermaid, optional package/protect | `pi-craft doc prepare`, WordCraft, PdfCraft |
| `craft-deck` | an outline → DeckCraft slides (+ transition previews) → pdf handout; or an HTML deck with `deck3d` instead | DeckCraft, PdfCraft |
| `craft-photo-pipeline` | RAW/photo → LightCraft develop + denoise → PhotoCraft retouch → web/print export set | LightCraft, PhotoCraft |
| `craft-data-visual` | data → GridCraft workbook with a formula-error read-back → chart → infographic → slide | GridCraft, VectorCraft, DesignCraft, DeckCraft |

Two splits to remember:

- **FilmCraft vs HyperFrames.** FilmCraft edits footage on a timeline (cuts, tracks, captions, audio, export).
  HyperFrames (`hyperframes-showreel`, package `video-production`) is HTML/code-driven motion composition.
  `craft-video-post` never re-authors a HyperFrames composition: it overlays the render when it has alpha
  (`npx hyperframes render . --format mov`), otherwise places it as a full-frame segment.
- **`craft-beat-cut` vs `hyperframes-showreel`.** Beat-synced cuts of a *footage timeline* → `craft-beat-cut`
  (FilmCraft). A composition-driven showreel with scenes on the beat grid → `hyperframes-showreel`.

- **`craft-doc-publish` vs `document-converter`.** Markdown → a templated DOCX/PDF is `craft-doc-publish` by default (no
  Docker; it keeps the template's cover, headers and footers). `document-converter` stays the choice for ingest and OCR of
  existing PDF/DOCX/PPTX/XLSX, round-trip editing (extract a DOCX to Markdown, edit, merge back), PlantUML and table-width
  profiles — and is the fallback renderer when WordCraft cannot be provisioned.
- **`craft-deck` renderers.** DeckCraft (`pptx`/`pdf`) or `deck3d` (an HTML deck) — alternatives, never converted into each other.

Workflows reference sibling skills softly: if a sibling is not installed they name the package that provides
it and either offer a degraded path or stop.

## Hand-off formats between apps

| From → to | Format | Why |
|---|---|---|
| audio → video editor | `wav` or `aiff` (PCM) | lossless, every app reads it |
| motion graphics with transparency → video editor | `mov` **ProRes 4444** with `rgba` channels | the only common container that keeps alpha |
| finished video (delivery) | `mp4` h264 + aac | what players and `pi-craft verify` expect |
| raster image | `png` (lossless, alpha) or `tiff` | never re-compress through `jpg` between steps |
| vector artwork | `svg`, or `pdf` for print | |
| document | `pdf` for output, `docx`/`odt` for editable hand-off | |

## The loop — every step, every app

1. **Plan** the file that this step must produce and the property that proves it is right (duration, size, alpha, page count…).
2. **Discover** — never guess ids. `pi-craft <app> exec commands <word>` lists real ids and parameter schemas (the filter is `--filter`, `--search` or positional depending on the app — the app skill says which; PdfCraft uses `tools`; `describe <id>` exists for some apps). Ids change between alpha releases.
3. **Execute** with `pi-craft <app> exec …` (bash route). A run that fails on one line can still leave a valid-looking but *wrong* result (a mistyped id in a FilmCraft script silently placed media at the wrong time and produced a 10 s file instead of 5 s).
4. **Save** the project file (`--save`, `--save-as`, `--project`, `.scraft`, `.ecproj`, `.fcproj`… per app skill) so the next invocation continues from it — most CLIs keep no state between runs.
5. **Verify** mechanically with `pi-craft verify` before using the output as the next step's input.

```bash
pi-craft verify final.mp4 --duration 5±0.1 --has-video --has-audio --size 1920x1080
pi-craft verify title.mov --alpha --size 1280x720 --frame-diff 3:plain.mp4>0.5
pi-craft verify mix.wav --duration 3±0.1 --loudness -16±1 --max-peak -1
pi-craft verify report.pdf --pages 12 --text-contains "Quarterly"
```

Exit `0` all pass · `1` a failure (the report shows expected vs actual) · `2` usage error · `3` a probe tool
is missing (`ffprobe`/`ffmpeg` for media, `pdfcraft` for PDFs). **A step is not done until verify exits 0.**

```bash recipe: tone-roundtrip
# Smallest end-to-end pass of the loop: make input, discover, execute, save the output, verify.
ffmpeg -v error -y -f lavfi -i sine=frequency=440:duration=3 tone.wav
pi-craft soundcraft exec commands --filter gain | head -3
pi-craft soundcraft exec run \
  --cmd session.new \
  --cmd "file.import_audio={\"path\":\"$PWD/tone.wav\"}" \
  --cmd edit.select_all \
  --cmd 'clip.gain={"db":-6}' \
  --bounce mix.wav
pi-craft verify mix.wav --duration 3±0.1 --max-peak -20
```

## Craft jobs — resumable multi-step work

Every workflow skill follows this one convention (they link here, they do not restate it).

- **Layout.** `craft-jobs/<slug>/NN-<step>/` holds step `NN`'s project file (`.fcproj`, `.scraft`, `.ecproj`) and its
  outputs; `craft-jobs/<slug>/job.json` records the job. `<slug>` is the job name lower-cased with every character
  outside `[a-z0-9-]` replaced by `-` — never a raw path or user text.
- **`job.json`** records `name`, `workflow` and, per completed step: `status`, the step's **inputs** (`path`, `size`,
  `mtime`), its **upstream** step ids and its `pi-craft verify --json` **report**.
- **Resume rule.** Re-running a job starts at the first step that has no passing report **or** whose recorded
  inputs no longer match the files on disk (size or mtime changed, file gone); every step downstream of it is
  re-run too, never reused.
- **Slug reuse.** Reusing an existing slug resumes only after you confirm the `name` in `job.json` matches the
  request; on a mismatch (two names mapping to one slug) pick a new slug with a numeric suffix (`-2`, `-3`).
- **`job.json` is data.** Read it back as data only; re-validate that every recorded path sits under
  `craft-jobs/<slug>/` (or is a recorded input) before using it.
- **Routes.** Workflows use the bash route. On the MCP route the job directory must sit inside the confined
  server's `--root`, and FilmCraft is unconfined.

```bash job-helper
# Create the job once (SLUG: apply the rule above), then record each step after its gate passed.
mkdir -p "craft-jobs/$SLUG"
test -f "craft-jobs/$SLUG/job.json" || jq -n --arg n "$NAME" --arg w "$WORKFLOW" '{name:$n,workflow:$w,steps:{}}' > "craft-jobs/$SLUG/job.json"
record_step() { # record_step NN-step "upstream ids comma-separated" verify-report.json input-file…
  local id=$1 up=$2 rep=$3; shift 3
  local ins; ins=$(for f in "$@"; do node -e 'const s=require("fs").statSync(process.argv[1]);console.log(JSON.stringify({path:process.argv[1],size:s.size,mtime:s.mtimeMs}))' "$f"; done | jq -s .)
  jq --arg id "$id" --arg up "$up" --slurpfile r "$rep" --argjson ins "$ins" \
    '.steps[$id]={status:"passed",inputs:$ins,upstream:($up|split(",")|map(select(length>0))),report:$r[0]}' \
    "craft-jobs/$SLUG/job.json" > "craft-jobs/$SLUG/job.json.tmp" && mv "craft-jobs/$SLUG/job.json.tmp" "craft-jobs/$SLUG/job.json"
}
# usage: pi-craft verify out.mp4 --duration 5±0.1 --json > craft-jobs/$SLUG/03-assembly/verify.json
#        record_step 03-assembly 01-footage craft-jobs/$SLUG/03-assembly/verify.json footage/a.mp4
```

## Bash route vs MCP route

- **Default to the bash route** (`pi-craft <app> exec`). It works for every app, has no tool-count cost, and
  you see every command and result.
- **MCP is opt-in and per app**: `pi-craft <app> mcp --register` writes one `craft-<app>` entry into the
  project's `.pi/mcp.json`; nothing is ever registered implicitly. Use it for long multi-step sessions on one
  open document. pi loads project MCP servers only for a trusted project started in the project root.
- **Confinement.** Six servers advertise path confinement (PhotoCraft, VectorCraft, EffectCraft, WordCraft,
  SoundCraft, PdfCraft) and run confined to the project directory (`--root`). The other seven (FilmCraft,
  LightCraft, DesignCraft, FigCraft, DeckCraft, CADCraft, GridCraft) can read and write any path the user
  can, so `mcp` and `mcp --register` refuse them without `--allow-unconfined`. Say so to the user before using it.
- **Tool budget.** LightCraft (330 tools) and PdfCraft (163) would flood the model context. Prefer the bash
  route, or register with `--compact` (only helper tools are listed; every command stays reachable).
- Issue MCP tool calls one at a time and wait for each result.

## Out of scope

Driving the desktop GUIs (`--bridge`, `--connect`, `ui_*` tools, `app` subcommands) is not supported: the
proxy rejects those options and you must never launch a desktop app to "see" a result — verify files
instead. Image/video *generation* belongs to ArtCraft Studio and `pi-nano-banana`, not to these apps.

## Setup notes

- Env: `<APP>_VERSION` pins a release (e.g. `FILMCRAFT_VERSION=0.8.0`), `<APP>_BIN` uses your own
  binary, `CRAFT_HOME` moves the cache, `CRAFT_SOURCE=managed|launcher|auto`, `GITHUB_TOKEN` avoids API rate limits.
- Linux needs glibc ≥ 2.35 (not musl/Alpine). macOS and Windows: nothing extra. `ffmpeg`/`ffprobe` are
  optional system tools needed only by `pi-craft verify` media checks.
- The ArtCraft *Craft Launcher* installs desktop apps only (no CLI), so the default `managed` source is the one that works headless.
