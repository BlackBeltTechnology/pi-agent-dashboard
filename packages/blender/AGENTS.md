# DOX — packages/blender

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `.pi/skills/blender/SKILL.md` | Skill `blender`. Headless Blender (bpy) for 3D modelling + GLB export: when to use, setup (`pi-blender ensure`, `mcp --register`), the 5 tools, build limits (no Subsurf/OpenSubdiv, no rendering, no USD/Alembic/X3D, no network/subprocess, ~1.2 GB/session), `sessionReset` = scene lost, GLB-first workflow, multi-file + `.gltf` re-import via `blender_python` + `inputs`, headless bpy idioms (`/in`, `/out`, link to `bpy.context.collection`, no UI ops), error codes. Checked by `src/__tests__/skills.test.ts`. See change: add-blender-wasm-mcp. |
| `README.md` | Install, CLI table, MCP registration + merge rules, env vars (`BLENDER_WASM_HOME/DIR/IDLE_SEC/MAX_INPUT_MB/MAX_OUTPUT_MB/E2E`), requirements (Node ≥ 24, ~1.2 GB/session, ~175 MB/version cache, manual cleanup, slow first call), trust + licence (upstream v0.0.x single maintainer, pinned sha512, GPL-3.0-or-later runtime fetched on demand, never bundled). See change: add-blender-wasm-mcp. |
| `bin/pi-blender` | Plain-JS extensionless launcher. Checkout: tsx + `src/bin/blender.ts`; install: `node dist/blender.js`; else exit 1 naming the build. Spawns the entry WITH an IPC channel: entry (and its Blender host) exit on `disconnect`, so SIGKILL of the launcher tears down every descendant. Passes args, stdio, exit code, SIGINT/SIGTERM. See change: add-blender-wasm-mcp. |
| `package.json` | Manifest. Name `@blackbelt-technology/pi-dashboard-blender`. `pi.skills` ×1, bin `pi-blender`, `exports` incl. `./package.json` + `./bin/*`; `files` ships `bin/ dist/ src/` minus tests/AGENTS; `prepack` builds `dist`. Only dep: shared (bundled by esbuild). See change: add-blender-wasm-mcp. |
| `scripts/build.mjs` | esbuild bundles `src/bin/blender.ts` → `dist/blender.js` and `src/host/host.ts` → `dist/host.js` (ESM, node20, shebang + `createRequire` banner, workspace code bundled, `external: []`); copies `src/host/worker-boot.cjs` → `dist/worker-boot.cjs` verbatim. Run by `prepack`. See change: add-blender-wasm-mcp. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`; `types: ["node"]`, rootDir `src`, includes tests. |
| `vitest.config.ts` | Vitest config. Forks pool, `PARALLEL_MAX_WORKERS`, 30 s timeout, HOME tripwire (`setup-home.ts` globalSetup + `setup-home-perfile.ts`). Real-runtime suites self-gate on `BLENDER_WASM_E2E=1`. |
