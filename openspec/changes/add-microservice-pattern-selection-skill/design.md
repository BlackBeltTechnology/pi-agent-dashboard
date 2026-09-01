## Context

The proposal establishes *why*: `microservices.io` encodes 55 patterns as a
language whose selection signal (forces, drawbacks, relations) is exactly what an
agent lacks when recommending an architecture, but whose page completeness is
uneven (A=34 / B=16 / C=5 by section measurement).

This document decides *how* the artifact is structured, because for this change
the artifact **is** the implementation: there is no runtime code. The skill is
markdown, and its file layout doubles as the retrieval index schema. A format
mistake is therefore not cosmetic — it is a functional defect that is expensive
to correct once ~17 files exist.

Two facts were measured during design and constrain everything below:

1. **Sibling patterns share `context`/`problem`/`forces` verbatim.** Identical
   character counts across groups (deployment six at `192/39/576`; decomposition
   pair at `1984/46/736`; monolith+microservices at `1465/81/1664`;
   sidecar+service-mesh at `ctx:104`, distinct from the deployment six).
2. **`kb` config arrays overwrite, they do not union.**
   `packages/kb/src/config.ts:158-171` — `mergeConfig` assigns `out[k] = v` for
   any array; the nested-merge branch handles non-array objects only. A project
   config that declares `sources` therefore **discards** global `sources`
   entirely.

## Goals / Non-Goals

**Goals:**

- Given a stated problem, route to the smallest set of genuinely competing
  patterns, and choose among them using forces and drawbacks — not popularity.
- Be able to answer "this is not a distributed-systems problem" and stop.
- Work in a bare pi install; get faster where `kb` or `context-mode` exists.
- Encode Richardson's pattern relations so they survive both as graph edges
  (kb link graph) and as plain text (everywhere else).
- Keep provenance honest: distinguish what the source says from what standard
  literature supplies.

**Non-Goals:**

- Reproducing microservices.io prose. Cards are authored distillations + links.
- A general architecture-pattern catalogue (EIP, cloud-design patterns).
- Code generation, scaffolding, or applying a chosen pattern.
- Recommending *whether to adopt microservices* as an org strategy. Gate zero
  answers a narrower question: does this problem live in this language at all.

## Decisions

### D1 — The unit of organisation is the *decision cluster*, not the pattern

One reference file per cluster. Shared `context`/`problem`/`forces` stated once
at file level; each competing pattern then contributes only its solution and
consequences.

*Why:* measurement (fact 1) shows the source itself is authored this way —
siblings literally repeat the same forces block. A per-pattern layout would
duplicate that block 6× in the deployment file and force the reader to diff six
near-identical texts to find the actual choice. Per-cluster puts the shared
premise once and makes the *differences* the content.

*Alternative considered — per-pattern files (55).* Better for direct lookup
("show me Saga"), worse for selection, which is the skill's purpose. Rejected:
lookup is adequately served by search + heading anchors within a cluster file.

*Alternative considered — one flat file.* ~200KB in context on every trigger.
Rejected outright.

### D2 — Clusters carry a *kind*, and the kind dictates the reading protocol

| Kind | Meaning | Reading protocol |
|---|---|---|
| `decision` | mutually exclusive options | weigh forces → pick exactly one |
| `checklist` | complementary, non-competing | adopt all that apply; no choosing |
| `chain` | prerequisite ordering | satisfy predecessor before successor |
| `single` | one pattern, no siblings | applicability check only |

*Why:* observability's 7 patterns have no competing alternatives — treating them
as a decision would make the skill invent a false trade-off ("metrics *or*
tracing"). Transactional messaging is genuinely ordered: outbox first, then
tailing *or* polling. Encoding kind prevents category errors that a uniform
layout invites.

### D3 — Cluster file schema (fixed)

```markdown
---
cluster: <id>
kind: decision | checklist | chain | single
patterns: [<slug>, …]
---

# <Cluster title>

## Shared context          ← stated once (fact 1)
## Problem
## Forces                  ← the selection signal
## When this cluster does NOT apply   ← gate-zero echo, per cluster

## <Pattern Name>          ← one H2 per pattern = one retrievable chunk
**Solution:** …
**Consequences:** …
**Use when:** … / **Avoid when:** …
**Alternatives:** [X](./file.md#x) · **Prerequisite:** … · **Leads to:** …
**Source:** https://microservices.io/patterns/… · **Depth:** A|B|C
```

Two constraints are load-bearing:

- **One `##` per pattern** — the kb chunker splits on headings, so each pattern
  becomes an independently retrievable unit with its cluster as parent breadcrumb.
- **Relations in prose *and* as relative links** — the link form feeds the kb
  Tier-1 graph (`kb_neighbors`); the prose form means a Tier-3/4 search hit
  carries its own neighbourhood inline. Neither encoding is load-bearing alone.

### D4 — Tiered fill policy with explicit provenance

Every card carries `Depth: A|B|C`.

- **A** — distil the page.
- **B** — distil the solution from the page; supply the missing forces/drawbacks
  from standard literature, marked `(not on source page)`.
- **C** — ship a short pointer card marked `thin`. Do **not** synthesise a full
  card from outside sources.

*Why:* the alternative — silently writing complete-looking cards for all 55 —
produces an artifact where the reader cannot tell sourced trade-offs from
invented ones. For a skill whose whole value is trustworthy trade-offs, that is
the worst possible failure. C-cards stay honestly thin (`aggregate`,
`consumer-side-contract-test` are one sentence upstream; pretending otherwise
manufactures false authority).

### D5 — Gate zero precedes routing

SKILL.md step 1 asks: is there more than one independently deployed unit, or a
transaction/query spanning them? If not → recommend the boring answer (one
service, one database) and **stop without routing**.

*Why:* Richardson lists *Monolithic architecture* as pattern #1 and gives it the
identical 1664-char forces block as *Microservice architecture* — the source
treats "don't distribute" as a first-class answer. Without this gate the skill
becomes a complexity generator, contradicting the project's simplicity-first
rule (AGENTS.md Code Instruction 2).

### D6 — kb registration is **per-project**, never `--global`

Step 0 registers `<skill_dir>/references` as a kb source in the *project* config
via `kb init --source`, after an `ask_user` confirmation, then `kb index`.

*Why — this reverses the assumption in the proposal's open question 1.* Global
registration looks attractive (cards are project-independent), but fact 2 makes
it silently unreliable: `mergeConfig` overwrites arrays, so any project that has
its own `sources` — i.e. every project that has configured kb, the exact
population that would benefit — drops the globally registered skill source
without warning. Worse, `dbPath` resolves via `resolve(cwd, …)`
(`config.ts:231`), so a relative `dbPath` in a global config still yields a
per-project database; `--global` shares *settings*, not an *index*, unless
`dbPath` is made absolute.

A silent, environment-dependent retrieval failure is far worse than an explicit
one-time per-project prompt.

*Alternative considered — global config with absolute `dbPath`.* Would give a
true shared index, but hijacks the user's kb database location machine-wide to
serve one skill. Rejected as disproportionate.

### D7 — SKILL.md is a router, not a catalogue

SKILL.md holds: gate zero, a symptom→cluster table, the retrieval ladder, and
the hand-off lines. Pattern content is pulled on demand — never inlined.

*Why:* skills load their description every session; the body loads on trigger.
Keeping ~200KB of cards out of SKILL.md is what makes the skill affordable, and
mirrors `scenario-design`, which routes to `references/technique-cheatsheet.md`
rather than inlining ISTQB technique detail.

### D8 — Explicit hand-offs at the two known trigger overlaps

- `security/access-token` overlaps `security-hardening`
- the 7 observability patterns overlap `observability-instrumentation`

Both cluster files open with a hand-off line: this skill answers *which pattern*,
the sibling discipline answers *how to implement it well*. SKILL.md's description
avoids the sibling skills' trigger verbs ("harden", "instrument", "add metrics").

### D9 — Licensing

Cards are original prose; no pattern text is reproduced. Each card links its
source page. `NOTICE` gains a microservices.io attribution block in the existing
style, stating derivation-of-concepts rather than the MIT reproduction wording
used for the Addy-Osmani / NousResearch skills (different relationship: those
are MIT-licensed derived works, this is not).

### Resulting cluster taxonomy (17 files, 55 patterns)

| File | Kind | N | Patterns |
|---|---|---:|---|
| `architectural-style.md` | decision | 2 | monolithic, microservices |
| `service-boundaries.md` | decision | 4 | by-business-capability, by-subdomain, self-contained-service, service-per-team |
| `refactoring-to-services.md` | chain | 2 | strangler-application, anti-corruption-layer |
| `data-ownership.md` | decision | 2 | database-per-service, shared-database |
| `commands-and-consistency.md` | decision+chain | 5 | saga, command-side-replica, aggregate, domain-event, event-sourcing |
| `queries.md` | decision | 2 | api-composition, cqrs |
| `transactional-messaging.md` | chain | 3 | transactional-outbox → transaction-log-tailing \| polling-publisher |
| `communication-style.md` | decision + checklist | 4 | rpi, messaging, domain-specific, idempotent-consumer |
| `external-api.md` | single | 1 | api-gateway / BFF |
| `service-discovery.md` | decision ×2 + prereq | 5 | service-registry, client-side, server-side, self-registration, 3rd-party-registration |
| `deployment.md` | decision | 6 | multiple-per-host, single-per-host, per-vm, per-container, serverless, deployment-platform |
| `cross-cutting.md` | checklist | 5 | chassis, service-template, externalized-configuration, sidecar, service-mesh |
| `reliability.md` | single | 1 | circuit-breaker |
| `security.md` | single | 1 | access-token |
| `observability.md` | checklist | 7 | log-aggregation, metrics, audit-logging, distributed-tracing, exception-tracking, health-check-api, log-deployments |
| `testing.md` | checklist | 3 | consumer-side-contract, service-integration-contract, service-component |
| `ui-composition.md` | decision | 2 | server-side-page-fragment-composition, client-side-ui-composition |

Note the split of the index page's "deployment" section: the six topology
patterns share `192/39/576`, while `sidecar` and `service-mesh` share a
different context (`104`) and are cross-cutting-concern mechanisms, not
placement choices. The measurement, not the site's navigation, defines the
cluster.

## Risks / Trade-offs

- **Skill recommends complexity the user doesn't need** → gate zero (D5) plus a
  mandatory `Consequences` field on every card; a recommendation without stated
  drawbacks is a malformed card.
- **Tier-B/C cards drift into invented authority** → `Depth` marker and
  `(not on source page)` annotations are mandatory (D4); reviewable mechanically.
- **Cluster taxonomy is our editorial judgement, not the source's navigation** →
  it is derived from measured shared-forces groupings and documented above; each
  card still links its canonical source page, so a reader can always fall back to
  the site's own organisation.
- **Silent retrieval failure from kb config override** → resolved by D6;
  step 0 must additionally *verify* the source appears in `kb config show`
  after registration rather than assuming the write succeeded.
- **Source drift** — microservices.io is actively edited (2nd-edition MEAP in
  progress); cards will age → each card carries its source URL, and the change
  ships a documented re-measurement procedure (the section-measurement script) so
  drift can be re-detected rather than re-eyeballed.
- **~17 authored files is the bulk of the work** and cannot be generated
  mechanically without violating D4 → tasks must sequence clusters by value
  (data/consistency and boundaries first; single-pattern clusters last) so the
  skill is useful before it is complete.
- **`kb init --source` mutates user config** → `ask_user` consent, idempotent
  re-run, and the skill degrades to Tier 4 on refusal (never blocks).

## Migration Plan

Purely additive; no runtime, protocol, or persistence surface is touched.

1. Author `SKILL.md` + `references/*.md` under
   `packages/eng-disciplines/.pi/skills/microservice-pattern-selection/`.
2. Register in `package.json` `pi.skills[]`; add `AGENTS.md` rows, README row,
   `NOTICE` block.
3. Ships with the package's normal version bump — no separate release step.

**Rollback:** delete the skill directory and its `pi.skills[]` entry. No state,
no migration. A user who ran step 0 keeps a stale kb source entry pointing at a
removed path; the indexer's missing-source handling
(`kb-indexing-pipeline` spec: "Missing source directories handled") tolerates
this, and `kb config` editing removes it.

## Open Questions

1. **Does `kb init --source` append to an existing `sources` array, or replace
   it?** `init.ts` documents "never clobbers", but D6's whole safety argument
   rests on append semantics for the *project* config. Must be confirmed (and
   covered by a task) before step 0 is written; if it replaces, step 0 must
   read-modify-write instead.
2. **Should the skill ship one worked example** (a routed problem → chosen
   pattern → stated drawbacks) inside SKILL.md? Improves calibration, costs
   context on every trigger. Leaning yes, one, compact.
3. **Cluster granularity for `commands-and-consistency.md`** — 5 patterns mixing
   a decision (saga vs command-side-replica) with building blocks (aggregate,
   domain-event, event-sourcing). May warrant splitting into
   `commands.md` + `event-driven-building-blocks.md` during authoring; deferred
   until the first two cards are written and the file's real size is known.
