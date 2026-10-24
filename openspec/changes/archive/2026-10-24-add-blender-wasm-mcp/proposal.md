# Proposal

## Why

Agents in pi sessions cannot create or edit 3D assets: Blender ships only as a large native desktop binary, and the existing Blender MCP servers drive a running GUI Blender with unguarded Python access to the host. A 2026-10-24 spike showed that the published WebAssembly build of Blender (`@knervous/blender-web`, Blender 5.3.0 Alpha, single-threaded JSPI flavour) runs headless inside plain Node 24. It booted in ~1.5 s, served `bpy` requests in ~70 ms and exported real GLB files. Python inside it reached only an in-memory filesystem, with no host files and no subprocesses. That makes a no-native-binary, sandboxed Blender tool possible now.

## What Changes

- New package `@blackbelt-technology/pi-dashboard-blender` (`packages/blender`) with a `pi-blender` bin and a `blender` skill. It is a pi package (skills + bin), not a dashboard plugin.
- **Lazy runtime provisioning.** The first use downloads one pinned `@knervous/blender-web` npm tarball and verifies it against an integrity hash pinned in our source. Verification fails closed. Only the files needed for the single-threaded flavour are extracted and expanded into a per-version cache under the pi tools directory, beside the craft-apps cache. Nothing GPL ships inside our package. A directory override serves offline and air-gapped installs.
- **Stdio MCP server** (`pi-blender mcp`). It hosts one persistent headless Blender session per server process, behind a small tool set: run Python, scene info, import, export, reset.
  - File I/O is confined to a project root.
  - Tool calls run one at a time with a per-call timeout.
  - A crashed or timed-out session reboots on the next call and reports that the scene was lost.
  - The session shuts down when idle, to release its ~1.2 GB of memory.
  - The server opens no network listener.
- **Runtime gate.** Before downloading anything, the server checks whether the host Node exposes WebAssembly JSPI, natively or behind `--experimental-wasm-jspi` (Node 24). It passes that flag only to the Blender child process. Where JSPI is unavailable (Node 22), the server keeps answering and every Blender tool call fails with an actionable "Node 24 or newer" error; `pi-blender ensure` exits non-zero. Neither downloads anything.
- **Lazy, opt-in registration.** `pi-blender mcp --register` writes one `blender-wasm` entry to `<cwd>/.pi/mcp.json`. No command registers anything as a side effect.
- `pi-blender ensure` and `pi-blender status` print provisioning reports as JSON or text.
- The recommended-extensions manifest gains an optional entry for the package.
- **Out of scope** (follow-ups): a native-Blender fallback (OpenSubdiv, GPU rendering, Cycles), rendering of any kind, a GLB viewer in the dashboard, and the Blender UI in the editor pane. The spike showed the UI cannot get WebGPU inside the opaque-origin craft-web sandbox.

## Capabilities

### New Capabilities

- `blender-runtime-provisioning`: on-demand, integrity-pinned download, safe extraction, per-version caching and reporting of the Blender WebAssembly runtime, plus the offline directory override.
- `blender-mcp-server`: the stdio MCP server, covering the tool surface, workspace confinement, session lifecycle (lazy boot, serial calls, timeout, crash recovery, idle shutdown), the JSPI runtime gate, and the no-network-listener guarantee.
- `blender-cli-entrypoint`: the `pi-blender` command (dispatch, exit codes, `ensure`/`status`/`mcp`/`mcp --register`), startability from a plain shell, the agent skill, and the recommended-extensions manifest entry.

### Modified Capabilities

None. The recommended-extensions entry is specified inside `blender-cli-entrypoint`, the same way `craft-cli-entrypoint` specifies its own entry.

## Impact

- **New code:** `packages/blender/` (bin launcher, provisioning, MCP server, worker-thread host for the browser runtime, skill, tests).
- **Registration:**
  - `.github/workflows/publish.yml` PACKAGES
  - root `vitest.config.ts` projects
  - `knip.json` workspaces
  - `packages/shared/src/recommended-extensions.ts` (+ its test)
- **External dependency:** the `@knervous/blender-web` npm tarball (`GPL-3.0-or-later` per npm metadata and its README, with Blender sources under GPL-2.0-or-later; v0.0.x, single maintainer). It is fetched at runtime, never bundled, and pinned by version and integrity hash.
- **Runtime requirements:** Node ≥ 24 with JSPI (the repo's `engines` range also allows Node 22, where this feature reports itself unavailable). About 1.2 GB RSS per live session. About 175 MB of disk per cached runtime version.
- **Security:**
  - Agent-supplied Python runs inside WebAssembly with an in-memory filesystem.
  - Host file access is mediated only by the server's confined import/export paths.
  - The server never opens a network port.
- No server, client or extension code changes: one data row in the shared recommended-extensions manifest those consumers already read, plus one Node 24 CI job matrix (Linux, macOS, Windows) for the runtime suites. No migration. Rollback is removing the package and the `blender-wasm` entry from `.pi/mcp.json`.

## Discipline Skills

- `security-hardening`: untrusted agent Python and agent-supplied file paths (confinement, symlink escape), plus an untrusted downloaded runtime (integrity pin, archive extraction).
- `performance-optimization`: about 1.2 GB per session and boot latency; idle shutdown and timeout budgets.
- `observability-instrumentation`: a new long-lived process with external download and crash/reboot paths (stderr diagnostics, provisioning report).
- `doubt-driven-review`: the runtime-gate and integrity-pin decisions before they stand.
- `review-code`: before commit.
