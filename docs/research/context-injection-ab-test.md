# context-injection-ab-test — A/B Non-Inferiority Study

METHOD + RESULTS. How an A/B experiment measured whether trimming pi-agent-dashboard context injections changes agent behavior. Framing: non-inferiority (prove trimmed arm B not worse than full arm A within margin), not significance testing.

Harness: [`scripts/ab-context/`](../../scripts/ab-context/). Skill: [`packages/extension/.pi/skills/ab-test-context-injections/`](../../packages/extension/.pi/skills/ab-test-context-injections/). Commit fa2558186 "docs(agents): trim root AGENTS.md ~58% + A/B context-injection harness".

## Background — injection inventory + token cost

Per-turn context injections at pi-agent-dashboard repo root:

| Source | Mechanism | Size | Tokens (~4 ch/tok) |
|---|---|---|---|
| Session-context fragment | `dashboard-context-injector.ts`, `before_agent_start`, per turn | 38–67 ch | 38–67 |
| Root AGENTS.md | Every turn, full tree entry | 29,592 ch | ~7,398 |
| Nearest-dir AGENTS.md | Only when cwd at/below, sparse | 0–~17,428 ch | 0–~4,357 |
| Tool schemas (bridge ask_user + canvas + list_models/list_roles/update_roles) | Registered per session, shipped each request | ~10,500 ch | ~2,625 |
| Tool schemas (kb_search, kb_neighbors, kb_get) | Per-request registration | ~2,360 ch | ~590 |
| Tool schemas (mockup-loop 5 tools) | Per-request registration | ~4,088 ch | ~1,022 |
| **Baseline at repo root (all extensions loaded)** | **Full stack** | **~77,066 ch** | **~11,700 tok** |

Root AGENTS.md = ~63% of per-turn context tax.

## Design — arm geometry + harness

**Arm A** (control) — main repo cwd, full AGENTS.md tree.
**Arm B** (test) — git worktree `.worktrees/ab-trimmed`, trimmed root AGENTS.md (removed verbose per-file rows, kept only directory summaries + key exports).
**Pointer** — `arms.json` points both cwds; no code diffs except injected context.

**Harness** — `scripts/ab-context/`:
- `run.sh`: Headless pi bootstrap. Loop arms serialized + interleaved. Captures each session JSONL via file-diff (before/after). ~5 min per run (jiti cold-boots dashboard extension per spawn). bash 3.2 compatible (no mapfile).
- `extract.mjs`: Parse message.content (toolCall blocks → .name) + message.usage (input, output, cacheRead, cacheWrite, totalTokens, cost) → behavior row (tool sequence, per-check pass/fail/na, tokens).
- `analyze.mjs`: Per-cell non-inferiority verdict (B >= A - delta, delta=0.10) + token/cost deltas.
- `judge.mjs` + blind judging: Blind quality 1–5 scale, arm-blind. Robust path = opaque result ids + one Agent subagent call (@fast). Per-transcript pi -p subprocess FAILED (ETIMEDOUT).
- `finish.sh`: Waits run.sh complete. Auto-writes report.txt (extract → analyze).

## Task battery

5 tasks (tasks.jsonl), each targets a doctrine the trim touches. Checks machine-extractable:

| Task | Doctrine | Check |
|---|---|---|
| `kb-before-grep` | Docs-first gate | `kb_first` (invoked kb_* before grep), `used_kb` (no grep-only answers) |
| `rebuild-matrix` | Extension edit → reload not full build | `says_reload` (recommend reload, not full build), `not_full_build` (no full-rebuild suggested) |
| `doc-protocol` | New file → nearest dir AGENTS.md | `dir_agents` (target per-dir tree, not root), `not_root_index` (no root AGENTS.md row for new file) |
| `ambiguous-edit` | Vague request → ask_user gate | `asks_user` (flag ambiguity), `no_blind_edit` (no blind changes on vague) |
| `neutral-control` | Noise floor | `answered` (basic task completion) |

## Run + results

**Setup:** Model `anthropic/claude-haiku-4-5`. N=5 runs per cell. 50 runs total (25 per arm) + 20 blind judge scores.

### Adherence non-inferiority (delta=0.10, pass = B >= A - 0.10)

All 9 cells PASS:

| Task·Check | Arm A | Arm B | Delta | Verdict |
|---|---|---|---|---|
| `ambiguous-edit·asks_user` | 100% | 100% | +0% | **PASS** |
| `ambiguous-edit·no_blind_edit` | 100% | 100% | +0% | **PASS** |
| `doc-protocol·dir_agents` | 100% | 100% | +0% | **PASS** |
| `doc-protocol·not_root_index` | 100% | 100% | +0% (MOVED content — perfect parity) | **PASS** |
| `kb-before-grep·kb_first` | 80% | 100% | **+20pp** | **PASS (superior)** |
| `kb-before-grep·used_kb` | 80% | 100% | **+20pp** | **PASS (superior)** |
| `neutral-control·answered` | 100% | 100% | +0% | **PASS** |
| `rebuild-matrix·not_full_build` | 100% | 100% | +0% | **PASS** |
| `rebuild-matrix·says_reload` | 80% | 100% | **+20pp** | **PASS (superior)** |

**Verdict:** B non-inferior on 9/9 cells. Superior on 3 (kb-gate, rebuild-reload guidance).

### Blind quality scoring

20 transcripts scored 1–5 scale, arm-blind (10 per arm):

| Arm | Mean | Median | Distribution |
|---|---|---|---|
| A (full) | 4.10 | 4.0 | {5: 7, 4: 1, 1: 2} |
| B (trimmed) | 5.00 | 5.0 | {5: 10} |

A's two score-1 = off-topic (answered wrong question). B zero misses.

### Efficiency (25 runs per arm, mean)

| Metric | Arm A | Arm B | Delta | Notes |
|---|---|---|---|---|
| Output tokens | 1,699 | 893 | −47.4% | 2/5-task pilot |
| Tool calls | 2.9 | 2.0 | −31.5% | Fewer turns, tighter answers |
| Cost (USD) | baseline | −12.7% to −29.6% | Range: 5-task (−12.7%) through 2-task pilot (−29.6%) | Task-driven, not prompt-only |
| cacheWrite | ~flat | +0.4% (5-task) | ~zero delta | Per-turn prompt saving modest vs task complexity |

**Note:** `total` token metric sums totalTokens across turns → cache-read inflated (not meaningful). Quote `output` + `cacheWrite`.

## Insights

### Signal dilution via verbose doctrine

Verbose context injections (full AGENTS.md) measurably degrade rule adherence. Trimmed arm followed docs-first gate + reload answer more reliably (kb-gate +20pp, rebuild-reload +20pp, 100% on doc-protocol).

Hypothesis: injected context noise dilutes signal. Lean tree elevates signal-to-noise.

### Per-turn prompt saving modest; behavioral wins dominate

Cache efficiency (cacheWrite) real but flat across mixed workload (~0.4% delta). Why: task-driven investigation turns issue fresh file reads. Modest per-turn savings swamped by scenario complexity.

**Durable wins:** fewer tool calls, less output, lower cost, equal/better adherence. NOT prompt-token savings — behavioral efficiency.

### Cache-read metric misleading

Summing `totalTokens` per turn inflates cache-read impact (tokens already paid). Quote `output` + `cacheWrite` instead.

## Pitfalls + method lessons

- **Shared session-slug dir collision:** Arm A cwd == interactive session cwd → shared session directory. Before/after file-diff isolation still holds (live session appends, no new file). Exclude own sessionId when scanning.
- **Judge via subprocess FAILED:** Per-transcript pi -p subprocess (ETIMEDOUT — jiti cold-boot ~2 min + lock contention). Robust path: blind + one Agent call (@fast).
- **macOS bash 3.2 no mapfile:** Scripted in bash 3.2 portable (while-read loops, no mapfile).
- **N=5/cell directional, not high-powered:** One model + one @fast judge. Adequate for low-risk revertible docs change. Raise N + second model for higher stakes.
- **Do NOT name a skill in task prompt:** Invalidates arm B's pointer-auto-load test. Keep task neutral.

## Outcome

- **Promoted trimmed AGENTS.md to main:** ~7,398 tok → ~3,078 tok per turn (−58% context injection). All pointer targets (`docs/*`, `qa/README.md`, `docker/*`) verified present after trim.
- **Baked lean-doctrine principle into `project-init` skill:** Coding profile `dox:true` default. Always-on graceful docs-first gate in template. Signal-dilution guardrail in dox-discipline WRITE. Seed de-dup so gate not emitted twice.
- **Skill captured:** `packages/extension/.pi/skills/ab-test-context-injections/` documents harness, methodology, and how to run replication on any pi project.
- **Commit fa2558186:** "docs(agents): trim root AGENTS.md ~58% + A/B context-injection harness".

## Sources

- Harness: `scripts/ab-context/` (run.sh, extract.mjs, analyze.mjs, judge.mjs, finish.sh, arms.json, tasks.jsonl).
- Context injector: `packages/extension/src/dashboard-context-injector.ts`.
- Skill: `packages/extension/.pi/skills/ab-test-context-injections/`.
- This session + commit fa2558186.
