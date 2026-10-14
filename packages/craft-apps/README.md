# @blackbelt-technology/pi-dashboard-craft-apps

Headless [ArtCraft Crafting Apps](https://github.com/storytold) for pi agents — **PhotoCraft, VectorCraft, FilmCraft,
LightCraft, PdfCraft, EffectCraft, DesignCraft, FigCraft, WordCraft, SoundCraft, DeckCraft, CADCraft, GridCraft**.
`pi-craft` provisions each app's `<app>-cli` binary on first use (no desktop app, nothing installed system-wide),
exposes it over **bash** and a **per-app stdio MCP server** with an explicit confinement policy, verifies outputs
mechanically (`pi-craft verify`), and ships a `craft-studio` router skill plus one skill per app.

Standalone pi package (skills + CLIs). No dashboard client/server code. Supersedes
`@blackbelt-technology/pi-dashboard-photocraft` (now a deprecation shim).

## Install

```bash
pi install npm:@blackbelt-technology/pi-dashboard-craft-apps
```

Ships 14 skills (`craft-studio`, `photocraft`, `vectorcraft`, `filmcraft`, `lightcraft`, `pdfcraft`, `effectcraft`,
`designcraft`, `figcraft`, `wordcraft`, `soundcraft`, `deckcraft`, `cadcraft`, `gridcraft`) and the bins `pi-craft` and
`pi-photocraft` (plain-JS launchers over esbuild bundles — they run from a plain shell, including an agent's bash
tool). Depends on `@blackbelt-technology/pi-dashboard-nano-banana` for `pi-photocraft replace-region`.
`ffmpeg`/`ffprobe` are optional system tools used only by `pi-craft verify` media checks.

## CLI

| Command | What it does |
|---|---|
| `pi-craft apps [--json]` | The 13 apps: id, purpose, repo, MCP confinement and tool-count class. Offline. |
| `pi-craft status [--json]` | Per app: installed versions, cache size, version that would be used, active source. Never downloads. |
| `pi-craft install <app…>\|--all` | Provision each app (as `ensure`), one JSON report per app; one failure does not stop the others (exit `69` if any failed). |
| `pi-craft <app> ensure` | Provision; print a JSON report (`app`, `version`, `source`, `asset`, `cacheHit`, `binary`, `durationMs`, macOS `gatekeeper`). |
| `pi-craft <app> path` | Provision; print only the absolute binary path. |
| `pi-craft <app> exec <args…>` | Run `<app>-cli <args…>` verbatim (argument vector, streamed stdio, exit code propagated). |
| `pi-craft <app> mcp [--root <dir>] [--compact]` | Stdio MCP server, `tools/call` forwarded one at a time. Confined apps run confined to `<dir>` (default cwd); the other seven refuse without `--allow-unconfined`. |
| `pi-craft <app> mcp --register [--allow-unconfined] [--compact]` | Opt-in: add a `craft-<app>` entry (PhotoCraft: `photocraft`) with absolute paths to the project's `.pi/mcp.json`. |
| `pi-craft verify <file> <assertion…> [--json]` | Mechanical checks: duration, streams, alpha, loudness/peak, size, fps, codec, frame diff, PDF pages/text. |
| `pi-craft launcher status\|install` | Craft Launcher state / checksum-verified installer (explicit only). |
| `pi-photocraft …` | Compatibility alias of `pi-craft photocraft …` plus `replace-region`. |

Exit codes: `0` success · `1` usage error or failed operation · `69` provisioning failure. `exec` returns the binary's
own exit code. `verify`: `0` pass · `1` fail · `2` usage · `3` probe tool missing.

### MCP policy

Nothing is registered implicitly. Six servers advertise path confinement and run confined to the project directory
(PhotoCraft, VectorCraft, EffectCraft, WordCraft, SoundCraft via `--automation-read-root/--automation-write-root`;
PdfCraft via `--root`). The other seven (FilmCraft, LightCraft, DesignCraft, FigCraft, DeckCraft, CADCraft, GridCraft)
can read and write any path the user can, so `mcp` and `--register` refuse them without `--allow-unconfined`
(the flag is persisted in the registered entry). LightCraft (330 tools) and PdfCraft (163) flood the model context:
prefer the bash route or `--compact` (helper tools only). The proxy rejects `--bridge/--connect/--control-token` and
direct automation-root options — desktop GUI bridging is out of scope. pi loads project MCP servers only for a
**trusted** project started in the **project root**; the entry holds absolute paths (do not commit it for a team).

### verify

```bash
pi-craft verify final.mp4 --duration 5±0.1 --has-video --has-audio --size 1920x1080
pi-craft verify title.mov --alpha --frame-diff 3:plain.mp4\>0.5
pi-craft verify mix.wav --loudness -16±1 --max-peak -1
pi-craft verify report.pdf --pages 12 --text-contains "Quarterly"
```

## Environment

| Variable | Effect |
|---|---|
| `<APP>_VERSION` | Pin a release (`v0.8.0` or `0.8.0`), e.g. `FILMCRAFT_VERSION` — the per-app rollback lever. |
| `<APP>_BIN` | Use this binary; skip provisioning (air-gapped / self-built). Beats every source. |
| `CRAFT_HOME` | Cache root (default `<pi agent dir>/tools`; `PI_CODING_AGENT_DIR` or `~/.pi/agent`). Apps live in `<root>/<app>/<version>/`. |
| `PHOTOCRAFT_HOME` | Back-compat: PhotoCraft's per-app directory (the previous package's cache is reused, no re-download). |
| `CRAFT_SOURCE` | `managed` (default: release CLI archives) · `launcher` (a CLI from a Craft Launcher install; never downloads) · `auto` (launcher, then managed). |
| `CRAFT_LAUNCHER_HOME` | Directory that holds launcher-installed apps (override of the per-OS default). |
| `GITHUB_TOKEN` | Bearer token for the GitHub API (avoids the 60 req/h anonymous limit). |

"Latest" is resolved per app at most once per 24 h (`latest.json`); when the lookup fails the highest installed
version is used with a warning. Command ids change between alpha releases — the skills are discovery-first.

**Sources.** The ArtCraft *Craft Launcher* installs the desktop apps only: on macOS `/Applications/<Name>.app` contains
no `<app>-cli` (probed on launcher 0.4.1), so `launcher` finds nothing there and `auto` falls back to `managed`. The
default `managed` source is the one that works headless.

Platforms: macOS (arm64/x64, CLI zip), Linux x64/arm64/riscv64 (**glibc ≥ 2.35**, SoundCraft ≥ 2.34; not musl),
Windows x64/arm64/x86 portable zip (layout verified; run-time verification pending), FreeBSD x64. The desktop executable
is deleted after extraction. Per app, a CLI-only archive is preferred when the release has one (macOS always; PdfCraft
on Linux), else the portable archive.

## Security notes

- The binary is verified against the release's `SHA256SUMS.txt` (fail closed). That is the **same origin** as the
  asset: it detects corruption and CDN tampering, **not** a compromised upstream release or a downgrade.
- High-assurance setups: build or vet `<app>-cli` yourself, then set `<APP>_BIN` (and/or pin `<APP>_VERSION`).
- Archives are listed before extraction; absolute paths, `..` segments, symlinks, hard links and special files abort
  the install. Extraction happens in a staging directory and is moved into place atomically.
- macOS: `spctl --assess --type install` is recorded as `gatekeeper` (advisory; a rejection only warns).
- `pi-craft launcher install` is the only command that downloads a desktop installer (checksum-verified, then handed
  to the OS); app provisioning fetches only the CLI archive and `SHA256SUMS.txt`.
- 13 third-party executables run with the user's privileges; the unconfined MCP servers are opt-in per app.
- Trust model of the environment: `<APP>_BIN`, `CRAFT_HOME`, `PHOTOCRAFT_HOME`, `CRAFT_LAUNCHER_HOME` and the launcher roots
  (`/opt`, `~/.local/share`, `%LOCALAPPDATA%\Programs`, `/Applications`) locate binaries that are then **executed**; they must
  not point to world-writable directories (ownership is not checked). A launcher-found CLI is only probed with `--version`.
- Release metadata is untrusted: versions are validated as path segments, asset names come from the registry (not the
  release JSON), download URLs must stay under `https://github.com/<repo>/releases/download/`, downloads are size-bounded,
  and the extracted tree is re-checked for symlinks. Windows system tools are spawned as `.exe` (never via `cmd.exe`).
- `pi-craft verify` resolves its file and `--frame-diff` reference to absolute local paths and bounds every probe with a timeout.
- `mcp --register` refuses to write through a symlinked `.pi` or `mcp.json`, never clobbers a non-object `mcpServers`, and
  writes atomically. The default MCP confinement root is the current directory — start pi in the project, not in `$HOME`.

## Development

```bash
npx vitest run packages/craft-apps                                   # unit + packaging + skill lint/drift (fake release server)
CRAFT_E2E=1 CRAFT_HOME=/tmp/craft-home npx vitest run packages/craft-apps/src/__tests__/{real-apps,skills-recipes,skills-drift}.test.ts
CRAFT_HOME=/tmp/craft-home node --import tsx scripts/record-fixtures.mjs   # re-record src/__tests__/fixtures/commands/*.json
PHOTOCRAFT_E2E=1 PHOTOCRAFT_BIN=/path/to/photocraft-cli npx vitest run packages/craft-apps real-binary   # region-replace
node scripts/build.mjs                                               # dist/craft.js + dist/photocraft.js (also runs on prepack)
```
