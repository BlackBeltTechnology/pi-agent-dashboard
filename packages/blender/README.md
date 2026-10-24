# @blackbelt-technology/pi-dashboard-blender

Headless **Blender for pi agents, with no native install**. It runs the published Blender WebAssembly
build (`@knervous/blender-web`) inside Node, downloads one integrity-pinned runtime on first use, and
exposes it as a sandboxed stdio **MCP server** (`blender-wasm`) that reads and writes files only inside
a project root. Ships the `pi-blender` CLI and a `blender` skill (3D modelling with `bpy`, GLB export).

## Install

```bash
pi install npm:@blackbelt-technology/pi-dashboard-blender   # the skill
npm install -g @blackbelt-technology/pi-dashboard-blender   # the pi-blender CLI on PATH (optional)
pi-blender ensure                                           # download + verify the runtime now
```

Nothing is downloaded at install time. `pi-blender ensure` (or the first tool call) fetches the runtime.

## CLI

| Command | What it does | Exit |
|---------|--------------|------|
| `pi-blender ensure [--json]` | Probe JSPI, then download, verify and cache the pinned runtime; print a report (`version`, `source`, `dir`, `bytes`, `licence`, `jspi`). | `0`; `69` if JSPI is unavailable or provisioning fails |
| `pi-blender status [--json]` | Show the pinned version, whether it is cached, cached versions, licence and JSPI support. **Never downloads.** | `0` |
| `pi-blender mcp [--root <dir>]` | Run the `blender-wasm` stdio MCP server. `--root` defaults to the current directory. | `1` on a bad root |
| `pi-blender mcp --register [--root <dir>]` | Add a `blender-wasm` entry to `<cwd>/.pi/mcp.json` (opt-in). | `0`; `1` on an unsafe target |
| `pi-blender --help` | Usage on stderr. | `0` |

No arguments or an unknown command prints usage and exits `1`.

## MCP server

Register it for a project, from the project root:

```bash
pi-blender mcp --register                  # confine to the project directory
pi-blender mcp --register --root assets    # confine to ./assets (stored as an absolute real path)
```

This writes `.pi/mcp.json` (merging into an existing `blender-wasm` entry: `command`/`args` are replaced,
`enabled`, `env` and every other key are kept; other servers are untouched; a malformed file or a symlinked
`.pi/` / `mcp.json` is refused and left as it was). The entry holds absolute paths, so it is
machine-specific — do not commit it for a team. pi loads project MCP servers only after the project is
trusted and only when started in the project root. Nothing registers implicitly: `ensure`, `status` and
`mcp` never touch `.pi/mcp.json`.

Tools: `blender_scene`, `blender_python`, `blender_import`, `blender_export`, `blender_reset`. Details,
build limits and the GLB-first workflow are in the `blender` skill.

## Environment variables

| Variable | Effect |
|----------|--------|
| `BLENDER_WASM_HOME` | Runtime cache root. Default: `~/.pi/agent/tools/blender-wasm` (under `$PI_CODING_AGENT_DIR` when set). The runtime lands in `<root>/<version>/`. |
| `BLENDER_WASM_DIR` | Use this already-extracted runtime directory instead of downloading (checked for the required files). |
| `BLENDER_WASM_IDLE_SEC` | Seconds of inactivity after which the Blender session is ended (default `600`). The next call starts a fresh scene (`sessionReset: true`). |
| `BLENDER_WASM_MAX_INPUT_MB` | Lowers the input staging cap (default and maximum 256 MiB). Can only lower it. |
| `BLENDER_WASM_MAX_OUTPUT_MB` | Lowers the output cap (default and maximum 512 MiB). Can only lower it. |
| `BLENDER_WASM_E2E` | `1` enables the real-runtime test suites (they boot the real runtime; for development and CI). |

## Requirements and costs

- **Node 24 or newer** (WebAssembly JSPI). On Node 22 `pi-blender ensure` exits `69` and says so; nothing is downloaded.
- **About 1.2 GB of memory per live Blender session.** Use one server per project.
- **About 175 MB of disk per cached runtime version** (a ~66 MB download). Old versions are never removed
  automatically: delete `<cache root>/<old version>/` yourself (`pi-blender status` prints the root and sizes).
- The **first call is slow** (download + verify + boot). Run `pi-blender ensure` ahead of time.
- Build limits: single-threaded Blender 5.3 alpha, EEVEE only — no rendering; no Subsurf/OpenSubdiv, Draco
  or meshopt; no USD, Alembic or X3D; no network or subprocess access from Python.

## Trust and licence

- The runtime is the upstream npm package **`@knervous/blender-web`**, a v0.0.x release maintained by a
  single maintainer. This package pins **one exact version** and its **sha512 integrity**; the download is
  verified against it, extracted through an allowlist, and never trusted otherwise. No registry metadata is
  consulted at run time, and a newer upstream version is never picked up silently.
- The runtime is **GPL-3.0-or-later**. It is **fetched on demand into your cache and never bundled** in this
  package, which is MIT-licensed. `pi-blender status` and `ensure` report the licence of the cached runtime.
- The Blender session has no network and cannot start processes; file access is confined to the root you
  register.
