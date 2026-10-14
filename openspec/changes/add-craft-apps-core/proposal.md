## Why

ArtCraft's Crafting Apps (github.com/storytold, Apache-2.0, Rust) are thirteen native creative apps — PhotoCraft, VectorCraft, FilmCraft, LightCraft, PdfCraft, EffectCraft, DesignCraft, FigCraft, WordCraft, SoundCraft, DeckCraft, CADCraft, GridCraft — each shipping a headless `<app>-cli` with a self-describing command registry (≈6 000 commands total) and a stdio MCP server. Today only PhotoCraft is usable by pi agents (`packages/photocraft`, change `add-photocraft-plugin`); its provisioner, MCP proxy and skill are hard-wired to one app.

An explore spike (2026-10-14, macOS, latest releases) established:
- All 13 apps (+ `craft-launcher`) publish the **same release layout**: `<app>-cli-<v>-macos-universal.zip`, Linux/FreeBSD tarballs with the CLI under `bin/`, Windows portable zips, and `SHA256SUMS.txt`. All 13 checksums verified.
- CLIs share a family shape (`commands`, `run`, `mcp`, `info`/`convert`) but **differ per app** (`run FILE` vs `run --in FILE` vs `run <id> <json>…`; `describe`, `script`, `app --port`, `export`, `render`, `bounce` exist only on some; PdfCraft has no `commands`).
- MCP tool counts: 12–32 per app, except **LightCraft 330** and **PdfCraft 163** — always-on registration would flood the model context.
- Only **4/13** MCP servers advertised path confinement in the spike (`--automation-read-root/--automation-write-root`: Photo, Effect, Vector, Word); the latest-release probe (design.md) adds SoundCraft 0.7.0 and PdfCraft (`--root`) → 6/13, and finds `--compact` MCP modes for the two large apps.
- A **headless three-app round-trip works today**: SoundCraft import → clip gain → bounce; EffectCraft comp + animated text → ProRes 4444 alpha; FilmCraft import → sequence → two overwrites → h264+aac export. ≈3 s end to end, verified with ffprobe, loudness and a frame diff.
- The same spike produced a **silently wrong output** (10 s instead of 5 s) from one guessed command id (`timeline.setPlayhead`, real: `playhead.set`): agents need discovery-first skills and mechanical output verification.

## What Changes

- New package `packages/craft-apps` → `@blackbelt-technology/pi-dashboard-craft-apps`, absorbing `packages/photocraft` (source, tests, `replace-region`, skill).
- **App registry**: one typed table describing every app (id, repo, CLI name, asset patterns, CLI dialect, MCP confinement support, bridge flag, MCP tool-count class).
- **Generic provisioning** (generalised from PhotoCraft's): per-app pin/override env vars, shared cache root, fail-closed checksums, safe extraction, per-app versioned cache. Existing `PHOTOCRAFT_*` env vars and the `tools/photocraft` cache keep working (no re-download).
- **Selectable source**: `managed` (headless CLI-only provisioning, default) or `launcher` (use CLIs installed by the ArtCraft Craft Launcher); `pi-craft launcher status|install` provisions the launcher installer itself (checksum-verified) on explicit request.
- **`pi-craft` CLI**: `apps`, `status`, `<app> ensure|path|exec|mcp|mcp --register`, `install <app…>|--all`, `verify`. `pi-photocraft` remains as a compatibility alias (`replace-region` stays a PhotoCraft subcommand).
- **Lazy, per-app MCP**: nothing is registered by default; `pi-craft <app> mcp --register` writes one entry; large-tool-count apps warn; apps without path confinement require `--allow-unconfined`.
- **`craft-verify`**: mechanical post-step assertions on outputs (duration, streams, alpha, loudness/peak, dimensions, page count, frame difference) with a JSON report and non-zero exit on failure.
- **Skills**: one router skill `craft-studio` (which app for which job, hand-off formats, shared discovery→execute→save→verify loop) + 13 per-app skills (dialect, document model, discovery commands, gotchas, minimal recipes). PhotoCraft's existing skill is kept and folded in.
- **Skill-drift check**: every command id quoted in a skill is validated against the pinned app version's live `commands`/`describe` output (nightly, real binaries).
- The published `@blackbelt-technology/pi-dashboard-photocraft` gets a final deprecation release: a shim depending on `craft-apps` that forwards `pi-photocraft`.

## Capabilities

### New Capabilities
- `craft-binary-provisioning`: per-app release resolution (override, pin, latest), host→asset mapping from the registry, checksum verification, extraction, versioned cache, managed vs launcher source, launcher installer provisioning, reporting.
- `craft-cli-entrypoint`: `pi-craft` subcommands, exit codes, `apps`/`status` listing, exec pass-through, per-app MCP proxy with confinement policy and lazy registration, `pi-photocraft` alias, manifest entry.
- `craft-verify`: output assertion command for media, image and PDF artefacts.
- `craft-app-skills`: the router skill, the 13 per-app skills, their required content, and the skill-drift check.

### Modified Capabilities
- `photocraft-binary-provisioning`: REMOVED — superseded by `craft-binary-provisioning` (PhotoCraft becomes one registry row; env vars and cache path stay compatible).
- `photocraft-cli-entrypoint`: MODIFIED — `pi-photocraft` is shipped by `craft-apps` and by the deprecated shim; manifest entry points at `craft-apps`.
- `photocraft-region-replace`: unchanged behaviour (code moves with the package; no delta).

## Impact

- Code: new `packages/craft-apps/` (`src/registry.ts`, `src/provision.ts` (generalised), `src/launcher.ts`, `src/mcp-proxy.ts`, `src/mcp-register.ts`, `src/verify.ts`, `src/region-replace.ts` (moved), `src/bin/craft.ts`, `src/bin/photocraft.ts` (alias), launchers `bin/pi-craft` + `bin/pi-photocraft`, 14 skills); `packages/photocraft/` reduced to a deprecation shim; `packages/shared/src/recommended-extensions.ts`; repo registrations (publish allowlist, vitest project, knip workspace, lockfile) per `add-new-plugin-package-checklist`.
- Dependencies: none new at runtime (system `ditto`/`tar`; `ffprobe`/`ffmpeg` optional for `verify` media checks — declared in `pi.tools` as optional). Existing dep on `pi-dashboard-nano-banana` moves with `replace-region`.
- Network/disk: GitHub API + per-app CLI downloads (6–106 MB each, ≈0.8 GB for all 13 on macOS) on first use per app only.
- Security: 13 third-party executables; integrity via same-origin SHA256SUMS (corruption, not authenticity); 9 MCP servers without path confinement gated behind explicit opt-in; launcher installer download is explicit-only.
- Compatibility: `PHOTOCRAFT_BIN/VERSION/HOME`, the `tools/photocraft/<version>` cache, the `pi-photocraft` CLI surface and existing `.pi/mcp.json` `photocraft` entries keep working (shim keeps its launcher path).
- Implementation order (group `artcraft-craft-apps`): 1 of 4 — foundation for `add-craft-media-workflows`, `add-craft-office-workflows`, `add-artcraft-studio`.
- Rollback: pin `<APP>_VERSION`; deprecate `craft-apps` and un-deprecate `photocraft` (the previous release is still on npm); manifest entry revert. No persisted dashboard state, no migration.

## Discipline Skills

- `security-hardening` — downloads and executes 13 third-party binaries; untrusted archive extraction; launcher installer download; MCP servers without path confinement; `.pi/mcp.json` writes.
- `doubt-driven-review` — absorbing a published package (`photocraft` → `craft-apps`) and the npm deprecation are hard to walk back; the unconfined-MCP policy is a security default.
- `observability-instrumentation` — new external calls per app (GitHub API, downloads); `ensure`/`status`/`verify` emit structured JSON reports with version, source, cache hit and timings.
- `performance-optimization` — MCP tool-count budget (LightCraft 330 / PdfCraft 163 tools) is a model-context budget; lazy registration and warnings enforce it.
- `review-code` — before commit.
