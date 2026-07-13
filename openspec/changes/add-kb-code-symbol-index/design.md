# Design — code symbol index

## The engine fork (the real decision)

Three ways to get symbols out of source. Only one is "LSP." The choice is a
precision/operational-cost tradeoff, not a quality ladder.

| Axis | Live LSP (rust-analyzer, gopls, pyright, tsserver, jdtls, clangd) | SCIP / LSIF (precomputed index) | tree-sitter tags |
|---|---|---|---|
| Gives | live def/refs/call-hierarchy/types | def + resolved cross-file xref | defs + heuristic refs |
| Model | 1 stateful daemon per language per root | run indexer → emit index file → load | pure function, per file |
| Cold cost | 30–60s warm-up (jdtls/rust-analyzer) | seconds–minutes full pass | ms per file |
| Ops surface | crash/restart/timeout mgmt, RAM heavy | rerun on change, artifact mgmt | zero state, embeddable |
| Fit as *indexer* | poor (protocol assumes open editor) | good (built for batch xref) | excellent (fast, uniform) |

**Decision: tree-sitter for the MVP.** It answers the stated primary job —
navigation ("find the method, jump to position") — across all six languages with
one uniform mechanism, no daemons, and reuses the KB's existing incremental gate.
Precise xref (SCIP) and live enrichment (LSP) are deferred *behind the same
`nodes`/`edges` seam*, so shipping nav now does not preclude precision later.
This mirrors how `add-connector-layer` staged capability behind a `kind`
discriminator.

## Tree-sitter integration (the concrete mechanics)

### Binding: WASM, not native

Two runtimes exist. For a cross-platform Electron app the choice is decisive:

| | `node-tree-sitter` (native) | `web-tree-sitter` (WASM) |
|---|---|---|
| Build | native addon (node-gyp) | pure WASM, no compile |
| Distribution | prebuild per os×arch×NodeABI (node-pty-class pain) | **one `.wasm` runs everywhere** |
| Parse speed | ~2–3× faster | slower — but the sha256 gate means a warm reindex parses ~nothing, so irrelevant |
| Precedent | — | VS Code uses exactly this |

**Decision: `web-tree-sitter` (WASM).** Architecture-independent grammar
artifacts eliminate the per-platform prebuild matrix the design otherwise fears.

### What ships — and what is *not* authored

The heavy per-language IP is pre-solved and permissively licensed; the extractor
vendors it rather than writing it.

```
web-tree-sitter          npm dep (1). The WASM runtime.
<lang>.wasm   × N         VENDORED grammar assets (tree-sitter-wasms /
                         tree-sitter-language-pack). NOT authored.
<lang>-tags.scm × N       VENDORED capture queries — the file that knows
                         "a Rust `fn` is a definition, a call is a reference."
                         Maintained upstream (language-pack / nvim-treesitter).
                         THIS is the hard part, and it already exists.
```

### The extraction loop (language-agnostic)

One loop over all languages. This is `extractSymbols()`:

```ts
await Parser.init();                       // WASM boot, once
const lang = await Language.load('rust.wasm');  // cache per language
const parser = new Parser();
parser.setLanguage(lang);
const tree = parser.parse(source);
for (const { node, name } of lang.query(tagsScm).captures(tree.rootNode)) {
  if (name.startsWith('name.definition.')) …  // → nodes(type=symbol)+defined_in
  else if (name.startsWith('name.reference.')) … // → edges(references, candidate)
}
```

The `name.definition.*` / `name.reference.*` capture convention maps 1:1 onto the
spec's `defined_in` vs candidate `references` split — no translation layer.

### How many languages — data-driven registry, tiered coverage

`tree-sitter-language-pack` ships **306 grammars with bundled `tags` queries and
on-demand download**. So "support all of tree-sitter" is a curation decision, not
an engineering one — with two constraints:

1. **Tags gate.** A grammar yields a parse tree; only languages that ship a
   `tags.scm` yield *symbols*. `highlights.scm` ≈ universal; `tags.scm` ⊂ that.
   Symbol support therefore covers the tags-capable subset (all popular langs).
2. **Asset wall.** 306 × ~1.5 MB ≈ 400–500 MB — untenable to bundle.

Resolution — the language set is a **registry, never a hardcoded list**:

```
languageRegistry: Record<lang, {
  ext: string[];          // .rs .py …
  wasm: path | url;       // bundled (core tier) OR lazy-fetch url (tail)
  tagsScm: path | null;   // null → parse-only, no symbols
  tier: 'core' | 'lazy';
}>
```

- **Core tier** bundles eagerly → guaranteed offline. Selection rule:
  **has a maintained `tags.scm` AND top-tier popularity.** Concrete **Core-16**:
  `typescript javascript tsx/jsx python go rust java c cpp c-sharp ruby php
  kotlin bash lua scala`. The original six (py/java/ts/go/rust/c-cpp) are the
  non-negotiable heart; the rest cover a real polyglot repo. ~15–20 MB.
- **Lazy tier** fetches the grammar `.wasm` on first encounter, caches locally
  → "all 306" reachable, ~15 MB shipped. Gated — see next section.
- The core/lazy boundary is the registry's `tier` flag — movable without code
  (a TS-heavy repo may promote/demote a language).
- Adding a language = one registry row + two files (or a lazy URL). Zero code.
- `symbols.languages` config *filters* this registry.

### Reproducibility & supply-chain (the lazy-fetch tension)

Runtime grammar download contradicts the KB's own DNA
(`markdown-knowledge-base`: *offline, no server, **reproducible reindex***).
Three violations, and the reconciliation:

```
  lazy-fetch a grammar at index time
    ├▶ network at index time      → breaks "offline / no server"
    ├▶ "latest" grammar drifts     → same repo, two machines, different
    │                                symbols → breaks REPRODUCIBLE reindex
    └▶ downloads EXECUTABLE .wasm  → supply-chain surface (MITM / bad host)
```

WASM caps the blast radius: the runtime is **sandboxed** (no syscalls, no fs, no
net) — a hostile grammar can poison symbol *data* or DoS, but **cannot RCE**,
unlike a native `node-tree-sitter` addon. Another point for the WASM binding.

Reconciling design (not "don't" — "don't lie to the DNA"):

- **Core tier**: vendored + **version-pinned**, shipped in-app → always offline,
  always reproducible.
- **Lazy tier**: **opt-in** (`symbols.allowDownload: true`, default `false`).
  The registry carries a **SHA-256 per grammar**; a downloaded `.wasm` is
  verified against it and **refused on mismatch**; cache is **content-addressed**.
  Pinning by **hash, not version**, keeps symbol output reproducible even for the
  long tail, and the integrity check closes MITM. WASM sandbox caps RCE.

Default posture: offline core only. The 306-language reach is a deliberate,
integrity-gated opt-in — never the silent default.

### Packaging + dep-hygiene gotchas

- **`asarUnpack`.** Electron packs into `app.asar`; the WASM runtime reads
  grammar files from disk, so `<lang>.wasm` + `<lang>-tags.scm` must be
  `asarUnpack`ed (or served via emscripten `locateFile`). This is the entire
  packaging cost — trivial vs native prebuilds.
- **Keep `kb` core dep-free.** `packages/kb` runs on `node:sqlite` with zero
  runtime deps. Symbols is an **optional, lazily-imported sub-module**: the
  `web-tree-sitter` import fires only when `symbols.enabled` AND a source file is
  seen. Disabled-by-default stays a true no-op with zero added load cost.

## Data model — reuse, don't extend the schema

No DDL migration. Both new tables already exist.

```
nodes                          edges
  id                             src  ─┐
  type = 'symbol'   ← NEW value  dst   │ defined_in : symbol → file   NEW rel
  name = 'parseConfig'           rel  ─┘ references : symbol → symbol NEW rel
  path = 'src/config.ts'         weight            (candidate, heuristic)

chunks (FTS5)
  doc_type = 'symbol'   ← NEW value
  heading  = 'parseConfig (function)'
  body     = signature line + docstring/leading comment (bounded)
  path/level carry position; a resolver maps chunk → path:line
```

### Name collisions — node = concept, edges carry the specifics

`nodes.UNIQUE(type,name)` allows one row per `(type,name)`. But real code has
**many defs of one name** — `parseConfig` in three files, or C++/Java overloads
(`foo(int)` vs `foo(str)`) that share every qualifier. Options considered:

```
  A. name = "path::container::symbol"   unique, but name becomes a path → bare
     (fully-qualified)                   "parseConfig" search misses unless FTS
                                         also carries the bare name.
  B. UNIQUE(type,name,path,line)         cleanest keys, but MIGRATES the SHARED
                                         nodes table the markdown KG depends on.
  C. name = bare symbol; node = the      one node per name; overloads/duplicates
     *concept*, each def is a distinct    = N defined_in edges, each to its file
     defined_in edge w/ path:line.        node with line on the edge.  ◄ CHOSEN
```

**Decision: option C.** It is the most faithful to the existing graph model
(a node is a name/concept; relations hang off edges, exactly as the markdown
graph already treats nodes), keeps `UNIQUE(type,name)` intact (no shared-DDL
migration — rules out B's blast radius), and makes bare-name search work (rules
out A's miss). Overloads/duplicate defs model naturally as multiple `defined_in`
edges, each carrying its own `path:line`. The FTS5 chunk still carries the
positioned, container-qualified detail for display/disambiguation.

## Extraction flow (deterministic, LLM-free)

```
source file ──► language detect (ext) ──► tree-sitter parse
                                              │
                                        tags query (per grammar)
                                              │
                         ┌────────────────────┼───────────────────┐
                         ▼                    ▼                    ▼
                   definitions          reference sites      leading comment
                   (func/class/…)       (name matches)       (bounded body)
                         │                    │                    │
                   nodes(type=symbol)   edges(references,     chunks(doc_type
                   + edges(defined_in)  candidate)            = symbol, FTS5)
```

Runs inside the *same parse pass ethos* as the markdown indexer. No model, no
network. Reference edges are explicitly **candidate** (name-match heuristic, not
resolved) — honest labeling prevents misuse for refactor. Precise edges arrive
with the SCIP phase and *replace* candidate edges for covered languages.

## SCIP precise-xref phase (deferred — the seam is real, not aspirational)

The MVP's `references` edges are name-match candidates. Refactor-grade "every
caller of X" needs *resolved* xref, which needs type/build context — SCIP's job.
Deferred, but sketched concretely so the seam is provably additive:

```
  MVP (tree-sitter)          PHASE 2 (SCIP)                same nodes/edges tables
  ─────────────────          ──────────────                ──────────────────────
  references:candidate  ──►  scip-<lang> emits index  ──►  UPGRADE the edge rel:
  (name-match)               (resolved occurrences)         references:candidate
                                                            → references:resolved

  indexers, run like a linter:
    scip-typescript · scip-python · scip-go
    rust-analyzer --scip · scip-java · scip-clang
         │  parse SCIP protobuf → occurrences + symbol roles (def/ref)
         ▼  replace candidate edges for COVERED langs;
            tree-sitter candidates REMAIN the fallback for uncovered langs
```

Why deferring is safe — three seam properties:

- **Additive & per-language.** SCIP lands one language at a time; unsupported
  languages keep tree-sitter candidates. No big-bang.
- **Zero schema change.** `edges.rel` is free-text — `references:candidate` vs
  `references:resolved` already fits. Same tables, same `find_symbol` surface.
- **Reversible.** An edge upgraded to resolved can fall back to candidate if the
  indexer is removed. Mirrors `add-connector-layer`'s `kind` staging.

The one real cost: SCIP indexers are **per-language toolchains** (each needs the
language's compiler/build to resolve types) — reintroducing some of the
operational weight tree-sitter avoided. So SCIP is **opt-in enrichment** for
repos that want refactor-grade xref, never the baseline.

## Retrieval — pull, never push (two layered surfaces)

Both surfaces are pull-only (satisfies the existing "LLM-facing pull retrieval,
not push injection" requirement). No symbol data ever enters a prompt unbidden —
physically it cannot, because retrieval is scoped and progressive. The insight:
**BM25 full-text ranking is the wrong model for "go to definition."** So symbols
get two surfaces, not one:

| Surface | Backed by | Job |
|---|---|---|
| `kb_search` (exists) | FTS5 `doc_type='symbol'` | fuzzy **discovery** — "something about parsing config" |
| `find_symbol(name, kind?, lang?)` (new) | `nodes`/`edges` direct query | precise **navigation** — exact/qualified `name → path:line` + candidate callers |

```
kb_search("get")    → BM25 over every chunk containing "get"; the def ranks
                      ... somewhere. Fine for discovery, fragile for nav.
find_symbol("get")  → exact match on nodes(type=symbol); top result IS the def
                      + its candidate callers. Deterministic. ~180 bytes.
```

`find_symbol` ships as a `pi.registerTool()` in the existing `kb-extension`
(seam confirmed in research), with a `promptSnippet` so the model discovers it.
MVP MAY land symbols-in-FTS first (`kb_search` works immediately); `find_symbol`
is the precise layer on top. This mirrors real code-intel: text search ≠ symbol
resolution.

## Incremental & lifecycle (already solved)

The `files` table tracks `mtime_ms` + `sha256`. Symbol extraction reuses it
verbatim: unchanged sha → skip; changed → replace that file's symbol nodes +
outbound edges + symbol chunks; deleted → remove nodes-as-source + edges, keep
inbound. No new staleness machinery.

## Config & settings

`kb` config layering (`markdown-knowledge-base` "Project and global
configuration layering") gains a `symbols` block:

```jsonc
"symbols": {
  "enabled": false,               // opt-in; default no-op
  "engine": "tree-sitter",        // future: "scip", "lsp"
  "allowDownload": false,         // opt-in lazy tier; default offline core only
  "languages": ["ts","py","go","rust","java","c","cpp"], // filters the Core-16 registry
  "ignore": ["**/dist/**","**/vendor/**","**/*.min.js"]
}
```

Settings panel (rides the existing KB index-health UI):

```
  ┌─ Knowledge Base ▸ Code Symbols ────────────────────┐
  │  ◉ Enable symbol indexing            [ off | on ]     │
  │  Languages (Core-16)                                   │
  │   ☑ typescript  ☑ python   ☑ go      ☑ rust           │
  │   ☑ java        ☑ c/c++    ☐ ruby    ☐ php   … +more   │
  │  ☐ Allow downloading grammars for other languages      │
  │      (off = offline core only; on = SHA-verified fetch)│
  │  Index health                                          │
  │   142,318 symbols · 3 files stale · indexed 2m ago     │
  │   [ Reindex symbols ]                                   │
  └─────────────────────────────────────────┘
```

Two toggles map 1:1 to the safety decisions: the **language multiselect** =
the registry filter (`symbols.languages`); the **"Allow downloading" checkbox** =
the `allowDownload` opt-in supply-chain gate, surfaced honestly to the user.
Health readout reuses the observability instrumentation.

## Performance budget (numbers, not vibes)

The sha256 gate makes the common case trivial; the budget the change commits to:

```
  ▸ disabled (symbols.enabled=false)  = 0        no WASM load at all — opting
                                                  out costs literally nothing
  ▸ warm reindex (1 changed file)     < 50 ms   added latency
  ▸ per-file parse (p95, <2k LoC)     < 25 ms   WASM, single-thread
  ▸ cold full index, mid repo (~5k f) < 30 s    single-thread, WASM
```

WARM is the case that matters (edit 1 file → parse 1 file → ms) — which is why the
WASM parse penalty (~2–3× vs native) is a non-issue. The disabled-path zero is the
load-bearing guarantee. Numbers are measured and recorded, not assumed.

## Multi-root / monorepo scoping

The KB is **per-root**; this repo is a `packages/*` workspaces monorepo *and* uses
git worktrees. Two collisions, both decided toward the safe default:

```
  1. CROSS-PACKAGE within one root
     packages/kb/… parseChunk()  +  packages/server/… parseChunk()
     → node-as-concept handles it: 1 node, 2 defined_in edges. The def edge
       CARRIES package/path so find_symbol hits are disambiguable in output.

  2. CROSS-ROOT / worktree
     root A and worktree ../feat-x are SEPARATE KBs (per-root DB) → no bleed by
     construction. Symbols reflect THAT checkout's working tree, not main.
```

**Decision: symbols are strictly per-root — no cross-root/worktree symbol graph.**
Monorepo = one root, many packages, one graph (hits carry package/path).
Worktrees = independent graphs. Matches every other KB guarantee, needs no new
machinery — but is stated so nobody expects `find_symbol` to see across worktrees.

## Risks / open questions

- **Name collisions** under `UNIQUE(type,name)` — mitigated by container
  qualification; verify it holds for anonymous/generic decls.
- **Candidate-ref precision** — must be labeled so nobody treats it as
  refactor-grade. Spec requires the label.
- **Grammar footprint** — WASM grammars are architecture-independent assets
  (not native modules); the cost is `asarUnpack`, not a prebuild matrix.
- **Lazy-tier integrity** — downloaded grammars MUST be SHA-256-verified against
  the registry and refused on mismatch; download is opt-in. See
  "Reproducibility & supply-chain".
- **Monorepo/worktree multiplicity** — KB is per-root; symbol volume × N roots.
  MVP indexes per-root like everything else; no cross-root symbol graph.
- **Whole-repo cold time** — must land under a stated budget (perf discipline).
