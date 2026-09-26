# Test Plan — context-manager-kernel

Stage: design   Generated: 2026-09-24

The hard gate was resolved via `ask_user` (G1–G3) before this file was written:
- **G1:** lessons read-after-write is strong.
- **G2:** the identity-check budget is warm p95 < 2 ms with 150 tools, and
  cold < 50 ms.
- **G3:** calibration runs in report mode only; no floor is committed.

No clarifications are open.

Level legend (this repo):
- **L1:** vitest under `packages/*/src/**/__tests__/`. Rows whose technique
  says "(contract harness)" run against a real pi `AgentSession` (see New
  infra).
- **L2:** qa smoke.
- **L3:** Playwright.

No scenario renders UI.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | runtime: inert unless enabled (flag resolution) | decision-table | L1 | automated | env `PI_CONTEXT_MANAGER` ∈ {`1`,`0`,`yes`,unset} × project file ∈ {`true`,`false`,malformed,absent} × global file ∈ {`true`,`false`,absent} | resolve the flag at load for the process cwd | `enabled` equals the precedence table (env `1`/`0` wins; `yes` ignored; malformed counts as absent); exactly one `[context-manager]` `console.warn` per ignored env value and per malformed file, per process |
| E2 | runtime: inert unless enabled | EP | L1 | automated | flag resolves off; fake pi runner | load the factory | 0 `pi.on` registrations, 0 tools, 0 commands; the session's prompt, active tools and one tool result equal a run without the package |
| E3 | runtime: state per session, only degrades | state-transition (legal + illegal edges) | L1 | automated | sessions starting in each of `disabled`/`refused`/`active`; config flipped `false→true` mid-session; an SDK run where `session_start` never fires | a flag edit, the next events, and a lazy first event | a mid-session flip leaves the state unchanged and the next session picks it up; no path reaches `active` from another state; `active→refused` only via identity; with no `session_start`, the first event computes the state |
| E4 | runtime: tools registered in `session_start` only when active | EP (contract harness) | L1 | automated | a real in-memory `AgentSession`; states `disabled`, `refused`, `active` | `session_start`, then one prompt with a stub model | `active`: `context_search`/`context_get` are registered and active; `disabled`/`refused`: not registered, not active, and no tool-loadout change for them in the transcript's system entries |
| E5 | runtime: resumed session gets the tools | state-transition (contract harness) | L1 | automated | a session file created with the flag off (tools absent) | resume it with the kernel `active` | after `_restoreToolsFromTranscript`, both tools are in `getActiveTools()` |
| E6 | runtime: refusal by package identity | decision-table | L1 | automated | tools whose `sourceInfo` is `npm:pi-hermes-memory@0.9.9`, a path into a dir whose package.json `name` is `context-mode`, `npm:pi-blackhole` (`recall`), `npm:my-context-mode-ext`, a foreign `memory_search` | `resolveState` for the epoch | the first three make the state `refused` and name the package and tool source; the last two keep it `active` |
| E7 | runtime: package loaded between prompts | state-transition | L1 | automated | an `active` session; kernel and kb-extension in both load orders; a context-mode-sourced tool registered after prompt 1 | `before_agent_start` of prompt 2 | the state is `refused` before either handler acts; prompt 2's system prompt carries kb-extension's appended doctrine (byte-equal to a no-kernel run); one `[context-manager]` transition log; `context_search` removed from active tools |
| E8 | runtime: chassis composition | decision-table | L1 | automated | two `tool_result` consumers (orders 10, 20), each appending a line and returning `details` | one tool result | content ends with line-10 then line-20; `details` equals the order-20 consumer's return (pi's replace semantics); `tool_call` stops at the first `{block}` |
| E9 | runtime: kb bodies run exactly once | state-transition + decision-table (load order × bound/unbound) | L1 | automated | kernel and kb-extension in a fake runner, both load orders; first event with an unbound slot | a markdown `write`, 3 consecutive `rg` bash calls, and one prompt | per event, the markdown write triggers exactly 1 reindex, the guard fires exactly once at the threshold crossing, and the prompt has exactly 1 doctrine fragment; on the first event with the kernel's handler first, kb-extension handles it and the kernel takes over from event 2 |
| E10 | runtime: guard pause under the kernel | state-transition | L1 | automated | an `active` session | `kb_guard_pause` for 3 turns, then a 3-search chain in each of turns 1–4 | no guard text in turns 1–3; guard text in turn 4 |
| E11 | runtime: reload does not stack consumers | state-transition | L1 | automated | an `active` session in a fake runner | simulate `/reload` twice (shutdown → factory re-run → start), then a markdown write | each hook has exactly one entry per consumer owner; exactly 1 reindex |
| E12 | runtime: in-process child session | state-transition (contract harness) | L1 | automated | an `active` parent session; a child built with `createAgentSession({ sessionManager: SessionManager.inMemory(cwd) })` loading the same extensions | the child prompts once, then `dispose()` (no `session_shutdown`); then the parent runs a markdown write and `kb_guard_pause 2` | the parent reindexes once and its guard pause holds for 2 turns; the parent's docs search still works (store open); the registry has no id-keyed structure holding the child's slot (it is keyed by the `WeakMap` session manager) |
| E13 | runtime: registry version skew | EP | L1 | automated | kb-extension binding into `…context-manager.v0` while the kernel reads `v1` | one prompt and `context_search` | kb-extension appends the doctrine itself; `/context status` shows `docs: unavailable`; `context_search` returns `(docs unavailable)` |
| E14 | runtime: pinned tier byte-stable | invariant | L1 | automated | unchanged doctrine config and file | 100 turns on the sections path, then 100 on the forced path | the pinned block's SHA-256 is identical within each run of 100 |
| E15 | runtime: coexists with the bridge in either order | decision-table (order × path) | L1 | automated | a prompt rendered by pi's `buildSystemPromptSections` (with `<cwd>`, no `Current working directory:`); the real `spliceContextFragment` | the kernel before the bridge, and the bridge before the kernel; 2 turns each | exactly 1 `── context-manager pinned ──` and 1 `── pi-dashboard session context ──` in the final prompt; turn 1 and turn 2 are byte-equal per order |
| E16 | runtime: literals quoted in project files | BVA | L1 | automated | an AGENTS.md context file containing the sentinel, the bridge delimiter and `<context>` verbatim; plus a forced prompt with no `</cwd>` | a forced-path insertion | the block is inserted exactly once, after the last `</cwd>`; with no `</cwd>` it is appended once, wrapped `<context>`…`</context>` exactly as pi renders sections |
| E17 | runtime: nothing to pin | EP | L1 | automated | `doctrine.inject: off`; no other provider | one prompt | no sentinel, no `context` section, and the forced prompt is unchanged by the kernel |
| E18 | runtime: per-turn message budgets | BVA | L1 | automated | (a) 3 `cue` items of 300 chars with priorities 3/2/1; (b) the first-contact nudge in a 120-char cwd; (c) no items | one prompt each | (a) one message holding the priority-3 and priority-2 items (≤ 600 chars); (b) one message containing the whole nudge including "non-interactive", `display: true`; (c) no message |
| E19 | runtime: nudge not repeated | state-transition | L1 | automated | an unset doctrine key; the nudge delivered on turn 1 | `/reload`, then a prompt; separately, resume, then a prompt | no second `context-manager` message with the first-contact nudge id in either path |
| E20 | doctrine delta: delivery under the kernel | decision-table (state × seed × readable) | L1 | automated | kernel `active`/`refused` × legacy seed present/absent × doctrine file readable/unreadable | one prompt | active + no seed: 1 doctrine fragment inside the pinned block, 0 appended by kb-extension; refused: byte-equal to a no-kernel run; active + seed: no doctrine in the pinned block and the migration nudge once as a message; unreadable: no doctrine, no nudge, one `[kb]` warn |
| E21 | read-discipline delta: reset set | decision-table | L1 | automated | guard chain at 2 searches | `context_search` (active), `context_search ""` (active), a foreign `context_search` (kernel not active), an `edit` | the first two reset the counter and firing count to 0; the foreign call and the edit do not |
| E22 | retrieval: a lesson appears once | EP | L1 | automated | a temp git repo whose kb sources include `.pi`, with `.pi/lessons/a.md` matching the query | `context_search {scope:["docs","lessons"]}` and `kb_search` | the context search returns `a.md` once, tagged `[lessons]`; `kb_search` output byte-equals the flag-off run |
| E23 | retrieval: first use, subdirectory, unconfigured scope | EP | L1 | automated | `~/.pi/agent/lessons/g.md` (via a temp HOME); no `lessons.db`; a session cwd `<root>/packages/x`; `scope:"web"` | the first `context_search` over lessons; then over web | `<root>/.pi/dashboard/context_manager/lessons.db` is created and `g.md` returned; no DB is created under `packages/x`; web returns the no-match text without error |
| E24 | retrieval: read-after-write (G1) | state-transition | L1 | automated | the lessons scope indexed | write `<root>/.pi/lessons/new.md` containing `zephyrquark`, then immediately `context_search {scope:"lessons", query:"zephyrquark"}` (no sleep) | the result includes `new.md` |
| E25 | retrieval: docs parity with kb_search | invariant (golden replay) | L1 | automated | the cached fixture index of this repo; no lesson under a docs source; docs floor 0 | every query of `golden.markdown-intent.json` and `golden.source-intent.json` through both tools | an identical ordered (path, heading) list for 100% of queries |
| E26 | retrieval: lesson hits don't shorten the page | BVA | L1 | automated | a docs result set where 3 of the top 10 lie under `.pi/lessons/` and ≥ 10 other docs hits exist | `context_search {scope:"docs", limit:10}` | 10 hits, 0 under a lessons root |
| E27 | retrieval: default call is docs-only | EP | L1 | automated | `lessons.db` with a strong match; docs with a weaker one | `context_search {query}` (no scope) | only `[docs]`-tagged hits |
| E28 | retrieval: fusion, format, empty query | decision-table | L1 | automated | docs ranks A,B; lessons ranks L1,L2 | `scope:["docs","lessons"]`; `format:"yaml"`; `query:""` | order A, L1, B, L2 with scope tags; `yaml` renders condensed without error; empty query gives `(no query)` / `[]` |
| E29 | retrieval: abstention semantics | BVA | L1 | automated | floor `{value:v, norm:"raw"}` with a first-hit relevance of v−ε, v, v+ε; floor 0 | `context_search {scope:"docs"}` | v−ε gives `(no confident match)` / `[]`; v and v+ε give the full list in the provider's order and count; floor 0 never abstains |
| E30 | retrieval: calibration script modes (G3) | decision-table | L1 | automated | tiny synthetic golden/negative fixtures where the ship rule passes, and ones where it fails | the script in report mode; `--write` + fail; `--write` + pass | report: `measurements.md` fields present (floor, norm, verify counts with n, P@1/MRR deltas, abstention per set with n, chunk count, ship-rule verdict), no config written; `--write` + fail: no config written, reason printed; `--write` + pass: `retrieval.floor.docs = {value, norm}` written, other keys preserved |
| E31 | retrieval: negatives validation | EP | L1 | automated | an in-domain candidate whose key term appears in an indexed doc; one whose term appears only in `eval/negatives.in-domain.json` | the validation step | the first is rejected; the second is kept (the eval files are excluded) |
| E32 | retrieval: context_get | EP | L1 | automated | a multi-section doc; `ref:"C:\\repo\\docs\\a.md"`; `scope:"lessons"` + a lesson path; `section` + `neighbors:1` | calls to `context_get` | `(+N more sections` marker; the Windows path is resolved as a docs path (no scope parse); lesson content from `lessons.db`; neighbours of the section's heading node, not the file node |
| E33 | retrieval: kb tools unchanged | invariant | L1 | automated | the same repo, kernel `active` vs disabled | the registered tool definitions; `kb_search "session start"` | descriptions and parameter schemas are byte-equal; `kb_search` output is byte-equal |
| E34 | runtime: `/context status` | EP | L1 | automated | (a) refused via a tool source; (b) active with lessons configured, web unconfigured, a docs floor calibrated at 1,000 chunks while the index now has 1,300 | `/context status` | (a) shows `refused`, the package and the tool source; (b) shows `lessons: <n> chunks`, `web: empty`, consumers per hook with owners, the floor with its norm and a drift flag (growth 30% > 25%), registry `v1` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | runtime: dispatch overhead | tail-latency | L1 | automated | 1,000 synthetic `tool_call` + `tool_result` events, 5 no-op consumers | per-event overhead p95 < 1 ms | 1,000 events |
| P2 | runtime: identity-check budget (G2) | tail-latency | L1 | automated | 150 registered tools, warm resolution cache; plus one cold check | warm p95 < 2 ms; cold < 50 ms | 1,000 epochs + 1 cold |
| P3 | retrieval: warm context_search latency | tail-latency | L1 | automated | 100 golden queries, the fixture index of this repo, a populated up-to-date `lessons.db`, `scope:["docs","lessons"]` | p95 < 150 ms; cold first-search time for `lessons.db` recorded in `measurements.md` (no threshold) | 100 queries |
| P4 | doctrine delta: handler latency under the kernel | tail-latency | L1 | automated | a warm project config, kernel `active` | kb pinned provider + kernel `before_agent_start` p95 < 20 ms | 100 turns |

### Frontend-quirk

None: this change has no rendered UI.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | runtime: fault-isolated consumers | fault-injection (abort) | L1 | automated | one `tool_result` consumer and one `tool_call` consumer throw on every event | 5 tool calls | results equal the other consumers' output; no call is blocked (fail-open); exactly 1 `[context-manager]` warning per faulty consumer for the session |
| X2 | runtime: shutdown closes stores | fault-injection (resource) | L1 | automated | an `active` session with `lessons.db` open | `session_shutdown` | the lessons store is closed (`-wal`/`-shm` gone after checkpoint); the directory can be deleted |
| X3 | rollback | state-transition (contract harness) | L1 | automated | a session used with the kernel `active` (docs + lessons searches, markdown writes) | flag off, next session; then delete `<root>/.pi/dashboard/context_manager/` | kb-extension appends the doctrine itself and runs its guard and reindex; the kb store's `index.db` was never written by the kernel (write-attribution check: its file state and row counts change only through kb-extension's reindex) |
| X4 | retrieval: docs provider missing | fault-injection (abort) | L1 | automated | kb-extension not loaded | `context_search {scope:"docs"}` | `(docs unavailable)`, not `(no confident match)` |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | dogfooding / migration step 2 | exploratory | — | manual-only | a clean `PI_CODING_AGENT_DIR` without the three old packages; the flag on for this repo | a real dashboard session doing a docs lookup task | [judgment: the agent picks `context_search` naturally, `/context status` reads sensibly, and the provider's cache-read tokens stay high across turns — no stable automatable threshold] |

---

## Coverage summary

- Requirements covered: 17/17
  - runtime: 8;
  - retrieval: 5;
  - `kb-doctrine-injection` deltas: 3 (via E20, E19, P4);
  - `kb-read-discipline` delta: 1 (via E21).
- Scenarios by class: edge 34 · perf 4 · frontend 0 · error 4 · manual 1
- Scenarios by level: L1 42 (4 via the contract harness) · L2 0 · L3 0 · — 1
- Scenarios by disposition: automated 42 · manual-only 1

## New infra needed

- **Real-`AgentSession` contract harness** (E4, E5, E12, X3). A vitest helper
  that builds an in-memory session with pi's SDK
  (`createAgentSession({ sessionManager: SessionManager.inMemory(cwd) })`)
  with the kernel and kb-extension loaded, plus a stub model that streams
  canned turns. It must support resume from a session file.
  - The nearest existing surface is
    `packages/extension/src/__tests__/commit-draft-agent-session.test.ts`,
    which stubs that SDK. The harness uses the real one.
- **Multi-extension fake-pi runner** (E7–E11, E13–E21). This extends the
  single-extension fake used by
  `packages/kb-extension/src/__tests__/doctrine-hook.test.ts`:
  - two extensions and a configurable load order;
  - `forceSystemPrompt` chaining and `getAllTools()` with `sourceInfo`;
  - simulated `/reload`.
