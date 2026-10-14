---
name: cadcraft
description: Headless 2D CAD with CADCraft (DXF/DWG drawings, 617 AutoCAD-style commands, layers, text, dimensions, hatches, export to PDF/PNG/SVG, DXF<->DWG conversion), provisioned on demand by pi-craft. Use for "draw a rectangle and a circle and export a pdf", "convert this dxf to a pdf", "add a layer and a text label to this drawing", "turn this dwg into a dxf", "render the drawing as a png", "how many entities are in this dxf".
---

# CADCraft — headless 2D CAD

CADCraft is ArtCraft's 2D CAD app (617 commands in 0.7.0, AutoCAD-style ids and aliases). `pi-craft` provisions the headless
`cadcraft-cli` on first use (no desktop app). App choice, the loop, hand-off formats and the MCP policy live in `craft-studio`;
technical drawings go to CADCraft, illustrations to VectorCraft.

## What it is for / formats

Create and edit drawings (lines, polylines, circles, arcs, text, dimensions, hatches, blocks, layers, layouts), inspect them,
export. Open/write `dxf` and `dwg`; export `pdf png svg` (also `dxf dwg`). The native project file is the `.dxf` (or `.dwg`).
**PDF cannot be opened** (`unsupported file type pdf`) — it is an output only.

## CLI dialect

`pi-craft cadcraft exec <args…>` passes the arguments to `cadcraft-cli`.

```bash
cadcraft-cli commands [FILTER]                  # JSON array (default!) of ids with aliases, params, label; FILTER is positional; --json is an ERROR
cadcraft-cli run [FILE | --sample | --metric] [--cmd 'id {json}']... [--script TEXT] [--script-file F.scr] [--save OUT.dxf] [--export OUT.(png|svg|pdf)] [FRAMING]
cadcraft-cli convert IN.dxf OUT.(dxf|dwg|svg|png|pdf) [FRAMING]
cadcraft-cli info FILE.dxf                      # JSON: counts per entity type, layers, extents, view, blocks
cadcraft-cli sample (bracket|floorplan) OUT.(dxf|dwg|svg|png)
cadcraft-cli perf [N | FILE]                    # benchmark
```

- There is **no `describe`**: the `params` string of `commands <id>` is the schema.
- `--cmd` is **`'id {json}'` — a space, not `=`** (unlike GridCraft/WordCraft). `'id'` alone takes no params. Params are
  point arrays `[x,y]`, e.g. `'circle {"center":[50,30],"radius":15}'`. Ids and aliases both work (`rectang` / `rec`).
- `--script TEXT` / `--script-file F.scr` replay *typed command-line input* (`LINE`, point lines, empty line to end), as in
  a CAD prompt — the `--cmd` JSON route is more reliable for agents.
- Framing for png/svg/pdf: `--view extents|current`, `--window x0,y0,x1,y1` (drawing units). Default: fit extents, or the
  current view if the commands changed it. With no FILE, `run` starts a blank drawing (`--metric` = metric template).
- png export is fixed **2400×1600**; pdf is **A4 landscape, 1 page** (`--window` changes the crop, not the page).

## State between invocations

None. `run` builds the drawing in memory; it is written only by `--save OUT.dxf` (or `.dwg`), a `qsave`/`saveas {"path":…}`
command, or `--export`. `run FILE.dxf` opens it but does **not** write back — `--save FILE.dxf` to overwrite (a `qsave`
command also overwrites the opened file). Chain steps through files.

## Discovery first

```bash
pi-craft cadcraft exec commands rectang | jq '.[] | {id,aliases,params}'   # substring filter over id/alias/label
pi-craft cadcraft exec commands layer | jq -r '.[].id'                     # layer family
pi-craft cadcraft exec info drawing.dxf                                    # what is already in a file
pi-craft cadcraft exec run drawing.dxf --cmd entities                      # entity list with geometry, handle, layer
```

Id families: draw (`line pline circle arc rectang polygon ellipse spline text mtext hatch`), modify (`move copy rotate scale
mirror offset trim extend fillet erase`), `layer.*`, `dimstyle.*`/`dim*`, `block`/`insert`, `layout.*`, `zoom.*`/`view.*`,
`export plot exportpdf`, `save qsave saveas`.

## Traps

- `commands --json` → "unknown option --json" (JSON is already the default); `commands` with no filter prints all 617.
- **`--cmd 'id={json}'` → "unknown command"** (GridCraft's spelling). Use a space.
- A failing/unknown `--cmd` aborts with exit 1 and writes nothing (`unknown command \`nosuch\`` leaves no `--save` file).
- `move` needs its params (`from` is required: "invalid parameters for `move`", exit 1); `erase` with nothing selected
  returns `{"erased":0}` with exit **0** — check `info` counts, don't trust exit codes for edits.
- Draw commands answer `{"handle":"100"}` (or `{"handles":[…]}`); handles identify entities for later edits.
- `layer.new {…,"current":true}` makes the layer current: entities drawn afterwards land on it. Layer `color` takes names (`red`).
- **PDF/SVG text is outlined**: `--text-contains` on a CADCraft PDF finds nothing, and the svg has no `<text>`. Verify the pdf
  with `--pages` and the png with `--size`; check text in the DXF via `run F --cmd entities`.
- `pi-craft verify --frame-diff` reported 0.000% between clearly different png renders (layer off, window crop) — do not
  use it for CAD stills.
- `convert` from a `.pdf` is an error; `--window` is in drawing units, not pixels.

## MCP route (opt-in)

`pi-craft cadcraft mcp --register` writes a `craft-cadcraft` entry into `.pi/mcp.json` (12 tools). It is **not** confined
(no root flags): it can read/write any path the process can — review before registering. Use it for one long open drawing;
bash for everything here. GUI bridging (`--connect`) is out of scope.

## Recipes

```bash recipe: rect-circle-pdf-png
# Metric drawing: a 100x60 rectangle, a circle in its middle; save dxf and export pdf + png in one run.
pi-craft cadcraft exec run --metric \
  --cmd 'rectang {"p1":[0,0],"p2":[100,60]}' \
  --cmd 'circle {"center":[50,30],"radius":15}' \
  --save plate.dxf --export plate.pdf
pi-craft cadcraft exec convert plate.dxf plate.png
pi-craft cadcraft exec info plate.dxf | grep -q '"Circle": 1'
pi-craft verify plate.png --size 2400x1600
```

```bash recipe: dxf-conversions
# Sample part -> pdf (delivery), svg, dwg; dwg -> dxf round trip keeps the entities.
pi-craft cadcraft exec sample bracket bracket.dxf
pi-craft cadcraft exec convert bracket.dxf bracket.pdf
pi-craft cadcraft exec convert bracket.dxf bracket.svg
pi-craft cadcraft exec convert bracket.dxf bracket.dwg
pi-craft cadcraft exec convert bracket.dwg again.dxf
pi-craft cadcraft exec info again.dxf | grep -q '"Dimension": 6'
pi-craft verify bracket.pdf --pages 1
```

```bash recipe: layers-and-text
# Two layers, text on the current one, framing with --window, explicit save; check layers/text in the DXF itself.
pi-craft cadcraft exec run --metric \
  --cmd 'layer.new {"name":"WALLS","color":"red","current":true}' \
  --cmd 'rectang {"p1":[0,0],"p2":[100,60]}' \
  --cmd 'layer.new {"name":"NOTES","color":"blue","current":true}' \
  --cmd 'text {"at":[5,65],"text":"Plate A","height":5}' \
  --save notes.dxf
pi-craft cadcraft exec info notes.dxf | grep -q '"name": "NOTES"'
pi-craft cadcraft exec run notes.dxf --cmd entities | grep -q '"value":"Plate A"'
pi-craft cadcraft exec run notes.dxf --export detail.png --window 0,0,50,30
pi-craft verify detail.png --size 2400x1600
```

```bash recipe: typed-script
# Replay typed CAD input (LINE, points, empty line ends the command), then edit the saved file and re-save under a new name.
printf 'LINE\n0,0\n10,10\n\nCIRCLE\n5,5\n3\n' > draw.scr
pi-craft cadcraft exec run --metric --script-file draw.scr --save drawn.dxf
pi-craft cadcraft exec run drawn.dxf --cmd 'circle {"center":[20,20],"radius":2}' --save more.dxf --export more.pdf
pi-craft cadcraft exec info more.dxf | grep -q '"Circle": 2'
pi-craft verify more.pdf --pages 1
```
