# Design — Tier-2 LLM semantic-annotation plane

## 1. The invariant this design exists to protect

`markdown-knowledge-base` states, in every KG scenario:

> **"No LLM extraction SHALL be performed."** *(the indexer builds the graph)*

That is a property of the **indexer**, not of the whole system. This design keeps
it literally true by placing the LLM on the far side of a hard seam:

```
 ┌──────────────────────────────────────────────────────────────────────┐
 │  ENRICHMENT PLANE   (LLM · write-time · opt-in · batched · @fast)      │
 │                                                                        │
 │   doc body ──► @fast subagent ──► candidate {entities, relations}      │
 │      ▲          constrained by ontology whitelist  │                   │
 │      │                                             ▼                   │
 │      │              deterministic VALIDATOR (no LLM):                  │
 │      │              type/predicate ∈ ontology? normalize alias?        │
 │      │              known→approved · unknown→proposed+review-queue     │
 │      │                                             │                   │
 │      └──────────────── merge-preserving write ─────┼──────────────►    │
 └────────────────────────────────────────────────────┼──────────────────┘
                                                       ▼
                       ╔══════════════════════════════════════╗
                       ║  frontmatter `kb:` block             ║  ◄─ THE CONTRACT
                       ║  git-tracked · diffable · reviewable  ║     (git diff =
                       ╚══════════════════════════════════════╝      review gate)
                                                       │
 ┌──────────────────────────────────────────────────────┼─────────────────┐
 │  INDEXING PLANE   (deterministic · zero-LLM · unchanged invariant)      │
 │                                                        ▼                 │
 │   kb index ──► entity nodes + typed edges (APPROVED ONLY) ──► neighbors  │
 └─────────────────────────────────────────────────────────────────────────┘
```

Three properties fall out of putting the contract in frontmatter:

1. **Reviewable** — LLM output is a git diff a human/agent approves before it is
   graph truth. Hallucination is caught at review, not silently injected.
2. **Reproducible** — `kb index` stays deterministic; two runs over the same
   frontmatter yield the identical graph. Nondeterminism is quarantined to the
   write plane.
3. **Idempotent + cheap** — the annotator is hash-gated; cost scales with edits,
   not repo size.

Precedent in-repo: `migrate-runner.ts` already drives `@fast` subagent fan-out to
author `AGENTS.md` rows with a detect-don't-clobber discipline. The annotator is
the same shape aimed at frontmatter.

## 2. Graph model — near-free on the existing store

The store already accommodates this with almost no schema change:

- `GraphNode.type` union already includes `"entity"` (declared, unpopulated).
- `edges.rel` is a **TEXT** column; the only constraint is the TS union
  `"child_of" | "links_to" | "references" | "has_tag"`. Widen it to accept
  **CURIE predicates** (`schema:dependsOn`, `skos:broader`, …) and typed edges are
  storable with no migration.

Representation:

```
 entity node:  { type:"entity", name:"schema:SoftwareSourceCode/bridge.ts", path:<file> }
 typed edge:   { src:<file|entity>, dst:<file|entity>, rel:"schema:dependsOn" }
 concept edge: { src:"skos:Concept/reconnection", dst:"skos:Concept/transport", rel:"skos:broader" }
```

Node `name` is a **CURIE-shaped id** so entities are stable, joinable, and
collision-resistant across files. Traversal reuses the existing recursive-CTE
`neighbors`/`backlinks`; a new optional `--rel <curie>` filter scopes a traversal
to one predicate for reference-context expansion.

## 3. The `kb:` frontmatter block (machine-managed) — provenance schema

```yaml
---
title: Reconnection Protocol          # ── human-authored zone (LLM never touches)
tags: [transport]
kb:                                    # ── machine-managed zone ──────────────
  annotator:
    model: "@fast"
    ontologyVersion: "2025.1"
    contentHash: "sha256:7f3c…"        # hash of the BODY at annotation time
    annotatedAt: "2026-07-07T10:20:00Z"
  entities:
    - id: "schema:SoftwareSourceCode/bridge.ts"
      type: "schema:SoftwareSourceCode"
      label: "bridge extension"
      status: approved                 # approved | proposed | rejected
      confidence: 0.91
      source: llm                      # llm | human
    - id: "skos:Concept/reconnection"
      type: "skos:Concept"
      label: "reconnection"
      status: approved
      confidence: 0.95
      source: human                    # human-authored → survives regen
      pinned: true
  relations:
    - { subject: "<self>", predicate: "schema:dependsOn", object: "[[heartbeat]]",
        status: approved,  confidence: 0.87, source: llm }
    - { subject: "skos:Concept/reconnection", predicate: "skos:broader",
        object: "skos:Concept/transport",
        status: proposed,  confidence: 0.62, source: llm }   # inert until curated
---
```

Rules that make the block safe and maintainable:

- **Zoning.** Everything under `kb:` is machine-managed. Human frontmatter lives
  outside `kb:`. A human MAY hand-author an item *inside* `kb:` by setting
  `source: human` (optionally `pinned: true`); such items are never overwritten.
- **`status` is the graph gate.** The indexer emits edges **only** for
  `status: approved`. `proposed` (open-world, unknown vocab) and `rejected` items
  are stored in frontmatter for auditability but produce **no graph edges**.
- **`source` + `pinned` drive merge.** Regeneration replaces only
  `source: llm && !pinned` items.

## 4. Regen protocol (thread #4) — idempotent, merge-preserving

```
 kb annotate <file>:
   body      = strip frontmatter(file)
   h         = sha256(body)
   if kb.annotator.contentHash == h
      && kb.annotator.ontologyVersion == currentOntologyVersion:
        SKIP  (no LLM call)                      ← idempotence / cost gate
   else:
        candidate = @fast(body, ontologyWhitelist)   ← the only LLM call
        validated = validate(candidate, ontology)     ← deterministic
        merged    = merge(existing kb.items, validated):
                        keep  source:human OR pinned:true       (verbatim)
                        drop  old source:llm && !pinned
                        add   validated (known→approved, unknown→proposed)
        write kb block with fresh {contentHash:h, ontologyVersion, annotatedAt}
        append unknown vocab → review-queue.jsonl (dedup by curie)
```

Determinism knobs on the single LLM call: **temperature 0**, fixed
**structured-output schema** (entities[]/relations[] with the fields above),
ontology whitelist injected into the prompt, body truncated/chunked
deterministically. Two annotate runs over unchanged content make **zero** LLM
calls (hash skip); the first run is the only nondeterministic step and its output
is frozen into the diff.

## 5. Ontology binding — open-world with a curation gate

Stores:

```
 packages/kb/ontology/schema-core.json   vendored subset of schema.org Types+Properties
 packages/kb/ontology/skos.json          SKOS Concept + broader/narrower/related
 .pi/dashboard/kb-ontology/ontology.json  { version, imports:[…], types:[curie…],
                                            predicates:[curie…], aliases:{alias→curie} }
 .pi/dashboard/kb-ontology/review-queue.jsonl   proposed vocab awaiting curation
```

Open-world flow (chosen over closed-world per exploration):

```
 annotator proposes "schema:isPartOf" (not yet in project ontology)
   → validator: unknown predicate → item status=proposed, mirror to review-queue
   → indexer: emits NO edge for it (inert)
 curator: kb ontology review        → lists proposed curies + freq + example docs
          kb ontology promote schema:isPartOf   → added to ontology.json, version bumps
          (next kb index: proposed items with that curie flip to approved
           DETERMINISTICALLY — no re-annotation, no LLM)
          kb ontology reject  <curie>           → annotator told to stop proposing
```

Promotion is a **deterministic** state flip driven by ontology membership, so
curating vocabulary never re-invokes the model. `ontologyVersion` bumping on
promote/reject is what forces the next `kb annotate` to re-evaluate
(hash-gate second condition).

Vocabulary fit for a docs KB: **SKOS first** (docs are about *concepts* with
broader/related structure — highest recall, cheapest nodes), **schema.org** for
the few concrete entity kinds actually tracked (Person=author,
SoftwareSourceCode=module, Organization). Do not import all 800+ schema.org types;
the vendored subset is curated to what a code/docs repo uses.

## 6. Failure modes + guardrails

| Risk | Guardrail |
|------|-----------|
| LLM invents entities → false graph context | ontology whitelist + validator + approved-only emission |
| Non-determinism destabilizes the graph | LLM only in write plane; temp 0; frozen into git diff; indexer deterministic |
| Regen clobbers human intent | `source:human` / `pinned` preserved by merge |
| Open-world vocab sprawl / self-poisoning | proposed items inert; explicit promote gate; curation deterministic |
| Cost blow-up over large repos | hash-gate + changed-files-only + `@fast` + batch |
| Someone reads "no LLM extraction" and thinks we broke it | spec MODIFIED delta scopes the invariant to the indexer explicitly |

## 7. Open questions (for review, not blocking the proposal)

- **Confidence threshold** for auto-`approved` vs forced-`proposed` even when the
  type is known — a second safety dial, or over-engineering? Default: known-vocab
  ⇒ approved; make a `minConfidence` config knob, default 0.
- **Chunking long docs** for annotation: per-section (aligns with the chunker) vs
  whole-doc. Per-section gives finer entity anchoring but more LLM calls.
- **Subject identity** for cross-file entities: first-writer-wins on the CURIE id,
  or a lightweight alias-resolution pass. Start first-writer-wins; revisit if
  duplicate entities appear.
- **RDF export** (`kb export --rdf` → Turtle/N-Triples) as a *view* for anyone
  who wants SPARQL, without running a triplestore — deferred follow-up, noted so
  the CURIE-shaped ids stay export-clean.
- **Sequencing** (see §8): should the deterministic Tier-1a edges
  (`changedBy`/`partOf`/`realizes`) ship as their own smaller, LLM-free change
  BEFORE this annotation plane? They need no model, no review queue, no trust
  gate — pure regex/structure over conventions the repo already follows
  (`See change:` ×1120, `packages/*` membership, openspec change→capability). It
  is an independent quick win that makes Tier-1 dramatically richer at zero token
  cost, and it de-risks this larger change by proving the typed-edge graph model
  first. Recommendation: extract Tier-1a as `add-kb-deterministic-provenance-edges`
  and land it first; this change then adds only the genuinely prose-latent layer.
- **Second producer of the `kb:` block (coordination with
  `unify-context-manager`, D4).** Lesson files (`<repo>/.pi/lessons/`,
  `~/.pi/agent/lessons/`) write the same §9.4 shape: top-level
  `type: kb:Lesson`, `kb.relations[]` over a closed predicate set
  (`kb:about`, `kb:fixes`, `kb:supersedes`, `kb:decidedIn`, `kb:replacedBy`)
  with `source: deterministic`, objects taken from observed tool events. They
  need no annotator run or review queue, so the indexer must accept
  `source: deterministic` edges as graph truth and keep the predicate
  vocabulary shared. Evidence to weigh before relying on prose-latent
  relations for retrieval: in the ontology ablation over 856 memory entries
  (research doc `docs/research/unified-context-manager-exploration.md` §19),
  an entity field plus an entity-overlap boost did not improve hit@5 (19/56 →
  17/56) or firing precision; measure annotation value on the Tier R eval
  before making it a ranking signal.

## 8. Grounded ontology — corpus-derived, not a schema.org dump

A survey of the actual repo overturns the assumption that schema.org is central.
The entities are repo-native, and — critically — the **highest-volume relations
are already deterministic**, so the LLM plane shrinks to genuinely prose-latent
edges.

### 8.1 Extraction tiers (the key structural finding)

Each predicate declares a `source` = its extraction tier, so the pipeline routes
it correctly and never spends tokens on what a regex already knows:

```
 Tier-1a  regex / structure  (INDEXER emits, zero-LLM)      ~4000+ edges FREE
   kb:changedBy   ← `See change: <id>`     (1120 occurrences, 77 AGENTS.md)
   kb:partOf      ← file path under packages/<x>   (28 packages)
   kb:realizes    ← openspec proposal `### New/Modified Capabilities` + spec tree
                    (591 archived changes · 367 capabilities · 2525 requirements)
   (references / child_of already exist)

 Tier-2   prose  (ANNOTATOR → review → status:approved)
   kb:dependsOn(37) kb:owns(48) kb:feeds/consumedBy(34) kb:supersedes(replaces 85
   +supersedes 14) kb:derivedFrom(77) kb:extends(17)
   skos:broader / skos:related / kb:about   ← the concept graph (highest-ROI slice)
```

### 8.2 Entity types — repo-native + minimal imports

schema.org contributes exactly TWO types; SKOS contributes the concept layer;
~80% is a `kb:` micro-vocabulary. Do NOT import the full schema.org catalog.

```
 kb:Component   session/dashboard/server/bridge/client/extension/flow/wizard/…
 kb:Package     packages/*   ⊑ schema:SoftwareSourceCode   (the one real schema.org fit)
 kb:Change      an OpenSpec change            kb:Capability   kb:Requirement
 skos:Concept   a topic/theme docs are about
 schema:Person  author/architect  (rare — 2 `architect` frontmatter keys)
```

### 8.3 The vendored + project ontology (concrete)

```jsonc
{
  "version": "2025.1",
  "imports": ["skos", "schema-core"],   // schema-core = {SoftwareSourceCode, Person} ONLY
  "types": [
    "kb:Component", "kb:Package", "kb:Change",
    "kb:Capability", "kb:Requirement", "skos:Concept", "schema:Person"
  ],
  "predicates": {
    // Tier-1a DETERMINISTIC (indexer, no LLM)
    "kb:changedBy": { "source": "regex:See change:",  "domain": "*",           "range": "kb:Change" },
    "kb:partOf":    { "source": "structure:path",     "domain": "*",           "range": "kb:Package" },
    "kb:realizes":  { "source": "structure:openspec", "domain": "kb:Change",   "range": "kb:Capability" },
    // Tier-2 PROSE (annotator → review → approved)
    "kb:dependsOn": { "source": "llm", "domain": "kb:Component", "range": "kb:Component" },
    "kb:owns":      { "source": "llm", "domain": "kb:Component", "range": "*" },
    "kb:feeds":     { "source": "llm", "domain": "*", "range": "*", "inverseOf": "kb:consumedBy" },
    "kb:supersedes":{ "source": "llm", "domain": "*", "range": "*" },
    "kb:derivedFrom":{ "source": "llm", "domain": "*", "range": "*" },
    "kb:extends":   { "source": "llm", "domain": "*", "range": "*" },
    "skos:broader": { "source": "llm", "domain": "skos:Concept", "range": "skos:Concept" },
    "skos:related": { "source": "llm", "domain": "skos:Concept", "range": "skos:Concept" },
    "kb:about":     { "source": "llm", "domain": "*", "range": "skos:Concept" }
  },
  "aliases": {
    "replaces": "kb:supersedes", "supersede": "kb:supersedes",
    "consumed by": "kb:consumedBy", "drives": "kb:feeds",
    "part of": "kb:partOf", "depends on": "kb:dependsOn"
  }
}
```

The `source` field is the routing key: `regex:*` / `structure:*` predicates are
emitted by the deterministic indexer (§8.1 Tier-1a); `llm` predicates flow
through the annotator + review gate (§4–5). One ontology, two extraction paths,
no tokens wasted on deterministic edges.

## 9. OKF alignment — conformant producer/consumer, typed graph as extension

Grounded in the real spec (`GoogleCloudPlatform/knowledge-catalog/okf/SPEC.md`,
OKF **v0.1 Draft**, 2026-06), not the announcement blog. OKF is the published
standardization of the LLM-wiki pattern this change independently converged on;
aligning to it buys portability + third-party tooling (e.g. Google's static graph
visualizer) at near-zero cost, because we are already ~90% OKF-shaped.

### 9.1 The entire OKF conformance contract (§9 of the spec)

A bundle is conformant iff:
1. every non-reserved `.md` has a **parseable YAML frontmatter block**,
2. every frontmatter block has a **non-empty `type`** field,
3. reserved files `index.md` (§6) and `log.md` (§7) follow their structure when
   present.

Standard (all optional except `type`): `type` (REQUIRED), `title`, `description`,
`resource` (canonical URI), `tags`, `timestamp` (ISO 8601). Type values are **not**
centrally registered; consumers MUST tolerate unknown types (treat as generic
concept). Consumers MUST tolerate broken links (not-yet-written knowledge).

### 9.2 The extension clause makes our typed graph legal OKF (the crux)

> OKF §Extensions: *"Producers MAY include any additional keys. Consumers SHOULD
> preserve unknown keys when round-tripping and SHOULD NOT reject documents with
> unrecognized fields."*

Therefore the entire `kb:` block (§3 — typed entities, typed relations, provenance)
is a **conformant OKF extension**. Non-OKF-aware consumers ignore it; our indexer
reads it. We are a strict superset: OKF-portable at the base, typed-graph-rich in
the extension. No capability is sacrificed to gain conformance.

### 9.3 Convergence map (grounded in the v0.1 spec)

```
 OUR DESIGN                         OKF v0.1                         RELATION
 frontmatter = plane contract       principle 2 (format is contract) identical
 Tier-2 annotator + review          reference "enrichment agent,     identical shape
                                     BQ pass + web pass"
 graph from markdown links          §"markdown links → a graph"       identical (already Tier-1)
 kb: entity `type` (CURIE)          required `type` field            ours = constrained subtype
 has_tag (tags) — already indexed    standard `tags` field            identical
 See change: provenance             `log.md` (§7)                     same intent, map/emit
 AGENTS.md tree / dir-level agents   `index.md` (§6)                   same intent
 typed predicates (dependsOn…)       untyped markdown links           OURS = extension superset
 §8 ontology                        "type not centrally registered"  ours = producer content-model
```

### 9.4 Frontmatter reconciliation (concrete — supersedes §3 field layout)

To be conformant, hoist `type`/`tags`/`timestamp`/`resource` to the top level (the
file's ONE primary OKF concept); keep the typed graph + provenance under the `kb:`
extension:

```yaml
---
type: kb:Component               # OKF-REQUIRED, top-level (the file's primary concept)
title: Reconnection Protocol
tags: [transport]                # OKF standard (unifies with the existing has_tag path)
timestamp: 2026-07-07T10:20:00Z  # OKF standard
resource: https://…             # optional canonical URI
kb:                              # OKF EXTENSION (unknown key — legal, ignored by others)
  annotator: { model: "@fast", ontologyVersion: "2025.1", contentHash: "sha256:…" }
  relations:
    - { predicate: kb:dependsOn, object: "[[heartbeat]]", status: approved, source: llm }
---
```

File-as-concept is the OKF-native model and it fits a docs KB: one doc ≈ one
primary concept (its top-level `type`), with `kb.relations[]` carrying typed edges
to other concept-files over OKF's untyped links. Multi-entity docs use
`kb.relations[]`; they do not need a top-level entity array.

### 9.5 Integration levels + grounded cost

```
 L1 CONSUME  point kb at an OKF bundle            ALREADY WORKS (OKF is just markdown;
             + map top-level `type` → entity node,  existing fs/git/npm/https resolvers
               recognize index.md / log.md          + link-graph already index it)
 L2 PRODUCE  annotator surfaces top-level          cost: frontmatter naming (§9.4)
             type/tags/timestamp/resource          → KB docs = a valid OKF bundle other
                                                     OKF consumers/visualizers can read
 L3 ALIGN    publish §8 ontology as the            cost: docs only
             producer content-model; typed
             relations documented as extension
```

### 9.6 Reserved-file mapping

- `log.md` (§7): date-grouped, newest-first, ISO 8601 `YYYY-MM-DD` headings, prose
  entries with a leading bold convention word. The Tier-1a `kb:changedBy` extractor
  SHOULD also read `log.md` date entries where present; emitting `log.md` from our
  `See change:` history is optional (L2 producer nicety).
- `index.md` (§6): directory listing for progressive disclosure — the direct OKF
  analog of the directory-level `AGENTS.md` chain; no new mechanism needed.

### 9.7 Caveat

OKF is **v0.1 Draft**: minor bumps add optional fields (safe); a major bump may
rename required fields or reserved filenames. Lock-in is near-zero (markdown+YAML),
but pin conformance to a stated OKF version, expose it as a lint (`kb okf lint`),
and re-verify on OKF version bumps rather than tracking `main`.
