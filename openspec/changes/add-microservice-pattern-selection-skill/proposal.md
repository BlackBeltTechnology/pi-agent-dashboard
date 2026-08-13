# Add a microservice pattern-selection skill to eng-disciplines

## Why

`microservices.io` publishes a **pattern language** — 55 patterns organised as a
graph of context → problem → forces → solution, with explicit
alternative/predecessor/successor relations. Asked *"which pattern solves my
problem"*, an agent today either recalls patterns from parametric memory (no
forces, no drawbacks, no relations — so it recommends Saga for a two-user CRUD
app) or re-reads the site mid-task at ~10KB/page.

The site is well suited to becoming a selector, because the selection signal is
already encoded in it — but only if we consume it as a *language*, not as 55
summaries.

### What the corpus actually contains

All 55 pattern pages were fetched and section-measured (character counts per
`Context`/`Problem`/`Forces`/`Solution`/`Resulting context`). Completeness is
uneven:

| Tier | Count | Shape | Card policy |
|---|---:|---|---|
| **A** | 34 | problem + solution + a trade-off section (forces / drawbacks / resulting context) | distil directly |
| **B** | 16 | solution present, **forces and/or drawbacks empty** | distil solution; fill trade-offs from standard literature, marked as such |
| **C** | 5 | stub or book-pointer | one-line pointer card, flagged thin |

Tier B is not an edge case — it covers the whole deployment family, both UI
composition patterns, strangler, anti-corruption-layer and sidecar
(`sidecar`: problem **and** forces both empty, 108-char solution). Tier C
includes `aggregate` and `consumer-side-contract-test` (a single sentence each).

**Consequence:** a scrape cannot power the selector. Exactly where a choice is
hardest, the site is thinnest. Cards must be *authored* — site content where it
exists, standard literature where it does not, each card linking back to its
source page.

### The finding that drives the design

Sibling patterns **share their context, problem and forces verbatim**. Measured
character counts are identical across each group:

```
   deployment family    ctx:192  prob:39  forces:576   ← 7 patterns, one decision
   decomposition        ctx:1984 prob:46  forces:736   ← 4 patterns
   monolith vs micro    ctx:1465 prob:81  forces:1664  ← 2 patterns, same forces,
                                                          opposite solutions
   client/server-side discovery   ctx:694 prob:116 forces:413
   self- vs 3rd-party registration ctx:247 prob:85  forces:295
   log-tailing vs polling-publisher ctx:50 prob:85
```

The language is not a flat list of 55 patterns — it is a set of **decision
clusters**: one shared (context, problem, forces), N competing solutions, each
with its own consequences. *The cluster is the selection unit.* A selector that
indexes per-pattern fights this structure; one that indexes per-cluster inherits
it.

Not every group is a choice. Observability's 7 patterns have no competing
alternatives — you adopt all of them. Transactional messaging is a *chain*
(outbox first, then tailing **or** polling). So reference files come in three
kinds: **decision** (pick one), **checklist** (adopt all), **chain**
(prerequisite ordering).

## What Changes

- Add skill `microservice-pattern-selection` to
  `@blackbelt-technology/pi-dashboard-eng-disciplines`, registered in
  `pi.skills[]`.
- `SKILL.md` = a **symptom router**, not a pattern dump: maps a stated problem
  ("orders double-charge on retry", "query needs data from three services") to
  one cluster file, then walks that cluster's forces to a recommendation with
  its drawbacks stated.
- **Gate zero — the anti-complexity check.** Before routing, the skill asks
  whether the problem is actually distributed. Richardson lists *Monolithic
  architecture* as pattern #1 and gives it the same forces block as
  Microservice architecture; the skill must be able to answer "you don't need a
  pattern from this language, you need one database". Without this gate a
  pattern selector becomes a complexity generator, contradicting the project's
  simplicity-first rule.
- `references/*.md` = one file per cluster. Shared context/problem/forces stated
  **once** at file level; then one `##` section per pattern with solution,
  consequences, and **relations written in prose**
  (`Alternatives:` / `Prerequisite:` / `Leads to:`) plus a source link.
- Relations are written as **relative markdown links between cards**, so the kb
  indexer's Tier-1 link graph reconstructs Richardson's pattern graph and
  `kb_neighbors` can walk it.

### Retrieval ladder

The same markdown artifact serves four tiers; no tier is a dependency.

| Tier | Environment | Mechanism | Capability |
|---|---|---|---|
| 1 | this repo | kb already walks `packages/` (typed `source-md`) | search + graph |
| 2 | any pi-dashboard user | `kb init --source <skill_dir>/references` + `kb index` | search + graph |
| 3 | context-mode present | `ctx_index(path: …/references)` | search only |
| 4 | bare pi | SKILL.md router → `read` one file | manual |

Tier 2 is the common case: `pi-dashboard-kb` is published with a `kb` bin,
`kb init --source` accepts **any** path, and the population holding this skill
is the population holding that CLI. Because relations live in card *text*, a
Tier-3/4 search hit still carries its neighbourhood — the graph is an
accelerator, never the only encoding.

Registration mutates project kb config, so step 0 checks `kb config show` first
and asks via `ask_user` before writing. Idempotent; re-runs are no-ops.

## Impact

- **New:** `packages/eng-disciplines/.pi/skills/microservice-pattern-selection/SKILL.md`
- **New:** `.../references/*.md` — one per cluster (~12–15 files)
- `packages/eng-disciplines/package.json` — `pi.skills[]` entry
- `packages/eng-disciplines/AGENTS.md` — one row per new file
- `packages/eng-disciplines/README.md` — skills table row
- `packages/eng-disciplines/NOTICE` — attribution: cards are original
  distillations of concepts from microservices.io (© Chris Richardson), each
  linking to its source page. No pattern text is reproduced.
- No server, client, protocol or persistence change. No new dependency.

### Deliberately out of scope

- **Not a general architecture-pattern selector.** EIP, cloud-design and
  refactoring catalogues stay out; the router's top level is this language only.
  Widening it turns an authored, verifiable artifact into an unbounded one.
- **No auto-application.** The skill recommends and states drawbacks; it does
  not scaffold sagas or generate outbox tables.
- **Tier C patterns are not reconstructed** into full cards from outside
  sources. They ship as flagged pointer cards — an honest thin card beats an
  invented one.

## Open questions

1. **Global vs per-project kb index.** Cards are project-independent, so
   `kb init --global --source …` is a better fit than N per-project
   registrations — *if* the `kb_*` MCP tools query the global index. Unverified;
   a 5-minute check during implementation decides the step-0 default.
2. **Trigger phrasing.** Must fire on "which pattern for X", "how do I keep data
   consistent across services", "should we split this service" without
   colliding with `security-hardening` (access-token) or
   `observability-instrumentation` (the 7 observability patterns). Both overlaps
   are real and need explicit hand-off lines.

## Discipline Skills

- `doubt-driven-review` — gate zero and the cluster-not-pattern indexing
  decision both become precedent for any future pattern-language skill.
  Stress-test before they stand.
- `review-code` — no runtime code, but ~15 authored reference files whose
  format *is* the index schema; a format error is expensive to correct later.
- `scenario-design` — the selector is testable: a fixed set of problem
  statements must route to expected patterns, and gate zero must reject a
  non-distributed problem.
