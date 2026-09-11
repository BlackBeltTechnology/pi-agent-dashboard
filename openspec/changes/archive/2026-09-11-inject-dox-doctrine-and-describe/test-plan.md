# Test Plan — inject-dox-doctrine-and-describe

Stage: design   Generated: 2026-05-19

Gate: HARD — 3 gaps resolved with the user before writing (cap = 50 rows, handler p95 < 20 ms, warning channel = `console.warn("[kb] …")`).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | kb-config-and-init / Layered resolution — unset | EP | L1 | automated | no global file, no project file | `loadConfig(cwd)` | `doctrine` = `{inject:"kb", write:false}`, `doctrineSource` = `"none"` |
| E2 | kb-config-and-init / unset — global only | EP | L1 | automated | global `{doctrine:{inject:"off"}}`, no project file | `loadConfig` | `doctrine.inject` = `"off"`, `doctrineSource` = `"global"` |
| E3 | kb-config-and-init / key-presence not file-presence | boundary (key absent, file present) | L1 | automated | project `{readDiscipline:{guard:{mode:"warn"}}}` (no `doctrine`), no global | `loadConfig` | `origin` = `"project"` AND `doctrineSource` = `"none"` |
| E4 | kb-config-and-init / one-level deep merge | decision-table | L1 | automated | global `{doctrine:{inject:"kb"}}`, project `{doctrine:{write:true}}` | `loadConfig` | `doctrine` = `{inject:"kb", write:true}`, `doctrineSource` = `"project"` |
| E5 | kb-doctrine-injection / empty object counts as choice | BVA (empty group) | L1 | automated | project `{doctrine:{}}` | `loadConfig` | `doctrineSource` = `"project"`, `doctrine` = defaults |
| E6 | kb-config-and-init / validation | invalid partition | L1 | automated | project `{doctrine:null}` | `loadConfig` | throws; message names `doctrine` |
| E7 | kb-config-and-init / unknown inject mode | invalid partition | L1 | automated | project `{doctrine:{inject:"manual"}}` | `loadConfig` | throws; message contains `manual` |
| E8 | kb-config-and-init / write is boolean | invalid partition | L1 | automated | project `{doctrine:{write:"yes"}}` | `loadConfig` | throws; message names `doctrine.write` |
| E9 | kb-doctrine-injection / READ per turn + WRITE opt-in | decision-table (inject × write) | L1 | automated | 4 combos `{kb,false}` `{kb,true}` `{off,false}` `{off,true}` | `buildDoctrineFragment` | `{kb,false}` → delimiter + READ, no WRITE heading; `{kb,true}` → READ + WRITE; both `off` → `""` |
| E10 | kb-doctrine-injection / legacy seed — half migration | state (marker removed) | L1 | automated | contextFiles `[{path:"AGENTS.md", content:"<!-- dox:write:start -->…"}]` (no marker) | `hasLegacySeed` | `true` |
| E11 | kb-doctrine-injection / pointer block does not suppress | EP | L1 | automated | contextFiles content = marker + pointer text, no delimiter | `hasLegacySeed` | `false` |
| E12 | kb-doctrine-injection / manual variant detected | EP | L1 | automated | content containing `<!-- dox:read:manual:start -->` | `hasLegacySeed` | `true` |
| E13 | kb-doctrine-injection / coexists — insert before anchor | state | L1 | automated | systemPrompt `"A\nCurrent working directory: /x\n"` | handler | fragment index < anchor index; anchor line still present verbatim |
| E14 | kb-doctrine-injection / coexists — no anchor | boundary (anchor absent) | L1 | automated | systemPrompt `"A"` | handler | result = `"A\n\n── dox doctrine ──…"` |
| E15 | kb-doctrine-injection / reload does not stack | idempotence | L1 | automated | systemPrompt already containing `── dox doctrine ──` | handler runs twice | exactly 1 delimiter occurrence |
| E16 | kb-doctrine-injection / coexists (kb first) | integration of two real pure fns | L1 | automated | pi prompt with anchor | kb handler THEN real `spliceContextFragment(sid,cwd,null)` | output contains `── dox doctrine ──` AND `You are pi session` |
| E17 | kb-doctrine-injection / coexists (bridge first) | integration | L1 | automated | same prompt | `spliceContextFragment` THEN kb handler | both fragments present; exactly one of each |
| E18 | kb-doctrine-injection / first-contact once | state-transition (turn 1→2) | L1 | automated | fake pi, `doctrineSource:"none"` | two `before_agent_start` events | turn 1 prompt contains nudge with the 4 options + `.pi/dashboard/knowledge_base.json` + non-interactive rule; turn 2 does not |
| E19 | kb-doctrine-injection / legacy → migration nudge | decision-table (legacy × source) | L1 | automated | legacy contextFiles, `doctrineSource:"none"` | handler | no doctrine fragment; migration text present; first-contact text absent |
| E20 | kb-doctrine-injection / legacy + inject off | decision-table | L1 | automated | legacy contextFiles, project `{doctrine:{inject:"off"}}` | handler | no fragment, no migration nudge, no first-contact nudge |
| E21 | kb-doctrine-injection / config resolved per turn | state-transition | L1 | automated | temp cwd; turn 1 no config | write `{doctrine:{inject:"kb",write:true}}` between turns; turn 2 | turn 2 fragment contains WRITE heading; turn 1 did not |
| E22 | project-init-skill / pointer not doctrine | EP + idempotence | L1 | automated | empty AGENTS.md | `seedDoctrine` twice | block contains `<!-- dox-doctrine -->`, `pi-dashboard-kb-extension`, `.pi/dashboard/knowledge_base.json`; contains no `dox:*:start`; second call `seeded:false`, file byte-identical |
| E23 | kb-read-discipline / injected doctrine keeps full table (D0) | content-contract | L1 | automated | `packages/kb-extension/dox-doctrine.md` READ section | read | contains: `doc_type` lane rule, `tests/ qa/ scripts/ docker/` corpus boundary, `ctx_search`/`memory_search` corpus line, `STALE`+`GONE`+`MOVED`+`FRESH`, `kb_search --doc-type agents` row, `kb_get` row, `ctx_execute_file` row, "Fall-through" |
| E24 | kb-dox-tree / empty-purpose enumeration | EP | L1 | automated | temp tree: `a/AGENTS.md` (1 empty row), `b/AGENTS.md` (1 empty, 1 filled) | `listEmptyPurposeRows(root)` | 2 groups; subjects `a/x.ts`, `b/y.ts`; total 2 |
| E25 | kb-dox-tree / JSON output | shape | L1 | automated | same tree | `dox describe --list --json` | parses; `[{agentsPath, subjects:[…]}]` + `total: 2` |
| E26 | kb-dox-tree / `--dir` restricts | EP | L1 | automated | same tree | `--dir a` | only `a/AGENTS.md`; total 1 |
| E27 | dox-describe / nothing to describe | boundary (zero) | L1 | automated | tree with all cells filled | `--list` | `[]`, total 0, exit 0 |
| E28 | kb-dox-tree / whitespace-only purpose | BVA | L1 | automated | row `` | `f.ts` |   | `` | `--list` | counted as empty |
| E29 | kb-doctrine-injection + dox-describe / shipped files | packaging | L1 | automated | `packages/kb-extension/package.json` | read `files` | includes `dox-doctrine.md` and `.pi/skills/dox-describe/`; both paths exist on disk |
| E30 | D9 dogfood / no reduction | content-contract | L1 | automated | root `AGENTS.md` | read | no `## Docs-First Gate` / `## Investigation Protocol` heading; contains `docs/faq.md` grep row and `run-fixtures.ts` line; `.pi/dashboard/knowledge_base.json` has `doctrine.write === true` |
| E31 | kb-doctrine-injection / first-contact end-to-end | real session | — | manual-only | temp project, `project-init` run, no `doctrine` key | first turn | agent asks 4-option question; choose `kb read+write`; project file gains `doctrine` with other keys intact; next session: no nudge, READ+WRITE fragment once |
| E32 | kb-doctrine-injection / migration accepted | real session | — | manual-only | temp project with legacy full seed (kb variant) | first turn, accept | AGENTS.md block replaced by pointer; first-contact question follows; next session injects |
| E33 | dox-describe / plan → confirm → fill, cap, idempotent | real session | — | manual-only | temp `kb dox init` tree with 51 empty rows | run skill twice | run 1: plan shows 51 rows + cap 50, confirm, 50 filled, 1 deferred; run 2: fills 1, then a 3rd run modifies nothing; `kb dox lint` clean; `kb_search` finds a new purpose |
| E34 | project-init-skill / describe offered | real session | — | manual-only | temp dir | run `project-init` with DOX | after tree scaffold the skill asks "run dox-describe now?" |
| E35 | design D5 risk / doctor check | real session | — | manual-only | temp project with `doctrine` key, kb extension not loaded | run `doctor` | report names "doctrine configured but kb extension not loaded" |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | kb-doctrine-injection / handler latency | tail-latency (fn-level) | L1 | automated | 100 sequential `before_agent_start` events, warm project + global config on disk | p95 wall < 20 ms | one test run |

### Frontend-quirk

_none — no rendered UI in this change._

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | kb-doctrine-injection / malformed project config | fault-injection (bad input) | L1 | automated | project file `{"doctrine": ` (truncated JSON) | 3 turns | each turn: READ fragment present, WRITE absent, no first-contact nudge; `console.warn` called exactly once with a `[kb]` prefix |
| X2 | kb-doctrine-injection / doctrine file missing | fault-injection (abort) | L1 | automated | `dox-doctrine.md` path unreadable | handler | no throw; systemPrompt unchanged; one `[kb]` warn |
| X3 | kb-dox-tree / AGENTS.md without a `| File | Purpose |` table | malformed input | L1 | automated | `c/AGENTS.md` = prose only | `--list` | file skipped; no throw; other groups reported |
| X4 | D8 / reindex contention | fault-injection (SQLITE_BUSY) | L1 | automated | reindex fn stubbed to throw `SQLITE_BUSY` once | `scheduleReindex` fires | error logged with `[kb]` prefix, not rethrown; next scheduled reindex succeeds |
| X5 | dox-describe / unreadable subject | real session | — | manual-only | tree row pointing at a 0-byte or binary file | run skill | that Purpose cell stays empty and is listed in the final report |

---

## Coverage summary

- Requirements covered: 14/14 (kb-doctrine-injection ×4, dox-describe ×2, kb-read-discipline ×2, kb-config-and-init ×3, project-init-skill ×1, kb-dox-tree ×1, + D9 dogfood contract)
- Scenarios by class: edge 35 · perf 1 · frontend 0 · error 5
- Scenarios by level: L1 35 · L2 0 · L3 0 · — 6
- Scenarios by disposition: automated 35 · manual-only 6

## New infra needed

- none. L1 exemplars already exist: `packages/kb/src/__tests__/` config tests (see list below), `packages/kb-extension/src/__tests__/guard.test.ts` + `reindex.test.ts` (pure module + fake pi), `packages/extension/src/__tests__/dashboard-context-injector.test.ts` (prompt splicing), `packages/extension/src/__tests__/project-init-seed-doctrine.test.ts` (seed), `packages/kb/src/__tests__/dox-triage.test.ts` + `dox-source-coverage.test.ts` (tree walks).
