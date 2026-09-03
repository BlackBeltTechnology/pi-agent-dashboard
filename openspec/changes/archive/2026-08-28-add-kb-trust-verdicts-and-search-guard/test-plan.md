# Test Plan — add-kb-trust-verdicts-and-search-guard

Stage: design   Generated: 2026-08-28

HARD gate resolved: hash cap = **1048576 bytes (1 MiB)**; the 15 ms enrichment
target is **advisory** (recorded in `measurements.md`, no CI assertion). No
clarification markers remain.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Verdict labels (kb-fts5 delta, "Hits carry a trust verdict") | decision-table | L1 | automated | temp git repo: indexed AGENTS.md row + acked hash; subject file unchanged | enrichHits over a hit whose section resolves to that subject | verdict FRESH; subject not read when acked stat baseline matches |
| E2 | same | decision-table | L1 | automated | subject file edited after ack | enrichHits | verdict STALE; hash recomputed and differs |
| E3 | same | decision-table | L1 | automated | subject `git mv`'d to one successor path | enrichHits | verdict MOVED; successor path reported |
| E4 | same | decision-table | L1 | automated | subject deleted, no successor; second case: plain fs dir (no git) | enrichHits | verdict GONE in both; no path guessed |
| E5 | same / UNVERIFIED distinctness | decision-table | L1 | automated | subject exists, never acknowledged (no sidecar entry) | enrichHits | verdict UNVERIFIED; NOT STALE; NOT FRESH |
| E6 | existence precedes hash gate | state-transition | L1 | automated | subject deleted AND never acked | enrichHits | verdict GONE (not UNVERIFIED) |
| E7 | Aggregation worst-of + counts | decision-table | L1 | automated | section with 8 resolvable rows: 1 GONE, 2 STALE, 5 FRESH | enrichHits | hit verdict GONE; counts show 1/2/5 composition |
| E8 | Subject cap 8 + visibility | BVA | L1 | automated | section with exactly 8, then 9, resolvable rows | enrichHits | 8 → all checked; 9 → first 8 checked; counts state checked AND total |
| E9 | Null verdict for prose | decision-table | L1 | automated | hit with zero resolvable rows | enrichHits | verdict null; renders nothing |
| E10 | Hash cap boundary (decided: 1048576) | BVA | L1 | automated | subject of exactly 1048576 bytes; then 1048577 bytes; no stat baseline | enrichHits | 1048576 → hashed (STALE/FRESH by content); 1048577 → not hashed → UNVERIFIED |
| E11 | Stat baseline skip | decision-table | L1 | automated | acked baseline {sha256,size,mtimeMs}; (a) stat matches, (b) size differs | enrichHits with counting fake fs | (a) zero content reads, FRESH; (b) falls back to hash |
| E12 | v1 sidecar tolerance (kb-dox delta) | error-shape | L1 | automated | sidecar JSON with sha256 only (no size/mtimeMs) | enrichHits | unknown stat fields treated as unknown; hash runs; no crash |
| E13 | Coverage separate + default-off | decision-table | L1 | automated | default opts; then coverage enabled; subject >262144 bytes | enrichHits | off → no subject read, no coverage field; on → own field, verdict unchanged; read capped at 262144 |
| E14 | Label-only, never rank | invariant | L1 | automated | fixture page incl. STALE and GONE hits at rank 1 | same query, verdicts on vs off | hit order byte-identical; GONE hit still at rank 1, labelled |
| E15 | Read-only enrichment | invariant | L1 | automated | page containing STALE/MOVED/GONE hits | enrichHits | zero index mutations, zero file writes/deletes (spy fs + store) |
| E16 | Guard chain threshold 3 | BVA | L1 | automated | guard (warn mode); 2 then 3 consecutive search actions | note() feed | 2 → null; 3rd → warning string |
| E17 | Reset set incl. kb CLI | state-transition | L1 | automated | chain>0; then kb_search / kb_neighbors / kb_get / bash `kb agents x` / bash `kb_search` empty query | note() | each resets chain AND firings to zero |
| E18 | Edit does not reset | state-transition | L1 | automated | chain=2; edit file between searches | note() | chain continues; next search fires |
| E19 | Bash segment parse | decision-table | L1 | automated | `cat f \| grep x`; `rg x .`; `npm test`; `echo hi && ls`; `rg x \|\| true`; multi-line with `find .`; `timeout 60 rg` (documented gap) | note("bash") | first five count (incl. or-chain and newline); npm test does not; `timeout 60 rg` does NOT count — accepted gap asserted as such |
| E20 | Ladder × mode | decision-table | L1 | automated | firings 1, 2, 3+ in warn mode; same in block mode | note() | warn: warning → escalation → escalation (never block); block mode: warning → escalation → {block:true, reason names kb call} |
| E21 | Pause clamp/expiry (1–20) | BVA + state | L1 | automated | suspend(0), suspend("junk"), suspend(1), suspend(25), re-suspend(5) under active 20, tickTurn ×N | suspend/tickTurn | junk/0 no-op; 20→20; re-suspend keeps 20; expiry → clean slate (chain 0, firings 0) |
| E22 | Env weakens, never strengthens (D14) | decision-table | L1 | automated | KB_GUARD_MODE=block with config off; =warn; =off | guard init | effective mode block→NOT blocking (warn/off per value); env can set off/warn only |
| E23 | Shipped default advisory | decision-table | L1 | automated | no config, no env | guard init | mode = warn; block unreachable |
| E24 | Seeds stay untrimmed (phase 7.7) | invariant | L1 | automated | project-init `AGENTS.md.tmpl` + dox-doctrine.md | template content check | substitution table rows present in both kb-wired and manual variants |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Advisory 15 ms enrichment target (decided: advisory) | measured median | L1 | automated | default page (10 hits, ≤8 subjects/hit, all exist, stat-gated) on the fixture index; ONE batched rename scan | median enrichment ms, recorded vs advisory 15 ms; NO pass/fail gate | recorded per run into `measurements.md` alongside the 1.1 baseline |

### Frontend-quirk

None — no rendered-UI behaviour changes; verdicts are plain text in `kb_search` tool output rendered by the existing generic tool-result path.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Guard degrades silently | fault-injection (throw) | L1 | automated | guard.note() throws mid-evaluation | tool_call feed | tool call proceeds; tool result returned unmodified |
| X2 | Unreadable subject during enrichment | fault-injection (EACCES) | L1 | automated | subject file chmod 000 | enrichHits | subject labelled UNVERIFIED (cannot hash); no crash; no partial verdict |
| X3 | git unavailable for rename batch | fault-injection (spawn fails) | L1 | automated | absent subject + git spawn error | enrichHits | degrade to GONE; no throw; no guessed path |

### Manual-only

| id | requirement | disposition | procedure |
|----|-------------|-------------|-----------|
| M1 | Phase 7.5 A/B non-inferiority | manual-only | `scripts/ab-context` run per `ab-test-context-injections` skill (~/.pi/agent/projects-memory/pi-agent-dashboard/skills/), post-merge, gated on M2 field data |
| M2 | Phase 7.2 guard firing-rate observation | manual-only | collect firing rate over a representative window of real sessions before any trim decision |

## Coverage summary

- Requirements covered: 13/13 delta requirements (all scenarios in the three deltas mapped)
- Scenarios by class: edge 24 · perf 1 · frontend 0 · error 3 · manual-only 2
- Scenarios by level: L1 25 · L2 0 · L3 0
- Scenarios by disposition: automated 28 · manual-only 2

## New infra needed

None — L1 covers all automated rows (guard.ts and verdict.ts are pure modules; enrichment tests use the temp-git-repo pattern from `packages/kb/src/__tests__/dox-triage.test.ts`). No L2/L3 rows: no process-level or rendered-UI behaviour is added.
