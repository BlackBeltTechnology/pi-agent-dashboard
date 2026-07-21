# Test Plan — distill-hermes-memory-into-skills

Stage: design   Generated: 2026-07-17

Gate resolved (scenario-design HARD gate): `T_age` = 14 days · classifier auto-drop < 0.7 ·
cross-dedup = semantic near-match ≥ 0.85 normalized similarity.

No rendered UI, no server/packaging path, no latency budget → all automatable scenarios are
L1 unit (pure logic + a temp SQLite for the memory-tool remove). No L2/L3/electron/ci rows.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R-maturity | BVA | L1 | automated | entry `last_referenced` = 13d ago vs 15d ago | run gate | 13d excluded (not settled); 15d eligible |
| E2 | R-shareability | EP | L1 | automated | entry `target = user` | run candidate selection | never a candidate (excluded regardless of age/content) |
| E3 | R-shareability | EP (invalid) | L1 | automated | entry content holds an API token + absolute `/Users/...` path | run scrub | hard no-move; entry stays in Hermes; no sidecar write |
| E4 | R-classifier | boundary | L1 | automated | classifier confidence 0.69 vs 0.71 | classify | 0.69 auto-dropped (no human table); 0.71 surfaced for approval |
| E5 | R-scope | EP | L1 | automated | entry with `project` ≠ session `projectName`; separate entry `project IS NULL` | select | both are non-candidates |
| E6 | R-dedup | boundary | L1 | automated | sidecar already holds a lesson at similarity 0.86 vs 0.84 to candidate | author | 0.86 skipped (no 2nd copy); 0.84 authored |
| E7 | R-backstop | decision | L1 | automated | repo `knowledge_base.json` omits `.pi` from sources | run pass | warning emitted that distilled lessons are not `kb_search`-retrievable off-phase |
| E8 | R-triggers | state | L1 | automated | lesson authored into a skill whose `description` lacks the lesson's trigger situation | author | pass produces a proposed `description` update that includes the situation token |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R-move-out | fault (over-match) | L1 | automated | `old_text` substring matches 2 rows (incl. distinct-scoped `failure` copies) | move-out | row-count check sees >1 → abort, no removal, entry flagged |
| X2 | R-move-out | fault (miss) | L1 | automated | `old_text` matches 0 rows (content reworded for sidecar) | move-out | row-count check sees 0 → abort, entry flagged |
| X3 | R-move-out | fault (crash) | L1 | automated | process aborts after sidecar author, before Hermes remove | re-run pass | entry still in Hermes (recoverable dup); dedup (E6) skips re-author → no loss, no double |
| X4 | R-move-out | invariant | L1 | automated | (any successful move-out) | move-out | removal issues only `memory(action:remove)`; zero raw `DELETE` on `sessions.db` |
| X5 | R-classifier | invariant | L1 | automated | routing table not yet approved | attempt move-out | no `memory(action:remove)` fires before the approval flag is set |

### Manual-only (no automatable observable — deferred post-merge)

| id | requirement | technique | level | disposition | surface | human judgment |
|----|-------------|-----------|-------|-------------|---------|----------------|
| M1 | R-classifier | subjective | — | manual-only | proposed routing table | is each memory routed to the *right* host skill? |
| M2 | R-triggers | subjective | — | manual-only | proposed `description` diff | is the tuned trigger correct and not over-broad? |
| M3 | R-privacy | subjective | — | manual-only | approval step | human confirms no personal/mis-scoped entry is promoted before move-out |

---

## Coverage summary

- Requirements covered: 6/6 (maturity, shareability, classifier, scope, dedup, move-out/triggers/backstop).
- Scenarios by class: edge 8 · perf 0 · frontend 0 · error 5 · manual 3.
- Scenarios by level: L1 13 · L2 0 · L3 0.
- Scenarios by disposition: automated 13 · manual-only 3.

## New infra needed

- none — L1 vitest over a temp SQLite fixture of the `memories` schema + a scrub fixture. No new harness.
