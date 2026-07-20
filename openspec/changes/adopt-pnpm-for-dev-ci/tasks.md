# Tasks — adopt pnpm for dev + CI

Ordered, reversible phases (design.md §D6). Each phase ends green before the next.
`pnpm` runs verified on 11.15.1; pin it. Do NOT touch Column C runtime npm.

## 1. Preflight + guardrails

- [ ] 1.1 Pin the toolchain: add `"packageManager": "pnpm@11.15.1"` to root
      `package.json`; document `corepack enable` as the dev prereq (README).
- [ ] 1.2 Inventory the npm-survivor call sites that MUST stay npm and add a guard
      test/comment so the migration can't rewrite them (EXACT paths — verified):
      `packages/server/src/pi/pi-core-updater.ts`,
      `packages/server/src/pi/pi-core-checker.ts`,
      `packages/server/src/lifecycle/recovery-server.ts`,
      `packages/electron/src/lib/update-checker.ts`; the `npm publish` step in
      `.github/workflows/publish.yml`. (doubt-review: flat `packages/server/src/*.ts`
      paths were WRONG — a guard against them is false-green.)

## 2. pnpm-workspace.yaml config (design.md §D2)

- [ ] 2.1 Write `pnpm-workspace.yaml`: `packages:['packages/*']`, `nodeLinker: hoisted`,
      `verifyDepsBeforeRun: false`, `blockExoticSubdeps: false`,
      `linkWorkspacePackages: true`, `preferWorkspacePackages: true`,
      `confirmModulesPurge: false`,
      `onlyBuiltDependencies:[node-pty,esbuild,sharp,electron]`.
- [ ] 2.2 Keep root `.npmrc` `engine-strict=true`; confirm pnpm honors `engines.node`.

## 3. Workspace phantom-dep declarations (design.md §D3) — all `^0.6.0`

- [ ] 3.1 `packages/client-utils/package.json` `dependencies` += `@blackbelt-technology/dashboard-plugin-runtime`
- [ ] 3.2 `packages/demo-plugin/package.json` `dependencies` += `@blackbelt-technology/dashboard-plugin-runtime`
- [ ] 3.3 `packages/flows-anthropic-bridge-plugin/package.json` `dependencies` += `@blackbelt-technology/dashboard-plugin-runtime`
- [ ] 3.4 `packages/dashboard-plugin-skill/package.json` `devDependencies` += `@blackbelt-technology/dashboard-plugin-runtime` (type-only import)
- [ ] 3.5 `packages/client/package.json` `dependencies` += `pi-dashboard-automation-plugin`, `pi-dashboard-flows-anthropic-bridge-plugin`, `pi-dashboard-kb-plugin`, `pi-dashboard-roles-plugin`
- [ ] 3.6 `packages/client/package.json` `devDependencies` += `@blackbelt-technology/demo-plugin` (test-only import)

## 4. bundle-server.mjs fix (design.md §D4)

- [ ] 4.1 Add a `node_modules`-excluding filter to EVERY `cpSync` that copies a
      workspace/plugin package tree in `packages/electron/scripts/bundle-server.mjs`
      — verified: the workspace loop (~L89), the first-party plugin loop (~L134),
      the web-pkg materialization (~L515), AND the symlink-materialization copy
      (~L483, `dereference:true`); NOT the dist-only client copies (~L154, ~L519)
      nor the launch-helper file copy (~L219). Use a Windows-safe split
      (`src.split(/[\\/]/).includes("node_modules")`, NOT `path.sep` — forge's
      win32 leg is where the node-pty GO/NO-GO is load-bearing). NOTE this is NOT
      a no-op under npm (`packages/server/node_modules`≈288K,
      `packages/extension/node_modules`≈808K) — it forces a clean re-resolve
      (intended); re-verify the npm-path bundle still builds.
- [ ] 4.2 Add the native-maker rebuild to the electron build path:
      `pnpm rebuild macos-alias fs-xattr` before `electron-forge make` (design.md §D5).

## 5. Local verification (must be green before CI)

- [ ] 5.1 `corepack enable && pnpm install` completes; root `node_modules` flat.
- [ ] 5.2 `pnpm -r --filter '!@blackbelt-technology/pi-dashboard-web' run build` exit 0.
- [ ] 5.3 `pnpm --filter @blackbelt-technology/pi-dashboard-web run build` → 5264+
      modules, fresh `packages/client/dist/index.html`, no `Rollup failed to resolve`.
- [ ] 5.4 `node packages/electron/scripts/bundle-server.mjs` exit 0 with all 6
      node-pty prebuild triples present.
- [ ] 5.5 `pnpm --filter @blackbelt-technology/pi-dashboard-electron exec electron-forge package`
      → `out/**/PI-Dashboard.app` containing `Contents/Resources/server` + node-pty prebuilds.

## 6. CI migration (`.github/workflows/`) — ALL 6 workflows

- [ ] 6.1 Flip `actions/setup-node` `cache: npm` → `pnpm/action-setup` + `cache: pnpm`
      in the ROOT/workspace workflows: `ci.yml`, `publish.yml`, `_electron-build.yml`,
      `ci-e2e-electron.yml`, `_smoke.yml`. **EXCEPTION — `deploy-site.yml` is
      DUAL-install:** its `site/` job (L52 `working-directory: site`, L59-60
      `cache: npm` + `cache-dependency-path: site/package-lock.json`, L63 `npm ci`)
      installs the SEPARATE `@blackbelt-technology/pi-dashboard-site` (`site/` is
      NOT in `workspaces:['packages/*']`; own `site/package-lock.json`). That job
      STAYS npm. Flip ONLY the root job (L86-87). Migrating `site/` to pnpm = out of scope.
- [ ] 6.2 Replace every ROOT/workspace `npm ci` with `pnpm install --frozen-lockfile`
      — `publish.yml` (`ci-checks` L101, `tag-and-push` L143, `publish` L261),
      `_electron-build.yml` L127, `deploy-site.yml` L87 (root only, NOT L63).
      **Preserve the `--engine-strict=false` override** on `_smoke.yml` L74/L110
      (transitive appdmg engine range fail-fasts on Node 24/25 under root
      `.npmrc engine-strict=true`) — pnpm: `--config.engine-strict=false` /
      `npm_config_engine_strict=false`. Dropping it reds the release-gate smoke legs.
- [ ] 6.3 Replace `npm install --package-lock-only` lockfile-regen with
      `pnpm install --lockfile-only` in BOTH `publish.yml` (L170) AND
      `_electron-build.yml` (L181) — the electron build regenerates too.
- [ ] 6.4 Replace `npm run -w <pkg> …` / `npm run …` with `pnpm --filter`/`pnpm run`.
- [ ] 6.5 Delete the `rm -f package-lock.json` #4828 workaround wherever it appears,
      INCLUDING the Windows PowerShell variant
      `Remove-Item -Recurse -Force node_modules, package-lock.json` in
      `ci-e2e-electron.yml` (L58, L128, both jobs).
- [ ] 6.6 Rewrite `scripts/verify-lockfile-versions.mjs` to parse `pnpm-lock.yaml`
      (YAML `importers`/`packages` map) instead of `JSON.parse(package-lock.json)`
      — it runs in BOTH publish.yml and _electron-build.yml (L185). This is a
      rewrite, not a tweak.

## 7. Docker migration

- [ ] 7.1 `docker/Dockerfile`: `corepack enable`; `COPY pnpm-lock.yaml pnpm-workspace.yaml`;
      `pnpm install --frozen-lockfile && pnpm run build`; drop the web-client
      `rm -f package-lock.json && npm install` hack.
- [ ] 7.2 Keep global tool installs (`npm install -g @earendil-works/pi-coding-agent …`)
      as npm — those are Column C-style user installs.

## 8. Publish job (design.md §D1) — pnpm install, npm publish

- [ ] 8.1 `publish.yml`: `pnpm install --frozen-lockfile` + `pnpm run build`;
      keep the per-package `npm publish --provenance` loop (OIDC unchanged).
- [ ] 8.2 (Lockfile-regen + verify-lockfile moved to §6.3/§6.6 — they span both
      publish and electron-build; keep them workflow-wide, not publish-only.)
- [ ] 8.3 Drop the `npm install -g npm@11.12.1` pin ONLY AFTER §6.2 removes EVERY
      `npm ci` from the flow. The pin guards npm's EALLOWGIT; `blockExoticSubdeps:false`
      is pnpm-only and does NOTHING for a surviving `npm ci`. Dropping it early
      reds the `ci-checks` release gate. Sequence: §6.2 → then §8.3.

## 9. Lockfile swap (point of no easy return — GATED on §5 AND a green ci-electron run)

- [ ] 9.1 **Gate:** do NOT delete `package-lock.json` until a full `ci-electron.yml`
      run of the swap branch is GREEN (test-plan #X4). Rationale: the release graph
      is `publish → electron → github-release`; `publish` runs `npm publish
      --provenance` (IRREVERSIBLE — unpublish blocked >72h) and the installer build
      runs AFTER it. A swap that breaks the installer layer strands every release
      (npm out, no installers, no GitHub Release) — and can't be caught by a real
      release because publish already happened. `ci-electron.yml`/`ci-smoke.yml`
      delegate to the SAME `_electron-build.yml` (6-tuple matrix, native runners)
      with NO npm publish, so an on-demand green run proves the release path safely.
      A local `electron-forge package` (spike-proven) is necessary-not-sufficient:
      the release also runs `.deb` (forge make), DMG/AppImage/NSIS (electron-builder),
      and the `latest*.yml` update-metadata that `github-release` hard-asserts.
- [ ] 9.2 `git rm package-lock.json`; commit `pnpm-lock.yaml`.
- [ ] 9.3 Ensure `bundle-server.mjs`'s internal `npm install` uses
      `--no-package-lock` so it does not write a stray `package-lock.json` into
      `resources/server/` (second-lockfile leak).
- [ ] 9.4 Update `.pi/settings.json` `worktreeInit` hook `(npm ci || npm install)` →
      `corepack enable && pnpm install`.

## 10. Docs + skills

- [ ] 10.1 Update `README.md` + `docs/architecture.md` (commands, prereqs) via DocScribe (caveman style).
- [ ] 10.2 Update skills/scripts that hard-code npm lockfile ops:
      **`release-cut`** (`.pi/skills/release-cut/SKILL.md`): the PRIMARY release
      trigger — L166-206 (`npm version -ws` + `npm install --package-lock-only` +
      `git add package-lock.json`; untouched it commits a 2nd lockfile or fails the
      frozen install), the operator pre-flight L56 `npm test` / L61 `npm run build`,
      AND the triage row L301 ("publish job PINS `npm@11.12.1`") which §8.3 makes
      stale. Also `ci-troubleshoot`, `ship-change`, `ship-it`, `release-pipeline`,
      and `scripts/sync-versions.js` L145-147 (the full 3-line message block:
      `package-lock.json`, the relocated `publish.yml > prepare` job name, and
      `npm install --package-lock-only`) — all stale post-migration, not just L147.
- [ ] 10.3 Add directory-`AGENTS.md` rows for the new `pnpm-workspace.yaml` +
      the bundle-server.mjs change (`See change: adopt-pnpm-for-dev-ci`).
- [ ] 10.4 Add an early validation task: assert `blockExoticSubdeps`,
      `verifyDepsBeforeRun`, `preferWorkspacePackages`, `confirmModulesPurge` are
      honored by the PINNED pnpm (11.15.1) before rollout — a fresh
      `pnpm install` in a scratch dir that FAILS if the git subdep is refused
      (proves `blockExoticSubdeps:false` is a real, active key, not silently
      masked by `nodeLinker:hoisted`).

## Tests / Validate

<!-- folded from test-plan.md; 16/16 automated, 0 manual-only. Each row: exemplar + (input·trigger·observable) Triple + (test-plan #id). -->

- [ ] E1 (test-plan #E1) L2 qa smoke — pnpm links local workspace pkg ahead of registry. input: repo where local dashboard-plugin-runtime (0.6.x) > registry (0.5.4), specifier ^0.6.x · trigger: `pnpm install` · observable: node_modules/@blackbelt-technology/dashboard-plugin-runtime resolves to local packages/… (workspace link), not a registry tarball; exit 0; no ERR_PNPM_NO_MATCHING_VERSION. Exemplar: `qa/tests/01-install.sh`.
- [ ] E2 (test-plan #E2) L2 qa smoke — git subdep allowed. input: pnpm-workspace.yaml blockExoticSubdeps:false · trigger: pnpm install resolving @electron/node-gyp (git) · observable: exit 0, dep present via HTTPS codeload, no ERR_PNPM_EXOTIC_SUBDEP. Exemplar: `qa/tests/01-install.sh`.
- [ ] E3 (test-plan #E3) L2 qa smoke — config-key validity (falsify). input: pnpm-workspace.yaml with blockExoticSubdeps REMOVED, pinned pnpm 11.15.1 · trigger: pnpm install · observable: FAILS with ERR_PNPM_EXOTIC_SUBDEP (proves key active, not masked by nodeLinker). Exemplar: `qa/tests/01-install.sh` (negative).
- [ ] E4 (test-plan #E4) L1 vitest — single lockfile hygiene. input: repo tree · trigger: assertion · observable: pnpm-lock.yaml present AND package-lock.json absent (root); no stray lockfile in resources/server. Exemplar: `packages/shared/src/__tests__/publish-workflow-contract.test.ts`.
- [ ] E5 (test-plan #E5) electron — bundled node-pty prebuilds. input: pnpm monorepo nodeLinker:hoisted · trigger: node bundle-server.mjs · observable: resources/server/node_modules/node-pty/prebuilds has all required triples; GO/NO-GO exit 0. Exemplar: `packages/electron/scripts/test-deb-install-inner.sh`.
- [ ] E6 (test-plan #E6) electron — cpSync filter regression (all loops). input: pnpm store symlinks in packages/*/node_modules · trigger: bundle-server.mjs loops ~L89/L134/L483/L515 · observable: no broken symlink copied into resources/server; node-pty install clean. Exemplar: `test-deb-install-inner.sh`.
- [ ] E7 (test-plan #E7) electron — electron-forge package. input: pnpm nodeLinker:hoisted, client dist built · trigger: electron-forge package · observable: out/**/PI-Dashboard.app with Contents/Resources/server/node_modules/node-pty/prebuilds. Exemplar: `.github/workflows/ci-electron.yml` (package job).
- [ ] E8 (test-plan #E8) electron win32 — Windows-safe cpSync filter. input: win32 leg (path.sep=\\) · trigger: bundle-server.mjs on Windows · observable: node-pty win32-x64 prebuild present (proves /[\\/]/ split, not path.sep). Exemplar: `.github/workflows/_electron-build.yml` (win32 matrix leg).
- [ ] X1 (test-plan #X1) L2 qa smoke — pnpm run build no crash. input: pnpm-workspace.yaml verifyDepsBeforeRun:false · trigger: pnpm -r build · observable: exit 0, no runDepsStatusCheck/execaCoreSync crash. Exemplar: `qa/tests/02-server-start.sh`.
- [ ] X2 (test-plan #X2) ci — publish preserves OIDC. input: prerelease rc tag, no NPM_TOKEN · trigger: publish workflow (pnpm install → npm publish --provenance) · observable: OIDC exchange succeeds, provenance attestation present, exit 0. Exemplar: `publish-workflow-contract.test.ts` (workflow shape) + a prerelease dry-run.
- [ ] X3 (test-plan #X3) L1 vitest — runtime-stays-npm guard. input: Column C files (server/src/pi/pi-core-updater.ts, pi/pi-core-checker.ts, lifecycle/recovery-server.ts, electron/src/lib/update-checker.ts) · trigger: guard greps package-manager token · observable: each invokes npm; FAILS if any rewritten to pnpm. Exemplar: `packages/shared/src/__tests__/no-bash-on-windows.test.ts` (source-grep contract).
- [ ] X4 (test-plan #X4, GATES §9) electron/ci — FULL installer matrix under pnpm via a real ci-electron.yml run. input: swap branch (pnpm config + `pnpm rebuild macos-alias fs-xattr`) · trigger: dispatch `ci-electron.yml` (→ `_electron-build.yml`, 6-tuple matrix, native runners, NO npm publish) · observable: every leg green — Linux .deb (forge make) + macOS DMG + Linux AppImage + Windows NSIS (electron-builder) all emitted, AND each `latest*.yml` update-metadata present so `github-release`'s per-installer assertion (publish.yml:545) would pass. Exemplar: `.github/workflows/ci-electron.yml` (delegates to `_electron-build.yml` = the release path). **§9 lockfile swap MUST NOT precede this going green** (publish is irreversible + runs before electron).
- [ ] X5 (test-plan #X5) ci — cache flip, no missing-lockfile error. input: package-lock.json deleted, setup-node cache:pnpm + pnpm/action-setup · trigger: migrated workflow run · observable: no "could not find package-lock.json"; install succeeds. Exemplar: `no-bash-on-windows.test.ts` (workflow shape) + CI dry-run.
- [ ] X6 (test-plan #X6) ci — deploy-site dual-install regression. input: deploy-site.yml post-migration · trigger: release:published · observable: site/ job runs npm ci vs site/package-lock.json (untouched), docs redeploys; root job pnpm. Exemplar: `publish-workflow-contract.test.ts` (assert site-job stays npm).
- [ ] X7 (test-plan #X7) ci — #4828 optionaldeps. input: pnpm install on linux CI · trigger: build · observable: no "Cannot find module @rollup/rollup-linux-x64-gnu" / lightningcss; rm -f package-lock hack gone. Exemplar: `.github/workflows/ci.yml` (linux build job).
- [ ] X8 (test-plan #X8) ci — smoke engine-strict override. input: _smoke.yml Node 24/25, root engine-strict=true · trigger: pnpm install --config.engine-strict=false · observable: no fail-fast on appdmg engine range; smoke legs green. Exemplar: `.github/workflows/_smoke.yml` (Node matrix legs).
