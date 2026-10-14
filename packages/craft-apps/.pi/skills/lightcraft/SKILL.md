---
name: lightcraft
description: Headless photo/RAW development with LightCraft (Lightroom-style develop controls, presets, export), provisioned on demand by pi-craft - exposure, white balance, colour grading, tone, B&W, denoise, sharpen, HDR/panorama merge, export to jpg/png/tif/webp. Use for "develop this RAW", "brighten this photo and export a jpg", "apply a black and white preset", "export this photo at 2000 px on the long edge", "make an HDR from these brackets".
---

# LightCraft — headless photo development

LightCraft is ArtCraft's RAW developer: non-destructive develop sliders plus an export encoder. `pi-craft`
provisions the headless `lightcraft-cli` on first use (no desktop app). Choosing between apps, the
discover → execute → save → verify loop and the MCP policy live in `craft-studio`.

## What it is for / formats

Develops **one photo → one exported file**. Reads camera RAW (DNG, ARW, NEF, RAF…) and also plain `png jpg tif`
(verified with `png` and with DNGs from `synth-merge`; no real camera RAW was available here — use ffmpeg-made
images or `synth-merge` to try things). Exports `jpg png tif webp avif jxl psd dng`
(chosen by the `-o` extension). Edits live in a LightCraft *library*, not in a project file. Pixel editing
(layers, masks, compositing) is PhotoCraft; vector art is VectorCraft.

## CLI dialect

`pi-craft lightcraft exec <args…>` passes the arguments to `lightcraft-cli` verbatim.
There is **no `describe`** and no `--cmd` flag — the dialect has two routes:

```bash
lightcraft-cli render <IN> -o <OUT> [--set CONTROL=VALUE]… [--settings F.json] [--preset ID] [--size N] [--quality Q] [--opt KEY=VALUE]…
lightcraft-cli run [--import PATH]… | [--demo] | [--library DIR]  <command> [key=value | '{json}']… [<command> …]…
lightcraft-cli commands [--json]      # every command id + params (626 lines)
lightcraft-cli controls [--json]      # every develop slider id + range/default (122)
lightcraft-cli merge hdr|panorama|hdr-panorama [--preview OUT.png] FILES…   # writes <first>-HDR.dng next to the inputs
lightcraft-cli synth-merge hdr|panorama -o DIR                               # synthetic DNG brackets / overlapping PNGs
```

- **`render` is the one-shot route**: develop one file, export it. `--set` is repeatable; `--size N` is the
  long edge (default full size); `--quality` 1–100 (default 92) for jpg/avif/jxl; `--opt` passes any `app.export`
  option (`--opt colorSpace=displayP3`, `--opt bitDepth=16`, `--opt shortEdge=1080`).
- **`run` is the command route**: a word without `=` starts the next command; `key=value` are its parameters
  (JSON when parsable). It prints one JSON line per command and exits non-zero on failure. Chain
  `develop.set control=<id> value=<n>`, `develop.auto`, then `app.export path=<abs> longEdge=<n>`.
- Presets are applied with `--preset ID` (ids from `run --demo presets.list`, e.g. `lc.bw-high-contrast`,
  `lc.warm-glow`, `lc.teal-orange`) or the `preset.apply` command. `--settings F.json` merges a partial settings
  object whose shape is `develop.get` output (`{"light":{"exposure":1.5}}`).

## State between invocations

`render` keeps nothing: it reads `<IN>`, writes `<OUT>`, the original is never modified. `run --import` is also
throw-away; `run --library DIR` opens or creates a persistent library and **saves edits there**. Prefer `render`
and keep the slider values in your own notes/`--settings` file so a result is reproducible.

## Discovery first

Slider ids and preset ids are data — read them, don't guess.

```bash
pi-craft lightcraft exec controls | grep -i -E "exposure|saturation|temp"   # id  label  range (default)
pi-craft lightcraft exec commands | grep -A2 "^preset.apply"                # command + params
pi-craft lightcraft exec run --demo presets.list                            # preset ids (JSON)
pi-craft lightcraft exec run --demo develop.get                             # settings object shape for --settings
```

## Traps

- **Out-of-range `--set` values are clamped silently** (`light.exposure=99` exits 0 and renders at the cap 5.0).
  Check the range in `controls`. An unknown control id or preset id exits 1 (`unknown control`, `unknown preset`).
- `--set light.exposure=0` is a no-op: the result is pixel-identical to a render without `--set`. If a
  `--frame-diff … >` check fails, the edit changed nothing.
- `-o` is required and its extension must be a known one; `render in.png out.jpg` and `-o noext` fail with
  `unexpected argument` / `unknown extension`.
- Without `--size` you get the **full-size** image (possibly cropped by the photo's own crop).
- `pi-craft verify --frame-diff` compares **luma**: a pure colour shift (saturation, hue) or a B&W conversion of an
  image with similar luminance can read as ~0 % different. Prove colour edits with exposure/contrast, or by
  checking a derived property (see the `bw-preset` recipe).
- `merge` without `--preview` writes `<first>-HDR.dng` **next to the first input** — copy inputs to a work dir
  first. `--preview OUT.png` writes only a ≤1024 px preview (nothing next to the inputs).
- `run` paths: `app.export path=` wants an **absolute** path. The README mentions `--connect`/`snapshot`/UI methods:
  those need a running desktop app or a window — out of scope here.

## MCP route (opt-in)

`pi-craft lightcraft mcp --register` writes a `craft-lightcraft` entry into `.pi/mcp.json`. The server is
**unconfined** (reads/writes any path), so it needs `--allow-unconfined`, and it exposes 330 tools: always add
`--compact` (helpers only; every command stays reachable via `run_command`). The bash route above is the
default recommendation. GUI bridging (`--connect`, `snapshot`) is out of scope.

## Recipes

```bash recipe: develop-export
# Brighten + saturate a (generated) photo (a --settings file plus --set) and export a 600 px-wide webp.
ffmpeg -v error -y -f lavfi -i testsrc=size=1200x800 -frames:v 1 in.png
printf '{"light":{"exposure":1.2}}' > bright.json
pi-craft lightcraft exec render in.png -o plain.png --size 600
pi-craft lightcraft exec render in.png -o out.webp --size 600 \
  --settings bright.json --set color.saturation=30 --quality 90
pi-craft verify out.webp --size 600x400 --frame-diff 0:plain.png\>1
```

```bash recipe: bw-preset
# A built-in preset: lc.bw-high-contrast. B&W means zero saturation, which we check with ffmpeg.
ffmpeg -v error -y -f lavfi -i testsrc=size=1200x800 -frames:v 1 in.png
pi-craft lightcraft exec render in.png -o bw.png --preset lc.bw-high-contrast --size 600
ffmpeg -i bw.png -vf signalstats,metadata=print -f null - 2>&1 | grep 'SATAVG=0$'
pi-craft verify bw.png --size 600x400
```

```bash recipe: run-export
# The command route: import, set a slider, auto-tone, export 500 px on the long edge (absolute path).
ffmpeg -v error -y -f lavfi -i testsrc=size=1200x800 -frames:v 1 in.png
pi-craft lightcraft exec run --import in.png \
  develop.set control=light.exposure value=0.7 develop.auto \
  app.export path="$PWD/r.jpg" longEdge=500
pi-craft verify r.jpg --size 500x333
```

```bash recipe: dng-develop
# A real DNG (synthetic bracket from synth-merge) developed, then an HDR merge preview of the brackets.
pi-craft lightcraft exec synth-merge hdr -o brackets
pi-craft lightcraft exec render brackets/bracket-1.dng -o dev.jpg --size 500 --set light.exposure=0.3
pi-craft lightcraft exec merge hdr brackets/bracket-0.dng brackets/bracket-1.dng brackets/bracket-2.dng --preview hdr.png
pi-craft verify dev.jpg --size 500x333
```
