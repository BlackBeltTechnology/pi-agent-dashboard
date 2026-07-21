# Federate CodeGraph as a standalone code-plane package family (mirroring kb)

> Supersedes `add-kb-code-symbol-index`. That change proposed to *absorb* a
> code-symbol index INTO `packages/kb` via embedded tree-sitter (native dep,
> 6-language navigation-only, resolved cross-references deferred to SCIP/LSP).
> This change takes the opposite architecture: **federate** the mature external
> [CodeGraph](https://github.com/colbymchenry/codegraph) (20+ languages,
> resolved references, blast radius, framework-aware routes) as its own
> **standalone package family that mirrors kb's 3-slot shape** — leaving
> `packages/kb` AND `packages/kb-extension` entirely untouched. On acceptance,
> `add-kb-code-symbol-index` is deprecated (do not implement it).

## Why

The KB indexes the **docs plane** — prose in `docs/`, `openspec/`, `packages/`,
the `AGENTS.md` tree — into FTS5 with a deterministic Tier-1 graph over
*markdown structure only*. Its own type contract states the invariant:
`KB reads markdown only, never executes source`, over `node:sqlite` with **zero
runtime deps**. It deliberately cannot answer the **code plane** question:
*"where is symbol X defined, who calls it, and what breaks if I change it?"*
Today the agent falls back to `rg`/Read across source — token-expensive,
imprecise, re-run every lookup.

CodeGraph solves exactly the code plane using the *same technique* kb already
trusts: a local SQLite + FTS5 index with a graph on top, pulled by the agent
("trust the result, don't re-grep"). The two are **complementary planes, not
competitors** — same machinery, different substrate:

- **kb** → docs plane: `file`/`heading`/`tag`/`entity` nodes; `child_of`/
  `links_to`/`references` edges. "How does Y work per the docs."
- **CodeGraph** → code plane: `function`/`class`/`method` nodes; `calls`/
  `imports`/`extends`/`implements` edges; resolved references; blast radius.
  "Who calls `foo()`; what breaks if I change it."

Absorbing CodeGraph into `packages/kb` (the `add-kb-code-symbol-index` path)
would break kb's invariants — tree-sitter is a native binding (kb is
`node:sqlite`-only, zero-dep) and parsing source violates *"never executes
source"* — and would reimplement a mature 1.0. Simplicity-first: adopt, don't
rebuild.

**Why a standalone package family, not a router bolted into kb-extension.** kb
ships as three packages by concern — core indexer (`packages/kb`), pi extension
(`packages/kb-extension`), dashboard UI plugin (`packages/kb-plugin`). The
cleanest federation mirrors that shape as its own family rather than growing
kb-extension a second job:

- **Single responsibility per package** — kb-extension stays docs-only; the
  source-file write-hook lives in the code-plane extension's *own* hook. pi runs
  both hooks independently — no "one hook, two indexers" coupling.
- **Independent enable/disable + versioning** — load kb without code indexing,
  or vice-versa; each family publishes on its own cadence.
- **Zero cross-package coupling** — kb-extension currently inline-mirrors kb's
  `resolveRowPath` to avoid an unreleased-export dependency across the versioned
  boundary; a standalone code-plane family has **no kb dependency at all**.
- **Own UI** — a `CodegraphSettingsPanel` mirroring `KbSettingsPanel`, surfacing
  what CodeGraph uniquely has (binary-present state, per-worktree index
  freshness, force-reindex), instead of a bolt-on to the KB panel.

CodeGraph is 100% local, ships as an OS-native standalone binary + MCP server,
requires no Node, and degrades cleanly (a path with no `.codegraph/` index
returns guidance to use built-in tools). Accepted as a **peer binary** (like
`zrok`/`code-server` already carried by the Docker image), not an npm dependency.

## What Changes

- **New standalone package family (kb is a 3-slot mirror). `packages/kb` and
  `packages/kb-extension` are not modified.**
  - **`packages/codegraph-driver`** — pure CLI adapter: spawn the `codegraph`
    binary, parse its JSON, detect presence (binary on PATH + `.codegraph/`
    index for a cwd). **No pi imports**, unit-testable (analogous to
    kb-extension's pure `reindex.ts`). Shared by the extension and the plugin's
    server API — the "core" slot that, for kb, is `packages/kb` (here the
    indexer is the external binary, so the driver is a thin adapter, not a
    reimplementation).
  - **`packages/codegraph-extension`** — pi extension: registers the
    `codegraph_explore` native tool and its **own** `tool_result` write-hook
    (source-file writes → debounced `codegraph sync <cwd>`), plus cold-start
    `codegraph init <cwd>` on first explore. Mirrors `packages/kb-extension`.
  - **`packages/codegraph-plugin`** — dashboard UI plugin: a
    `CodegraphSettingsPanel` + `useCodegraphStats` + server API mirroring
    `packages/kb-plugin` (`KbSettingsPanel`/`useKbStats`/`kb-api`). Surfaces
    binary-present state, per-worktree index health/freshness, force-reindex,
    and per-language enablement.
- **Two-tools-plus-guidance discovery (not a classifier).** The "one surface" is
  the docs-first **guidance row**, not a routing classifier — mirroring the
  proven kb pattern (*"call kb_search FIRST for any 'where is X' question"*). Add
  a symmetric root-`AGENTS.md` row: *code-structure / "who calls X" / blast
  radius → `codegraph_explore`; docs / "where is X documented" → `kb_search`*.
  Two clearly-described tools cannot silently blind the agent to a plane the way
  a misrouting classifier would.
- **Transport = CLI shell-out** via `codegraph-driver`. `kb-extension`-style
  spawn of the `codegraph` binary in JSON mode; the tool contract is owned by
  us. No MCP proxy plumbing.
- **Two separate stores.** CodeGraph owns `.codegraph/codegraph.db`; kb owns its
  own DB. No schema merge, no cross-plane edges (deferred).
- **Lazy, per-worktree lifecycle mirroring kb (no daemon).** Each cwd/worktree
  owns its `.codegraph/` index; the extension drives CodeGraph in pull mode with
  its watcher disabled (`CODEGRAPH_NO_DAEMON=1`):
  - **Cold-start init** — first `codegraph_explore` in a cwd with no
    `.codegraph/` runs `codegraph init <cwd>` once, then serves (mirrors kb's
    `ensurePopulated`).
  - **Incremental reindex on write** — the extension's own write-hook debounces
    `codegraph sync <cwd>` on source-file writes, per-cwd.
  - **Freshness on query** — a fast `codegraph sync <cwd>` (or CodeGraph's
    connect-time reconciliation) before serving, mirroring kb_search freshness.
  - **Command-callable** — `codegraph init|sync|index|status <cwd>` are the
    manual controls, symmetric with `kb index`.
  - `.codegraph/` is gitignored per worktree, as kb gitignores its `dbPath`.
- **Graceful degradation.** Binary absent or no `.codegraph/` index → the tool
  returns clean guidance to use built-in tools; the extension is a no-op. No
  hard dependency is ever introduced.
- **Binary resolution ladder + delivery.** `codegraph-driver` resolves the
  binary through a ladder so one driver works across all install shapes:
  (1) `CODEGRAPH_BIN` env/config override, (2) **bundled** under
  `<resourcesPath>/codegraph/` (Electron delivered method), (3) system `PATH`
  (Docker/dev/manual), (4) **self-installed** via `npm install -g
  @colbymchenry/codegraph@<pin>` into a resolvable prefix (fallback when no
  delivered method is present — plain npm install, unbundled arch), (5) none →
  graceful degradation + an actionable install hint in the panel.
- **Electron bundling (delivered method), scoped to available prebuilts.** Mirror
  the existing git/node bundling: a build-time `download-codegraph.mjs`
  (pinned + sha256, resolves `npm_config_target_arch`) drops the per-arch binary
  into `resources/codegraph/`, listed as an `extraResource` in `forge.config.ts`;
  runtime resolves it via `process.resourcesPath`. Bundle **only targets where
  CodeGraph publishes a prebuilt binary**; other targets fall back to rung 4.
  The rung-4 `npm install -g` can reuse Electron's already-bundled node/npm.
- **Docker peer carry (opt-in)** — the `ARG CODEGRAPH_ENABLED=0` build-arg
  (details in Out of scope) sits on the same ladder (rung 3, PATH).
- **Deprecate `add-kb-code-symbol-index`.** Do not implement the in-kb
  tree-sitter extractor. The code plane is federated, not absorbed.

Out of scope (deferred behind the driver/tool seam, no core rework — refined
stances below so a follow-up doesn't re-litigate):

- **Cross-plane linking → NOT a graph-schema change.** Two separate stores mean
  kb's single-DB `neighbors`/`backlinks` CTE cannot JOIN to `.codegraph`, so
  materialized cross-plane edges are out. The useful 80% is a **read-time,
  name-keyed federation** where the symbol name is the join key: an optional
  `codegraph_explore` result footer ("📄 documented in: …") computed by
  `codegraph-plugin` calling kb's existing `/api/kb/search` REST endpoint by
  symbol name. Direction: **code→doc first** (an agent editing a symbol asking
  "is this documented?" is the higher-value query). Coupling is read-time,
  optional, HTTP-level (categorically weaker than the index-time package
  coupling this change rejects), and feature-flagged
  (`CODEGRAPH_CROSSREF_DOCS`, off by default). kb's dormant `entity` node type
  stays reserved for a later *annotated* materialized version if authors ever
  emit `[[sym:…]]` links — not needed for the read-time footer.
- **Unified `kb_explore` fan-out tool → measure-first.** Ship two tools +
  guidance row (kb already proves guidance steers agents). Instrument the
  mis-pick signal (agent calls `kb_search` for a clearly code-structural
  question, gets nothing, falls back to `grep`). Only build `kb_explore` if that
  rate is real — and then as **safe one-or-both classification**: a cheap
  heuristic may *skip* an irrelevant plane as an optimization but never
  *excludes* a plane it should include, so a misclassification costs an extra
  query, never hides a plane (inverting the misroute risk that rules out a
  two-tool classifier).
- **CodeGraph's native FS watcher / auto-sync daemon** — deliberately disabled
  in favor of the lazy pull model; no background process is introduced.
- **Docker peer-binary carry → `ARG CODEGRAPH_ENABLED=0` build-arg.** The whole
  code plane is optional and a 20-language parser binary is not tiny, so bake it
  in only when built with the flag (lean default image, no runtime network dep —
  beats entrypoint lazy-install for air-gapped). Pin the version via the
  existing `npm install -g` line (native binary, arch handled) or a zrok-style
  pinned tarball + sha256 if standalone. `.codegraph/` persists per-worktree in
  the workspace mount for free (no extra VOLUME, unlike `~/.zrok2`); gitignore
  it. **Non-interactive install MUST run `codegraph telemetry off`** — baking in
  a tool with its own outbound phone-home while `add-universal-network-guard` is
  in flight is a network-posture risk (see Discipline Skills).

Known cost (accepted): CodeGraph parses *all source*, so each worktree's first
`init` is a full-repo parse with no cross-worktree index sharing — heavier than
kb's markdown-only index. Incremental `sync` is content-hash cheap thereafter;
the write-hook debounce collapses edit bursts; connect-time reconciliation
self-heals a skipped sync on the next explore.

## Capabilities

### Added Capabilities

- `codegraph-code-plane` — a standalone package family (`codegraph-driver` +
  `codegraph-extension` + `codegraph-plugin`) mirroring kb's 3-slot shape, that
  federates the external CodeGraph CLI as the code plane: a `codegraph_explore`
  tool with lazy per-worktree/no-daemon lifecycle, a docs-first guidance row for
  discovery, graceful degradation when absent, and a dashboard settings/health
  UI. `packages/kb` and `packages/kb-extension` are untouched; two separate
  stores.

### Removed Capabilities

- `code-symbol-index` (proposed by `add-kb-code-symbol-index`) — superseded. The
  code plane is federated via CodeGraph rather than built into `packages/kb`.

## Discipline Skills

- `doubt-driven-review` — federate-vs-absorb, standalone-family-vs-router, and
  CLI-vs-MCP transport are near-irreversible decisions that supersede an
  existing proposal; stress-test before the family stands.
- `security-hardening` — the driver spawns an external binary and passes its
  JSON output into agent context; audit argument construction (no shell
  injection from query text), binary-path resolution/trust, and the untrusted
  nature of indexed third-party source surfaced through the tool. Additionally:
  the Docker carry bakes in a tool with its own anonymous telemetry / outbound
  endpoint while `add-universal-network-guard` is landing — the non-interactive
  install MUST disable telemetry (`codegraph telemetry off`) and the outbound
  endpoint must be reconciled with the network guard.
- `observability-instrumentation` — a federated index has its own freshness; the
  extension and the plugin's health panel must surface CodeGraph's staleness /
  presence state so a missing or stale code index is visible, not silent.
