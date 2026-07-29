# Understand-Anything × pi-dashboard — Research Dossier

> Status: **research / pre-planning** (explore mode output, no implementation).
> Goal: research [Egonex-AI/Understand-Anything](https://github.com/Egonex-AI/Understand-Anything), map which of its parts pi-dashboard already implements (differently), and identify the genuinely missing functionality adaptable to the kb system and dashboard.
> Date: 2026-07-23.
> Prompt origin: "most of the parts already implemented in pi-dashboard in a different way. Adapt missing functionality to use skills and tools defined in this repo. What can be used, what is adaptable to kb and pi dashboard."

---

## 1. TL;DR / Recommendation

- Understand-Anything (UA) is MIT-licensed (Yuxiang Lin / Infinite Universe, Inc.). TypeScript. It turns any codebase/knowledge-base/docs into ONE `.ua/knowledge-graph.json` (nodes + edges + layers + tour + project meta) and opens it in a React/ReactFlow visual dashboard.
- **~70% of UA's engine is redundant** with what pi-dashboard has shipped or has in-flight. pi-dashboard already made the opposite architectural bet: split the concern into *planes as SQLite stores with pull/progressive-disclosure retrieval* instead of pushing one big graph JSON to a human dashboard.
- The genuine GAP is UA's "graphs that **teach**" layer: an **interactive visual graph explorer** and **guided tours**. pi-dashboard produces `nodes`/`edges` (kb Tier-1 graph) but has NO viewer — the dashboard client monitors sessions, it does not render the knowledge graph.
- **Chosen adaptation (user-selected): a kb graph-visualization panel** in `packages/kb-plugin`. MIT license + React-19-to-React-19 + an existing kb-plugin server-API/client-hook/settings-panel seam make it a bounded change. It is useful on day one over the shipped zero-LLM Tier-1 graph, and auto-enriches as the two in-flight LLM/code changes land.
- Do NOT adopt UA as a system — that would import a competing architecture and duplicate your own invariants (kb is `node:sqlite`, zero-dep, "never executes source"; the code plane is deliberately *federated* to CodeGraph, not absorbed).

---

## 2. What Understand-Anything actually is

A single-artifact system. Parse a repo → emit one `.ua/knowledge-graph.json` → explore it in a React/ReactFlow dashboard (or a standalone zero-dep Node viewer for committed graphs).

```
   SOURCE  ─►  ┌── deterministic plane (tree-sitter) ──┐
               │  40+ language configs, per-language   │
               │  extractors, framework registry;      │
               │  imports/exports/calls/inherit, path:ln│      ┌─────────────────────┐
               │  fingerprint-based incremental update  │ ─►   │ .ua/                │
               └────────────────────────────────────────┘      │  knowledge-graph.json│ ─► React/ReactFlow
               ┌── semantic plane (LLM) ────────────────┐ ─►   │  {nodes, edges,     │     dashboard
               │  reads parsed structure + source →      │      │   layers, tour,     │     (or zero-dep
               │  summaries, tags, arch LAYERS, guided   │      │   project}          │      Node viewer)
               │  TOURS, business DOMAINS, lang callouts │      └─────────────────────┘
               └────────────────────────────────────────┘
```

Two planes feed the JSON:

- **Deterministic (tree-sitter):** parses source into a syntax tree; extracts structural facts (imports, exports, function/class definitions, call sites, inheritance) as `path:line[:col]`. Same input → same output. Powers fingerprint-based change detection for incremental updates.
- **LLM (semantic):** reads the parsed structure alongside the original source to produce what parsers cannot — plain-English summaries, tags, architectural layer assignments, business-domain mapping, guided tours, language-concept callouts.

**Skills / slash commands:** `/understand`, `/understand-chat`, `/understand-explain`, `/understand-diff`, `/understand-onboard`, `/understand-domain`, `/understand-knowledge` (Karpathy-pattern LLM wiki), `/understand-figma`, `/understand-dashboard`.

**Sub-agents:** `project-scanner` (discover files, detect languages/frameworks), `file-analyzer` (extract functions/classes/imports → nodes+edges), `architecture-analyzer` (identify layers), `tour-builder` (guided tours), `graph-reviewer` (validate completeness/referential integrity), `domain-analyzer` (business domains/flows), `article-analyzer` (wiki entities/claims), `design-analyzer` (Figma), `assemble-reviewer`, `knowledge-graph-guide`.

**Graph schema (from `packages/core/src/schema.ts`):** node types include function/class/module/file/service/document/pipeline/endpoint/config/resource/table/schema plus domain/flow/step (domain plane) and article/entity/topic/claim/source (knowledge plane); 38 edge types across 9 categories (Structural, Behavioral, Data-flow, Dependencies, Semantic, Infrastructure, Schema/Data, Domain, Knowledge, Design). Top-level `KnowledgeGraphSchema = { version, kind: codebase|knowledge|design, project, nodes, edges, layers, tour }`. Search is fuse.js fuzzy over node name/etc.

**Dashboard (`packages/dashboard`, React 19):** ReactFlow (`@xyflow/react`) canvas; ELK (`elkjs`) + dagre + d3-force layouts; graphology + `graphology-communities-louvain` community clustering; SearchBar, NodeInfo, Breadcrumb, FilterPanel, PathFinderModal, LayerLegend, guided-tour LearnPanel, themes, i18n, mobile, CodeViewer, ExportMenu; zustand store.

---

## 3. Component-by-component: UA vs pi-dashboard

```
                 UNDERSTAND-ANYTHING              PI-DASHBOARD EQUIVALENT              STATUS
  ┌───────────────────────────────────┬──────────────────────────────────────┬──────────────────┐
  │ tree-sitter structural extraction │ add-codegraph-code-plane (federate    │ in-flight        │
  │ (imports/calls/inherits, path:ln) │  external CodeGraph binary; 20+ langs, │ (SUPERSEDES the  │
  │                                   │  resolved refs, blast radius)          │  in-kb extractor)│
  ├───────────────────────────────────┼──────────────────────────────────────┼──────────────────┤
  │ LLM semantic plane (summaries,    │ add-kb-semantic-annotation-plane       │ in-flight        │
  │  tags, layers)                    │  (Tier-2; schema.org+SKOS ontology,    │                  │
  │                                   │  review queue, typed entity/edges)     │                  │
  ├───────────────────────────────────┼──────────────────────────────────────┼──────────────────┤
  │ deterministic graph over docs     │ kb Tier-1 graph (child_of/links_to/    │ SHIPPED          │
  │                                   │  references/has_tag over markdown)     │                  │
  ├───────────────────────────────────┼──────────────────────────────────────┼──────────────────┤
  │ fuse.js fuzzy search              │ kb_search (FTS5 + BM25) + codegraph    │ SHIPPED (better  │
  │                                   │  FTS5                                   │  for prose)      │
  ├───────────────────────────────────┼──────────────────────────────────────┼──────────────────┤
  │ /understand-chat (Q&A over graph) │ the pi agent loop itself + kb_search / │ SHIPPED natively │
  │                                   │  codegraph_explore                     │                  │
  ├───────────────────────────────────┼──────────────────────────────────────┼──────────────────┤
  │ fingerprint incremental update    │ kb content-hash gate / codegraph sync  │ SHIPPED          │
  ├───────────────────────────────────┼──────────────────────────────────────┼──────────────────┤
  │ .understandignore generator       │ kb ignore config                       │ SHIPPED          │
  ├───────────────────────────────────┼──────────────────────────────────────┼──────────────────┤
  │ interactive graph VISUALIZATION   │ (none — client monitors sessions only) │ MISSING ★        │
  │ guided TOURS / onboarding         │ (none)                                 │ MISSING ★        │
  │ architectural LAYERS + coloring   │ partial via annotation plane; no viz   │ PARTIAL          │
  │ /understand-diff (PR explanation) │ adaptable as skill on codegraph+kb     │ MISSING (cheap)  │
  │ domain-analyzer (business flows)  │ (none)                                 │ OUT OF SCOPE     │
  │ understand-figma (design plane)   │ (none)                                 │ OUT OF SCOPE     │
  └───────────────────────────────────┴──────────────────────────────────────┴──────────────────┘
```

**Key philosophical difference.** UA pushes a whole graph JSON into a human dashboard (push model, everything client-side). pi-dashboard deliberately splits the same concern into planes as SQLite stores with pull-retrieval / progressive disclosure (the agent pays zero tokens until it searches). Most of UA's *engine* is therefore redundant; the *visualization + teaching* layer is what pi-dashboard lacks.

**In-flight OpenSpec changes that already mirror UA's engine** (found under `openspec/changes/`):

- `add-codegraph-code-plane` — federate the external CodeGraph CLI (20+ languages, resolved references, blast radius) as a standalone package family (`codegraph-driver` + `codegraph-extension` + `codegraph-plugin`) mirroring kb's 3-slot shape; two separate stores; lazy per-worktree, no daemon; graceful degradation. Explicitly **supersedes** `add-kb-code-symbol-index`.
- `add-kb-code-symbol-index` — **SUPERSEDED, do not implement.** Would have absorbed a tree-sitter symbol extractor INTO `packages/kb`. Rejected because tree-sitter is a native binding (kb is `node:sqlite`-only, zero-dep) and parsing source violates kb's "never executes source" invariant.
- `add-kb-semantic-annotation-plane` — a Tier-2 LLM enrichment plane, opt-in, write-time, quarantined UPSTREAM of frontmatter. Reads document bodies, classifies against a vendored schema.org-core + SKOS-subset ontology, writes a machine-managed `kb:` frontmatter block; the deterministic indexer then emits typed `entity` nodes + typed CURIE edges FROM that block (still zero-LLM). Open-world review queue; provenance/regen protocol; `kb neighbors --rel <curie>` filtering.
- `add-automatic-session-kb-index` — auto-index sessions into kb.

---

## 4. What's already covered (do NOT rebuild)

- **Structural graph** → kb Tier-1 (docs plane) + federated CodeGraph (code plane).
- **LLM semantic layer** → `add-kb-semantic-annotation-plane` (Tier-2, quarantined, reviewable).
- **Search** → `kb_search` (FTS5 + BM25) is superior to fuse.js for prose; CodeGraph FTS5 for symbols.
- **Q&A over the graph** → UA's `/understand-chat` is essentially what the pi agent already does natively via `kb_search` / `codegraph_explore`. No separate chat surface needed.
- **Incremental updates** → kb content-hash gate; `codegraph sync`.
- **Ignore handling** → kb ignore config.

Rebuilding any of these would fight pi-dashboard's own invariants and duplicate mature work.

---

## 5. What is genuinely missing and adaptable

Ranked by value / fit:

1. **Interactive graph visualization (the big one).** pi-dashboard has the graph DATA (`nodes`/`edges`) but no visual explorer. UA's `packages/dashboard` (ReactFlow + ELK/force layout + Louvain community clustering + filters + node-info + breadcrumb + path-finder) is the most adaptable artifact. Natural home: a `kb-plugin` dashboard panel reading the kb graph via the existing `/api/kb` server API. *This is the chosen adaptation — detailed in §6.*
2. **Guided tours / onboarding** (`tour-builder`, `/understand-onboard`). UA's `tour` array = an ordered, narrated walkthrough of key nodes. pi-dashboard has no equivalent. Adaptable either as a `tour` field on the kb graph populated by the semantic-annotation plane, or a standalone skill `onboard-repo` emitting an ordered tour doc. Low cost, high onboarding value — it is the actual "graphs that teach" thesis.
3. **Architectural layers** (`architecture-analyzer`). Assigns each node a layer and colors the graph by it. Overlaps heavily with the semantic-annotation plane (a `layer` predicate in the ontology yields the data); visualization needs #1.
4. **Diff / PR explanation** (`/understand-diff`). "What does this change do + blast radius," using the graph. Adaptable as a skill on top of `codegraph_explore` (blast radius) + kb (docs context). No new engine.
5. **Language/framework concept callouts** — teaching notes; minor; could ride the annotation plane.

Likely OUT OF SCOPE for a dev-ops dashboard: `understand-domain` (business-flow modeling), `understand-figma` (design plane).

---

## 6. Chosen adaptation — kb graph-visualization panel

### 6.1 License & stack fit (all green)

- UA is **MIT** — lift/adapt with an attribution notice; no copyleft risk.
- pi-dashboard client is `packages/client` (**React 19**); dashboard plugins ship client slot components via a manifest → generated plugin-registry. UA's dashboard is also **React 19** → direct component portability.
- UA's graph libs are all MIT and **absent** from pi-dashboard's tree (add fresh, no conflict): `@xyflow/react`, `elkjs` + `@dagrejs/dagre`, `d3-force`, `graphology` + `graphology-communities-louvain`, `zustand`, `react-markdown`, `prism-react-renderer`.
- The seam already exists in `packages/kb-plugin`: a server API (`src/server/kb-routes.ts`, `/api/kb`), client data hooks (`useKbStats.ts`, `kb-api.ts`), and a settings panel (`KbSettingsPanel.tsx`) registered via manifest claims. A graph panel is a NEW client slot + ONE new read route serving the Tier-1 `nodes`/`edges`.

### 6.2 The actual kb Tier-1 contract (shipped, `packages/kb/src/types.ts`)

```
GraphNode { type: "file"|"heading"|"tag"|"entity",
            name: string,
            path: string|null }
GraphEdge { src: name, dst: name,
            rel: "child_of"|"links_to"|"references"|"has_tag",
            weight? }
KbStore API: neighbors(node, depth, rel?) · backlinks(node) ·
             counts() {files,chunks,nodes,edges}
```

Decisive fact: **Tier-1 carries no semantic payload** — no `summary`, `layer`, `complexity`, or `lineRange` (the opposite of UA's dense node). Node identity is the `name` string (headingPath for headings, path for files, `tag:X` for tags). `links_to`/`references` create a virtual `{type:"file", path:null}` node for unresolved targets.

### 6.3 The transform, field by field

```
   VIEWER NEEDS          kb Tier-1 HAS              RESOLUTION
  ┌────────────────┬──────────────────────┬───────────────────────────────────┐
  │ stable node id │ name (string) is key │ use name as id — no numeric id    │
  │ shape / color  │ 4 types only         │ 4-symbol palette (file/heading/   │
  │                │                      │  tag/entity) — NOT UA's ~20 code  │
  │                │                      │  types; simpler, honest           │
  │ label          │ name                 │ truncate heading breadcrumb leaf  │
  │ open-in-file   │ path (null for tags/ │ null nodes = "virtual" (unresolved│
  │                │  unresolved links)   │  wikilink / tag) → render dashed  │
  │ edge style     │ 4 rels               │ 4 edge styles, 1:1               │
  │ tooltip/summary│ ✗ NONE               │ lazy: kb_get first chunk on click │
  │                │                      │  (v1) → annotation plane (v2)     │
  │ layer grouping │ ✗ NONE               │ Louvain community detection —     │
  │                │                      │  UA already ships louvain.ts,     │
  │                │                      │  zero-LLM, deterministic          │
  └────────────────┴──────────────────────┴───────────────────────────────────┘
```

Reframe: do NOT hardcode UA's code-plane taxonomy. Build the panel to render whatever node `type`s and `rel`s exist in the store, so it works today on 4 structural types and automatically absorbs the `entity` nodes + typed CURIE edges the semantic-annotation plane adds later — same viewer, richer data.

### 6.4 What to adapt vs skip from UA's `packages/dashboard`

- **Adapt (substrate-agnostic):** `utils/elk-layout.ts`, `utils/louvain.ts`, `utils/force-layout.ts`, `components/GraphView.tsx`, `SearchBar`, `NodeInfo`, `Breadcrumb`, `FilterPanel`, `store.ts` (zustand).
- **Skip:** `KnowledgeGraphView` / `DomainGraphView` / `FlowNode` / `StepNode` (UA's domain/knowledge/design planes — not this data model), `TokenGate`, `PersonaSelector`, i18n/themes (pi-dashboard has its own theme-system), `CodeViewer` (kb points at files opened normally).
- **Rewrite the data contract:** the viewer keys off the kb schema; the semantic-annotation plane later enriches nodes with tags/layers UA colors by.

### 6.5 Two design wrinkles to resolve before a proposal

1. **No "dump the graph" API.** KbStore exposes only `neighbors(node, depth)` and `counts()`. Route options: (a) bounded BFS — `GET /api/kb/graph?root=<name>&depth=<n>` walks `neighbors` from a seed and returns the induced subgraph (respects pull/progressive-disclosure, bounds payload, needs a sensible default seed); (b) full dump — add `dumpGraph()` (`SELECT * nodes/edges`) guarded by `counts().nodes < threshold` + `?full=1`. Lean: (a) as default, (b) behind a node-count guard for small repos.
2. **Heading node identity can collide.** `addNode({type:"heading", name: c.headingPath})` keys on the breadcrumb string. Two files with the same breadcrumb produce the same node name but different `path` → a name-keyed graph would merge them. This is a kb-model wrinkle the panel inherits: either tolerate occasional merges, or a follow-up kb change keys heading nodes as `path#headingPath`. Name it in design.md as a known limitation vs. a prerequisite.

### 6.6 Staging (useful day one, strictly improves as in-flight changes land)

```
   v1 (ships on Tier-1 today, zero-LLM):
     structural map of docs + AGENTS.md tree + wikilink/reference cross-links,
     colored by Louvain community, click → lazy kb_get first-chunk summary.
     Honest about being structure-only.

   v2 (auto-enriches when add-kb-semantic-annotation-plane lands):
     same viewer gains entity nodes, typed CURIE edges, real tags/layers →
     color key flips from "community" to "layer", tooltips get real summaries.

   v3 (when add-codegraph-code-plane lands):
     optional second edge/node source overlaid — code plane in the same canvas,
     two stores, name-keyed federation (matches that change's stated direction).
```

The panel has NO dependency on the two in-flight LLM/code changes — it improves as they land, with no rework, just richer input.

### 6.7 Proposed package shape (mirrors kb-plugin conventions)

```
   kb SQLite (nodes/edges — SHIPPED)
             │
             ▼
   NEW read route: GET /api/kb/graph  ── kb-routes.ts
     → { nodes, edges }  (+ optional ?root= / ?depth= scoping)
             │
             ▼
   NEW client slot: KbGraphPanel.tsx  (kb-plugin manifest claim)
     adapt from UA: GraphView + elk-layout + louvain clustering
     + SearchBar + NodeInfo + Breadcrumb + FilterPanel
             │
             ▼
   later: overlay codegraph plane (once add-codegraph lands) as a
          second edge/node source — same viewer, two stores
```

Change surface: new capability `kb-graph-view`; modifies `kb-plugin` (one server route + one client slot + three graph deps); kb core untouched; MIT attribution file added.

---

## 7. Open decisions before scaffolding an OpenSpec change

- **Seed/scoping default** for the graph route — bounded-BFS-from-root vs full-dump-under-threshold.
- **Color key for v1** — Louvain community (lean) vs flat-by-type vs by-source-root.
- **Heading collision** — tolerate in panel, or require the `path#headingPath` kb fix first.
- **Panel placement** — new tab in the existing `KbSettingsPanel`, or a standalone dashboard route/canvas.

---

## 8. Sources

- Understand-Anything repo: https://github.com/Egonex-AI/Understand-Anything (MIT; TypeScript). Key paths inspected: `understand-anything-plugin/packages/core/src/schema.ts` (nodes/edges/38 edge types), `.../packages/core/src/search.ts` (fuse.js), `.../packages/dashboard/` (React 19; `@xyflow/react`, `elkjs`, `graphology-communities-louvain`, zustand; `utils/{elk-layout,louvain,force-layout}.ts`), `.../skills/{understand,understand-chat,understand-knowledge}/SKILL.md`, `.../agents/*.md`, `LICENSE`.
- pi-dashboard kb contract: `packages/kb/src/types.ts` (GraphNode/GraphEdge/KbStore), `packages/kb/src/indexer.ts` (child_of/links_to/references/has_tag emission), `packages/kb/src/sqlite-store.ts` (neighbors/backlinks/counts).
- pi-dashboard kb-plugin seam: `packages/kb-plugin/src/server/kb-routes.ts`, `.../client/{KbSettingsPanel.tsx,useKbStats.ts,kb-api.ts,index.tsx}`.
- In-flight OpenSpec changes: `openspec/changes/add-codegraph-code-plane/proposal.md`, `openspec/changes/add-kb-semantic-annotation-plane/proposal.md`, `openspec/changes/add-kb-code-symbol-index/proposal.md` (superseded), `openspec/specs/markdown-knowledge-base/spec.md`.
- Client stack: `packages/client/package.json` (React 19); no graph libs present anywhere in the tree.
