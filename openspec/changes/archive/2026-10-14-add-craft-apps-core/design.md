## Context

`packages/photocraft` (change `add-photocraft-plugin`) proved the pattern for one app: on-demand checksum-verified CLI provisioning, a confined serialising MCP proxy, opt-in `.pi/mcp.json` registration, a discovery-first skill. The ArtCraft Crafting Apps family has 12 more apps with the same release layout and a similar — but not identical — CLI surface. This change generalises the PhotoCraft package into a family package and adds the skill layer the agent needs to use the apps safely.

### Spike evidence (2026-10-14, macOS arm64, artefacts in `spike/` (probe.py, matrix.json, assemble.jsonl, roundtrip-frame-3s.png))

| App | Version | Commands | MCP tools | MCP path confinement | Live-app bridge flag | Notable subcommands |
|---|---|---|---|---|---|---|
| photocraft | 0.8.2 | 892 | 25 | yes | `--bridge` | batch, convert, droplet, serve |
| vectorcraft | 0.11.0 | ≈400 | 32 | yes | `--connect` | convert, run |
| filmcraft | 0.7.2 | 700 | 17 | **no** | `--bridge` | exec, run (jsonl), import, export, render, probe |
| lightcraft | 0.8.0 | 313 | **330** | **no** | `--connect` | render, denoise-serve, merge, calibrate |
| pdfcraft | 0.8.0 | n/a (`tools`) | **163** | **no** | — | combine, split, extract, audit, render, text |
| effectcraft | 0.9.2 | 681 | 27 | yes | `--bridge` | exec, run, props/get/set, render, render-frame, script (jsx) |
| designcraft | 0.8.0 | ≈250 | 25 | **no** | `--connect` | run, script, describe, app |
| figcraft | 0.6.0 | 552 | 18 | **no** | — | convert, export, render, plugin |
| wordcraft | 0.7.0 | 617 | 16 | yes | `--connect` | convert, render, text, inspect, zotero |
| soundcraft | 0.6.1 | 469 | 17 | **no** | `--connect` | run (--cmd/--bounce), script, describe, plugins |
| deckcraft | 0.7.0 | ≈150 | 25 | **no** | `--connect` | render, render-transition, convert, describe |
| cadcraft | 0.7.0 | ≈300 | 12 | **no** | `--connect` | info, convert, run, sample |
| gridcraft | 0.7.0 | 341 | 21 | **no** | `--connect` | eval, functions, check, cat, convert |

Round-trip (all headless, exit 0): SoundCraft `run --cmd session.new --cmd file.import_audio={path} --cmd edit.select_all --cmd clip.gain={db:-6} --bounce mix.wav` (LUFS/peak returned as JSON) → EffectCraft `--empty --save-as t.ecproj run comp.new {…} layer.newText {…} layer.applyTextPreset {…}` then `--project t.ecproj render --out title.mov --format prores --prores 4444 --channels rgba` (0.9 s) → FilmCraft `--project p.fcproj --save import …`, `run assemble.jsonl` (`file.newSequence fromItem`, `source.open`, `timeline.setTargeting`, `playhead.set`, `source.overwrite`), `export final.mp4 --format h264` (1.0 s, 158 fps). Verified: 5.0 s, h264+aac, max volume −27 dB (= bounce), title alpha-composited at t=3 s, absent at t=0.2 s.

Failure observed: an unknown command id in a FilmCraft `run` script fails that line only (with `--keep-going`) — subsequent `source.overwrite` lands at the *current* playhead, producing a valid but wrong 10 s file. → discovery-first skills + `craft-verify`.

## Goals / Non-Goals

**Goals**
- One package, one CLI (`pi-craft`) and one provisioning core for all 13 apps; PhotoCraft behaviour and compatibility preserved.
- Agents can pick the right app, discover commands at runtime, run them headless, persist state between steps and verify outputs mechanically.
- MCP usable per app without flooding context or silently widening file access.

**Non-Goals**
- Cross-app workflow skills (changes `add-craft-media-workflows`, `add-craft-office-workflows`).
- ArtCraft *studio* (the AI image/video IDE) management and its hosted MCP (change `add-artcraft-studio`).
- Driving the desktop GUIs (`--bridge`/`--connect`, `ui_*` tools) — documented as out of scope in skills; the proxy rejects bridge flags.
- Dashboard UI for craft apps (addons-hub surfaces the package via the manifest only).
- One skill per command (≈6 000 commands; command ids churn between alpha releases).

## Decisions

### D1. One package with an app registry; photocraft absorbed
`packages/craft-apps/src/registry.ts` holds a typed, readonly table:

```ts
interface CraftApp {
  id: "photocraft" | "vectorcraft" | /* … 13 */;
  repo: `storytold/${string}`;
  cli: string;                       // "filmcraft-cli"
  assets: AssetPatterns;             // per host; macOS prefers <id>-cli-<v>-macos-universal.zip
  dialect: CliDialect;               // how run/commands/describe are spelled (for skills + verify hints)
  mcp: { confinement: boolean; toolClass: "small" | "large"; bridgeFlag?: "--bridge" | "--connect" };
}
```
Alternatives: 13 packages (13× registrations, publish churn) or a core lib + 13 thin packages (same churn, no user benefit — every app is a few KB of registry + one skill; binaries are provisioned on demand anyway). Rejected.

### D2. Provisioning generalised, PhotoCraft-compatible
Precedence per app: `<APP>_BIN` → `<APP>_VERSION` → latest (24 h cache) → fallback highest installed. Cache root `CRAFT_HOME` (default `<pi agent dir>/tools`), per-app dir `<root>/<app>/<version>/` — identical to today's `tools/photocraft/<version>`, so existing installs are cache hits. `PHOTOCRAFT_HOME`, when set, overrides PhotoCraft's per-app dir (back-compat). Asset choice: a CLI-only asset for the host (`<app>-cli-<v>-<host>.*`) is preferred when the release has one (macOS always; PdfCraft also on Linux), else the portable archive, binary located at the registry-known path. glibc ≥ 2.35 gate retained per app (to be re-validated per app in the cross-platform probe task).

### D3. Source selection: managed | launcher
`CRAFT_SOURCE=managed` (default) uses D2. `launcher` resolves CLIs from an ArtCraft Craft Launcher installation and never downloads; `auto` tries launcher then managed. The launcher's layout was probed (task 0.3): it installs desktop `.app`/msi/AppImage bundles that **do not contain a CLI**, so on macOS `launcher` resolves nothing and reports "desktop app only"; the mode stays for layouts that do include a CLI and for `CRAFT_LAUNCHER_HOME`. `pi-craft launcher install` downloads the launcher installer for the host from `storytold/craft-launcher` (checksum-verified; the repo publishes `SHA256SUMS.txt`) and opens it — the only path that fetches a desktop installer, and only on that explicit command.

### D4. MCP: lazy, per app, confinement policy
- Nothing registered by default; `pi-craft <app> mcp --register` writes `mcpServers["craft-<app>"]` (PhotoCraft keeps the name `photocraft` for back-compat).
- Proxy (from PhotoCraft): `tools/call` serialised, non-JSON stdout diverted, signals mapped, bridge/connect/automation-root options rejected.
- Confinement: for apps with `mcp.confinement`, `--root` (default cwd) maps to both automation roots (`--root` for PdfCraft). For the 7 apps without (probe 0.4; was 9 in the spike), `mcp` and `mcp --register` refuse unless `--allow-unconfined` is given; the registered entry carries the flag so the decision is visible in `.pi/mcp.json`, and stderr states that the server can read/write any path the user can. Rationale: inside pi the agent already has bash, so this is defence-in-depth against MCP use by other clients and prompt-injected tool calls — but it must be a conscious opt-in.
- Tool budget: registering a `large` app (LightCraft, PdfCraft) prints the tool count and suggests the bash route or `--compact` (helper tools only).

### D5. `craft-verify` is a CLI subcommand, not a skill-only convention
`pi-craft verify <file> [assertions…] [--json]` → exit `0` all pass / `1` any fail / `2` usage / `3` required probe tool missing. Media via `ffprobe`/`ffmpeg` (optional system tools), images via `ffprobe` dimensions + alpha, PDFs via `pdfcraft-cli info` (provisioned on demand). Frame diff = share of pixels whose luma differs by >40 between `file@t` and `--ref ref@t` — the spike's metric. Skills require a `verify` after every artefact-producing step.

### D6. Skills: router + 13 app skills; drift-checked
- `craft-studio` (router): app-selection table, hand-off formats (wav/aiff, mov ProRes 4444 alpha, mp4 h264, png/tiff, svg, pdf), the loop *plan → describe → execute → save project → verify*, MCP vs bash guidance, confinement policy.
- `<app>` skills: dialect (exact `run`/`exec`/`script` spelling), document/project model and persistence flags (`--project/--save/--save-as`, `.scraft`, `.ecproj`, `.fcproj`…), discovery commands, known traps (e.g. FilmCraft overwrite lands at playhead → always `playhead.set`; EffectCraft `<comp>` `-` = active), 2–4 minimal verified recipes.
- Drift check: a test extracts every command id from skill code fences and checks it against `commands`/`describe` of the pinned version (nightly with real binaries; offline unit test uses recorded fixtures).
- PhotoCraft's skill is moved verbatim, then trimmed of anything the router now owns.

### D7. Deprecation shim for the old package
Final `@blackbelt-technology/pi-dashboard-photocraft` release: depends on `craft-apps`, keeps `bin/pi-photocraft` at the same path (forwarding to craft-apps' alias) so absolute paths in existing `.pi/mcp.json` stay valid; `npm deprecate` message points to `craft-apps`. Manifest entry swaps to `craft-apps`.

## Risks / Trade-offs

- **Alpha CLIs churn command ids** → discovery-first skills, drift check, `<APP>_VERSION` pins.
- **Silent wrong outputs** (spike) → `craft-verify` mandatory in skills; workflow skills (later changes) assert per step.
- **Unconfined MCP servers** → opt-in flag, visible in config; bash route recommended.
- **Disk** (≈0.8 GB all apps on macOS) → on-demand per app; `pi-craft status` shows sizes; cache dirs user-deletable.
- **Windows/Linux untested** in the spike → gating probe tasks in a Linux container and a Windows VM before claiming support; registry marks per-host status.
- **Same-origin checksums** give integrity, not authenticity → documented; macOS Gatekeeper assessment logged (as PhotoCraft).

- **Hardening from the security audit (ship-it step 4.5 prep)**: Windows system tools spawn as `.exe` (shared `platform/exec` routes extensionless names through `cmd.exe`); `verify` resolves file/ref to absolute paths, checks the `--frame-diff` reference exists, bounds probes with timeouts and frame size; launcher release tag validated like any version; download URLs pinned to the repo's release path, size caps, post-extraction symlink check; `--register` refuses symlinked targets / non-object `mcpServers` and writes atomically. Residual: JSON-RPC batch arrays (single-line `[…]`) pass the MCP proxy untouched and are not serialised (MCP 2025-06 dropped batching; pi does not batch); same-origin checksums prove integrity only; upstream `--root` canonicalisation (symlinks) is not verified here.

## Migration Plan

1. Land `craft-apps` with PhotoCraft as a registry row; run PhotoCraft's existing test-suite against the moved code (must pass unchanged, except package paths).
2. Publish `craft-apps`; publish the photocraft shim; `npm deprecate` old versions' line.
3. Swap the recommended-extensions entry.
Rollback: un-deprecate photocraft, revert the manifest entry; caches are shared and compatible.

## Gating probe results (2026-10-14, macOS 15 arm64 host; Linux in Docker)

**0.1 Linux (Ubuntu 22.04, glibc 2.35), x86_64 under qemu + aarch64 native — all 13 apps OK.** Every portable tarball `<app>-<v>-linux-<arch>.tar.gz` unpacks to `<app>-<v>-linux-<arch>/bin/<app>-cli`; each CLI runs `--version` and `commands` (PdfCraft: `tools`). Highest glibc symbol: **2.35 for 12 apps, 2.34 for SoundCraft**; filmcraft on Ubuntu 20.04 (glibc 2.31) fails with `GLIBC_2.35 not found` — the registry gate (`glibcMin`) matches. PdfCraft's CLI-only tarball `pdfcraft-cli-<v>-linux-<arch>.tar.gz` puts the CLI at the **archive root** (`pdfcraft-cli-<v>-linux-<arch>/pdfcraft-cli`), not under `bin/` — the basename fallback in `locateBinary` finds it. Linux riscv64/freebsd were not executed (assets listed only). Answers **O2**: floors are identical (2.35) except SoundCraft (2.34).

**0.2 Windows x64 — layout only (no VM).** Range-read of the 13 `…-windows-x64-portable.zip` central directories: each unpacks to `<app>-<v>-windows-x64-portable/<app>-cli.exe` next to the desktop `<app>.exe`. Execution on Windows is a **manual** task (no Windows VM available in this run).

**0.3 Craft Launcher (v0.4.1, macOS) — answers O1.** The launcher is a GUI-only app (`ai.storyteller.artcraft-launcher`, no CLI). It installs the **desktop** apps by downloading the release `.dmg` and copying `<Name>.app` to `/Applications` (log: `download ready (…/ArtCraft Launcher/downloads/wordcraft-0.7.0-macos-universal.dmg), running installer…`). The `.app` contains **only the GUI executable** (`Contents/MacOS/<Name>`; no `<app>-cli` anywhere) and that binary opens a window for any argument (`--help` is treated as a file to open). Consequence: on macOS the `launcher` source can never supply a CLI — D3 is kept (it still resolves a CLI that sits in a launcher install dir, e.g. a Windows/Linux layout or `CRAFT_LAUNCHER_HOME`) but `launcher` mode reports "installed by the Craft Launcher … ships no <cli> (desktop app only)" and `auto` falls back to `managed`. Windows/Linux launcher roots in `launcher.ts` are best-effort and unverified. The launcher repo's installer assets are named `artcraft-launcher-<v>-<host>.<ext>` (not `craft-launcher-…`); `launcher install` maps them (dmg / msi / AppImage).

**0.4 MCP confinement at the latest releases (supersedes the spike table).** Confined: PhotoCraft, VectorCraft, EffectCraft, WordCraft and — new in **SoundCraft 0.7.0** — SoundCraft, all via `--automation-read-root/--automation-write-root` ("a root left out grants none of its access"); **PdfCraft** via a single `mcp --root DIR` (verified: `doc_open` outside the root is refused through MCP). Unconfined: FilmCraft, LightCraft, DesignCraft, FigCraft, DeckCraft, CADCraft, GridCraft (7/13). **Compact tool lists**: `lightcraft-cli mcp --compact` and `pdfcraft-cli mcp --compact` list only helper tools (every command stays reachable via `run_command`/`tool_call`) — the fix for the 330/163-tool context flood; the registry carries `compactFlag`, the proxy and `--register` accept `--compact` for those two apps. MCP tool counts re-recorded at the latest versions are unchanged (25/32/17/330/163/27/25/18/16/17/25/12/21). **O3** (undocumented confinement in the 7 unconfined servers) cannot be answered from the binaries; it needs an upstream question (Discord/issue) — **manual follow-up**, registry flags flip when upstream adds it.

**0.5 Fixtures.** `scripts/record-fixtures.mjs` records `src/__tests__/fixtures/commands/<app>.json` (version, command ids, MCP tool names) from real binaries. Pinned test versions = the latest at probe time: photocraft 0.9.0, vectorcraft 0.11.0, filmcraft 0.8.0, lightcraft 0.8.0, pdfcraft 0.8.0, effectcraft 0.10.0, designcraft 0.8.0, figcraft 0.6.0, wordcraft 0.7.0, soundcraft 0.7.0, deckcraft 0.7.0, cadcraft 0.7.0, gridcraft 0.7.0. CLI dialect findings: `commands` prints JSON by default for DesignCraft/DeckCraft/CADCraft (their `--json` is wrong/empty), text for SoundCraft; `commands --json` for the rest; PdfCraft uses `tools`.

## Open Questions

- ~~**O1**~~ Resolved by probe 0.3 (see above): the launcher installs desktop apps only.
- ~~**O2**~~ Resolved by probe 0.1: glibc floor 2.35 (SoundCraft 2.34).
- **O3** Do the 7 unconfined MCP servers have undocumented confinement? — needs an upstream question (manual).
- **O4** Router skill vs dashboard skill-atlas: should `craft-studio` be the only always-visible skill, with per-app skills discovered through it, to keep the skill index lean (14 descriptions)? Default: all 14 declared; revisit after measuring.
