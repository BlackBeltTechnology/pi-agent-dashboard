# DOX — packages/photocraft

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `.gitignore` | Ignores `dist/` (esbuild output, built by `prepack`). |
| `.pi/skills/photocraft/SKILL.md` | Skill. Headless PhotoCraft editing, discovery-first (`commands --filter/--json`, `info`, `run`, `batch`), bash vs MCP route, one-`--out` rule, MCP project-trust + start-in-root + sequential calls + path-root rules, `replace-region` guidance (`--mask crop` vs `selection`), recipes with `pi-nano-banana` (replace part, remove object via `edit.contentAwareFill`, insert asset, background swap, batch export). |
| `README.md` | Install, CLI table, exit codes, env vars (`PHOTOCRAFT_VERSION/BIN/HOME`, `GITHUB_TOKEN`), platform table, security notes (checksum = integrity not authenticity; high-assurance path). |
| `bin/pi-photocraft` | Plain-JS extensionless launcher. Checkout: tsx + `src/bin/photocraft.ts`; install: `node dist/photocraft.js`; else exit 1 naming the build. Passes args, stdio, exit code, SIGINT/SIGTERM. Fixes raw-TS bin failing from a shell. See change: add-photocraft-plugin. |
| `package.json` | Manifest. Name `@blackbelt-technology/pi-dashboard-photocraft`. `pi.skills` → `.pi/skills/photocraft`; bin `pi-photocraft` → `bin/pi-photocraft`; `files` incl `bin/ dist/ src/`; `prepack` builds `dist`. deps nano-banana + shared; devDeps esbuild + tsx. |
| `scripts/build.mjs` | esbuild bundle `src/bin/photocraft.ts` → `dist/photocraft.js` (ESM, node20). Bundles `@blackbelt-technology/*` raw-TS workspace code; explicit empty `external`. Run by `prepack`. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`; `types: ["node"]`, rootDir src. |
| `vitest.config.ts` | Vitest config. Forks pool, `PARALLEL_MAX_WORKERS`, HOME tripwire (`setup-home.ts` globalSetup + `setup-home-perfile.ts`). |
