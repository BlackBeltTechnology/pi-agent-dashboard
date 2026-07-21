## Context

The knowledge base (`packages/kb` + `kb-extension` + `kb-plugin`) indexes the
**docs plane** — markdown prose and structure — into FTS5 with a deterministic
Tier-1 graph. Its invariants: `node:sqlite` only, **zero runtime deps**, *never
executes source*, pull-based retrieval. It cannot answer the **code plane**
question ("where is symbol X, who calls it, what breaks if I change it").

[CodeGraph](https://github.com/colbymchenry/codegraph) answers exactly that with
the *same technique* kb trusts — a local SQLite + FTS5 index with a graph on top,
pulled by the agent — but over source (tree-sitter, 20+ langs, resolved
references, blast radius). It ships as an OS-native standalone binary + MCP
server, 100% local, and degrades cleanly when no `.codegraph/` index exists.

This change federates CodeGraph as its own **3-package family mirroring kb's
shape**, leaving `packages/kb` and `packages/kb-extension` untouched. It
supersedes `add-kb-code-symbol-index`, which took the opposite (absorb
tree-sitter into kb) path and is now deprecated.

Current state grounding (from the codebase):
- kb graph: `nodes(type, name, path)` + `edges(src, dst, rel, weight)`; walks are
  single-DB recursive CTEs (`neighbors`/`backlinks`) — cannot JOIN across DBs.
- kb-extension registers tools via `pi.registerTool` and reindexes markdown via a
  debounced `tool_result` write-hook; its pure logic lives in `reindex.ts` (no pi
  imports, testable).
- kb-plugin ships `server/kb-routes.ts` + `server/job-registry.ts` (long-running
  reindex jobs) + `client/kb-api.ts` (folder-scoped, base64url cwd codec) +
  `client/KbSettingsPanel.tsx`.
- Docker carries peer binaries two ways: pinned tarball + sha256 (zrok) or
  `npm install -g` (pi, openspec).

## Goals / Non-Goals

**Goals:**
- Federate CodeGraph as the code plane behind a standalone package family:
  `codegraph-driver` (pure adapter), `codegraph-extension` (pi tool + hook),
  `codegraph-plugin` (dashboard UI + server API).
- Lazy, per-worktree, no-daemon lifecycle that mirrors kb's pull model (cold-start
  init, debounced write-hook sync, freshness-before-query).
- Discovery via a docs-first guidance row (two tools, no routing classifier).
- Graceful degradation: absent binary / index → guidance to built-in tools, never
  an error, never a hard dependency.
- `packages/kb` and `packages/kb-extension` are not modified.

**Non-Goals:**
- Absorbing tree-sitter / symbol extraction into `packages/kb` (superseded).
- Materialized cross-plane graph edges (deferred; read-time footer instead).
- A unified `kb_explore` fan-out tool (deferred, measure-first).
- Running CodeGraph's FS watcher / auto-sync daemon (deliberately disabled).
- Bundling codegraph binaries for targets where CodeGraph publishes no prebuilt
  (those fall back to the rung-4 install).

## Decisions

### D1. Federate (external binary) over absorb (in-kb tree-sitter)
Absorbing breaks kb's `node:sqlite`-only / zero-dep / never-executes-source
invariants and reimplements a mature 1.0. **Chosen:** federate. **Alternative:**
`add-kb-code-symbol-index` (rejected/superseded).

### D2. Standalone 3-package family, not a router inside kb-extension
Mirrors kb's core/extension/plugin split. Keeps single-responsibility, allows
independent enable/version, and yields **zero cross-package coupling** with kb
(kb-extension currently has to inline-mirror kb's `resolveRowPath` to dodge a
versioned-export dependency — a standalone family avoids that class of wart).
**Alternative:** add the passthrough + a source write-hook branch into
kb-extension (rejected — grows kb-extension a second job, couples the two planes'
hooks).

### D3. `codegraph-driver` = pure CLI adapter, separate package
No pi imports; spawns the `codegraph` binary, parses JSON, detects presence.
Shared by the extension (tool) and the plugin (server API), so both spawn through
one tested seam. **This is the "core" slot** — but since CodeGraph *is* the
indexer, the driver is a thin adapter, not a reimplementation. **Alternative:**
inline the logic in the extension (rejected — the plugin's server API also needs
to spawn, so a shared package avoids duplication).

Driver surface (maps 1:1 to CodeGraph CLI):
- `presence(cwd)` → `{ binaryOnPath: boolean; indexed: boolean }` (binary via
  PATH probe; `indexed` via existence of `<cwd>/.codegraph/`).
- `init(cwd)` → run `codegraph init <cwd>` (cold-start build).
- `sync(cwd)` → run `codegraph sync <cwd>` (incremental).
- `status(cwd)` → parse `codegraph status <cwd> --json` (health/freshness/pending).
- `explore(cwd, query)` → run `codegraph explore <query>` in `<cwd>` (JSON).
- `index(cwd, { force })` → `codegraph index <cwd> [--force]` (full reindex).
All spawns: argument-vector (never a shell string), `CODEGRAPH_NO_DAEMON=1` in
env, and a bounded timeout. Missing binary / nonzero exit → typed
`{ unavailable: true, reason }`, never a throw into agent context.

### D4. Two tools + guidance row (no classifier)
Register `codegraph_explore`; add a root-`AGENTS.md` docs-first row: code-structure
/ "who calls X" / blast-radius → `codegraph_explore`; docs / "where documented" →
`kb_search`. kb already proves guidance steers agents. **Alternative:** a unified
tool with a routing classifier (rejected — a misroute silently hides a whole
plane; deferred fan-out variant is the only safe unification).

### D5. Lazy, no-daemon, per-worktree lifecycle (mirror kb)
- Cold-start: first `codegraph_explore` in a cwd with no `.codegraph/` → `init`
  once, then serve (mirrors kb `ensurePopulated`).
- Write-hook: `codegraph-extension`'s **own** debounced `tool_result` hook fires
  `sync <cwd>` on non-`.md` source writes (clone kb-extension's debounce/coalesce
  structure). kb-extension's markdown hook is unchanged.
- Freshness: a fast `sync` (or CodeGraph's connect-time reconciliation) before
  serving explore.
- `.codegraph/` gitignored per worktree; persists in the workspace mount.
**Alternative:** run CodeGraph's watcher daemon (rejected — background process,
divergent from kb's pull model).

### D6. Two separate stores; cross-plane linking deferred to a read-time footer
CodeGraph owns `.codegraph/codegraph.db`; kb owns its DB. No schema merge, no
cross-DB JOIN. The deferred useful 80% is a **read-time, name-keyed** code→doc
footer: `codegraph-plugin` optionally calls kb's `/api/kb/search` by symbol name
(flag `CODEGRAPH_CROSSREF_DOCS`, off). kb's dormant `entity` node type stays
reserved for a later annotated version.

### D7. Docker carry via `ARG CODEGRAPH_ENABLED=0` build-arg
Lean default image; opt-in fat image when built with the flag (no runtime network
dep, air-gap friendly). Pin the version; `.codegraph/` persists in the workspace
mount (no extra VOLUME). Non-interactive install **must** run
`codegraph telemetry off`. **Alternative:** always bake in (rejected — size for an
optional feature) or entrypoint lazy-install (rejected — needs network at runtime).

### D8. Plugin server API cloned from kb-plugin
`codegraph-routes.ts` + `job-registry` (long `init`/`index` runs are jobs) +
`codegraph-api.ts` client + `CodegraphSettingsPanel.tsx`, all folder-scoped with
the same base64url cwd codec. Reuse kb-plugin's patterns; do not import kb-plugin.
The panel's install-hint (rung 5) is an actionable **Install CodeGraph** button
that drives the rung-4 install via a server route, then re-probes presence.

### D9. Binary resolution ladder + delivery (Electron bundle + npm fallback)
`codegraph-driver.resolveBinary(cwd)` walks: (1) `CODEGRAPH_BIN` env/config
override; (2) bundled `<process.resourcesPath>/codegraph/<exe>` (Electron
delivered method) with a dev fallback to a repo-relative path (mirrors
`resolveLoadingPagePath` in `main.ts`); (3) system `PATH` via a `which`-style
probe (Docker/dev/manual); (4) self-installed `npm install -g
@colbymchenry/codegraph@<pin>` (fallback when no delivered method present); (5)
none → `{ unavailable, installHint }`.

**Delivery (rung 2)** mirrors the existing git/node bundling exactly:
`scripts/download-codegraph.mjs` reads a pinned `_codegraph-version.json`
(tag + per-arch sha256), resolves the build target from `npm_config_target_arch`
/ `TARGET_ARCH` / `process.arch`, downloads + verifies into
`resources/codegraph/`, and `forge.config.ts` lists it as an `extraResource`
"when present." Bundle **only targets where CodeGraph publishes a prebuilt
binary**; other targets ship no bundle and hit rung 4 on first use.

**Fallback (rung 4)** = `npm install -g @colbymchenry/codegraph@<pin>`; it can
reuse Electron's already-bundled node/npm, so a desktop user without system Node
still installs. Plain (non-Electron) npm installs of the extension require system
npm on PATH — the accepted tradeoff of this method (no integrity pin beyond the
version). **Alternative:** self-download a pinned+sha256 binary into
`~/.pi/dashboard/bin` (rejected — duplicates CodeGraph's release-asset knowledge;
npm-g is simpler and CodeGraph already publishes the npm package).

## Risks / Trade-offs

- **Worktree cost**: CodeGraph parses all source, so each worktree's first `init`
  is a full-repo parse with no cross-worktree sharing → heavier than kb's
  markdown-only index. → Mitigation: `sync` is content-hash incremental;
  write-hook debounce collapses bursts; connect-time reconcile self-heals a
  skipped sync; init runs as a background job with UI progress.
- **External binary availability**: not everyone installs `codegraph`. →
  Mitigation: presence detection + graceful degradation everywhere (tool returns
  built-in-tools guidance; panel shows an install hint).
- **Shell injection via query text**: the driver spawns with untrusted query
  input. → Mitigation: argument-vector spawns only, never a shell string; bounded
  timeout; validate the binary path.
- **Telemetry vs. network guard**: CodeGraph phones home (anonymous) while
  `add-universal-network-guard` is landing. → Mitigation: install disables
  telemetry (`codegraph telemetry off`); reconcile the outbound endpoint with the
  guard before Docker carry ships.
- **Subprocess vs in-process cost**: kb reindexes in-process; codegraph is a spawn
  per sync. → Mitigation: debounce + per-cwd coalescing; sync-on-write is an
  optimization over sync-before-query, not required for correctness.
- **Version skew**: CLI JSON shape may change across CodeGraph releases. →
  Mitigation: the driver is the single parse seam; pin a known-good version in
  Docker and document a supported range.
- **Rung-4 fallback needs node/npm**: `npm install -g` requires npm reachable
  (system, or Electron's bundled node). Plain non-Electron npm installs without
  system npm cannot self-install, and npm-g carries no integrity pin beyond the
  version. → Mitigation: pin `@<version>`; prefer bundled node/npm inside
  Electron; degrade gracefully (rung 5 install hint) when npm is absent.
- **Bundle coverage gaps**: targets with no CodeGraph prebuilt ship no bundled
  binary. → Mitigation: rung-4 fallback covers them; the panel shows the install
  action; presence detection keeps the tool a clean no-op until installed.

## Migration Plan

- Additive only — no migration of existing kb data. New packages ship disabled by
  default (no binary present = no-op).
- Rollback: remove the three packages / disable the extension; kb is untouched, so
  the docs plane is unaffected.
- Deprecation: `add-kb-code-symbol-index` is marked SUPERSEDED (banner added); do
  not implement it.

## Open Questions

- CodeGraph distribution in Docker: `npm install -g @colbymchenry/codegraph`
  (native binary, arch auto) vs. a pinned standalone tarball (zrok-style
  arch-map + sha256)? Resolve when authoring the Dockerfile arm of the change.
- Exact `codegraph status --json` schema fields to surface in the panel
  (freshness, pending files, symbol counts) — confirm against the installed CLI
  version during implementation.
- Whether the freshness `sync`-before-explore is worth the per-query latency, or
  whether cold-start init + write-hook sync + connect-time reconcile already keep
  the index fresh enough (measure during implementation).
