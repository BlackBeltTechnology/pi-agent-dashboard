# DOX — packages/photocraft/src/__tests__

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `cli.test.ts` | `pi-photocraft` alias: dispatch + exit codes, `path`/`ensure` output, `exec` argv/streaming/exit propagation (subprocess with stub `PHOTOCRAFT_BIN`), no implicit `.pi/mcp.json` (E13–E17, E21, X2b). |
| `craft-cli.test.ts` | `pi-craft`: dispatch/usage (13 ids), `apps --json` offline, `status` never provisions, `install` partial failure → 69, `exec` verbatim argv + exit code (subprocess), no implicit registration, `mcp --register` policy, `launcher status/install` wiring. |
| `fixtures/empty.srt`, `fixtures/one.srt`, `fixtures/music-hits/*.json` | Inputs of the executed workflow `check:` snippets (0/1 cue; valid / no-hits / `music-hits/0`). |
| `fixtures/commands/<app>.json` | Recorded command-list fixtures (13 apps: version, `commandIds`, `mcpTools`) from real binaries; input of the offline skill drift test. Re-record with `scripts/record-fixtures.mjs`. |
| `helpers/fixtures.ts` | Fake GitHub release server (`startFixture` with `repo`, tag, assets, sums, 403, truncation, delay), tar.gz/crafted hostile archive builders, tmp-dir tracking. No network, no real HOME. |
| `helpers/paths.ts` | `CLI` (`src/bin/photocraft.ts`), `CRAFT_CLI` (`src/bin/craft.ts`) + `TSX` (absolute loader) for subprocess tests. |
| `helpers/png.ts` | Tiny 8-bit PNG encoder/decoder + `scene()` for pixel assertions in real-binary tests. |
| `helpers/provision-child.ts` | Child process for the concurrent-install test (X7): `<app> <apiBase> <home>`. |
| `helpers/skills.ts` | Skill test helpers: `loadSkill`, `fences` (recipe-tagged code fences), `commandLines`, `loadFixture`, `quotedIds` (namespace-aware id extraction for drift), `WORKFLOW_SKILL_NAMES`/`WORKFLOW_APPS`/`WORKFLOW_SIBLINGS`, `stepSections`, `checkSnippet`, `fixtureUnion`, `unknownWorkflowIds`/`unknownIdsAgainst` (workflow drift over the app union). |
| `helpers/stubs.ts` | Executable node-script stubs: argv echo, fake MCP server (arrival/send log, delay, noise, hang). |
| `launcher-install.test.ts` | Installer asset mapping, checksum-verified download + OS hand-off, digest mismatch deletes file and opens nothing, missing sums fail closed. |
| `mcp-apps.test.ts` | Per-app proxy: roots for confined apps, PdfCraft `--root`, `--compact`, unconfined refusal / `--allow-unconfined`, rejected bridge options; per-app `--register` naming, flag persistence, large-app warning, malformed file. |
| `mcp-proxy.test.ts` | PhotoCraft proxy: root translation, option rejection, provisioning failure (stdout clean), serialization order, non-JSON stdout → stderr, SIGTERM/SIGINT → 143/130 (E18, E19, X10, X11, F1, F3). |
| `mcp-register.test.ts` | PhotoCraft alias `.pi/mcp.json` create / merge / replace / malformed / no-project-marker warning (E20). |
| `packaging.test.ts` | `npm pack` → 18 skills (router, 13 apps, 4 workflows) + both bins + both bundles shipped; extracted bins run with no TS loader; workspace bin symlinks start (E23, E43, E45). |
| `provision-apps.test.ts` | Cross-app behaviour: unknown id, per-app pins, `CRAFT_HOME`/`PHOTOCRAFT_HOME`, previous PhotoCraft cache reuse, CLI-only asset preference + marker, concurrent different apps, `CRAFT_SOURCE` managed/launcher/auto. |
| `provision.test.ts` | Provisioning suite parameterised over every registry row (`describe.each`) against the fixture server: precedence, pin, 24 h cache, token, asset table, libc gate, sums parse, listing guard, hostile archives, races, interrupted download, staging sweep, fallbacks (E1–E12, E41, E46, X1–X9). |
| `real-apps.test.ts` | Opt-in `CRAFT_E2E`: genuine GridCraft provisioning, MCP `initialize`+`tools/list` through the proxy (confined PhotoCraft, unconfined GridCraft, PdfCraft `--compact`), `verify --pages` on real PdfCraft. |
| `real-binary.test.ts` | Real `photocraft-cli` + stub generator, gated `PHOTOCRAFT_E2E`: locality, resolution, layered output, selectors, masks, MCP through the wrapper, real release provisioning (E29–E35, E39, E40, F2). |
| `region-replace.test.ts` | Argument validation, geometry, composite command lists, report/temp lifecycle, generator subprocess + launcher resolution, failure semantics with injected runner (E24–E28, E38, E42, E47, X12–X15). |
| `registry.test.ts` | 13 unique apps, `storytold/<id>`, per-host assets, CLI-only Linux preference, confinement/tool-class/compact flags match probe 0.4, dialects, unknown id. |
| `skills-drift.test.ts` | Opt-in nightly: every command id quoted in a skill (workflows: the union of their apps' lists) exists in the live `commands`/`tools` list of the provisioned binary; `extractCommandIds` unit tests. |
| `skills-recipes.test.ts` | Opt-in: runs every `recipe:`-tagged fence of the 14 router/app skills under `bash -e` against real binaries (subset via `CRAFT_RECIPE_APPS`); the 4 workflow skills only with the extra `CRAFT_WORKFLOW_E2E=1` (X3), plus the wrong-duration gate run (X2). |
| `skills.test.ts` | Skill lint: 14 router/app skills + 4 workflow skills (workflow lint E2–E15: step Output/Gate, verify/check fences, delivery gate, resume, soft refs, retry cap, drift union; executed `check:` snippets E8/E9), frontmatter/description, required sections, 2–4 recipes, every recipe ends with `pi-craft verify`, offline id drift vs fixtures, filmcraft playhead trap, pdfcraft `tools` dialect (`CRAFT_SKILLS` subset). |
| `verify.test.ts` | `pi-craft verify`: arg parsing (exit 2), missing file/tool (exit 1/3), generated ffmpeg fixtures (duration, streams, size, fps, codec, ProRes alpha, loudness/peak/silence, frame-diff overlay), PDF via stub pdfcraft, `--json` shape. |
