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
- Cross-plane linking of any kind — materialized edges AND the read-time code→doc
  footer (see D6: the kb search endpoint it would need does not exist).
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
- `presence(cwd)` → `{ binaryResolved: boolean; indexed: boolean }`. **The two
  fields are different scopes and must be consumed separately:**
  `binaryResolved` is HOST-global and is the verdict of the **full D9 ladder**
  (including its version probe) —
  NOT a bare `PATH` probe. A PATH-only probe would report "not installed" on the
  primary delivery target (Electron rung 2) and whenever `CODEGRAPH_BIN` is set,
  so `presence` and `resolveBinary` MUST share one implementation; two
  truth-sources here is the bug. `indexed` alone is per-worktree, and it means
  **ready**, not merely present: an interrupted `init` leaves `.codegraph/` on
  disk, so a directory-existence check would report `indexed: true`, suppress
  cold-start forever and serve a partial index. Readiness comes from `status`.
  A caller that renders `binaryResolved` per folder is printing one host fact N
  times. See D9.
- `init(cwd)` → run `codegraph init <cwd>` (cold-start build).
- `sync(cwd)` → run `codegraph sync <cwd>` (incremental).
- `status(cwd)` → parse `codegraph status <cwd> --json` (health/freshness/pending).
- `explore(cwd, query)` → run `codegraph explore <query>` in `<cwd>` (JSON).
- `index(cwd, { force })` → `codegraph index <cwd> [--force]` (full reindex).
All spawns: argument-vector (never a shell string) **with a `--` separator before
user text** — argv-only stops shell metacharacters but NOT a query beginning with
`-`/`--`, which the CLI would parse as its own flag; query length is bounded and
NUL rejected. `CODEGRAPH_NO_DAEMON=1` +
telemetry disabled in env, and a bounded timeout — **except `init`**, whose multi-minute full-repo
parse gets a long watched bound of its own; applying the per-query bound to it
would kill the background build this design depends on. **Failure taxonomy — nonzero
exit is NOT the same as unavailable:** a missing/unresolvable binary yields
`{ unavailable: true, reason }`, but a binary that ran and failed (malformed
query, writer-lock held, corrupt index) yields a distinct typed *error* result.
Collapsing the two makes a real failure masquerade as "CodeGraph isn't
installed" and silently routes the agent to built-in tools. Neither ever throws
into agent context.

### D4. Two tools + guidance row (no classifier)
Register `codegraph_explore`; add a root-`AGENTS.md` docs-first row: code-structure
/ "who calls X" / blast-radius → `codegraph_explore`; docs / "where documented" →
`kb_search`. kb already proves guidance steers agents. **Alternative:** a unified
tool with a routing classifier (rejected — a misroute silently hides a whole
plane; deferred fan-out variant is the only safe unification).

### D5. Lazy, no-daemon, per-worktree lifecycle (mirror kb)
- Cold-start: first `codegraph_explore` in a cwd with no `.codegraph/` returns
  guidance **immediately** and schedules `init` once as a **background job**;
  the tool call never blocks on the full-repo parse. kb's `ensurePopulated` is
  the shape but NOT the timing — kb reindexes markdown in-process in
  milliseconds, while `init` is a multi-minute subprocess parse, so serving it
  inline under D3's bounded timeout would either hang the turn or abort the
  build. A per-cwd in-flight guard makes a second concurrent `init`
  impossible (SQLite single-writer).
- Write-hook: `codegraph-extension`'s **own** debounced `tool_result` hook fires
  `sync <cwd>` on non-`.md` source writes (clone kb-extension's debounce/coalesce
  structure); the debounce is **configurable with a documented default of 800ms**,
  matching kb-extension's `DEFAULT_DEBOUNCE_MS` so there is one number to reason
  about. kb-extension's markdown hook is unchanged. **Path exclusions are
  load-bearing, not hygiene:** `sync` writes `.codegraph/codegraph.db{,-wal,-shm}`
  inside the cwd, so without excluding `.codegraph/` the hook retriggers itself —
  an unbounded reindex loop. Exclude `.codegraph/`, `.git/`, `node_modules/` and
  build outputs. kb-extension's `isNudgeEligible` already matches every
  non-markdown path, but it is a DOX-nudge predicate that excludes **no**
  directories — so it is the wrong gate to reuse, and the exclusion set must be
  written here rather than borrowed.
- Freshness: the hook only observes **agent** writes — IDE edits, `git checkout`
  and rebases are invisible, and the daemon is banned, so staleness is otherwise
  unbounded and fails as confidently-wrong blast radius rather than an error.
  A bounded reconcile before serving explore is therefore required, not optional.
- **Single-writer serialization (the no-daemon consequence).** With the daemon
  disabled CodeGraph permits ONE writer per project; a second exits on the
  writer lock. `init`, the debounced `sync`, and the freshness reconcile are all
  writers, so an init-only in-flight guard covers just one of several collision
  pairs — every write path for a cwd must go through one per-cwd queue.
- **Stale-lock recovery.** A background `init` killed mid-run (session shutdown,
  cwd eviction) can leave a stale lock that fails every later operation on that
  worktree — turning graceful degradation into permanent per-worktree breakage.
  Detect and recover via CodeGraph's `unlock` rather than assuming a clean exit.
- **Partial-index window.** The in-flight guard is in-memory, so a restart
  mid-init leaves `.codegraph/` present but incomplete and a naive
  existence-check reports `indexed: true` — serving a partial index as whole.
  Completeness must be judged by `status`, not directory existence. kb's
  in-process millisecond `ensurePopulated` never had this window; the mirror is
  structural, not temporal.
- `.codegraph/` gitignored per worktree; persists in the workspace mount. The
  extension MUST NOT silently edit a user repo's `.gitignore` — it ships the
  ignore where it owns the file (Docker image, this repo) and otherwise surfaces
  it as guidance.
**Alternative:** run CodeGraph's watcher daemon (rejected — background process,
divergent from kb's pull model).

### D6. Two separate stores; no cross-plane linking in this change
CodeGraph owns `.codegraph/codegraph.db`; kb owns its DB. No schema merge, no
cross-DB JOIN. A read-time, name-keyed code→doc footer was considered and
**dropped**: it would call a kb search endpoint that **does not exist** —
`packages/kb-plugin/src/server/kb-routes.ts` exposes only `/api/kb/stats`,
`/api/kb/reindex` and `/api/kb/config`. Shipping it would mean adding a search
route to kb-plugin, widening scope into the packages this change exists to leave
untouched. kb's dormant `entity` node type stays reserved for a later annotated
version. **Alternative:** build the footer on a new kb search endpoint (rejected
— scope creep into kb-plugin for a flag-off nicety).

### D7. Docker carry via `ARG CODEGRAPH_ENABLED=0` build-arg
Lean default image; opt-in fat image when built with the flag (no runtime network
dep, air-gap friendly). Pin the version; `.codegraph/` persists in the workspace
mount (no extra VOLUME). Non-interactive install **must** run
`codegraph telemetry off`. **Alternative:** always bake in (rejected — size for an
optional feature) or entrypoint lazy-install (rejected — needs network at runtime).

### D8. Plugin server API cloned from kb-plugin

> Surface design for both scopes was prototyped in `mockups/codegraph-settings/`
> (4 surfaces × 4 folder states × 2 binary states); rationale in
> `mockups/ui-plan.md`. The scope split below came out of that prototype.

`codegraph-routes.ts` + `job-registry` (long `init`/`index` runs are jobs) +
`codegraph-api.ts` client + the settings UI. **Two endpoint scopes, matching
D9:** the per-worktree endpoints (status/health, init, sync, index) are
folder-scoped with the same base64url cwd codec; the binary endpoints (resolve
the ladder, report path/version, install) are **global and take no cwd** — a
cwd-keyed route for a host fact is the same scope error at the API layer that
D9 fixes at the UI layer. Reuse kb-plugin's patterns; do not import kb-plugin.
The **Install CodeGraph** action (rung 5 → rung-4 install via a server route, then
re-probe) lives on the GLOBAL surface, not the folder panel — see D9. The folder
dialog shows the binary outcome as one compact line plus a `Manage in Settings →`
deep link, and replaces its index section with a blocker when no binary is
present.

### D9. Binary resolution ladder + delivery (Electron bundle + npm fallback)
`codegraph-driver.resolveBinary(cwd)` walks: (1) `CODEGRAPH_BIN` env/config
override; (2) bundled `<process.resourcesPath>/codegraph/<exe>` (Electron
delivered method) with a dev fallback to a repo-relative path (mirrors
`resolveLoadingPagePath` in `main.ts`); (3) system `PATH` via a `which`-style
probe (Docker/dev/manual); (4) self-installed `npm install -g
@colbymchenry/codegraph@<pin>` (fallback when no delivered method present); (5)
none → `{ unavailable, installHint }`.

**Scope — the ladder is host-global, and is presented globally.** Every rung
reads a host-level source: process env, `process.resourcesPath`, the system
`PATH`, a global npm prefix. The single exception is rung 2's **dev** fallback,
which resolves against the dashboard's own checkout — one fixed path, not the
folder being rendered. So the answer is the same for every folder, and the
ladder is rendered **once**, on the global settings surface (`settings-section`
→ `/settings/plugins/codegraph`), **not** inside the per-folder
`/folder/:encodedCwd/codegraph` dialog. Precedent is kb-plugin's own pair —
`KbSettingsClaim.tsx` (global claim) + `FolderKbSection.tsx` (folder section);
`NodeRuntimeSection` / `PiRuntimeSection` are built-ins rendered directly by
`SettingsPanel`, so they model the *shape* of a runtime-resolution section but
NOT the plugin-claim mechanism. The `cwd` parameter survives only to feed that dev fallback and does
**not** make the answer per-folder.

Rendering it per folder printed one host fact once per folder, and forced two
host facts — `absent` and `fallback rung` — into the folder panel's state enum.
Once the axes were separated the enum dropped **6 states → 4**, and `fallback`
lost the special case it needed to render as `fresh` on the row surfaces.

**Delivery (rung 2)** mirrors the existing git/node bundling exactly:
`packages/electron/scripts/download-codegraph.mjs` reads a pinned
`_codegraph-version.json` (tag + per-arch sha256), resolves the build target from
`GIT_TARGET_ARCH` / `npm_config_target_arch` / `TARGET_ARCH` / `process.arch`
(the repo's git script reads `GIT_TARGET_ARCH` first), downloads + verifies
into `packages/electron/resources/codegraph/`, and
`packages/electron/forge.config.ts` lists it as an `extraResource` "when present"
(the same `fs.existsSync` guard as `resources/node` and `resources/git`).
Invocation follows `download-git-windows.mjs`: spawned from
`packages/electron/scripts/bundle-server.mjs` as a GO/NO-GO step (non-zero exit
fails the build), not a standalone package.json script. Bundle **only targets
where CodeGraph publishes a prebuilt binary**; other targets ship no bundle and
hit rung 4 on first use.

**Precondition — verify before implementing this section:** rung 2 exists only if
`@colbymchenry/codegraph` actually publishes (a) per-arch prebuilt binaries and
(b) an npm package. Nothing in this change checks that today. If no prebuilts
exist, rung 2 is unbuildable and delivery collapses onto rung 3 (PATH) / rung 4
(`npm install -g`) — which changes this decision's emphasis, not just its tasks.

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
- ~~Whether the freshness `sync`-before-explore is worth the per-query latency~~
  — **closed.** The spec requires per-query reconciliation and D5 explains why
  (the hook sees only agent writes; IDE edits and `git checkout` are invisible,
  and the daemon is banned). The bound is a tuning question; whether to
  reconcile is not, and reopening it would contradict a spec delta.
