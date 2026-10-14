## 0. Gating probes (before implementation; record results in design.md)

- [x] 0.1 Linux container (x64 + arm64, glibc ≥ 2.35): provision all 13 apps from portable tarballs; record CLI path inside each tarball, glibc floor, `--version`, `commands` and `mcp tools/list` (O2)
- [x] 0.2 Windows (x64): record `<app>-cli.exe` location per app from the portable zips (central directories range-read: `<app>-<v>-windows-x64-portable/<app>-cli.exe`; results in design.md)
- [ ] 0.2b Manual: run the 13 `<app>-cli.exe --version` / `commands` on a real Windows x64 VM (no VM available in the ship-it run)
- [x] 0.3 Craft Launcher layout: install launcher on macOS (and Linux/Windows if available), install 2 apps through it, record where apps and CLIs land and whether CLIs are included (O1)
- [x] 0.4 Confirm per-app MCP confinement flags (`mcp --help`) on pinned versions (result: 6/13 confined, `--compact` for the two large apps — design.md)
- [ ] 0.4b Manual: ask upstream (Discord/issue) whether the 7 unconfined MCP servers have undocumented confinement (O3)
- [x] 0.5 Record per-app command-list fixtures (`commands --json` / `tools` / `describe`) for the pinned test versions under `src/__tests__/fixtures/commands/`

## 1. Package scaffold (follow `add-new-plugin-package-checklist`)

- [x] 1.1 Create `packages/craft-apps` (`package.json` name `@blackbelt-technology/pi-dashboard-craft-apps`, bins `pi-craft` + `pi-photocraft`, `pi.skills` ×14, `pi.tools` ffmpeg/ffprobe optional, `files`, `prepack`)
- [x] 1.2 `git mv` PhotoCraft sources/tests/skill from `packages/photocraft` into `packages/craft-apps`; run the moved PhotoCraft test-suite green before any generalisation
- [x] 1.3 Repo registrations: publish allowlist, root vitest project, knip workspace, lockfile, tsconfig
- [x] 1.4 `bin/pi-craft` plain-JS launcher + `scripts/build.mjs` esbuild bundle (deck3d/photocraft pattern)

## 2. Registry + provisioning (TDD; tests first)

- [x] 2.1 Tests: registry has 13 apps, ids unique, every app has assets for all supported hosts, confinement/toolClass flags match 0.4 results
- [x] 2.2 `src/registry.ts` typed readonly table (id, repo, cli, assets, dialect, mcp {confinement, toolClass, bridgeFlag}, glibcMin)
- [x] 2.3 Tests (port PhotoCraft's provision tests, parameterised per app): per-app env precedence, pins per app, CLI-only asset preference (pdfcraft linux), portable fallback, checksum fail-closed, traversal/symlink abort, concurrent installs of different apps, PhotoCraft cache reuse + `PHOTOCRAFT_HOME`
- [x] 2.4 Generalise `src/provision.ts` to take a `CraftApp`; keep all injectable deps
- [x] 2.5 Tests + impl `src/launcher.ts`: `CRAFT_SOURCE` managed|launcher|auto, launcher detection per 0.3, never downloads in launcher mode
- [x] 2.6 Tests + impl `pi-craft launcher status|install` (checksum-verified installer, OS hand-off, exit 69 on mismatch)

## 3. CLI entry point

- [x] 3.1 Tests: dispatch/usage/exit codes, `apps --json` offline, `status` never downloads, `install` partial failure → 69, `exec` verbatim argv + streaming + exit propagation
- [x] 3.2 `src/bin/craft.ts` implementation
- [x] 3.3 `src/bin/photocraft.ts` alias: existing PhotoCraft CLI tests pass unchanged

## 4. MCP proxy + registration

- [x] 4.1 Tests: confined app gets roots; unconfined refuses without `--allow-unconfined`; bridge/connect/root options rejected; serialized `tools/call`; stdout hygiene on provisioning failure
- [x] 4.2 Generalise `src/mcp-proxy.ts` per app (confinement-aware arg building)
- [x] 4.3 Tests + impl `mcp --register`: `craft-<app>` naming (`photocraft` kept), flag persisted, large-app warning with tool count, malformed file untouched, nothing registered implicitly
- [x] 4.4 Real-binary test (opt-in, like `real-binary.test.ts`): `initialize` + `tools/list` through the proxy for one confined and one unconfined app

## 5. craft-verify

- [x] 5.1 Tests with generated fixtures (ffmpeg testsrc/sine; ProRes 4444 alpha; overlay vs plain frame; 2-page PDF): every assertion pass + fail case, exit codes 0/1/2/3, `--json` shape
- [x] 5.2 `src/verify.ts` + `pi-craft verify` wiring (argv-only spawning via `platform/exec`)

## 6. Skills

- [ ] 6.1 Skill lint test: every recipe that writes an output has a `pi-craft verify` line; descriptions name the app
- [ ] 6.2 Drift test (offline): command ids in skill code fences ∈ fixture command lists (0.5); nightly variant against real binaries
- [ ] 6.3 `craft-studio` router skill
- [ ] 6.4 Media app skills, each recipe executed once against real binaries: filmcraft, soundcraft, effectcraft, lightcraft
- [ ] 6.5 Visual app skills: photocraft (move + trim), vectorcraft, figcraft, designcraft
- [ ] 6.6 Office/technical app skills: pdfcraft, wordcraft, deckcraft, gridcraft, cadcraft

## 7. Compatibility + distribution

- [ ] 7.1 Reduce `packages/photocraft` to the deprecation shim (dependency on craft-apps; `bin/pi-photocraft` forwards); packaging test: legacy `.pi/mcp.json` entry still starts the server
- [ ] 7.2 Swap the recommended-extensions manifest entry; update manifest tests
- [ ] 7.3 README for craft-apps (install, CLI table, env vars, sources, MCP policy, security notes); package + dir `AGENTS.md` rows
- [ ] 7.4 DocScribe: `docs/` page for craft apps (architecture, provisioning, MCP policy) — delegated

## 8. QA

- [ ] 8.1 Re-run the spike round-trip (SoundCraft → EffectCraft → FilmCraft) via `pi-craft` + `pi-craft verify` on macOS
- [ ] 8.2 Same round-trip in the Linux docker harness
- [ ] 8.3 Manual: pi session uses `craft-studio` to complete "make a 5 s titled clip with a −6 dB tone" end to end
- [ ] 8.4 `review-code` pass; `npm run quality:changed`
