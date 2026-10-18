# craft-apps.md — craft apps index

Pull-only condensed map. Source: `docs/craft-apps.md`. Headless ArtCraft CLIs for pi agents via `pi-craft`.

## 1. What / why
- Headless CLIs for 13 ArtCraft apps: PhotoCraft, VectorCraft, FilmCraft, LightCraft, PdfCraft, EffectCraft, DesignCraft, FigCraft, WordCraft, SoundCraft, DeckCraft, CADCraft, GridCraft.
- `pi-craft` provisions `<app>-cli` on first use. No desktop app.
- Surfaces: bash `pi-craft <app> exec`; opt-in MCP `pi-craft <app> mcp`.
- `pi-craft verify` checks outputs mechanically.
- Replaces `packages/photocraft`. Old package → deprecation shim.
- Package `@blackbelt-technology/pi-dashboard-craft-apps` (`packages/craft-apps`).
- Install: `pi install npm:@blackbelt-technology/pi-dashboard-craft-apps`.
- Bins: `pi-craft`, `pi-photocraft` (alias + `replace-region`). Dist `dist/craft.js`, `dist/photocraft.js`.
- Deps: nano-banana (`replace-region`). Optional: `ffmpeg`, `ffprobe`.

## 2. Architecture
- Bash: `src/bin/craft.ts` → `registry.ts` (`CRAFT_APPS`) → `provision.ts` → `<app>-cli`.
- MCP: `.pi/mcp.json` `craft-<app>` → `mcp-proxy.ts` `runMcp` → `<app>-cli mcp`.
- `verify` media → ffprobe/ffmpeg. `verify` PDF → provisions `pdfcraft`.
- Cache key `<app>/<version>`. Cache hit skips download.

## 3. Provisioning pipeline
Entry `provision(appOrId, deps)` in `src/provision.ts`.

1. `<APP>_BIN` set → use it. Highest precedence.
2. `CRAFT_SOURCE`: `managed` (default) | `launcher` | `auto`.
3. Pin `<APP>_VERSION` (one leading `v` stripped).
4. Latest: GitHub `storytold/<app>` non-prerelease. Cached 24 h (`latest.json`). Lookup fails + installed → highest installed + warn. None → fail, suggest `GITHUB_TOKEN`.
5. Assets: CLI-only `<app>-cli-<v>-<host>.<ext>` preferred. Else portable tar.gz / zip. Linux `glibcMin` 2.35 (SoundCraft 2.34). Unsupported host → fail.
6. `downloadVerified`: streamed SHA-256 vs `SHA256SUMS.txt`. Exactly one entry. Mismatch → fail closed.
7. `assertSafeListing`: reject abs paths, `..`, symlinks, hard links, specials.
8. Extract `ditto`/`tar` → `.staging-*`. `locateBinary`. chmod. Delete desktop exe.
9. Atomic rename → `<CRAFT_HOME>/<app>/<version>/`. Staging > 1 h removed.

- `ProvisionError` → exit `69`.
- Report keys: `app`, `version`, `source` (`override`|`pin`|`latest`|`latest-cached`|`fallback-installed`|`launcher`), `asset`, `cacheHit`, `binary`, `durationMs`, `gatekeeper`.

### Env
| Var | Effect |
|---|---|
| `<APP>_BIN` | use binary, skip provisioning |
| `<APP>_VERSION` | pin, e.g. `FILMCRAFT_VERSION=0.8.0` |
| `CRAFT_HOME` | cache root, default `<pi agent dir>/tools` |
| `PI_CODING_AGENT_DIR` | default `~/.pi/agent` |
| `PHOTOCRAFT_HOME` | reuses old `photocraft` cache |
| `CRAFT_SOURCE` | `managed` · `launcher` · `auto` |
| `CRAFT_LAUNCHER_HOME` | launcher apps dir override |
| `GITHUB_TOKEN` | avoids 60 req/h anon limit |

## 4. Craft Launcher probe
- Launcher v0.4.1 macOS: GUI-only, desktop bundles, no `<app>-cli`. GUI exe opens window for any arg.
- `auto` falls back to `managed` on macOS.
- Windows/Linux launcher roots (`launcher.ts`): unverified.
- `pi-craft launcher install`: only desktop-installer fetch. Explicit. Checksum vs `storytold/craft-launcher`.

## 5. MCP policy
- Nothing registered implicitly. `pi-craft <app> mcp --register` → `mcpServers["craft-<app>"]` (PhotoCraft `photocraft`) in `.pi/mcp.json`, absolute paths.
- Proxy: `tools/call` FIFO, one in flight. Non-JSON stdout → stderr. SIGINT/SIGTERM → 130/143.
- `notifications/cancelled`: queued dropped; in-flight released after `CANCEL_GRACE_MS`.
- Rejects caller `--bridge`, `--connect`, `--control-token`, `--automation-*-root`.
- Confined: `--root` (default cwd) → automation roots. PdfCraft: `--root DIR`.
- Unconfined (refuse w/o `--allow-unconfined`): filmcraft, lightcraft, designcraft, figcraft, deckcraft, cadcraft, gridcraft.
- `--allow-unconfined` persisted; stderr warns.
- Large (`--compact` suggested): lightcraft 330 tools, pdfcraft 163.
- Entry holds absolute paths. Do not commit.

## 6. `pi-craft verify`
`pi-craft verify <file> <assertion…> [--json]`. ≥1 assertion. `src/verify.ts`.

| Assertion | Default tol | Probe |
|---|---|---|
| `--duration <s>[±tol]` | 0.05 s | ffprobe |
| `--has-video --has-audio --no-audio` | – | ffprobe |
| `--size <W>x<H>` | – | ffprobe |
| `--fps <n>` | ±0.01 | ffprobe |
| `--codec <video\|audio>=<name>` | – | ffprobe |
| `--alpha` | – | ffprobe |
| `--loudness <LUFS>[±tol]` | 1 LU | ffmpeg `ebur128` |
| `--max-peak <dBFS>` | – | ffmpeg `volumedetect` |
| `--silent-below <dBFS>` | – | ffmpeg `volumedetect` |
| `--frame-diff <t>:<ref>[@<rt>]<op><pct>` | luma Δ > 40/255 | ffmpeg |
| `--pages <n>` (PDF) | – | pdfcraft |
| `--text-contains <s>` (PDF) | – | pdfcraft |

- `<op>` `>`: must differ. `<`: must match. Stills ignore `t`.
- Exit `0` pass · `1` fail/missing file · `2` usage · `3` probe tool missing.
- `pi-craft` other: `69` provision fail; `exec` returns binary exit code.

`pi-craft doc prepare <in.md> --out <dir>`: writes `template.filled.docx`, `body.md`, `prepare.json` (overwrites only those). `src/doc-prepare.ts`.
- Exit `0` ok · `1` fail or unresolved (w/o `--allow-missing`) · `2` usage.
- Frontmatter keys: `template`, `templates_dir`, `language`, `document_title`, `document_name`, `enable_toc`, `toc_heading`, `nano_banana`.
- Templates dir: `--templates-dir` > frontmatter > `$PI_DOC_TEMPLATES_DIR` > `./templates` > `~/Documents/templates`.
- Var precedence low→high: `variables.xml` < system < frontmatter < `--var`. System: `$date`, `$fileName`, `$year`, `$month`, `$day`.
- `{{ name }}` always; `<name>` only `syntax="both"`. Values XML-escaped.
- Images → data URIs ≤ 20 MB. Template images → `CRAFTIMG<NNNN>` markers + `prepare.json.pictures`.
- Mermaid → PNG via `mmdc`. `nano_banana.enabled` → `pi-nano-banana`, cache `.mermaid-cache/`. No `mmdc` → `mermaid.unrendered`.
- PlantUML stays code + `warnings`.

## 7. Skills
- `craft-studio`: router. App table, hand-offs, MCP vs bash, confinement.
- 13 app skills (one per app above).
- Media: `craft-video-post`, `craft-beat-cut`, `craft-podcast-master`, `craft-motion-titles`.
- Office: `craft-brand-kit`, `craft-doc-publish`, `craft-deck`, `craft-photo-pipeline`, `craft-data-visual`.
- Location `packages/craft-apps/.pi/skills/<name>/SKILL.md`. 23 total.
- `craft-doc-publish` = Markdown → templated DOCX/PDF. `document-converter` = fallback.
- `craft-deck` = DeckCraft. `deck3d` = HTML deck, separate branch.
- Discovery-first. Never guess ids. Loop: plan → discover (`commands`/`describe`/`tools`) → execute → save → `pi-craft verify`.
- Recipe fence: `` ```bash recipe: <id> `` ends in `pi-craft verify`. Run `bash -e`, tmp dir.
- Text gate: `` ```bash check: <label> ``.
- Gate fail → `describe` → retry. Max 2 retries.
- Soft refs (step 0): sibling skills, `pi-transcribe`, `pi-voiceid`, `pi-veo`, `.venv-music/bin/python`, `npx hyperframes`. Missing → fallback. Never invent data.
- Resume: `craft-jobs/<slug>/NN-<step>/`, `job.json` (`status`, inputs `path`/`size`/`mtime`, `upstream`). Slug `[a-z0-9-]`.
- Hand-offs: wav PCM 24-bit 48 kHz; mov ProRes 4444 alpha; srt; json `music-hits/1`; mp4 h264+aac. Chapters = sidecar text.

### Probed quirks
- FilmCraft 0.8.0: burned captions need `captions.import` + `export --settings '{"burnCaptions":true}'`.
- Overlay needs `timeline.setTargeting {"track":"V2","sourcePatch":true,"targeted":true}`; else `source.overwrite` replaces V1.
- SoundCraft 0.7.0: no LUFS target → ffmpeg two-pass `loudnorm linear=true`.
- Alpha mov: `npx hyperframes render . --format mov`.
- EffectCraft 0.10.0 template bg solid: `project.delete`. `verify --alpha` passes anyway → `check: alpha` corner pixel.
- Punch-in: `effects.setParam`, effect `motion`, param `scale`, `keyframe:true`.
- bash: write `${VAR}±0.1`, not `$VAR±0.1`.
- Office (2026-10): VectorCraft 0.12.0, GridCraft 0.7.0, DeckCraft 0.7.0, LightCraft 0.8.0, WordCraft 0.7.0, PdfCraft 0.8.0.
- `doc_protect` args `open_password`, `permissions_password`. `run --script` can't read `/dev/fd`; use 0600 temp file.

## 8. Tests
- Offline: `npx vitest run packages/craft-apps` (unit, packaging, skill lint, fixture drift).
- E2E: `CRAFT_E2E=1` → `real-apps`, `skills-recipes`, `skills-drift`. `CRAFT_WORKFLOW_E2E=1` adds workflow recipes (needs ffmpeg, jq).
- `real-binary.test.ts`: `PHOTOCRAFT_E2E=1` + `PHOTOCRAFT_BIN`.
- Re-record fixtures: `CRAFT_HOME=/tmp/craft-home node --import tsx scripts/record-fixtures.mjs`. Build: `node scripts/build.mjs`.
- Dialect: DesignCraft, DeckCraft, CADCraft → `commands` prints JSON. SoundCraft text output. PdfCraft `tools`.

## 9. Compatibility and rollback
- Old photocraft final release depends on `craft-apps`. Keeps `bin/pi-photocraft` path. `npm deprecate` → `craft-apps`.
- Entry name `photocraft` kept. `PHOTOCRAFT_HOME` honoured. Caches shared.
- Rollback: un-deprecate, revert manifest. Caches need no cleanup.
- Per-app: `<APP>_VERSION=<known-good>`. Offline: `<APP>_BIN=/path/to/cli`.

## 10. Known gaps
- Windows run-time unverified (layout only). riscv64, freebsd: not executed.
- O3: 7 unconfined MCP servers may have undocumented confinement.
- Integrity only: `SHA256SUMS.txt` same origin as asset. High-assurance → `<APP>_BIN`.
- Gatekeeper advisory. 13 third-party executables run with user privileges.
- Alpha CLIs churn ids → discovery skills, drift check, pins.
- Disk ≈ 0.8 GB all apps macOS.
