# Add query-time trust verdicts and a kb search guard

Two independently shippable arms behind one change: make a `kb_search` hit
say whether it is still **honest** (arm A), and make the READ discipline fire on
the **bypass action** rather than only in prose (arm B). Both adapt ideas from
[Heimdall](https://github.com/ArihantDeva/heimdall) (MIT), reworked against
machinery this repo already has.

## Why

### Arm A — a hit never says whether it is still true

The KB indexes markdown that **describes source it does not index**. A DOX row

```
| `dox.ts` | Stale-row triage. `resolveBaseline` walks file history … |
```

is an assertion about `packages/kb/src/dox.ts` that decays silently the moment
that file changes. We already detect this — `kb dox lint` reports `stale` when
the acked hash no longer matches, and `dox-triage.ts` resolves a baseline diff —
but **only offline, in a lint the agent does not run before acting.** At
retrieval time every hit looks equally authoritative. The agent's whole reason to
trust `kb_search` over `rg` is that the row summarises code it would otherwise
read; a row describing code that has since moved or changed is worse than no
answer, because it is acted on without verification.

Heimdall's `bin/kb_search_verify.py` labels every hit `STRONG` / `WEAK` /
`REBUILT` / `STALE` by re-verifying against the live filesystem at query time.
Two facts from reading that source make the adaptation cheap here:

1. **~100 of its 245 lines are a path-extraction heuristic we do not need.**
   Heimdall's nodes are unstructured prose, so it regex-mines `~/…` paths out of
   the body, expands brace groups, and greedily extends across spaces to survive
   directory names like `"Shepherd Ventures"`. Our chunks carry a real `path`,
   and DOX rows resolve through the existing `resolveRowPath`. That whole layer
   disappears.
2. **Its threshold is admittedly uncalibrated** — `# 0.5 threshold: heuristic,
   uncalibrated — tune only with a labeled hit set`. We *have* labeled hit sets
   (`packages/kb/eval/golden.*.json`, n=108 markdown / n=104 source) and a
   scoring harness (`eval.ts`, `run-fixtures.ts`). We can calibrate what they
   could not.

The load-bearing constraint, also from their source: **a verdict is a trust
label, not a relevance signal.** Their comment records the failure mode of
conflating the two — *"keeps the true STRONG hit on top instead of burying it
under a junk node whose tokens happen to lexically overlap."* Verdicts here
SHALL NOT reorder results.

We also explicitly **reject** their `handle_stale` behaviour, which deletes index
nodes from inside a read-path search and rehomes moved files by unqualified
`find -name <basename>` over hardcoded roots (`kb-rehome.sh`, exactly-one-hit or
give up). Search stays read-only, and git already answers "where did this file
go" authoritatively via rename detection.

### Arm B — the READ discipline never fires on the bypass

`steer-agents-to-kb-tools` replaced the prose gate with a mechanical
substitution table after measuring 10:1 under-use (485 bash search calls vs 24
`kb_search` over 1,079 tool calls; in 7 of 20 sessions `grep`/`rg` ran with
**zero** `kb_search`). The table is an improvement in framing, but enforcement in
`kb-extension` still only fires on **markdown writes** (the opt-in
`doxEnforcement` nudge). Nothing observes the actual violation: a source `grep`
before any `kb_search`.

Heimdall's `extensions/kb-search-guard.ts` + `lib/kb-guard-core.mjs` is written
directly against pi's `ExtensionAPI` and splits a zero-dep pure state machine
from the hook — the same split `reindex.ts` / `extension.ts` already uses here.
It counts consecutive search actions, resets only on knowledge-access (edits do
**not** reset), and parses bash by pipe/`&&`/`;` segment so `cat f | grep x`
counts while `npm test` never does.

The part that makes enforcement defensible, and which we would not have designed
unprompted, is the **self-service escape hatch**: a `kb_guard_pause` tool the
agent itself calls for 1–20 turns, ticked down on `turn_start`, expiring to a
clean slate. It answers the standing objection to any nudge ladder — legitimate
bulk exploration during a refactor — without a human in the loop.

### Not adopted

Heimdall's headline is a graft/bge-m3 embedding backend behind a reconciler
daemon. Their own `bench/analysis.md` reports it shipping **recall@1 = 0.20**,
root-caused to an FTS5 AND-join over natural-language tokens plus a vector lane
that embeds only the title, and measures a pure-BM25 simulation over the same
data at **recall@1 = 0.90** — *"proper lexical retrieval alone clears every
current cell."* That is evidence for the FTS5-only design already shipped here,
not against it. No embeddings, no daemon, no journal.

## What Changes

**Arm A — trust verdicts (`packages/kb`, `packages/kb-extension`)**

- New `packages/kb/src/verdict.ts`: a hit's **subject set** — the resolvable DOX
  rows of its section, capped at 8 in row order — is labelled `FRESH` / `STALE`
  / `MOVED` / `GONE` / `UNVERIFIED`; the hit carries the worst-of label plus
  per-label counts. `UNVERIFIED` (subject exists, no acknowledged hash yet) is
  the honest default at first deployment, not an error.
- Verdicts computed for `doc_type: agents` hits, where rows document source
  files. Prose hits report no verdict rather than a vacuous one.
- The stage lives **outside the store**: `store.search()` stays sync and
  untouched; an async post-search enricher in kb-extension (plus an opt-in CLI
  flag) does the stat/hash/git work — the same post-processor shape Heimdall
  itself uses.
- Freshness is hash-is-truth with a persisted stat pre-filter: acknowledgement
  (sidecar v2 — today only the sha256 exists) records `{sha256, size, mtimeMs}`
  per documented file; a matching stat skips the read. Subjects over 1 MB or
  binary are never hashed.
- `MOVED` resolves through git rename detection, not a basename search;
  non-git sources and undetectable renames degrade to `GONE` (stated
  limitation).
- `renderHits` shows the verdict inline; the `json` format carries it structured.
- **Label-only**: ordering is byte-identical to today with verdicts enabled.
- Optional second arm, default OFF pending calibration (mirroring how
  `coverageRerank` / `prf` shipped): Heimdall's **content coverage** signal —
  do the query terms actually appear in the subject file — split from `FRESH`
  as a separate confidence field, gated on the bundled golden sets.

**Arm B — search guard (`packages/kb-extension`)**

- New pure `packages/kb-extension/src/guard.ts` (no pi imports, testable
  standalone) — chain counter, reset set, bash segment parsing.
- Its OWN `tool_call` hook registration in `extension.ts` (the existing hook is
  gated inside `dirAgentsPush` and is not reused); warnings delivered via
  `tool_result`, blocks via `tool_call`.
- Ladder: warn → escalate. **Blocking is implemented but never default** —
  the shipped default is `warn` (resolved at planning).
- Reset set: `kb_search` / `kb_neighbors` / `kb_get` tool calls, and bash
  commands invoking the kb CLI (the doctrine's own recommended path must
  reset, or compliant agents get false nudges).
- `kb_guard_pause` tool: agent self-service suspension, 1–20 turns, clean-slate
  expiry, ticked on `turn_start`.
- Config `readDiscipline.guard.mode` in `knowledge_base.json`
  (`off` | `warn` | `block`) with documented rollback. Env override
  `KB_GUARD_MODE` may select `off`/`warn` only — it can weaken, never enable
  `block`.

## Impact

- **Specs:** `kb-fts5-search-store` (verdict field on hits, no-reorder
  guarantee), `kb-dox-tree` (subject resolution + acked-hash reuse),
  `kb-read-discipline` (guard, ladder, pause tool).
- **Code:** `packages/kb/src/{verdict.ts,render.ts,types.ts,dox-triage.ts}`
  (sidecar v2), `packages/kb-extension/src/{guard.ts,extension.ts}`;
  `sqlite-store.ts` is deliberately untouched.
- **Consumers:** `kb_search` output gains a field; `renderHits` output changes
  shape again (consumer-visible, same class of change as `slim-kb-search-output`).
- **Doctrine:** root `AGENTS.md` per-turn token cost, conditional on the phase-7
  measurement.
- **Latency:** the store's shipped 50 ms search budget is untouched (the store
  is); verdict enrichment carries its own additive budget, spec'd with
  conditions.
- **Out of scope, tracked separately:** retrieval telemetry (`kb_*` calls,
  hit rate). It is defined in terms of verdicts, so it sequences after arm A.
  Heimdall's `telemetry.sh` documents the counting trap to inherit — matching
  `kb_search` as a raw string in session JSONL over-counts ~24x, because the
  injected `AGENTS.md` doctrine mentions the tool name every turn.

**Phase 7 — gate trim (measurement-gated)**

The `Docs-First Gate` costs ~694 tokens of a ~3,478-token `AGENTS.md` injected
every turn (20.0%; ~820 including the `Investigation Protocol` section that
restates it). The guard delivers the *compliance* half at violation time, so the
per-turn prose may be reducible. The *routing* half is not a trim candidate: a
violation-time nudge cannot carry which lane to select, and the `doc_type` lane
pick alone measures P@1 0.041 → 0.227 on file lookups while measurably hurting
prose queries (0.150 → 0.067). The trim is gated on a non-inferiority A/B via
`scripts/ab-context`; "trim nothing" is a valid outcome, and the `project-init`
seeds stay untrimmed because a seeded project may never install kb-extension.

## Decision — default guard mode

Resolved at planning: `readDiscipline.guard.mode` defaults to **`warn`**. The
`doxEnforcement` default-OFF precedent was considered and rejected here — a
guard that is off does nothing about the measured 10:1 under-use that motivated
`steer-agents-to-kb-tools`. Config (`off` | `block`) is the rollback path;
`block` is never reachable as a default.

## Discipline Skills

- `doubt-driven-review` — verdicts add a public field to `KbHit` and change
  `renderHits` output shape for every consumer; the guard can suppress or
  (in `block` mode) refuse a tool call the agent asked for. Both are awkward to
  reverse once agents depend on them.
- `performance-optimization` — verdict enrichment adds per-subject filesystem
  work (stat, capped hash, git rename detection) in a POST-SEARCH enricher,
  outside the store; it carries its own stated additive budget (≤15 ms median
  under spec'd conditions), not the store's 50 ms search budget. Measure
  against the additive budget; do not assume `stat` or a git spawn is free at
  8 subjects per hit.
- `review-code` — spans kb store, render, types, the extension hooks, and a new
  tool registration.
- `security-hardening` — the guard reads bash command strings and the verdict
  path reads arbitrary files off disk during a query; both need bounds
  (read cap, no path escape outside indexed roots).
