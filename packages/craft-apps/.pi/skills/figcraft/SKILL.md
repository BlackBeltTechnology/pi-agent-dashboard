---
name: figcraft
description: Headless UI and interface design with FigCraft (Figma-style frames, shapes, text, auto layout, components), provisioned on demand by pi-craft - build screens from a JSON-lines script, then export frames and single layers as png, jpg, svg or pdf at 1x/2x/3x, or import an SVG and render it. Use for "design a mobile login screen and export it as png", "export this button at 2x", "make an iPhone 16 frame with a blue button", "export the frames of this design as a pdf", "turn this svg into an editable design".
---

# FigCraft — headless UI design

FigCraft is ArtCraft's interface-design app (pages, frames, auto layout, components, variables, prototyping; 1 100+
commands). `pi-craft` provisions the headless `figcraft-cli` on first use (no desktop app). App choice, the
discover → execute → save → verify loop and the MCP policy live in `craft-studio`.

## What it is for / formats

Screens and design systems. Native file: `.figcraft` (JSON). Opens `.figcraft .json` (FigCraft or REST API file JSON)
`.fig` (best effort; `info` lists what was not imported) `.svg` and rasters (`.png .jpg .webp .gif .bmp` → an image
layer). Exports `png jpg webp svg pdf` and `.fig` (experimental). For free-form vector illustration use
VectorCraft; for page layout/print DesignCraft.

## CLI dialect

`pi-craft figcraft exec <args…>` passes the arguments to `figcraft-cli`. There is no
`--help` (use `help`); `--no-system-fonts` on any subcommand makes text render identically on every machine.

```bash
figcraft-cli commands [--json] [--filter TEXT]        # text listing ("id*  label" + params line) or JSON; no describe command
figcraft-cli run SCRIPT [--in FILE] [--out FILE]      # SCRIPT = .jsonl (one step per line) or .json (array) of {"command": id, "params": {…}}
figcraft-cli info FILE [--json]                       # pages, frames with ids, node count
figcraft-cli export FILE -o OUT [--format png|jpg|svg|webp|pdf|fig] [--scale N] [--page NAME] [--node ID|NAME]
figcraft-cli render FILE -o OUT.png [--scale N] [--page NAME]
figcraft-cli convert IN OUT                           # e.g. svg -> .figcraft, .figcraft -> .fig
```

- **Scripts are files**, not `--cmd` flags: write the JSON lines to a file and `run` it. The result of each step is
  a JSON line (`{"ok":true,"result":{"id":2},"step":0}`) — **ids are small integers assigned in creation order**
  (the first frame is `2`), so later steps reference earlier ones with `"parent": 2`.
- `export -o OUT`: when OUT has an image extension (or `--node` is given) one file is written; otherwise OUT is a
  **directory** that gets one file per top-level frame named after the frame (`--format` picks the type). A PDF of a
  file has one page per top-level frame.
- `--node` takes an id or a layer **name** (`--node Button`); `--scale 2` doubles pixel size (a 393×852 frame →
  786×1704). `render` is the same as a png `export` without `--node`.
- In-script export: `file.export {ids, format, size: "2x" | scale, path}` writes during the run (relative to cwd).

## State between invocations

`run` with no `--in` starts an empty document (one empty "Page 1"); **without `--out` the result is discarded**
(only the printed step results remain). Persist with `--out ui.figcraft` and continue with `--in ui.figcraft
--out ui.figcraft` (or a new name). `info`, `export`, `render` only read.

## Discovery first

```bash
pi-craft figcraft exec commands --filter shape.            # ids ("*" marks commands that edit the document) with their parameter shape
pi-craft figcraft exec commands --json --filter node.set   # same as JSON
pi-craft figcraft exec info ui.figcraft                    # frame names and ids → use as --node / "parent"
pi-craft figcraft exec run /dev/stdin <<< '{"command":"frame.presets","params":{}}'   # device sizes for frame.create {"preset":"iPhone 16"}
```

Main namespaces: `frame` (`create` with `preset`), `shape` (`rectangle ellipse polygon star line arrow`), `text`
(`create` and styling), `node` (`create`, `set` — every property: `fill fills stroke strokeWeight cornerRadius opacity
layout gap padding fontSize textAlign …`), `select`, `file` (`new open save export exportFramesPdf import`), `image`
(`place`), `vector`, `edit`.

## Traps

- **Nothing is nested unless you say `"parent": <frame id>`**: without it a rectangle lands on the page next to the
  frame (verified: `info` showed 2 top-level nodes instead of 1). Coordinates `x`/`y` are relative to the parent frame.
- Style a layer at creation with `"props": {"fill":"#2563eb","cornerRadius":12,"name":"Button"}` (the same keys as
  `node.set`), or `select.set {"ids":[3]}` then `node.set {"fill":…}`; `node.set` also takes `"ids":[4]`.
  Text colour is `props.fill` too, font via `fontSize`/`fontFamily`.
- **Export of one layer only contains that layer**: `--node Button` is the button alone (1035×168 at `--scale 3`),
  not the button on its screen; export the frame for the full picture.
- A failing step stops the run (exit 1, `"ok":false` line) and **nothing is written** — `--out` file is not created.
- Unknown `--page`/`--node` exit 1 with the available names (`no page named …`); layer names must match exactly.
- `export` with a directory OUT writes `<dir>/<FrameName>.<format>`; reuse of a name overwrites.
- Fonts: text uses the system font index unless `--no-system-fonts`; sizes of text boxes can differ between machines
  without it.

## MCP route (opt-in)

`pi-craft figcraft mcp --register` writes a `craft-figcraft` entry into `.pi/mcp.json` (18 tools). The server is
**not path-confined** (it reads/writes anywhere the user can), so `mcp` refuses without `--allow-unconfined` —
tell the user first. Prefer bash `run`/`export` for the recipes below; the plugin and live-attach (`mcp --attach
PORT`) routes need a running app and are out of scope.

## Recipes

```bash recipe: screen-export
# A phone-sized frame with a button and a label; export the frame at 2x and the button at 3x.
cat > ui.jsonl <<'JSON'
{"command":"frame.create","params":{"preset":"iPhone 16","name":"Home"}}
{"command":"shape.rectangle","params":{"x":24,"y":60,"width":345,"height":56,"parent":2,"props":{"name":"Button","fill":"#2563eb","cornerRadius":12}}}
{"command":"text.create","params":{"text":"Sign in","x":40,"y":75,"parent":2,"props":{"fontSize":24,"fill":"#ffffff"}}}
JSON
pi-craft figcraft exec run ui.jsonl --out ui.figcraft
pi-craft figcraft exec export ui.figcraft -o home@2x.png --node Home --scale 2
pi-craft figcraft exec export ui.figcraft -o button.png --node Button --scale 3
pi-craft verify button.png --size 1035x168
pi-craft verify home@2x.png --size 786x1704
```

```bash recipe: restyle-pdf
# Continue a saved design: recolour the rectangle by id, then export every frame as one pdf page.
cat > a.jsonl <<'JSON'
{"command":"frame.create","params":{"x":0,"y":0,"width":400,"height":300,"name":"Card"}}
{"command":"shape.rectangle","params":{"x":20,"y":20,"width":200,"height":100,"parent":2}}
{"command":"text.create","params":{"text":"Hello","x":30,"y":150,"parent":2,"props":{"fontSize":32}}}
JSON
cat > b.jsonl <<'JSON'
{"command":"select.set","params":{"ids":[3]}}
{"command":"node.set","params":{"fill":"#ff0000","cornerRadius":12}}
JSON
pi-craft figcraft exec run a.jsonl --out d1.figcraft
pi-craft figcraft exec run b.jsonl --in d1.figcraft --out d2.figcraft
pi-craft figcraft exec export d2.figcraft -o card.svg
grep -q 'fill="#FF0000"' card.svg
pi-craft figcraft exec export d2.figcraft -o card.pdf
pi-craft verify card.pdf --pages 1 --text-contains "Hello"
```

```bash recipe: svg-import
# Import an SVG as an editable frame, save as .figcraft, render it back to png at 2x.
printf '%s\n' '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="#336699"/></svg>' > in.svg
pi-craft figcraft exec convert in.svg in.figcraft
pi-craft figcraft exec info in.figcraft
pi-craft figcraft exec render in.figcraft -o in2x.png --scale 2
pi-craft verify in2x.png --size 200x120
```

```bash recipe: in-script-export
# Export during the run with file.export (size "2x"), several frames -> one directory.
cat > two.jsonl <<'JSON'
{"command":"frame.create","params":{"x":0,"y":0,"width":300,"height":200,"name":"One"}}
{"command":"frame.create","params":{"x":400,"y":0,"width":300,"height":200,"name":"Two"}}
{"command":"file.export","params":{"ids":[2],"format":"png","size":"2x","path":"one2x.png"}}
JSON
pi-craft figcraft exec run two.jsonl --out two.figcraft
pi-craft figcraft exec export two.figcraft -o frames --format png
ls frames/One.png frames/Two.png
pi-craft verify one2x.png --size 600x400
```
