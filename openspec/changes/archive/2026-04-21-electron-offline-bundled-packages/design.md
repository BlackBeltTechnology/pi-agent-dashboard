## Context

The Electron bundle ships two offline-ready resources already
(`resources/node`, `resources/server`). This design extends that pattern to
the three runtime packages by bundling a pre-populated npm **cacache** per
platform, not just top-level tarballs. The cacache approach guarantees a real
100% offline first-run (unlike the top-level-tarballs-only approach, which
only partially covers offline cases).

## 1. Measured sizes (refresh in task 0.2 on CI)

Baseline measured 2026-04-21 on macOS arm64 with npm 10.x, on a clean
install of `@mariozechner/pi-coding-agent@0.68.0`,
`@fission-ai/openspec@1.3.0`, `tsx@4.21.0`:

| Artifact | Size |
|---|---|
| 3 top-level `.tgz` | 4.6 MB |
| Installed `node_modules/` (662 packages) | 200 MB |
| `_cacache/` on disk | 139 MB |
| `_cacache/` as `tar.gz` | **~50 MB** (+50 MB per platform installer) |

The size is dominated by the LLM SDKs bundled by pi-coding-agent:
`@mistralai/mistralai` (19 MB), `@google/genai` (14 MB), `openai` (13 MB),
`koffi` (28 MB, native FFI for clipboard), `@esbuild/*` (10 MB/platform).
None of this is dashboard code — it's pi's runtime surface.

Size budget: **target < 60 MB compressed per platform**. Abort and re-scope
if task 0.2 measures > 100 MB on any platform.

## 2. File layout inside the packaged Electron app

```
<app>/resources/offline-packages/
  manifest.json
  npm-cache.tar.gz    # gzipped _cacache/ from `npm install --cache`
```

`manifest.json`:

```json
{
  "bundledAt": "2026-04-21T12:00:00Z",
  "targetPlatform": "win32-x64",
  "pinnedVia": "packages/electron/offline-packages.json",
  "npmCacheSha256": "sha256-...",
  "packages": [
    { "name": "@mariozechner/pi-coding-agent", "version": "0.68.0" },
    { "name": "@fission-ai/openspec",          "version": "1.3.0" },
    { "name": "tsx",                           "version": "4.21.0" }
  ]
}
```

Read-only after the build; never mutated at runtime.

## 3. Why cacache instead of top-level tarballs

We considered tier A (ship only the 3 top-level `.tgz`, ~4.6 MB). Rejected
because the three packages together pull **662 transitive deps**. On an
air-gapped machine with a cold npm cache, `npm install <tgz>` would fail on
the first missing transitive. "Works if the cache happens to be warm" is not
a contract we can ship.

The cacache approach (tier B) puts every transitive tarball into the cache
up-front. The runtime install uses `npm install --offline --cache <path>`
which makes npm fail loudly if anything is missing — **deterministic offline
contract**. Size cost is +~45 MB over the top-level approach; acceptable.

Tier C (cross-platform merged cacache) was rejected because each Electron
installer is already platform-specific. Shipping macOS binaries inside a
Windows installer is wasted bytes.

## 4. Version bump policy

Default: manual bump per dashboard release. `offline-packages.json` is
reviewed alongside the CHANGELOG entry. Low frequency, high visibility.

Fallback: renovate rule watching the three registry versions. Adopt if we
miss two consecutive upgrades.

## 5. Runtime flow

```
Electron wizard → installStandalone(...)
  │
  ├─ resolveOfflinePackages(process.resourcesPath)
  │     → { present: true, manifest, tarballPath }
  │
  ├─ extractOfflineCache(tarballPath, MANAGED_DIR)
  │     → MANAGED_DIR/.offline-cache/_cacache/
  │     → verifies manifest.npmCacheSha256
  │
  ├─ npm install --prefix MANAGED_DIR
  │              --cache MANAGED_DIR/.offline-cache
  │              --offline
  │              <pkg>@<pinned-version>...
  │
  ├─ success → rm -rf MANAGED_DIR/.offline-cache
  └─ failure → preserve .offline-cache for debugging; report error; do NOT retry against registry
```

The `--offline` flag is the deterministic-contract linchpin. `--prefer-offline`
would fall back to the registry on a cache miss — rejected for the same
reason we rejected "retry on bundled-install failure".

## 6. Rollback

- Delete `packages/electron/resources/offline-packages/` from the shipped
  artifact. `resolveOfflinePackages()` returns absent. Installer falls back
  to registry mode. No persisted state.
- In source: revert commits; no config-file or database migration.

## 7. Compatibility with `unified-bootstrap-install`

When that change lands, `installStandalone` moves to
`packages/shared/src/bootstrap-install.ts` and gains a `packages` parameter.
`resolveOfflinePackages()` fits cleanly: it reads via
`process.resourcesPath` (set by Electron; undefined in CLI-only context —
safe, returns absent). The CLI path (`pi-dashboard` via `npm i -g`)
naturally gets absent → registry install, which is correct (that install
route assumes registry access).

## 8. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| cacache size creeps above 100 MB (LLM SDKs bloat) | Medium | Task 0.2 size budget; CI fails release if exceeded |
| npm cache format changes between Node versions | Low | Bundled Node + bundled cache produced by SAME npm version; lockstep |
| `--offline` rejects a valid cache due to index drift | Low | Pre-release QA on every supported platform |
| Tarball corruption during extraction | Low | SHA-256 verification before extract |
| User on non-covered platform (e.g. linux-arm64 if we don't ship it) | Low | Electron release already defines the supported matrix; new platforms are a separate scope |
| pi-coding-agent upgrade bundles a native module we can't cross-pack | Medium | Task 0.3 validates `--ignore-scripts` at bundle time; runtime install runs scripts on real platform |
