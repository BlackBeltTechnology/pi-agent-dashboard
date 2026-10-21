# Test Plan — context-manager-blackhole-fork

Stage: design   Generated: 2026-10-21

Hard gate: no spec gap. Every requirement carries concrete inputs, triggers
and thresholds (budgets: 2 ms threshold check, 0.5 ms bridge look; ≥95% tests
ported; six parity branch shapes).

Level legend (this repo): **L1** = vitest under `packages/*/src/**/__tests__/`.
"(contract)" = L1 against a real pi 1.3.0 `AgentSession` from the repo's
`node_modules`, with pi-ai's faux provider (kernel helper
`packages/context-manager/src/__tests__/helpers/agent-session.ts`). No
scenario needs L2 or L3: the live divider is a reducer fact
(`event-reducer-compaction.test.ts`), not a rendered-UI one.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | boundary: delivered on boundary API | state-transition (contract) | L1 | automated | persisted session, `midRunCompaction: off`, `compactAfterTokens` below the run's growth | one run with two tool turns | branch gains exactly 1 `compaction` entry after the run's last message; next prompt's request carries its summary and no message before `firstKeptEntryId`; `ctx.compact` spy not called |
| E2 | boundary: delivered on boundary API | state-transition (contract) | L1 | automated | persisted session, `midRunCompaction: resume`, threshold crossed after turn 1 | run with 3 tool turns | request of turn 2 carries the summary + kept entries; run not aborted (`agent_end` outcome `completed`) |
| E3 | boundary: delivered on boundary API | decision-table (contract) | L1 | automated | `SessionManager.inMemory` session × mode ∈ {off, resume, pause}, threshold crossed mid-run | one run | compaction entry present before `agent_settled` in all three; `ctx.compact` never called |
| E4 | boundary: delivered on boundary API | EP (contract) | L1 | automated | persisted session, `midRunCompaction: pause`, threshold crossed at turn 1 | one run | `ctx.compact` called once at `turn_end`; pi emits `session_compact`; `agent_before_settle` returns no draft |
| E5 | boundary: gates | EP | L1 | automated | boundary event whose `context.contextMessages` end with an assistant tool call without result; threshold met | `turn_end` consumer | returns no draft |
| E6 | boundary: gates | EP | L1 | automated | branch ending: assistant tool call (no result) then a custom entry; threshold met | `turn_end` consumer | returns no draft |
| E7 | boundary: gates | state-transition | L1 | automated | `resume`; turn N produced a persisted compaction; turn N+1 still above threshold | `turn_end` of N+1 | no draft |
| E8 | boundary: gates | state-transition (contract) | L1 | automated | `resume`, long run crossing the threshold at turn 3 and again at turn 9 | one run | both `turn_end` boundaries return a draft; 2 compaction entries persisted |
| E9 | boundary: gates | state-transition | L1 | automated | final-turn `turn_end` draft that pi does not persist (stubbed boundary), run settles above threshold | `agent_before_settle` | returns a draft |
| E10 | boundary: gates | EP | L1 | automated | incoming `agent_before_settle` `entries` already hold another extension's compaction draft | fork consumer | returns the entries unchanged, no draft added |
| E11 | boundary: gates | EP | L1 | automated | branch whose last entry is a compaction (vendored preparation returns `undefined`) | `agent_before_settle` | no draft |
| E12 | boundary: gates | EP | L1 | automated | threshold met; settings with model override `keepRecentTokens: -1` | boundary consumer | no draft; one `[context-manager]` warning containing `invalid_settings` |
| E13 | boundary: preparation parity | decision-table (contract) | L1 | automated | six branches: plain; context edit omitting a tool result; after a previous compaction; after a retain-none compaction; split turn; model with `keepRecentTokens` override | compact each once via boundary draft and once via pi's real `session_before_compact` (capturing `event.preparation`) | `preparation` objects deep-equal in all six |
| E14 | boundary: preparation parity | EP | L1 | automated | builder stubbed to return `{ cancel: true }` | boundary consumer | no draft; run continues |
| E15 | boundary: summary/details compat | state-transition (contract) | L1 | automated | session compacted twice through boundary drafts | second compaction | second summary built with the first's summary/details chain (compare with upstream `compile()` on the same inputs: byte-equal) |
| E16 | boundary: summary/details compat | EP | L1 | automated | `tailBehavior: minimal`, "compact everything" cut | build draft | entry `firstKeptEntryId: null`; `details.coverage.firstKeptEntryId === ""`; `details["context-manager.boundary"] === true` |
| E17 | boundary: manual/overflow | EP (contract) | L1 | automated | active session with history | user `/compact` | persisted entry has `details.compactor === "blackhole"` and no boundary marker; `session_compact` emitted by pi |
| E18 | boundary: manual/overflow | EP (contract) | L1 | automated | stub provider returns a context-overflow error once | one prompt | pi's overflow recovery compaction carries `details.compactor === "blackhole"` |
| E19 | boundary: manual/overflow | EP | L1 | automated | branch pi refuses to compact | `/context compact` | output is one information line naming pi's reason; no error notification |
| E20 | boundary: post-compaction work | state-transition (contract) | L1 | automated | `showPreCompactionMessage: true`; boundary compaction drops the newest assistant text | next `turn_start` | exactly 1 `blackhole-pre-compaction-output` entry, after the compaction entry |
| E21 | boundary: post-compaction work | state-transition (contract) | L1 | automated | session with UI stub; boundary compaction | next `agent_settled` | exactly 1 success notice; `compactWasPiVcc` reset; no notice duplicated by a `session_compact` handler |
| E22 | boundary: no private internals | invariant | L1 | automated | `src/blackhole/**` non-test sources outside `pi-vendor/`; then `pi-vendor/**` | static scan | 0 matches for `@earendil-works/pi-coding-agent/dist/`, pi `prepareCompaction` import, `AgentSession`, `prototype.compact`, `_emit`, `_disconnectFromAgent`, `.settingsManager`; `pi-vendor` imports only root-exported pi symbols |
| E23 | boundary: context replay | invariant | L1 | automated | session with an append-mode compaction chain | `context` hook through the chassis | messages byte-equal to upstream `compaction-context.ts` output on the same input |
| E24 | observational: provenance | invariant | L1 | automated | every `.ts` under `src/blackhole/` | provenance test | each starts with the forked, pi-vendored or new-file header; `NOTICE` names pi-blackhole and pi |
| E25 | observational: provenance | invariant | L1 | automated | `FORK.md` and the source tree | kept-LOC test | non-test LOC of forked-header files equals `FORK.md` kept total; no `pi-base/`, `changelog/`, `om/status-bar.ts`, `om/inline-compaction.ts` |
| E26 | observational: provenance | BVA | L1 | automated | upstream kept-module test list (tag v0.5.15) vs ported tests | provenance test | ported share ≥ 95%; each missing file listed in `FORK.md` with a reason |
| E27 | observational: config/state compat | state-transition (contract) | L1 | automated | temp agent dir; session run with upstream `pi-blackhole@0.5.15` (pending file, cooldown, `om.*` entries) | resume with the fork active | observer continues from recorded coverage; `/context memory` lists upstream observations |
| E28 | observational: config/state compat | state-transition (contract) | L1 | automated | session run with the fork (incl. a boundary compaction with marker) | resume with upstream `pi-blackhole@0.5.15` | upstream continues from coverage; its details validator accepts the entry; `/blackhole-memory` lists fork observations |
| E29 | observational: config/state compat | decision-table | L1 | automated | `observeAfterTokens` in global file, project file, both, `PI_BLACKHOLE_OBSERVE_AFTER_TOKENS` | load config | precedence equals upstream (env > project > global > default); no file written in any case |
| E30 | observational: registration | state-transition (contract) | L1 | automated | `pi-blackhole` npm source registered + context-manager flag on | session start + 1 prompt | state `refused` at `session_start`; no fork consumer called (spy); no fork `recall`; upstream `recall` callable |
| E31 | observational: registration | state-transition (contract) | L1 | automated | active session that used `recall`, persisted | resume | `recall` in `getActiveTools()` |
| E32 | observational: registration | EP | L1 | automated | active session | `/context memory off`, then a turn above `observeAfterTokens` | observer not launched; no config file written; output names the dashboard setting |
| E33 | observational: registration | EP | L1 | automated | `refused` session | `/context memory` | output names the state; handler spy not called |
| E34 | observational: headless export | EP (contract) | L1 | automated | 3 sessions in a temp project, fork active | `pi --context-export "days:7 mode:timeline out:<f>" --no-session -p` | process exits 0; `<f>` byte-equal to upstream `--blackhole-export` on the same sessions |
| E35 | observational: recall parity | invariant | L1 | automated | one fixture session | `recall` with `#3:text` via upstream and via the fork | byte-identical outputs |
| E36 | runtime: chassis hooks | decision-table | L1 | automated | two `turn_end` consumers appending one custom draft each | dispatch | returned entries = event entries + both drafts in order |
| E37 | runtime: chassis hooks | decision-table | L1 | automated | first `agent_before_settle` consumer throws, second appends a compaction draft | dispatch | entries = event entries + compaction draft; `continue` unchanged |
| E38 | runtime: chassis hooks | decision-table | L1 | automated | consumer A returns `continue: true`, later B `continue: false`, C `undefined` | `turn_end` dispatch | `continue: false` |
| E39 | runtime: chassis hooks | decision-table | L1 | automated | `session_before_compact` consumers: 1st throws, 2nd returns compaction, 3rd spy | dispatch | 2nd's compaction returned; 3rd not called |
| E40 | runtime: chassis hooks | EP | L1 | automated | `refused` session; consumers on all 9 new hooks | fire each hook | no consumer called; each hook returns no result |
| E41 | runtime: extension points | state-transition | L1 | automated | consumer-registered tool; session `active` → `refused` | next epoch | tool not in active tools |
| E42 | runtime: extension points | EP | L1 | automated | owners X and Y both register subcommand `export` | registration | second refused; one `[context-manager]` warning naming both owners |
| E43 | replay: live announcement | state-transition | L1 | automated | bridge harness; boundary compaction persisted at `turn_end` of turn 1 | `turn_start` of turn 2 | one `session_compact` (no `reason`/`willRetry`/`compactionEntry`, entry timestamp) forwarded before `turn_start`; reducer yields 1 boundary row |
| E44 | replay: live announcement | state-transition | L1 | automated | compaction persisted at `agent_before_settle`; a follow-up prompt queued | `agent_settled` | `session_compact` forwarded before `agent_settled` and before the follow-up send |
| E45 | replay: live announcement | EP | L1 | automated | pi's own compaction emits `session_compact` (forwarded) | next `turn_start` and `agent_settled` | no synthesized event for that id |
| E46 | replay: live announcement | state-transition | L1 | automated | compaction first seen by the turn-N `turn_start` peek, passed again by the turn-N `turn_end` usage drain | turns N, N+1 | exactly 1 `session_compact` total |
| E47 | replay: live announcement | state-transition | L1 | automated | compaction persisted on the last turn, then `session_shutdown` | shutdown | `session_compact` forwarded before `session_unregister` |
| E48 | replay: live announcement | state-transition | L1 | automated | compaction persisted; bridge reconnects and replays before next `turn_start` | `turn_start` | exactly 1 boundary row after reduce (replayed only) |
| E49 | replay: live announcement | state-transition | L1 | automated | `/tree` navigation to another branch, then a boundary compaction there | next `turn_start` | exactly 1 `session_compact` |
| E50 | replay: live announcement | invariant | L1 | automated | boundary compaction entry carrying `usage` | drains | one `usage_recorded` for it, as before; usage cursor positions equal a run without the feature |
| E51 | replay: MODIFIED no double render | invariant | L1 | automated | existing `compaction-boundary-replay` warm/reload/reconnect fixtures | replay + live | exactly 1 boundary row in each (existing tests unchanged and green) |
| E52 | plugin-settings: self-gate | decision-table | L1 | automated | registry ∈ {pi-blackhole only, context-manager only, both, neither} | settings route/gate | form for the first three; not-installed state for neither |
| E53 | session-pipeline: detection | EP | L1 | automated | registry holds the context-manager package only | `GET /api/plugins/blackhole/status` | `200 { installed: true }` |
| E54 | session-pipeline: detection | EP | L1 | automated | local-path install record whose package.json `name` is `@blackbelt-technology/pi-dashboard-context-manager` | `installedMatchesName(record, name)` | true |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | boundary: threshold check budget | tail-latency | L1 | automated | 2,000-entry branch below threshold | p95 boundary-consumer evaluation < 2 ms | 1,000 boundary events |
| P2 | replay: bridge look budget | tail-latency | L1 | automated | 2,000-entry session, no new entry | p95 `turn_start` peek + flush < 0.5 ms | 1,000 `turn_start` events |

### Frontend-quirk

None: no rendered UI changes; the divider is a reducer fact covered by E43/E48.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | boundary: gates (builder failure) | fault-injection (abort) | L1 | automated | summary builder throws `TypeError` | `agent_before_settle` above threshold | no draft; retry backoff set; 1 `compaction.boundary.failed` record with class `TypeError`; 1 `[context-manager] compaction skipped: builder_failed` warning; a second `invalid_settings` cause in the same session still warns |
| X2 | runtime: chassis fault isolation | fault-injection (abort) | L1 | automated | `context` consumer throws | request build | messages equal the other consumers' output; 1 warning for that consumer |
| X3 | B9: undici dispatcher | fault-injection (absent dependency) | L1 | automated | `Symbol.for("undici.globalDispatcher.1")` and `.2` unset | OM worker stream with `providerIdleTimeoutMs` | stream runs; no idle timeout applied; no throw |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | dogfood | exploratory | — | manual-only | clean `PI_CODING_AGENT_DIR` without pi-blackhole; flag on; a long real coding session | work until two automatic compactions | [judgment: summaries read as well as upstream's; the dashboard divider appears live at the right place; `/context memory` sensible] |

---

## Coverage summary

- Requirements covered: 17/17
  - boundary-compaction 7 · observational-memory 4 · context-manager-runtime 2 · compaction-boundary-replay 2 (ADDED + MODIFIED) · blackhole-plugin-settings 1 · blackhole-plugin-session-pipeline 1
- Scenarios by class: edge 54 · perf 2 · frontend 0 · error 3 · manual 1
- Scenarios by level: L1 59 (16 via the contract harness) · L2 0 · L3 0 · — 1
- Scenarios by disposition: automated 59 · manual-only 1

## New infra needed

- Compatibility rig (E27, E28, E34, E35): load `pi-blackhole@0.5.15` (devDependency) as an extension in a temp `PI_CODING_AGENT_DIR` within the contract harness, and run headless `pi -p` against the repo's pi 1.3.0. Extends the kernel's contract harness; no new level.
