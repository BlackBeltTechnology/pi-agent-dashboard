---
name: craft-studio
description: Router for the ArtCraft craft apps (PhotoCraft, VectorCraft, FilmCraft, LightCraft, PdfCraft, EffectCraft, DesignCraft, FigCraft, WordCraft, SoundCraft, DeckCraft, CADCraft, GridCraft) driven headless through pi-craft. Use to choose which app fits a creative job and to run the shared discover-execute-save-verify loop. Triggers - "which craft app should I use", "edit a video / audio / image / PDF / slides / spreadsheet / CAD drawing headless", "make a title card", "retouch a photo", "convert a document", "use ArtCraft from the command line".
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
