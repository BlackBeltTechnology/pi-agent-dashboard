---
name: blender
description: Headless Blender (bpy) for 3D modelling and GLB export, with no native Blender install - build or edit a scene in Python, import OBJ/FBX/STL/PLY/glTF/.blend, export .glb and other formats, all through the blender-wasm MCP server and the pi-blender CLI. Use for "model a 3D object", "make a .glb of this", "convert this OBJ/FBX to glTF", "inspect this 3D model".
---

# Headless Blender — 3D modelling and GLB export

`pi-blender` runs the published Blender WebAssembly build inside Node: no native Blender, no GUI, no GPU.
The runtime (~175 MB) is downloaded once, verified against a pinned hash, and cached. It is a **stdio MCP
server** (`blender-wasm`) with one persistent Blender session per server.

## When to use it

- Build or edit 3D geometry with Python (`bpy`): primitives, modifiers, materials, hierarchies.
- Convert or inspect 3D files: `.glb` `.gltf` `.fbx` `.obj` `.stl` `.ply` `.svg` `.blend`.
- Produce a **`.glb`** for a web viewer, game engine or AR.

Not for rendering images (no rendering here) or for anything needing a GUI.

## Setup (once per machine, once per project)

```bash
pi-blender ensure              # download + verify the runtime NOW; otherwise the first tool call is slow
pi-blender status              # what is cached, JSPI support (never downloads)
pi-blender mcp --register      # in the project root: writes .pi/mcp.json -> "blender-wasm"
pi-blender mcp --register --root assets   # confine file access to ./assets instead of the project
```

Registration is opt-in and project-local; pi loads project MCP servers only after the project is trusted,
and only when started in the project root. `ensure` needs **Node 24 or newer** (WebAssembly JSPI); on
older Node it exits 69 saying so — do not retry, tell the user to use Node 24+.

## Tools

| Tool | Use |
|------|-----|
| `blender_scene` | List objects (name, type, parent, transform, dimensions, materials, mesh counts). `limit` default 200. **Start here** to see what exists. |
| `blender_python` | Run `bpy` Python. `inputs` stages root-relative files at `/in/<same path>`; anything written under `/out/` is saved to `outputDir` (default `blender-out`). `print()` output is returned. |
| `blender_import` | Import one file by extension. A `.blend` **replaces the whole scene**. |
| `blender_export` | Export the scene by extension of the target path. `selectedOnly` exports the selection (not for `.blend`). |
| `blender_reset` | `mode: "factory"` (default cube/light/camera scene) or `"empty"`. |

All paths are relative to the confined root; a path outside it fails with `path-outside-root`.

## Build limits (do not plan around these)

- Single-threaded **Blender 5.3 alpha** under WebAssembly, EEVEE only: **no rendering**.
- **No Subsurf / OpenSubdiv**, no Draco or meshopt compression.
- **No USD, Alembic or X3D** import/export.
- **No network and no subprocess** from Python (`fetch`, sockets and process spawning are unavailable).
- About **1.2 GB of memory per live session**. Keep one server per project; sessions end after idle time
  (`BLENDER_WASM_IDLE_SEC`, default 600).
- Subdivide with explicit geometry (`bmesh`, loop cuts, array/bevel modifiers) instead of Subsurf.

## `sessionReset: true` means the scene was lost

Every tool result is JSON starting with `{"sessionReset": …}`. It is `true` on the **first result after a live
session was lost** (timeout, crash, out-of-memory, idle expiry): **the scene is gone** and everything not
exported with `blender_export` is gone. A `timeout` or `session-crashed` error means the same thing even
though its own flag is still `false`. Say so, run `blender_scene` to see the fresh state, and rebuild from a
script — never assume objects still exist. After a `timeout` or `session-crashed`, shrink the work (fewer
vertices, smaller modifiers) rather than repeating it. Export a `.blend` between big steps.

## GLB-first workflow

1. `blender_reset` with `mode: "empty"` (a factory scene brings a cube, light and camera into the export).
2. Build with one `blender_python` script that is **idempotent** (clear/rebuild by name) so it can be re-run.
3. `blender_scene` to check object count, dimensions and materials.
4. `blender_export` to `models/thing.glb`. Prefer `.glb` — one self-contained file. Verify the file is on disk.
5. Only then offer other formats (`.fbx`, `.obj` + `.mtl`, `.stl`, `.ply`, `.blend`).

## Multi-file assets and `.gltf`

`blender_import` takes ONE file. For anything that references siblings (OBJ + MTL + textures, glTF with
`.bin`/images, FBX with textures) use `blender_python` with `inputs` listing **every** file:

```python
# inputs: ["assets/chair.obj", "assets/chair.mtl", "assets/wood.png"]
import bpy
bpy.ops.wm.obj_import(filepath="/in/assets/chair.obj")
```

A `.gltf` exported by `blender_export` is `.gltf` + `.bin`; re-import it the same way
(`inputs: ["m/a.gltf", "m/a.bin"]`, `bpy.ops.import_scene.gltf(filepath="/in/m/a.gltf")`).
`blender_import` of a `.gltf` only works when everything is embedded as `data:` URIs.

## Headless `bpy` idioms

- Files: read from `/in/...`, write to `/out/...` (the only places visible to the session). Subdirectories
  under `/out` are kept.
- Link every new object yourself: `bpy.context.collection.objects.link(obj)`. Prefer the data API
  (`bpy.data.meshes.new`, `bmesh`) over `bpy.ops.mesh.primitive_*` when a context is awkward.
- Avoid operators that need a window, area or region (viewport, UI, `view3d`, `screen`, `*_modal`); they
  fail headless. Select with `obj.select_set(True)` and `bpy.context.view_layer.objects.active = obj`
  instead of UI calls, and check an operator's return value (`{'FINISHED'}`).
- Name things (`obj.name`, `mat.name`) so `blender_scene` output is readable and scripts can find them.
- Apply scale before export (`bpy.ops.object.transform_apply(scale=True)` with the object active).
- `print()` what you need to see; output beyond ~16 KiB is truncated (`outputTruncated: true`).
- Python errors come back as `python-error` with a traceback tail: fix and re-run, the session is still alive
  (`sessionReset: false`).

## Errors

`invalid-arguments`, `jspi-unavailable` (Node < 24), `provision-failed` (run `pi-blender ensure` and read
its message), `boot-failed`, `path-outside-root`, `input-not-found`, `unsupported-format`, `limit-exceeded`
(input/output size caps: `BLENDER_WASM_MAX_INPUT_MB` / `BLENDER_WASM_MAX_OUTPUT_MB` can only lower them),
`python-error`, `import-failed`, `export-failed`, `timeout`, `session-crashed`.
