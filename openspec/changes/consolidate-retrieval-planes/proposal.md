# consolidate-retrieval-planes

## Why

Four retrieval planes — `packages/kb`, pi-hermes-memory, context-mode, blackhole —
each carry a full per-turn injection cost with no shared lifecycle. A trivial
prompt costs **111,150 B (~30K tokens)** before any work happens.

**Measured** with `packages/context-budget` against a real captured provider
payload (plain headless session, this repo, 30 tools):

| Block | Bytes | % payload |
|---|---:|---:|
| skills catalogue | 43,849 | 39.5% |
| all 30 tool schemas | 38,970 | 35.1% |
| — hermes WRITE surface (`skill_manage` 5,472 · `memory_add` 2,256 · `memory_replace` 2,148 · `memory_remove` 2,054) | 11,930 | 10.7% |
| — retrieval surface (`kb_search` 1,719 · `memory_search` 1,373 · `recall` 1,163 · `session_search` 923 · `kb_get` 553 · `kb_neighbors` 337) | 6,068 | 5.5% |
| `memory-policy` system block | 3,337 | 3.0% |

Token figure uses ~3.7 B/token; every byte figure above is measured, and every
**estimate** below is labelled as one.

### The evidence inverts the obvious plan

A census over 3,656 session transcripts (504 conversations, one developer's
machine — see *Evidence scope* below) shows retrieval is ~1% of all tool traffic:

- **Reads:** `kb_search` 718 · `ctx_search` 224 · `kb_get` 152 · `memory_search`
  66 · `session_search` 29 · `recall` 12 — **1,201 total, 2.38/conversation**.
- **Writes:** `memory` 308 + `memory_add` 134 + `memory_replace` 15 +
  `memory_remove` 4 = 461. `memory_replace` and `memory_remove` together cost
  **4,202 B every turn for 19 calls across 504 conversations**.

So the retrieval facade — the intuitive consolidation — targets the **smaller**
surface (6,068 B), while the hermes write surface is nearly 2× larger and needs
no retrieval redesign to shrink.

### Three trust domains, only one of which we own

| Domain | Contents | What we may do |
|---|---|---|
| **Ours** | `packages/kb`, `packages/kb-extension`, `packages/context-budget` | change freely |
| **Third-party npm** | pi-hermes-memory (MIT, **no export map**, pre-1.0 at 0.9.6 — no stability contract), context-mode (**Elastic-2.0**, compiled-only) | wrap or deactivate at pi's registration layer; never absorb |
| **User environment** | `~/.pi/agent/settings.json`, ~3.1 GB hermes store, 130 MB hook-captured session store across 71 DBs, a stray 454 MB `~/.claude/context-mode`, ~200 project dirs mostly 0 B | operator action — **not shippable repo code** |

The shippable form of environment cleanup is a dashboard affordance: the
dashboard already owns `hermes-memory-settings`, so store hygiene belongs there
as an operator-initiated feature.

### Evidence scope — an explicit limit on what these numbers license

Every number here derives from **one developer's machine**. That is sufficient
to justify changes to *that* operator's local configuration, and **insufficient**
to justify changing defaults for all dashboard users:
`packages/shared/src/recommended-extensions.ts` ships `context-mode` as
`strongly-suggested`, so it is installed on other people's machines whose usage
we have not sampled.

**Therefore Phase 0 ships as an opt-in operator affordance, never as a changed
default or an implicit migration.** Generalising this sample to product policy
is out of scope for this change.

### Why now

`packages/context-budget` makes every claim falsifiable — `diff
--expect-removed` exits non-zero when a trim that looked applied never reached
the wire. That failure already happened once: a top-level `"skills": ["-…"]`
exclusion was accepted, changed nothing, and would have been reported as a win.

## What Changes

Four phases. **Phases 0 and 1 are independent of each other and of everything
else. Phase 2a is gated on Phase 0's baseline being settled. Phase 2b is gated
on Phase 2a's result.**

- **Phase 0 — store hygiene as an opt-in dashboard capability.** Inventory,
  dry-run, and operator-initiated reclamation of memory stores. Retires the
  **hook-captured session-event store** (130 MB across 71 DBs) for operators who
  opt in. This is **not** the deliberate content index (6.8 MB), and it does
  **not** remove `ctx_search`, `ctx_index`, or `ctx_execute`'s `intent`
  auto-index — those keep working against `content/`. What degrades for an
  opt-in operator is recall of *auto-captured session events*, which is the
  thing being traded for 584 MB.
- **Phase 1 — collapse the hermes write surface.** One `memory({action, …})`
  replacing `memory_add` / `memory_replace` / `memory_remove` (6,458 B measured),
  plus a trimmed `skill_manage` description. Originals deactivated via
  `pi.setActiveTools()`. No retrieval semantics touched.
- **Phase 2a — collapse the retrieval *names*, not the engines.** One
  `context_search(query, scope)` that dispatches to the **existing** six tools
  unchanged behind the scenes. Cheap, reversible, no adapter, no store coupling.
  This is the experiment: it manipulates the actual variable (tool-surface
  ambiguity) while holding retrieval quality constant by construction.
- **Phase 2b — collapse the *engines*.** `packages/kb` becomes the retrieval
  engine, hermes demoted from reader to writer, results merged with Reciprocal
  Rank Fusion. This is where the permanent third-party shim is incurred, and it
  proceeds **only** on a positive Phase 2a result plus a no-regression eval.

**Non-goals.** No context-mode code imported, vendored or forked. No change to
`ctx_execute`'s sandbox behaviour or its `content/` index. No data migration. No
change to `kb_search` ranking. No change to defaults for other users.

### Cost estimate (coarse, for decidability — not a commitment)

| Phase | Build | Ongoing |
|---|---|---|
| 0 | ~2–3 days (inventory, dry-run, UI surface, removal record) | low — local FS only |
| 1 | ~1–2 days, ~200 LOC + tests | **shim over hermes write semantics** |
| 2a | ~2–3 days (dispatch shim + one eval run) | low — reversible by config |
| 2b | ~1–2 weeks (adapter, RRF, eval, drift tests) | **permanent adapter over a pre-1.0 store** |

## Capabilities

### New Capabilities

- `memory-store-hygiene` — inventory, dry-run and operator-initiated reclamation
  of agent memory stores.
- `context-retrieval-facade` — one faceted retrieval tool over the retained
  planes (Phase 2a dispatch form; Phase 2b engine form, gated).
- `agent-tool-surface-budget` — deactivating and re-registering third-party tool
  surfaces at pi's registration layer, with a measured budget assertion and a
  pre-registered decision gate.

### Modified Capabilities

- `hermes-memory-settings` — gains the store-hygiene surface.
- `kb-read-discipline` — doctrine names the facade rather than the six tool
  names once Phase 2a lands.

## Impact

- **Wire cost.** Phase 0: **0 B measured** in a plain session (the capture shows
  zero `ctx_*` tools — they reach dashboard sessions later, via the MCP adapter,
  and that path is unmeasured). Phase 1: −6,458 B measured minus the new tool's
  schema (**est.** ~2,000 B) ⇒ **est. −4.5 KB**. Phase 2a: −6,068 B measured
  minus one facade schema (**est.** ~1,500 B) ⇒ **est. −4.5 KB**. Combined
  **est. ~9 KB of 111 KB (~8%)**. The skills catalogue at 43,849 B remains the
  larger lever and is config-only.
- **Disk.** ~584 MB reclaimable for an operator who opts in.
- **Maintenance.** Phases 1 and 2b mean owning a shim over a **pre-1.0**
  third-party store. Stated in `design.md` as the primary argument *against*
  proceeding.
- **Risk.** `kb_search` is the workhorse (718 calls). Any facade that degrades
  its routing is a net loss regardless of bytes saved.
- **Prompt caching** blunts the dollar saving; the argument is signal-to-noise in
  the model's tool space, not cost.

## Discipline Skills

- `doubt-driven-review` — Phase 2b replaces the most-used retrieval tool and
  Phase 0 deletes user data; both are irreversible from the operator's
  perspective. An adversarial review of this proposal already forced a
  structural correction (the original Phase 1→2 gate could not test its own
  hypothesis), which is the evidence this skill is load-bearing here.
- `performance-optimization` — measure-before-optimize is why
  `packages/context-budget` exists; each phase is verified against the meter
  rather than declared.
- `observability-instrumentation` — Phase 0 deletes data and Phase 1 changes
  which tools exist; both need an operator-visible record.
- `review-code` — before commit, per the project checkpoint table.
- `code-simplification` — the facade must beat the null result: if it is not
  simpler than the six tools it replaces, it should not land.

`security-hardening` does not apply: no auth surface, no untrusted input, no new
network path. The reclamation path is operator-initiated on local files, covered
by the dry-run requirement.
