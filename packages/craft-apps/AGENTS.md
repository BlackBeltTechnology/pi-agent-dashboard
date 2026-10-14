# DOX — packages/craft-apps

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `.gitignore` | Ignores `dist/` (esbuild output, built by `prepack`). |
| `.pi/skills/craft-studio/SKILL.md` | Router skill. App-selection table (13 apps), hand-off formats (wav/aiff, mov ProRes 4444 alpha, mp4 h264/aac, png/tiff, svg/pdf), the plan→discover→execute→save→verify loop, bash vs MCP route, confinement + tool-budget (`--compact`) policy, GUI bridging out of scope; recipe `tone-roundtrip`. |
| `.pi/skills/photocraft/SKILL.md` | Skill. Headless PhotoCraft editing, discovery-first, one-`--out` rule, selection-lives-in-one-run, `select.object` trap, MCP project-trust + root rules, `replace-region` guidance (`--mask crop` vs `selection`); recipes `resize-grade`, `remove-region`, `crop-export`. Moved from the former `packages/photocraft`. |
| `.pi/skills/filmcraft/SKILL.md` | Skill. FilmCraft dialect (`exec` twice, `--project/--save/--save-as`, `run script.jsonl --keep-going`), the playhead trap (`source.overwrite`/`source.insert` land at the current playhead → `playhead.set`), source monitor not persisted; recipes `assemble-two-clips`, `place-at-explicit-time`, `insert-and-range-export`, `typo-fails-loudly`. |
| `.pi/skills/soundcraft/SKILL.md` | Skill. SoundCraft `run --cmd … --bounce`, `.scraft` session persistence, selection + absolute-gain traps, mono −3 dB bounce, normalise; recipes `gain-bounce-loudness`, `fade-in-out`, `mix-two-tones-and-save`, `normalise-bounce`. |
| `.pi/skills/effectcraft/SKILL.md` | Skill. EffectCraft comps/text/keys, `--save` persistence, ProRes 4444 alpha needs `--channels rgba`, `render-frame --transparent`, JS `script`; recipes `title-alpha`, `still-frame`, `mp4-resume`, `script-comp`. |
| `.pi/skills/lightcraft/SKILL.md` | Skill. LightCraft `render IN -o OUT --set …`, `run` command route, controls/presets/merge, silent clamping of `--set`; recipes `develop-export`, `bw-preset`, `run-export`, `dng-develop`. |
| `.pi/skills/vectorcraft/SKILL.md` | Skill. VectorCraft `run --cmd ID --params JSON --export`, style-on-selection, `convert --scale`; recipes `draw-export`, `restyle-saved`, `convert-svg`, `text-pdf`. |
| `.pi/skills/figcraft/SKILL.md` | Skill. FigCraft JSON-lines `run` scripts, node parents/ids, `--node/--scale` export; recipes `screen-export`, `restyle-pdf`, `svg-import`, `in-script-export`. |
| `.pi/skills/designcraft/SKILL.md` | Skill. DesignCraft `run`/`script`, 0-based `--page` vs 1-based pdf pages, option order before `--export`, spreads; recipes `brochure-script`, `reopen-subset`, `png-2x`, `sample-pdf`. |
| `.pi/skills/pdfcraft/SKILL.md` | Skill. PdfCraft discovery via `pdfcraft-cli tools` (no `commands`), stateless `run` vs `--script`, `--root` semantics, direct subcommands; recipes `combine-extract`, `rotate-delete`, `render-page`, `script-stamp`. |
| `.pi/skills/wordcraft/SKILL.md` | Skill. WordCraft `run --file … --cmd id={json} --save`, `convert`/`render`/`text`/`inspect`, no `--filter`; recipes `report-pdf`, `two-pages`, `markdown-to-docx`, `append-and-render`. |
| `.pi/skills/deckcraft/SKILL.md` | Skill. DeckCraft positional `commands FILTER`, empty-deck start, 0-based `--slide`, `render --all`; recipes `deck-pdf`, `render-slide`, `add-slide-pdf`. |
| `.pi/skills/gridcraft/SKILL.md` | Skill. GridCraft `run --in --cmd id={json} --out`, `eval`/`cat`/`check`/`convert`, `--search` filter, PDF via `run --out x.pdf`; recipes `budget-table-pdf`, `eval-and-csv`, `recalc-after-edit`, `jsonl-script-sample`. |
| `.pi/skills/cadcraft/SKILL.md` | Skill. CADCraft `--cmd 'id {json}'` (space), default-JSON `commands`, fixed 2400×1600 png, no text in pdf/svg; recipes `rect-circle-pdf-png`, `dxf-conversions`, `layers-and-text`, `typed-script`. |
| `README.md` | Install, CLI table (`apps`, `status`, `install`, `<app> ensure/path/exec/mcp`, `verify`, `launcher`), MCP policy (6 confined / 7 unconfined, `--compact`), env vars (`<APP>_VERSION/BIN`, `CRAFT_HOME/SOURCE`, `PHOTOCRAFT_HOME`), sources, platforms, security notes. See change: add-craft-apps-core. |
| `bin/pi-craft` | Plain-JS extensionless launcher. Checkout: tsx + `src/bin/craft.ts`; install: `node dist/craft.js`; else exit 1 naming the build. Passes args, stdio, exit code, SIGINT/SIGTERM. See change: add-craft-apps-core. |
| `bin/pi-photocraft` | Same launcher for the `pi-photocraft` alias (`src/bin/photocraft.ts` / `dist/photocraft.js`). Path kept stable for `.pi/mcp.json` entries. See change: add-photocraft-plugin. |
| `package.json` | Manifest. Name `@blackbelt-technology/pi-dashboard-craft-apps`. `pi.skills` ×14, `pi.tools` ffmpeg/ffprobe optional; bins `pi-craft` + `pi-photocraft`; `exports` incl. `./package.json` + `./bin/*` (the photocraft shim resolves them); `prepack` builds `dist`. deps nano-banana + shared. See change: add-craft-apps-core. |
| `scripts/build.mjs` | esbuild bundles `src/bin/craft.ts` → `dist/craft.js` and `src/bin/photocraft.ts` → `dist/photocraft.js` (ESM, node20, `@blackbelt-technology/*` bundled). Run by `prepack`. |
| `scripts/record-fixtures.mjs` | Records `src/__tests__/fixtures/commands/<app>.json` (version, command ids, MCP tool names) from real provisioned binaries; run `node --import tsx` with `CRAFT_HOME`. See change: add-craft-apps-core. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`; `types: ["node"]`, rootDir src. |
| `vitest.config.ts` | Vitest config. Forks pool, `PARALLEL_MAX_WORKERS`, HOME tripwire (`setup-home.ts` globalSetup + `setup-home-perfile.ts`). |
