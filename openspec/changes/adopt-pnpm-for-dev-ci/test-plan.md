# Test Plan — adopt-pnpm-for-dev-ci

Stage: design   Generated: 2026-07-20

Scenarios derived from the `monorepo-workspace-structure` spec delta (R1 pnpm
layout / single lockfile / nodeLinker:hoisted; R2 package-manager role split;
R3 electron build compatibility) and hardened against the 2-cycle doubt review
(deploy-site dual-install, `_smoke` engine-strict, config-key validity, cpSync
loop coverage). No clarification gaps — every Triple fills from spec + spike
evidence.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 workspace linking | state | L2 | automated | repo where local `@blackbelt-technology/dashboard-plugin-runtime` (0.6.x) is AHEAD of the registry (0.5.4), specifier `^0.6.x` | `pnpm install` | `node_modules/@blackbelt-technology/dashboard-plugin-runtime` resolves to the local `packages/…` (workspace link), NOT a registry tarball; exit 0; no `ERR_PNPM_NO_MATCHING_VERSION` |
| E2 | R1 git subdep allowed | decision-table | L2 | automated | `pnpm-workspace.yaml` with `blockExoticSubdeps:false` | `pnpm install` resolving transitive git dep `@electron/node-gyp` | install exit 0; dep present (HTTPS codeload tarball); no `ERR_PNPM_EXOTIC_SUBDEP` |
| E3 | R1 config-key validity (falsify) | decision-table | L2 | automated | `pnpm-workspace.yaml` with `blockExoticSubdeps` REMOVED, pinned pnpm 11.15.1 | `pnpm install` | install FAILS with `ERR_PNPM_EXOTIC_SUBDEP` — proves the key is real+active, not silently masked by `nodeLinker:hoisted` |
| E4 | R1 single lockfile | state | L1 | automated | post-migration repo tree | repo-hygiene assertion | `pnpm-lock.yaml` present AND `package-lock.json` absent (root); no stray lockfile under `resources/server/` after bundle-server (`--no-package-lock`) |

### Frontend-quirk

_(none — this change has no rendered-UI surface.)_

### Performance

_(none — no latency/throughput budget in the spec.)_

### Electron / build

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E5 | R3 node-pty prebuilds | state | electron | automated | pnpm-installed monorepo (`nodeLinker:hoisted`) | `node packages/electron/scripts/bundle-server.mjs` | `resources/server/node_modules/node-pty/prebuilds` contains all required triples (darwin-arm64, darwin-x64, linux-x64, win32-x64); GO/NO-GO exit 0 |
| E6 | R3 cpSync filter (all loops) | state | electron | automated | pnpm `.pnpm` store symlinks in `packages/*/node_modules` | bundle-server.mjs (loops ~L89/L134/L483/L515) | no broken store-symlink copied into `resources/server`; node-pty install clean (regression guard for the filter) |
| E7 | R3 electron-forge package | state | electron | automated | pnpm + `nodeLinker:hoisted`, client `dist/` built | `electron-forge package` | `out/**/PI-Dashboard.app` containing `Contents/Resources/server/node_modules/node-pty/prebuilds` |
| E8 | R3 Windows-safe filter | BVA (win32 leg) | electron | automated | win32 build leg (`path.sep` = `\`) | bundle-server.mjs on Windows | node-pty `win32-x64` prebuild present in the bundle (proves `/[\\/]/` split, not `path.sep`) |

### Error-handling

| id | requirement | technique | level | disposition | fault / input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------------|---------|---------------------|
| X1 | R1 pnpm run build | state-transition (falsify) | L2 | automated | `pnpm-workspace.yaml` with `verifyDepsBeforeRun:false` | `pnpm -r build` | exit 0; no `runDepsStatusCheck`/`execaCoreSync` crash (without the key it crashes) |
| X2 | R2 publish preserves OIDC | fault-injection (no-token) | ci | automated | prerelease `rc` tag; no `NPM_TOKEN` secret | publish workflow (`pnpm install --frozen-lockfile` → build → `npm publish --provenance`) | OIDC token exchange succeeds; provenance attestation present on the published package; exit 0 |
| X3 | R2 runtime stays npm (guard) | state (falsify) | L1 | automated | Column C files: `packages/server/src/pi/pi-core-updater.ts`, `…/pi/pi-core-checker.ts`, `…/lifecycle/recovery-server.ts`, `packages/electron/src/lib/update-checker.ts` | guard test greps for the package-manager token | each invokes `npm`; test FAILS if any is rewritten to `pnpm` (guards the flat-path false-green) |
| X4 | R3 electron-forge make (installers) | state | electron | automated | after `pnpm rebuild macos-alias fs-xattr` | `electron-forge make` | DMG/deb/appimage emitted AND `github-release` per-installer update-metadata assertion passes (GATES §9 lockfile swap — first verification of this path) |
| X5 | R1 CI cache flip | fault-injection (missing lockfile) | ci | automated | `package-lock.json` deleted; `setup-node` flipped to `cache: pnpm` + `pnpm/action-setup` | any migrated workflow run | no "could not find package-lock.json" error; install succeeds |
| X6 | R2 deploy-site dual-install | state (regression) | ci | automated | `deploy-site.yml` post-migration | `release: published` | `site/` job still runs `npm ci` against `site/package-lock.json` (untouched); docs site redeploys; root job uses pnpm |
| X7 | R1 #4828 optionaldeps | fault-injection (cross-platform) | ci | automated | pnpm install on a linux CI runner | build | no `Cannot find module @rollup/rollup-linux-x64-gnu` / `lightningcss-*`; the `rm -f package-lock.json` hack is gone |
| X8 | R1 smoke engine-strict | BVA (Node 24/25) | ci | automated | `_smoke.yml` on Node 24/25, root `.npmrc engine-strict=true` | `pnpm install --config.engine-strict=false` | no fail-fast on the transitive appdmg engine range; smoke legs green (release gate) |

---

## Coverage summary

- Requirements covered: 3/3 (R1, R2, R3)
- Scenarios by class: edge 4 · perf 0 · frontend 0 · error 8 · electron/build 4
- Scenarios by level: L1 2 (E4, X3) · L2 3 (E1, E2, E3, X1) · electron 5 (E5, E6, E7, E8, X4) · ci 5 (X2, X5, X6, X7, X8)
- Scenarios by disposition: automated 16 · manual-only 0

## New infra needed

- none — L1 (vitest), electron (`ci-electron.yml`/`_electron-build.yml`), and ci
  (workflow-level assertions) tiers all exist. X4 (`electron-forge make`) is the
  first exercise of the installer path under pnpm but reuses the electron tier.
