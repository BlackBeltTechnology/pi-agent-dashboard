# test-plan.md schema

Standalone scenario catalog. Lives at `openspec/changes/<name>/test-plan.md`.
Separate from tasks.md. One row per scenario.

---

```markdown
# Test Plan — <change-name>

Stage: <proposal|design|apply>   Generated: <YYYY-MM-DD>

<!-- SOFT GATE ONLY: drop this banner when there are no markers -->
## ⚠ Clarifications needed (N)

- [ ] **C1** — <decision-forcing question, names the blocked scenario id>
- [ ] **C2** — ...

> Resolve before the blocked scenarios (marked below) can be authored.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | <req ref>   | BVA       | L1    | automated   | <data/state> | <action/condition> | <measurable fact> |
| E2 | ...         | decision-table | L3 | automated | ... | ... | ... |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | <req ref>   | tail-latency | L2 | automated | <load> | p95 < Xms | 10 min |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | <req ref>   | state-transition | L3 | automated | ... | ... | converges to <invariant> |
| F2 | <req ref>   | visual/subjective | — | manual-only | <surface> | <human looks> | [judgment: "feels right" — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | <req ref>   | fault-injection (abort) | L3 | automated | <dependency fails> | <when> | <degradation/recovery> |

<!-- SOFT GATE: a blocked row keeps its known slots and marks the gap -->
| X2 | <req ref> | fault-injection (delay) | L3 | automated | <dep stalls> | <when> | [NEEDS CLARIFICATION: observable — what timeout does the client enforce?] |

---

## Coverage summary

- Requirements covered: <n>/<total>
- Scenarios by class: edge <a> · perf <b> · frontend <c> · error <d>
- Scenarios by level: L1 <x> · L2 <y> · L3 <z>
- Scenarios by disposition: automated <p> · manual-only <q>

## New infra needed

- <only if a scenario implies a harness/level that does not exist yet; else "none">
```

---

## Rules

- `level` values: `L1` (unit/vitest), `L2` (qa VM smoke), `L3` (Playwright e2e),
  plus `electron` / `ci` for shell/packaging + workflow-level scenarios. A
  `manual-only` row has no automatable level — use `—`.
- `disposition` values: `automated` (has an automatable observable — folds to a
  real test task in its `level`'s category) or `manual-only` (aesthetics /
  hardware / subjective — no automatable observable; never folded to a test
  task, deferred to post-merge by `ship-change`). **This manifest — not any
  `tasks.md` tag — is the single source of truth for automated-vs-manual.**
- Every row's Triple slots must be concrete, OR carry a `[NEEDS CLARIFICATION:
  <slot> — <q>]` marker (soft gate only). No vague slots without a marker.
- HARD gate: do not write this file until clarifications are answered — there is
  no marker path; ask via `ask_user` first.
- Keep ids stable (E#/P#/F#/X#) so a later tasks.md fold can reference them.
