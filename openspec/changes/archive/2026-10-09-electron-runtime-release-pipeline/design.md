## Context

Consumer side (change `electron-runtime-overlay-updates`, design D1/D5) expects: `runtime-lock.json` inside `pi-dashboard-server@X`; npm `beta` dist-tag for prereleases; a GitHub Release `vX` with `pi-dashboard-runtime-<X>-<platform>-<arch>.tgz` + `.sha512` (`githubAssetName` in `packages/server/src/runtime-overlay/runtime-io.ts`). Publishing uses `.github/workflows/publish.yml`: per-package idempotent loop, npm Trusted Publisher (OIDC), sub-packages first, root metapackage last.

## Goals / Non-Goals

- Goal: every release X is installable by the overlay stager from npm and GitHub.
- Goal: a release with an unpublished bundled plugin fails loudly instead of shipping an uninstallable lock.
- Non-goal: changing consumer behaviour, the whole-app `electron-updater` path, or Standalone installs.

## Decisions

### R1. Lock generation
Generate from `packages/server/package.json#piDashboard.bundledPlugins` (via `readBundledPluginIds`) plus the fixed runtime package set, all at X, into a temp root; `npm install --package-lock-only`; copy the lock into the server package before `npm publish`. `packages/server` depends on only one plugin, so every plugin is listed explicitly.
- **Self-reference (resolved)**: the lock ships inside server@X, so it cannot carry server@X's own integrity. Server is packed locally (`npm pack --workspace`) and added as a `file:` tarball; after generation its entry is rewritten to the registry `resolved` URL (`https://registry.npmjs.org/<scope>/<name>/-/<name>-X.tgz`, host rewritten by npm's default `replace-registry-host`) with no `integrity`, and the root dependency spec becomes `X`. Every other entry keeps registry integrity.
- **Meta dropped (resolved)**: `pi-agent-dashboard` is not in the lock. The overlay reads only server/web/extension (`compat.ts`); meta would be a second integrity-less entry.
- **npm 12 quirk (spike)**: `npm install --package-lock-only` on npm 12.0.2 fails `EALLOWREMOTE` on `@tailwindcss/oxide-wasm32-wasi` (a bundleDependencies package); generation passes `--allow-remote=all`. `npm ci` from the lock is unaffected.

### R2. Ordering
publish packages → registry gate (`npm view <name>@X version`, retry for propagation) → attach lock-dependent artifacts (GitHub asset) → mark release ready. The lock itself rides in the server tarball, so the gate must also fail the release before it is marked ready / promoted to `latest`/`beta`.
- **Resolved — reorder, no staging tag.** npm Trusted Publishing (OIDC) authorizes `npm publish` only; `npm dist-tag add` would need a long-lived `NPM_TOKEN`, so `--tag staging` + promote is rejected. Only the meta package depends on the server, so the publish loop runs: every package except server + meta → bundled-plugin gate → lock generation → server (carrying the lock) → meta. A gate miss stops before server@X exists: the consumer-visible server dist-tags never move and no lock naming a missing plugin is ever published. Other packages at X may already be public; they are not lock-dependent.

### R4. Channels (resolved)
Prereleases publish with `--tag beta` (was `next`; the consumer checker reads `beta`). GitHub prereleases keep `draft: true` (ci-cd-pipeline spec unchanged): the runtime asset is attached to the draft and becomes visible to the GitHub beta channel when a maintainer publishes it.

### R3. GitHub asset
Built per platform/arch by running the consumer's own install path (`npm ci --omit=dev` from the lock + plugin materialization), tarred, sha512 written alongside. Spike 1.1 decides whether one platform-independent asset suffices.
- **As built**: a separate `runtime-asset` matrix job in `publish.yml` (needs `publish`), not a step in `_electron-build.yml`, so `ci-electron.yml` / nightly stay side-effect-free. `scripts/build-runtime-asset.mjs` imports the consumer `stageRuntime` itself (npm source). Native runners only: darwin-arm64/x64, linux-x64/arm64, win32-x64. win32-arm64 is excluded because that leg cross-builds on x64 and npm would pick x64 native optionals; GitHub-source updates there 404 and the user picks npm. Artifact `electron-runtime-<platform>-<arch>` is attached by `github-release`'s `electron-*/**/*` glob. Dry run (0.8.0, macOS arm64): 228 MiB asset; consumer `stageRuntime` github path (`safeMembers`, sha512, lockstep, 14 plugins) accepts it.
- **Release blocker to clear first**: gmail-plugin, mcp-client-plugin, browser-plugin, chat-gateway-plugin and system-one-plugin have never been published to npm. The gate fails every release until each gets a first publish plus a Trusted Publisher config.

### R5. E2E registry fixture (as built)
`scripts/runtime-e2e-registry.mjs` publishes the runtime closure to a throwaway Verdaccio from `npm pack` tarballs with rewritten versions; the working tree stays untouched. Releases: base (app version, feeds `bundle-server.mjs`), good (`latest`, with the lock), broken (`broken` tag, server exits at boot). The server is published last, with its lock generated via `--server-dir`. New job `runtime-overlay-e2e` in `ci-e2e-electron.yml` (linux-x64, bundled-server package). Local run (macOS arm64, installed 0.8.0 app, good 0.8.1 / broken 0.8.2): X11 26 s, X10 1 s, X12 45 s — all pass. Findings folded into the spec:
- health reports `origin: "overlay"`, not the source name;
- the bundled extension registers as `<resources>/server/packages/extension`;
- a native dialog after a failed switch blocks `app.close()`, so teardown is bounded.

### R6. Verified against the published 0.9.0
Run from a temporary checkout of v0.9.0 with this change's scripts:
- The registry gate passes: all 21 bundled plugins resolve at 0.9.0.
- The lock generates (1140 packages, 25 pinned at 0.9.0).
- The stager + asset build produce 202 MiB with manifest 0.9.0 and 21 plugins.
- Finding: the server depends on `xlsx` via a URL tarball (cdn.sheetjs.com). npm 12 defaults `allow-remote=none` and `npm ci` refuses it. The consumer stager now passes `--allow-remote=all`; the lock pins integrity; npm 10 ignores the flag.

### R7. Plugin runtime deps at the lock root (task 2.6)
Materialized plugins ship without `node_modules`, so a dependency nested under a plugin package is lost. The generator adds the union of bundled plugins' third-party `dependencies` to the lock root, following bundle-plugin-third-party-deps D1/D3:
- Every declaration must use an identical specifier across plugins and the server-side workspaces (server, shared, extension, plugin-runtime); otherwise generation fails.
- `web` is excluded from that check: it is a Vite bundle, and its `yaml ^2.6.1` would otherwise conflict.
- Non-registry specifiers fail generation.
- `finalizeRuntimeLock` requires each dep at `node_modules/<dep>`.

Today's tree yields 12 deps. Verified against published 0.9.0: after staging, all 35 plugin→dep edges across 21 plugins resolve inside the runtime root `node_modules`.

## Risks / Trade-offs

- Registry propagation delay → retries with backoff, bounded.
- npm versions are immutable → the gate must run before dist-tags move (R2 open item).

## Open Questions

1. **Resolved (spike 1.1, macOS arm64 only; linux/win32 hosts unavailable): per-platform assets required.** Lock over server/web/extension/plugin-runtime + 14 plugins at 0.8.0 → 1268 entries, lockfile v3. `npm ci --omit=dev` (npm 11.20 and 12.0.2) installs host-only optional native packages: `@esbuild/darwin-arm64`, `lightningcss-darwin-arm64`, `@rollup/rollup-darwin-arm64`, `@napi-rs/canvas-darwin-arm64`, `@napi-rs/keyring-darwin-arm64`, `@koromix/koffi-darwin-arm64`, `@tailwindcss/oxide-darwin-arm64`, `fsevents`. A tree copied to linux/win32 lacks their binaries → one platform-independent asset cannot work. `githubAssetName` stays per `<platform>-<arch>`. The only symlinks are the 74 under `node_modules/.bin`. The consumer extractor refuses link members, so the asset build prunes `.bin` symlinks. Side finding: 5 of 19 bundled plugins (gmail, mcp-client, browser, chat-gateway, system-one) are absent from npm at 0.8.0, which is exactly the case the R2 gate catches.
2. **Resolved**: R2 reorder (above).
