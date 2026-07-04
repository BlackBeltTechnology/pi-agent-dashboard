# Design — wire-discipline-skills-into-openspec

## The mechanism: proposal artifact as carrier

openspec-apply/implement does not need to be taught about discipline skills. It already reads `proposal.md` + `tasks.md` into context at the start of an implementation. So the skill hints ride in on the artifact the loop already consumes:

```
proposal.md
  ## Discipline Skills: security-hardening, observability-instrumentation
        │
        ▼  openspec-apply / implement reads artifacts  (UNCHANGED)
  implement loop context now CONTAINS the skill names
        │
        ▼
  agent invokes security-hardening when the auth task lands,
  observability-instrumentation when the new endpoint lands
```

No openspec skill edit. The only new thing is an authoring rule (AGENTS.md) that puts the line in the proposal, and a checkpoint table (AGENTS.md) that tells the author which skills to name.

## Two levers, why both

| Lever | Where | Fires when | Failure mode it covers |
|---|---|---|---|
| Checkpoint table | AGENTS.md always-on doctrine | any implementation (openspec or ad-hoc) | agent never utters the NL trigger |
| `## Discipline Skills` line | proposal.md (per AGENTS.md convention) | openspec implement loop reads the proposal | table row is generic; proposal makes it concrete for *this* change |

Belt + suspenders: the table works even outside openspec; the proposal line works even if the author didn't internalize the table, because openspec-apply surfaces the named skills directly.

## The checkpoint table (proposed content)

| Task signal (in diff / tasks.md) | Skill |
|---|---|
| touches auth, untrusted input, secrets, webhooks, PII | `security-hardening` |
| spec has latency/throughput budget, or large-data / high-traffic path | `performance-optimization` |
| new endpoint, job, external call, or "can't tell what happened in prod" | `observability-instrumentation` |
| non-trivial/irreversible step (migration, public API, cross-boundary) BEFORE it stands | `doubt-driven-review` |
| a bug surfaces mid-implementation | `systematic-debugging` |
| runtime state opaque, `console.log` insufficient (jiti server, PTY workers, WS closures) | `node-inspect-debugger` |
| feature works + tests pass but implementation feels heavy | `code-simplification` |

Signals are deliberately observable in the diff or tasks.md (not vague intent), so the mapping is mechanical. Rows 5–6 depend on `add-debugging-skills`.

## Placement in AGENTS.md

- Table → new `### Discipline-skill checkpoints (implementation phase)` immediately after `### Code-quality gate (Biome ratchet)`, keeping all implementation-phase gates/checkpoints in one cluster.
- Convention paragraph → appended to `## OpenSpec Conventions`, next to the existing "place change artifacts at `openspec/changes/<name>/`" rule.

## Alternatives considered

- **Edit the openspec `implement` / `openspec-apply` skills to enumerate disciplines** — rejected: that is "touching openspec," couples our discipline set to skill files that may be shared/synced from the worktree parent, and the user explicitly wants the wiring external to openspec.
- **Enforcement lint** (fail build when `## Discipline Skills` absent) — rejected as a non-goal: advisory matches the warn-and-continue posture of the CodeRabbit gate; a hard gate would punish proposals where no discipline applies and create busywork.
- **Put the table in a `docs/` topic doc** instead of AGENTS.md — rejected: a topic doc is not loaded into the implement loop's context every turn; the whole point is always-on visibility during implementation. This is the rare case the Documentation Update Protocol reserves for AGENTS.md doctrine.

## Risk

- **Byte creep in AGENTS.md.** Mitigated by keeping to one table + one paragraph (~900 chars) and no per-change annotations (the same discipline that kept AGENTS.md from re-ballooning).
- **Table drift** if `eng-disciplines` gains/loses a skill. Low: the table is small and lives next to the gates it complements; a future skill add updates one row.
