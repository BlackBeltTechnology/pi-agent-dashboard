---
name: effectcraft
description: Headless motion graphics and compositing with EffectCraft (After-Effects-style comps, layers, text animation presets, keyframes, effects), provisioned on demand by pi-craft - build a composition, animate it, render a transparent (alpha) ProRes 4444 overlay, an mp4, a GIF or a still frame. Use for "make an animated title with a transparent background", "render a lower third as a mov with alpha", "export a still frame of this comp", "animate this text fading in", "script a composition in After Effects style".
---

# EffectCraft — headless motion graphics

EffectCraft is ArtCraft's compositing/motion app (comps, layers, 731 commands, 300+ effects). `pi-craft`
provisions the headless `effectcraft-cli` on first use (no desktop app). Choosing between apps, the
discover → execute → save → verify loop, the hand-off formats and the MCP policy live in `craft-studio`
(an alpha overlay for FilmCraft is **mov ProRes 4444 with rgba channels** — this skill produces it).

## What it is for / formats

Compositions of text, shapes, footage and effects with keyframes, expressions and text animation presets.
Project file: `.ecproj`. Renders `h264 hevc av1 prores webm gif`, image sequences `png jpeg tiff exr`, audio
`wav aiff`; a single still via `render-frame` (png). For finished video editing use FilmCraft, for a still
raster edit PhotoCraft.

## CLI dialect

`pi-craft effectcraft exec <args…>` passes the arguments to `effectcraft-cli`.
**Project flags come before the subcommand** (`--empty`, `--project F.ecproj`, `--save`, `--save-as F`).

```bash
effectcraft-cli commands [--filter TEXT] [--enabled] [--json]   # list ids; --json adds the parameter schema
effectcraft-cli exec <id> --params JSON                         # one command ("exec --list" = commands)
effectcraft-cli run <id> <json> [<id> <json> …]                 # several, in order (each id followed by its JSON)
effectcraft-cli script FILE.jsx [F.ecproj] | --eval CODE        # After-Effects-style JS object model (project, comps, layers)
effectcraft-cli info | props <comp> <layer> [--flat] | get <comp> <layer> <path> [--time S] | set <comp> <layer> <path> <value> [--time S]
effectcraft-cli render [--comp C] --out FILE --format F [--prores 4444] [--channels rgb|rgba] [--resolution half] [--start S --end S]
effectcraft-cli render-frame [--comp C] --time S|--frame N [--max-side PX] --out F.png [--transparent]
```

- `<comp>`: id or name, **`-` = the active comp**. `<layer>`: id, `#n` (index) or name. Property paths are
  slash paths from `props --flat` (e.g. `transform/opacity`, `transform/position`).
- `run` takes **JSON as the next argument**, not `--params`: `run comp.new '{…}' layer.newText '{…}'`. Each command
  prints its result (`{"comp":1}`, `{"layer":2}`) — keep ids for later steps.
- Text animation presets: `layer.applyTextPreset '{"preset":"fadeUpCharacters"}'` (also `typewriter`, `blurIn`,
  `trackingIn`, `dropInLines`, …); it applies to the last layer when `layer` is omitted.
- Keyframes: `prop.addKey '{"layer":"Name","path":"transform/opacity","time":1,"value":100}'`.

## State between invocations

A bare `run`/`exec`/`set` changes an in-memory project and **throws it away on exit**. Persist explicitly:

- first time: `--empty --save-as t.ecproj run …` (creates the file);
- later: `--project t.ecproj --save run …` (open, edit, write back). `--project t.ecproj run …` **without
  `--save` discards the edit**; a `render`/`render-frame`/`info` on `--project` only reads.
- `--save` also works on `set` (`--project t.ecproj --save set Title Hello transform/opacity 100 --time 1`).

## Discovery first

Command ids change between releases and parameters are optional-heavy objects — read the schema.

```bash
pi-craft effectcraft exec commands --filter newText            # id, label, shortcut, params
pi-craft effectcraft exec commands --json --filter prop.addKey  # JSON schema (+ "enabled"/"why")
pi-craft effectcraft exec --project t.ecproj info              # comps, layers, active comp
pi-craft effectcraft exec --project t.ecproj props - '#1' --flat   # property paths of layer 1 in the active comp
```

## Traps

- **No `--project`/`--empty` ⇒ a pre-populated demo project** (folders, "Lower Third", 90+ items), not a blank one.
  Always start with `--empty --save-as X.ecproj` so a leftover demo item cannot end up in your render.
- **Alpha needs both** `--format prores --prores 4444` **and** `--channels rgba` (`.mov`). Without `--channels rgba`
  the file is `yuv444p12le` and `verify --alpha` fails; with it the pixel format is `yuva444p12le` and the
  background really is transparent (comp background colour is not painted).
- `render-frame` is opaque `rgb24` unless you add `--transparent` (then `rgba`).
- A PNG render (`--format png`) is a **sequence**: `--out nocomp.png` writes `nocomp_00025.png` (frame number
  appended). For one frame use `render-frame`.
- `render-frame --time` is in seconds, `--frame` in frames; `--max-side 640` / `--scale K` shrinks the still.
- `set … --time T` creates a **keyframe** at T (the property becomes animated with a single key); omit `--time`
  for a static value. Use `prop.addKey` pairs for a real animation.
- `pi-craft verify --frame-diff 1.5:still.png\>0.1` fails with "no frame at 1.5 s" because a still only has a
  frame at 0 — write **`1.5:still.png@0\>0.1`** (`@<ref time>`). The diff compares luma, so a 1 % result for a
  title on transparency is normal.
- The `--out` of `render` is relative to the working directory; the render line prints the absolute path.
- Layer names: the text layer is named after its text unless `name` is passed; duplicates make `Name` ambiguous
  — use `#n` or the returned id.

## MCP route (opt-in)

`pi-craft effectcraft mcp --register` writes a `craft-effectcraft` entry into `.pi/mcp.json` (27 tools). It is
confined to the project directory (automation read/write roots; scripts are refused). Use MCP for a long
interactive session on one open document, bash for everything above. GUI bridging (`--bridge`) is out of scope.

## Recipes

```bash recipe: title-alpha
# Animated title (fades in over 1 s) -> ProRes 4444 overlay with real transparency.
pi-craft effectcraft exec --empty --save-as t.ecproj run \
  comp.new '{"name":"Title","width":1280,"height":720,"frameRate":25,"duration":2}' \
  layer.newText '{"text":"Fade","size":120,"position":[640,360]}' \
  prop.addKey '{"layer":"Fade","path":"transform/opacity","time":0,"value":0}' \
  prop.addKey '{"layer":"Fade","path":"transform/opacity","time":1,"value":100}'
pi-craft effectcraft exec --project t.ecproj render --out title.mov --format prores --prores 4444 --channels rgba
pi-craft effectcraft exec --project t.ecproj render-frame --time 0 --out blank.png --transparent
pi-craft verify title.mov --alpha --size 1280x720 --duration 2±0.1 --frame-diff 1.5:blank.png@0\>0.1
```

```bash recipe: still-frame
# A still from an animated text preset; --max-side halves it, --transparent keeps alpha.
pi-craft effectcraft exec --empty --save-as t.ecproj run \
  comp.new '{"name":"Title","width":1280,"height":720,"frameRate":25,"duration":2}' \
  layer.newText '{"text":"Hello","size":120,"position":[640,360]}' \
  layer.applyTextPreset '{"preset":"fadeUpCharacters"}'
pi-craft effectcraft exec --project t.ecproj render-frame --time 0 --out first.png --transparent
pi-craft effectcraft exec --project t.ecproj render-frame --time 1.5 --max-side 640 --out still.png --transparent
pi-craft verify still.png --alpha --size 640x360
```

```bash recipe: mp4-resume
# Re-open the saved project with --save to add a layer, then render a half-resolution mp4.
pi-craft effectcraft exec --empty --save-as t.ecproj run \
  comp.new '{"name":"Card","width":1280,"height":720,"frameRate":25,"duration":2,"background":"#203040"}' \
  layer.newText '{"text":"One","name":"One","size":100,"position":[640,260]}'
pi-craft effectcraft exec --project t.ecproj --save run \
  layer.newText '{"text":"Two","name":"Two","size":100,"position":[640,460]}'
pi-craft effectcraft exec --project t.ecproj render --out card.mp4 --format h264 --resolution half
pi-craft verify card.mp4 --size 640x360 --duration 2±0.1 --has-video
```

```bash recipe: script-comp
# The After-Effects-style object model: build a comp from JavaScript, save, render.
cat > build.jsx <<'JS'
var A = app;
var C = A.project.items.addComp("Scripted", 640, 360, 1, 2, 25);
C.layers.addText("Hi");
writeLn(C.name + " " + C.layers.length);
JS
pi-craft effectcraft exec --empty --save-as s.ecproj script build.jsx
pi-craft effectcraft exec --project s.ecproj render-frame --time 0 --out frame.png
pi-craft verify frame.png --size 640x360
```
