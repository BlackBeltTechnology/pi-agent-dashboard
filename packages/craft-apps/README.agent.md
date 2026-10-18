# README.md — craft-apps index

Pull-only condensed map. Source: packages/craft-apps/README.md. `@blackbelt-technology/pi-dashboard-craft-apps`: headless ArtCraft apps for pi via `pi-craft` CLI, per-app MCP, `pi-craft verify`, 23 skills.

## Install
- `pi install npm:@blackbelt-technology/pi-dashboard-craft-apps`.
- Bins: `pi-craft`, `pi-photocraft` (esbuild bundles, plain shell safe).
- Supersedes `@blackbelt-technology/pi-dashboard-photocraft` (deprecation shim).
- Depends on `@blackbelt-technology/pi-dashboard-nano-banana` (`pi-photocraft replace-region`).
- Optional system tools: `ffmpeg`, `ffprobe` (`pi-craft verify` media checks).

## CLI
- `pi-craft apps [--json]` — 13 apps; offline.
- `pi-craft status [--json]` — versions, cache, source; never downloads.
- `pi-craft install <app…>|--all` — exit 69 if any fail.
- `pi-craft <app> ensure` — JSON report (`app`, `version`, `source`, `asset`, `cacheHit`, `binary`, `durationMs`, `gatekeeper`).
- `pi-craft <app> path` — binary path only.
- `pi-craft <app> exec <args…>` — runs `<app>-cli` verbatim; exit code propagated.
- `pi-craft <app> mcp [--root <dir>] [--compact]` — stdio MCP; confined apps default cwd.
- `pi-craft <app> mcp --register [--allow-unconfined] [--compact]` — writes `craft-<app>` into `.pi/mcp.json` (PhotoCraft: `photocraft`).
- `pi-craft verify <file> <assertion…> [--json]` — duration, streams, alpha, loudness/peak, size, fps, codec, frame diff, PDF pages/text.
- `pi-craft doc prepare <in.md> --out <dir> [--template] [--templates-dir] [--var k=v] [--allow-path] [--allow-missing] [--json]` — writes `template.filled.docx`, `body.md`, `prepare.json`.
- `pi-craft launcher status|install` — Craft Launcher state / checksum-verified installer.
- Exit: `0` ok · `1` usage/failed · `69` provisioning. `verify`: `0` pass · `1` fail · `2` usage · `3` probe tool missing.

## MCP policy
- Nothing registered implicitly.
- Confined: PhotoCraft, VectorCraft, EffectCraft, WordCraft, SoundCraft (`--automation-read/write-root`), PdfCraft (`--root`).
- Unconfined (refuse w/o `--allow-unconfined`): FilmCraft, LightCraft, DesignCraft, FigCraft, DeckCraft, CADCraft, GridCraft.
- LightCraft (330 tools), PdfCraft (163) flood context → bash or `--compact`.
- Proxy rejects `--bridge/--connect/--control-token` and direct automation-root options.
- `.pi/mcp.json` holds absolute paths; do not commit for team.

## doc prepare
- Helper behind `craft-doc-publish`; no Docker, no pandoc.
- Frontmatter keys: `template`, `templates_dir`, `language`, `document_title`, `document_name`, `enable_toc`, `toc_heading`, `nano_banana`.
- Template lookup: `--templates-dir` → frontmatter `templates_dir` → `$PI_DOC_TEMPLATES_DIR` → `./templates` → `~/Documents/templates`.
- Precedence low→high: `variables.xml` default, system (`$date` en/hu/de/fr, `$fileName`, `$year`, `$month`, `$day`), frontmatter, `--var`.
- Fills `{{ name }}` (and `<name>` if `syntax="both"`) in document, textboxes, headers/footers. XML-escaped; untouched parts byte-identical.
- Body images inlined (input dir or `--allow-path`). Mermaid via `mmdc` or `pi-nano-banana` (paid; cache `.mermaid-cache/`).
- Values substituted after image/diagram processing.
- No `mmdc` → code block; `prepare.json` counts unrendered. `PUPPETEER_EXECUTABLE_PATH` for browser.
- Template images → `CRAFTIMG<n>` markers + `images/`; `craft-doc-publish` step 2 uses `insert.picture`.

## Workflow skills
- `craft-video-post`: footage → redaction → alpha overlay → FilmCraft → captions → SoundCraft → mp4. Siblings: `veo-generator`, `footage-redaction`, `hyperframes-showreel`, `video-transcription`.
- `craft-beat-cut`: music map → edit → hits → cuts → punches → mp4. Siblings: `music-analysis`, `music-edit-to-length`, `beat-sync-video`.
- `craft-podcast-master`: recording → stems → SoundCraft → loudnorm → chapters → mux. Siblings: `video-transcription`, `speaker-id`.
- `craft-motion-titles`: SRT names → EffectCraft alpha → FilmCraft overlay.
- `craft-brand-kit`: logo → VectorCraft → PhotoCraft → DesignCraft → PdfCraft. Siblings: `anti-slop-brandkit`, `pi-nano-banana`.
- `craft-doc-publish`: Markdown → `pi-craft doc prepare` → WordCraft → pdf → PdfCraft. Siblings: `document-converter`, `mmdc`.
- `craft-deck`: outline → DeckCraft → PdfCraft handout; or `deck3d`.
- `craft-photo-pipeline`: RAW → LightCraft → PhotoCraft → export. Sibling: `pi-nano-banana`.
- `craft-data-visual`: GridCraft → chart → VectorCraft/DesignCraft → DeckCraft.
- Each: step table, `verify` gate per artefact, step 0 sibling check, `craft-jobs/<slug>/` resume.
- Probed facts: FilmCraft 0.8.0, SoundCraft 0.7.0, EffectCraft 0.10.0, HyperFrames 0.8.168. Burn captions `export --settings '{"burnCaptions":true}'`; overlay needs V2 sourcePatch; no SoundCraft LUFS; HyperFrames mov keeps alpha; EffectCraft "Preview Background" solid.
- Office: WordCraft 0.7.0 (TOC before body: `references.toc`, `caret.docEnd`); GridCraft chart via pdf export (`image.trim`); LightCraft AI denoise needs model + licence accept; protected pdf not probed.
- Recipes: `CRAFT_E2E=1 CRAFT_WORKFLOW_E2E=1` (needs ffmpeg, jq; office also PdfCraft, WordCraft, VectorCraft, PhotoCraft, DesignCraft, DeckCraft, GridCraft, LightCraft).

## Environment
- `<APP>_VERSION` — pin release (`v0.8.0` or `0.8.0`).
- `<APP>_BIN` — use binary; skip provisioning; beats all sources.
- `CRAFT_HOME` — cache root; default `<pi agent dir>/tools`; apps in `<root>/<app>/<version>/`.
- `CRAFT_SOURCE` — `managed` (default) · `launcher` (never downloads) · `auto` (launcher then managed).
- `CRAFT_LAUNCHER_HOME` — launcher app dir override.
- `GITHUB_TOKEN` — avoids 60 req/h anon limit.
- "latest" resolved once per 24 h (`latest.json`); lookup fail → highest installed + warning.
- Platforms: macOS arm64/x64; Linux x64/arm64/riscv64 (glibc ≥ 2.35; SoundCraft ≥ 2.34; not musl); Windows x64/arm64/x86 (run-time verify pending); FreeBSD x64.

## Security notes
- SHA256 vs `SHA256SUMS.txt` (fail closed); same origin as asset; no upstream-compromise or downgrade protection.
- High assurance: build/vet `<app>-cli`, set `<APP>_BIN` and/or pin `<APP>_VERSION`.
- Archives: abs paths, `..`, symlinks, hardlinks, specials abort; staging then atomic move.
- macOS `spctl` → `gatekeeper` (advisory). Only `launcher install` downloads desktop installer.
- 13 third-party executables run with user privileges.
- Trust roots (`<APP>_BIN`, `CRAFT_HOME`, `PHOTOCRAFT_HOME`, `CRAFT_LAUNCHER_HOME`, `/opt`, `~/.local/share`, `%LOCALAPPDATA%\Programs`, `/Applications`) must not be world-writable; ownership unchecked.
- Release metadata untrusted: asset names from registry; URLs under `https://github.com/<repo>/releases/download/`.
- `mcp --register`: refuses symlinked `.pi`/`mcp.json`; never clobbers non-object `mcpServers`; atomic write. Start pi in project, not `$HOME`.
