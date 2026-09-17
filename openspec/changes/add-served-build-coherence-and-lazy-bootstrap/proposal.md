# Served-client build coherence + lazy terminal/diff bootstrap

> **Provenance.** Ported from the `JessieKaa/pi-agent-dashboard` fork, commit
> `3e2c56f8c` (+ follow-ups `e78d4dc61`, `285153e7d`, `3410a6c47`) — fork change
> `optimize-client-bootstrap-and-bundle-coherence`. The fork branched at
> `67111dfae` and is ~124 commits behind; every claim below was re-verified
> against current `origin/develop` (see *Upstream delta* per item). The fork diff
> is reference material, **not** a patch to cherry-pick.

## Why

Two independent first-order problems in the production bootstrap path. Both were
measured on the fork; both mechanisms still exist verbatim on `develop`.

1. **The built client and the served client can silently drift.**
   `POST /api/restart` restarts a server that resolves the *installed*
   `@blackbelt-technology/pi-dashboard-web/dist` first (module-resolver identity),
   while `npm run build` writes the *workspace* `packages/client/dist`. The fork
   observed the live `/api/health.bundleHash` (`879d335…`) differing from the
   `PLUGIN_REGISTRY_HASH` embedded in the browser's actually-loaded bundle
   (`59d19bd…`). `PluginStalenessBanner` compares the server's live hash against
   the *loaded bundle's* embedded hash, so a refresh loop cannot converge — the
   reload keeps fetching the same mismatched artifact. Nothing in the health
   surface or in `scripts/rebuild-restart.sh` reports *which* static directory is
   being served or whether it agrees with the running plugin set.

   *Upstream delta:* `develop` has **no** `clientBuild` health field
   (`git grep clientBuild packages/server/src` → 0 files), **no**
   `scripts/sync-served-client.mjs`, and **no** `build-metadata.ts` in
   `dashboard-plugin-runtime`. Nothing here is superseded.

2. **The cold landing import graph eagerly reaches terminal and diff code.**
   `vite.config.ts` `manualChunks` splits `@xterm/*` and `@git-diff-view/*` into
   separate files, but **a manual chunk is not a lazy boundary** — the chunk is
   still in the entry's static import graph. On current `develop`:
   `EditorPane.tsx:33` statically imports `TerminalPaneLayer`, `App.tsx:14`
   statically imports `FileDiffView`, and `pseudo-tab-registry.tsx` statically
   imports `DiffViewer`. The fork measured ~2.3 MB of root JS transfer before any
   chat renders, and a 16.6 s LCP under Fast-3G + 4× CPU throttling (TTFB 3 ms,
   render delay 16.555 s).

   *Upstream delta:* no `lazy(` boundary on any of the three call sites; the
   `manualChunks` split is unchanged. Not superseded.

## What Changes

Scope is the fork's, **re-derived against current `develop`** — the server's
static-root resolution, `system-routes.ts`, and `vite-plugin/index.ts` have all
moved since the fork point, so the port is a re-implementation guided by the fork,
not a merge.

- **Production builds emit a served-artifact declaration.**
  `packages/client/dist/pi-dashboard-build.json` records a schema version plus the
  deterministic plugin-registry hash already embedded as `PLUGIN_REGISTRY_HASH`.
  No timestamps, no machine-specific paths (reproducible-build safe). Written by
  the dashboard Vite plugin's production output lifecycle, after registry
  generation, from the same plugin set. Dev/HMR registry generation stays
  source-only and writes no declaration.
- **The vite-plugin hash is computed over a declared set, not runtime discovery.**
  New `dashboard-plugin-runtime/src/server/build-declaration-sdk.ts` +
  `build-metadata.ts` make the plugin set an explicit input, so the hash is stable
  across hosts (the fork's `e78d4dc61`/`3410a6c47` follow-ups exist because the
  first cut let discovery order leak into the hash — the port adopts the fixed
  form directly).
- **The server reports whether its served artifact matches its plugin set.**
  Static-root resolution extracts into one helper (`server/src/lib/client-dist.ts`)
  preserving the existing package-first identity (installed
  `@blackbelt-technology/pi-dashboard-web` first, workspace sibling as dev
  fallback). `server.ts` resolves the directory once, serves from exactly that
  directory, and reads the declaration at startup. `registerSystemRoutes` receives
  the snapshot and adds an **additive** `/api/health.clientBuild`:
  `{ pluginRegistryHash: string | null, status: "matched" | "mismatched" | "metadata-missing" | "not-served" }`.
  The existing `.bundleHash` field and the `PluginStalenessBanner` contract are
  unchanged. A startup diagnostic names the condition **without printing a
  filesystem path**.
- **The developer rebuild path deploys one verified artifact set.**
  `scripts/sync-served-client.mjs` resolves the served destination the same way
  the server does, syncs the freshly built workspace output into it when the two
  differ, and verifies both sides carry identical declarations.
  `scripts/rebuild-restart.sh` runs it between build and restart, so an incoherent
  set fails **before** any restart or bridge reload. API-only hosts and
  workspace-only layouts are explicit supported outcomes, not silent mismatches.
- **Terminals load only when a terminal tab exists.** `EditorPane.tsx` replaces the
  static `TerminalPaneLayer` import with a local `React.lazy` boundary rendered
  only once `openTerminalIds(paneState.openFiles)` is non-empty. The keep-alive
  contract is unchanged: `TerminalPaneLayer` stays the single `TerminalView` mount
  point, one instance per terminal id, hidden by the active-tab toggle rather than
  unmounted — no WebSocket is re-established on tab switches.
- **Diff loads only at its own routes.** `App.tsx` lazy-loads `FileDiffView` for
  the `/session/:id/diff` branch with a route-local suspense fallback;
  `pseudo-tab-registry.tsx` swaps only its `diff` entry to a lazy component. The
  D3 import-cycle boundary is preserved — `viewer-registry.tsx` and
  `CappedViewer.tsx` still never import a pseudo-tab viewer.
- **Build-output guards pin both properties.** A build-output regression test
  beside the existing chunk-size guards asserts the emitted cold-landing
  `index.html` module-preloads neither the `xterm` nor the `diff` chunk, while
  both chunks still exist for their feature routes. Skips without a build; fails
  loudly if a chunk is renamed or merged (same convention as the Monaco/Markdown
  guards).

Explicitly **excluded** (each needs its own change): Markdown global-primitive
registration and MDI reduction, mobile banner layout-shift work, startup metadata
request fan-out (openspec / git-status / kb-stats per-folder fetches), sidebar
session-state fan-out, DnD measurement scaling.

## Capabilities

### Added Capabilities

- `served-client-build-coherence` — the production client artifact carries a
  deterministic build declaration; the server reports whether the static artifact
  it actually serves agrees with its runtime plugin set; the local rebuild path
  verifies that agreement before restarting.
- `lazy-feature-bootstrap` — terminal and diff feature code SHALL NOT be part of
  the cold-landing dependency graph; it loads when its surface opens, without
  changing the terminal keep-alive contract or the viewer-registry cycle boundary.

## Impact

**Code**

- `packages/dashboard-plugin-runtime/src/vite-plugin/index.ts` — emit declaration;
  hash over declared set.
- NEW `packages/dashboard-plugin-runtime/src/server/build-metadata.ts`,
  `build-declaration-sdk.ts` (+ `server/index.ts` re-exports).
- NEW `packages/server/src/lib/client-dist.ts` — single static-root resolver.
- `packages/server/src/server.ts` — resolve once, serve that directory, read the
  declaration, pass the snapshot into system routes, path-free startup diagnostic.
- `packages/server/src/routes/system-routes.ts` — additive
  `/api/health.clientBuild`; `.bundleHash` unchanged.
- `packages/client/src/components/editor-pane/EditorPane.tsx` — lazy terminal-layer
  boundary gated on open terminal tabs.
- `packages/client/src/components/editor-pane/pseudo-tab-registry.tsx` — lazy
  `diff` entry only.
- `packages/client/src/App.tsx` — route-local lazy `FileDiffView`.
- NEW `scripts/sync-served-client.mjs`; `scripts/rebuild-restart.sh` gains the
  verify step.

**Tests**

- Runtime-plugin tests: declaration emit / validate / read, incl. malformed and
  missing metadata.
- Server health tests for all four `clientBuild` states + unchanged `bundleHash`.
- Sync-helper tests over temp directories: copies a complete build, rejects
  missing/invalid declarations, never reports a mismatch as success.
- Editor-pane keep-alive tests: a terminal tab mounts the layer once, switching
  away hides rather than unmounts, closing the tab tears it down.
- Retained viewer-registry partition tests and DiffViewer resolution tests.
- New build-output guard: cold `index.html` preloads neither `xterm` nor `diff`.
- `PluginStalenessBanner.test.tsx` stays green (browser contract unchanged).

**Docs**

- Nearest-directory `AGENTS.md` rows for the new helpers and changed
  vite/server/editor files (DocScribe for any `docs/` prose).
- `README.md` — distinguish a workspace-only build from the verified local
  deployment path.
- `docs/architecture.md` — build → served static artifact → health compatibility
  flow.

**Risk / compatibility**

- `/api/health.clientBuild` is purely additive; older browser tabs against a newer
  server are unaffected.
- The two contract-heavy seams are terminal keep-alive single-mount and the D3
  viewer-registry cycle; both are pinned by existing tests that must stay green.
- `sync-served-client.mjs` performs **filesystem mutation on a deployment path** —
  it must refuse rather than guess when the two sides disagree structurally.
- No deployment or restart is performed by this change's implementation or
  verification; running the verified rebuild script against the live dashboard
  remains a separately authorized action.

## Discipline Skills

- **`performance-optimization`** — the lazy boundaries target a measured budget
  (mobile Fast-3G + 4× CPU cold LCP 16.6 s, render delay 16.555 s, ~2.3 MB root
  JS). Re-measure on `develop` before and after; the build-output guard pins the
  preload property the measurement depends on.
- **`observability-instrumentation`** — `/api/health.clientBuild` + the startup
  diagnostic are a new health surface for an existing blind spot (which static
  artifact is served). Status enum, no new job or external call.
- **`review-code`** — two contract-heavy seams (terminal keep-alive single-mount,
  viewer-registry cycle boundary) plus a filesystem-mutating deployment helper.

`security-hardening` does not apply (no untrusted input or secret surface; the
health field deliberately carries no filesystem path). `systematic-debugging` does
not apply (root causes are established by measurement and pinned by tests).
`doubt-driven-review` — the port itself is the irreversible-ish decision (a
server-side static-root refactor); `plan-proposal` runs it by default.
