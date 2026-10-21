## Context

See proposal.md (Why). Current state:

- **Bundle install.** `bundle-server.mjs` writes a synthetic root `package.json`, `{ name: "pi-dashboard-bundled-server", private, workspaces: packages/<BUNDLED_WORKSPACE_PKGS>, dependencies: <bundled plugins' third-party union> }` (`packages/electron/scripts/bundle-server.mjs:112-126` for the workspace set, `:203-245` for the root). It then runs `npm install --omit=dev --no-audit --no-fund --no-package-lock` through `spawnSync` without checking its exit status (`:346-366`). Post-install gates and steps follow:
  - node-pty prebuilds `:367-398`;
  - koffi `:400-435`;
  - bundled git `:437-471`;
  - workspace symlink materialization `:500-545`;
  - `pi-dashboard-web` materialization from local `packages/client` `:549-606`;
  - spawn-helper `+x` `:609-621`;
  - quarantine strip `:623-640`;
  - `runtime-manifest.json` `:642`, `:679-697`;
  - `.bundle-stamp` `:648-665`.

  `BUNDLED_WORKSPACE_PKGS` includes `mcp-client-plugin` and `mcp-server-plugin`, which are also `piDashboard.bundledPlugins`. The other bundled plugins ship only under `resources/plugins/<id>/`.
- **Overlay install.** The stager writes `runtime-lock.json` as `package-lock.json` and runs `npm ci --omit=dev --no-audit --no-fund --allow-remote=all` (`packages/server/src/runtime-overlay/runtime-stager.ts:69-78`, `:186-205`).
- **The lock.** `scripts/generate-runtime-lock.mjs` (publish job, `publish.yml:424-430`) builds it by `npm install --package-lock-only` over a root named `pi-dashboard-runtime`. That root pins server, `pi-dashboard-web`, extension, dashboard-plugin-runtime and every `bundledPlugins` package at X (`scripts/lib/runtime-release.mjs:29-34`, `:115-119`), plus the plugins' third-party union. The `pi-dashboard-web` pin pulls the client's runtime-declared closure into the lock (react, monaco-editor, mermaid, …), although the client is consumed only as compiled `dist/`. **No published server version carries a lock yet** (`server@0.9.0`, `0.8.0` sampled), so the first release after merge is the first with one.
- **What `npm ci` checks** (measured by the review on npm 10.9.9 and 12.0.2 with a workspace + lock fixture):
  - it **fails** on a missing workspace link entry, a third-party version outside the root range, or a tampered `integrity`;
  - it **passes** on a workspace entry whose `version`, `dependencies` or `peerDependencies` disagree with the manifest, and on a third-party entry with **no** `integrity` (installed unverified);
  - it silently prunes entries unreachable from the root.
- **Callers of `_electron-build.yml`:**
  - `publish.yml:549-568`;
  - `ci-electron.yml:113-125`;
  - `nightly.yml:171-182` (Verdaccio `registry_url`, env passthrough per `nightly-verification`).

  The bundle step's only env is `GIT_TARGET_ARCH`. `TARGET_ARCH` is never set in CI; win32-arm64 runs the bundle on x64 Node, so npm resolves x64 optional packages. The version is stamped into the workspace manifests before the bundle step (`_electron-build.yml:227`). On nightly, each leg starts its own Verdaccio and publishes the working tree to it with `scripts/nightly-verdaccio-publish.mjs` (topological order, no runtime lock) before the bundle step (`_electron-build.yml:288-318`).
- **Constraints.** The launcher resolves the bundled extension at `resources/server/packages/extension` (`packages/electron/src/lib/runtime-overlay.ts:49-53`). The `electron-build-pipeline` scenario "Synthetic root carries the bundled-plugin dependency union" fixes the synthetic root's `dependencies`.

## Goals / Non-Goals

**Goals:**
- A release installer for X carries only third-party package versions X's runtime lock pins, each verified against the lock's `integrity`. No first-party package comes from the registry. Otherwise the release build fails.
- Bundle layout, launcher, synthetic `package.json` and every post-install gate stay unchanged.
- The release path is exercised on all six electron legs before a real release depends on it.

**Non-Goals:**
- Pinning PR, develop or on-demand (`ci-electron.yml`) bundles (user decision).
- Changing how the overlay or the runtime lock is produced, including the web closure in the lock.
- npm 12 `allow-remote`. `fix-npm12-remote-tarball-install` removes the URL-tarball dependency at its source.
- The overlay stager's lack of target-arch handling on win32-arm64.

## Decisions

### D1. A boolean release-lock input; the version comes from `version`; release mode is asserted on every release run
- `_electron-build.yml` gains `release_lock` (boolean, default `false`). When it is true, every leg's bundle step appends `--release-lock=${{ inputs.version }}`, using the same conditional-expression pattern `:368` uses for `--source-only`. The version is the workflow's always-required `version` input, so there is no second string to forget or leave empty.
- `bundle-server.mjs` accepts exactly one argv form, `--release-lock=<version>`. It exits non-zero when:
  - it sees a bare `--release-lock` or `--release-lock <space> value`;
  - the value is empty;
  - the flag is combined with `--source-only`;
  - the value differs from the stamped `packages/server/package.json` version.
- `publish.yml` and `nightly.yml` pass `release_lock: true`; `ci-electron.yml` and `ci-e2e-electron.yml` (which also runs `bundle-server.mjs`) do not.
- **Positive assertion.** Gated on the boolean, never on the version string: when `release_lock` is true, a node-native step after the bundle step reads `resources/server/runtime-manifest.json` and fails unless `installMode === "release-lock"` and `lockVersion === inputs.version`.
  - `installMode` and `lockVersion` are added as optional fields to the shared manifest parser and type (`packages/shared/src/runtime-overlay/manifest.mjs:22-40`, `manifest.d.mts`), which today drop unknown keys.
  - A release whose version resolves empty fails at the bundle step (empty value) or at the assertion. It cannot silently float.
- An L1 workflow-contract test pins three things: `publish.yml` passes `release_lock: true`; `_electron-build.yml` forwards the flag conditionally and runs the assertion whenever `release_lock` is true; `ci-electron.yml` does not set it.

### D2. Fetch the lock fail-closed
- In release-lock mode, `npm pack @blackbelt-technology/pi-dashboard-server@X --prefer-online` into a temp dir, with bounded retries and backoff (the stale-packument pattern at `publish.yml:511-523`).
- Use the build's configured registry (inherited env), `npm.cmd` + `shell: true` on Windows (as `:346-358` does), and check every spawn's exit status.
- Extract with the overlay's archive-member validation (`runtime-io.ts:51-60` refuses absolute, `..` and link members), reusing that code instead of a bare `tar`.
- Extract `package/runtime-lock.json` and require `packages[""].version === X`.
- Any failure exits non-zero naming X and the missing or mismatched artifact.

### D3. Rebase the lock onto the bundle's workspace layout
A pure function `(publishedLock, { workspaces: Map<name, {dir, manifest}>, bundledPlugins: Set<name>, pluginUnion, version: X }) → bundleLock`. It lives in a plain-Node `.mjs` module under `packages/electron/scripts/lib/`, importable by `bundle-server.mjs`, `publish.yml` (D6) and vitest. That directory is added to `bundle-watch-paths.mjs`, so editing the helper invalidates the bundle-freshness stamp the same way editing `bundle-server.mjs` does. The bundled-workspace name set is built by reading each `packages/<dir>/package.json` for the directories in `BUNDLED_WORKSPACE_PKGS`; the constant holds directory names (`bus-client`), not package names (`@blackbelt-technology/pi-dashboard-bus-client`). Each `packages` key is classified by the package that owns its top-level `node_modules/<name>` segment. Rules apply in order, and the first match wins. Rule 1 therefore takes `mcp-client-plugin` and `mcp-server-plugin`, which are both workspaces and bundled plugins.

1. **First-party bundled workspace** (name ∈ the `BUNDLED_WORKSPACE_PKGS` name set; this includes `mcp-client-plugin` and `mcp-server-plugin`):
   - its top entry becomes `{ resolved: "packages/<dir>", link: true }`;
   - a `packages/<dir>` entry is written from the bundled manifest (`version`, `dependencies`, `optionalDependencies`, `peerDependencies`, `peerDependenciesMeta`, `license`);
   - entries nested under it (`node_modules/<name>/node_modules/…`) are re-keyed to `packages/<dir>/node_modules/…`, otherwise byte-identical;
   - a bundled workspace with no entry in the published lock still gets its link and `packages/<dir>` entry, so `npm ci` never meets a workspace without a link.
2. **`pi-dashboard-web`.** Removed with its nested entries. The post-install step materializes it from local `packages/client`, and `npm ci` prunes its now-unreachable closure.
3. **Bundled plugins that are not bundled workspaces.** Removed with their nested entries. Their third-party deps come from the root union entries.
4. **Any other `@blackbelt-technology/*` entry.** The rebase **fails** ("unmapped first-party package"), so a newly added first-party package cannot be silently fetched from the registry.
5. **Third-party entries.** Kept byte-identical. The rebase **fails** if a non-link entry has no `integrity` (`npm ci` would install it unverified), or if its `resolved` is not an `https:` tarball URL (no `git:`, `file:` or non-loopback `http:` sources). Two exemptions found by spike 1.1: `inBundle: true` entries (shipped inside their parent's tarball; no `resolved`/`integrity` of their own — the parent's integrity covers them) are exempt from both checks, and `http:` to a loopback host (`localhost`, `127.0.0.1`, `[::1]`) is allowed, because the nightly lock is generated against a loopback Verdaccio and every third-party `resolved` points there.
6. **Root.** `name` becomes the synthetic root's name, `version` is X, `workspaces` is the bundle's list, and `dependencies` is the plugin union. The rebase fails if that union differs from the lock root's third-party dependency set.

   The two unions are derived from different workspace sets (`scripts/lib/runtime-release.mjs:29-34`, `:114-130` vs `bundle-server.mjs:112-129`, `:222-245`). They are equal today (14 deps), but nothing ties them together. An L1 parity test computes both from the repo and fails on any difference, so a third-party dependency added to a non-base workspace is caught in the PR. Otherwise it would break the next release, and the overlay's lock would also miss it.

Write it as `resources/server/package-lock.json` and run `npm ci --omit=dev --no-audit --no-fund --allow-remote=all`, with exit-status checking. These are the overlay stager's exact flags (`runtime-stager.ts:196-199`), so both installs of X behave the same; `--allow-remote` is inert once `fix-npm12-remote-tarball-install` removes the URL dependency. Delete `package-lock.json` in a `finally`, and also at the start of every bundle run, so a crashed run cannot leave it to be packaged.

*Alternatives considered:*
- **(1a) Bundle = staged overlay layout.** Rejected: it changes the bundle layout and the launcher's extension path (`runtime-overlay.ts:50`), contradicts "Synthetic root carries the bundled-plugin dependency union", and would ship the web closure.
- **(1b) npm `overrides` from the lock.** Rejected: no topology or integrity guarantee, and an override that does not apply is silently ignored.

### D4. Post-install tree audit (what `npm ci` does not check)
Runs right after `npm ci` and **before** the workspace-link materialization at `:500-545`, which turns links into copies. Every later gate stays where it is. It walks `node_modules` at the root and under every `packages/<dir>/node_modules`, and fails if:
- any installed third-party `name@version` is not an entry in the rebased lock (subset check). Pruned, dev-flagged and other-platform entries are expected to be absent, so absence is never an error; completeness of the reachable production set is `npm ci`'s job, and it fails when it cannot install one;
- any `@blackbelt-technology/*` entry is not a symlink to `packages/<dir>`. The web client is materialized later at `:549`;
- any `packages/<dir>/node_modules` exists. The later materialization copies workspaces without nested `node_modules` (`bundle-server.mjs:70`, `:538`), so a nested dependency would silently resolve to the hoisted version at runtime.

It logs the install mode, the lock source (registry, version), and the counts of audited packages (observability).

That check fails closed on a gap that predates this change (the floating path has it too). If spike 1.1 finds nested entries in a real lock, task 3.5 changes the materialization to keep them, and the check flips to verifying they survived.

### D5. Prove the release path on the full matrix every night
On nightly legs, `scripts/nightly-verdaccio-publish.mjs` mirrors the release order of `publish.yml:424-436`:
1. publish every workspace except the server and the root metapackage;
2. run `generate-runtime-lock.mjs --version <slug> --registry <verdaccio>` into `packages/server`, then the D6 lock lint;
3. publish the server, now carrying its lock;
4. publish the root metapackage last, which depends on the server.

   This keeps `scripts/__tests__/nightly-verdaccio-publish.test.mjs` ("publishes the root metapackage LAST", "orders every package after its deps") true; the test gains the server-after-lock assertion.

`nightly.yml` then passes `release_lock: true` (its `version` is the slug), so every one of the six legs builds its installer through the same release-path code (D2–D4) against a different registry. Its lock's `resolved` URLs point at Verdaccio, followed by the existing gates and launch smokes. The win32-arm64 leg runs on an x64 host with x64 Node. The registry override itself stays env-only, as `nightly-verification` requires.

The nightly no longer exercises the floating install. After this change that path serves only PR, develop and on-demand builds, which run it on every dispatch.

A first local spike (task 1.1) runs the same flow on one leg before the code lands. It records any rule D3 or D4 needed beyond what they state.

### D6. Lint the lock before the server is published
Publishing is irreversible, and `electron` runs only after `publish`. Any lock-level defect (D3 rules 4–6: an unmapped first-party entry, a missing integrity, a non-`https` source, a union mismatch) would otherwise surface after npm already holds X, leaving a version with no installer.

So `publish.yml` runs the pure rebase over the freshly generated `runtime-lock.json` against the repo's bundled workspaces, as a check only, after `generate-runtime-lock.mjs` (`:430`) and before `npm publish` of the server (`:434-436`). A failure stops the publish before the server and meta go out. The nightly runs the same lint (D5 step 2).

The bundle-time rebase stays: it re-checks against the exact sources the bundle copies.

## Risks / Trade-offs

- **The first real release is the first real lock.** → D5 runs the identical path nightly on all legs. The release fails closed rather than floating.
- **The rebase may need rules beyond D3** (an unusual nesting shape in the published lock). → Spike 1.1 runs first. Unknown first-party entries and missing integrity fail loudly (D3.4, D3.5), and the D4 audit catches anything `npm ci` lets through.
- **Release and nightly builds depend on the registry serving `server@X` right after publishing.** → Bounded retry with `--prefer-online` (D2). The electron job already depends on the same registry today.
- **PR and develop bundles still float.** → Accepted by decision. Nightly is pinned through D5.
- **The lock carries the web closure, which the bundle prunes.** → The bundle's set is a subset of the overlay's for the same X, never a different version. That is what the spec requires ("contains no version the lock does not list").

## Migration Plan

Ship before the next release. The first release after merge uses release-lock mode through `publish.yml`.

Rollback: revert the PR. Setting `release_lock: false` alone fails the D1 contract test, by design.

## Spike results (task 1.1, 2026-10-20)

Run in a scratch copy of the repo: loopback Verdaccio (the nightly's `.github/verdaccio/config.yml`), `nightly-verdaccio-publish.mjs` in the D5 order (all except server/root, `generate-runtime-lock.mjs --registry`, server, root), then `bundle-server.mjs --release-lock=<slug>` on npm 10.9.4 and npm 12.0.2 (both exit 0; CI legs run npm 10).

- **(a) Rules D3/D4 needed beyond the text.** Two, both now in D3 rule 5: `inBundle: true` entries (6 in the real lock, under `@tailwindcss/oxide-wasm32-wasi`) have no `resolved`/`integrity`, and on the nightly every third-party `resolved` is `http://127.0.0.1:<port>/…`, so an `https`-only check would fail every nightly leg. Also: the lock holds `xlsx` as an `https://cdn.sheetjs.com` tarball with integrity (needs `--allow-remote=all`, which the install passes; `fix-npm12-remote-tarball-install` owns removing it).
- **(b) Workspace-nested entries.** None: 0 of 1176 lock keys sit under `node_modules/@blackbelt-technology/<pkg>/node_modules/`. Task 3.5 is therefore "not needed"; the D4 `packages/<dir>/node_modules` check stays as the fail-closed guard.
- **(c) `npm ci` acceptance.** Accepted on npm 10.9.4 and 12.0.2: the version-less synthetic root `package.json` (lock root carries `version: X`), the renamed root, the field-subset `packages/<dir>` entries, link entries for 15 workspaces, and the 25 dropped first-party entries (their closure is pruned). 726 packages installed; the audit matched 711 third-party packages against 1166 lock entries.
- **(d) npm versions.** 10.9.4 (CI legs: Node 22) and 12.0.2 (local). `npm install --package-lock-only` over the full workspace set (nightly publish step (c)) crashes on npm 10 in a checkout without `node_modules` (`#loadPeerSet … edgesOut`) and hits `EALLOWREMOTE` on npm 12; unrelated to this change, so the spike skipped steps (c)/(d) of the publish script.
- **Bundle layout.** `runtime-manifest.json` records `installMode: "release-lock"` and `lockVersion`; no `package-lock.json` remains; node-pty/koffi/web/spawn-helper steps unchanged and green.
