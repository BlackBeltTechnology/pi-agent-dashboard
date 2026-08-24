# Repair the 80 structurally invalid main specs and gate spec integrity in CI

## Why

`openspec validate --specs` has never run in this repo. There is a CI gate on the
openspec **version** (`ci.yml:32`) but none on spec **content**. In that blind
spot, **80 of 546 main specs** drifted into states the parser cannot read, hiding
**384 live requirement blocks** from `validate`, `list`, `show`, and `archive`
(plus 9 already-retired ones in a spec that should not exist at all).

Resolution: **77 specs are repaired, 1 is deleted, 2 are tombstoned.**

> **Survey re-run** against the current tree — `openspec validate --specs
> --no-interactive` → `466 passed, 80 failed (546 items)`. The original survey
> read 85 of 531. Since then 15 specs were added, **all valid**, and 5 of the 85
> were repaired incidentally by changes archived in the meantime (2 from cohort
> A, 2 from C, 1 from D). No new corruption appeared. Every structural
> conclusion below is unchanged; only the counts moved.

This was found while repairing `oauth-authentication` for its archive. That spec
was one instance of a repo-wide class.

### The parse contract

`MarkdownParser.parseSpec` (`dist/core/parsers/markdown-parser.js`) requires two
h2 sections and **throws** without them:

```js
if (!purpose)             throw new Error('Spec must have a Purpose section');
if (!requirementsSection) throw new Error('Spec must have a Requirements section');
```

`findSection` matches the title **exactly** (case-insensitively). `## ADDED
Requirements` is therefore not `## Requirements` — it is an unrelated section, and
every `### Requirement:` beneath it is invisible.

### The failure is loud, but the diagnosis is masked

Contrary to first appearances these specs are **not** silently broken —
`validate` reports each one. What is masked is the *second* defect: the
`no-purpose` throw short-circuits parsing **before** the delta-header check runs.
So the 60 specs in cohort A report only "missing Purpose". Repair Purpose and a
fresh error class surfaces. **Any repair is inherently two-phase**; a script that
validates once and reports green after phase one is lying.

```mermaid
flowchart TD
    P{"## Purpose present?"} -->|no| E1["throw no-purpose<br/>parse aborts — delta check NEVER runs<br/>cohorts A B D = 71 specs"]
    P -->|yes| R{"findSection('Requirements')<br/>exact case-insensitive match"}
    R -->|"'ADDED Requirements' ≠ 'Requirements'"| E2["throw no-requirements<br/>cohorts C F = 7 specs"]
    R -->|found| M{"delta heading later in file?"}
    M -->|yes| E3["delta-header + req-outside<br/>partial parse: 3 of 5 reqs<br/>cohort E = 1 spec"]
    M -->|no| V["VALID — 466 specs"]
```

### Six cohorts, one root cause

The corruption is an **archive-path artifact**: a change's delta spec
(`openspec/changes/<name>/specs/<cap>/spec.md`, which legitimately uses `## ADDED
Requirements`) was copied to `openspec/specs/<cap>/spec.md` verbatim, without the
delta→main transformation. Corroborating evidence: **77 of the 80 also lack the
`# <name> Specification` h1** that the archive's spec-creation path emits, and
**119 already-valid specs** carry the archive's literal placeholder
`TBD - created by archiving change <name>. Update Purpose after archive.`

| # | `## Purpose` | plain `## Requirements` | delta hdr | `validate` reports | specs | hidden reqs |
|---|---|---|---|---|---|---|
| **A** | ✗ | ✗ | ✓ | `no-purpose` *(masks delta)* | 60 | 319 |
| **B** | ✗ | ✗ | ✗ | `no-purpose` | 7 | 27 |
| **C** | ✓ | ✗ | ✓ | `no-requirements` | 5 | 20 |
| **D** | ✗ | ✓ | ✗ | `no-purpose` | 4 | 13 |
| **E** | ✓ | ✓ | ✓ | `delta-header` + `req-outside` | 1 | 5 |
| **F** (delete) | ✓ | ✗ | ✗ | `no-requirements` | 2 | 0 |
| **G** (delete) | ✗ | ✗ | `REMOVED` | `no-purpose` | 1 | 0 *(9 retired)* |
| | | | | | **80** | **384 live** |

Cohorts **B** and **D** (11 specs) carry **no delta heading at all** — a
delta-only fix leaves them broken. Cohort **F** is two superseded stubs with zero
requirements.

### Two traps that will break a naive repair

1. **Multi-delta specs must have the heading DELETED, not renamed.** Four specs
   carry two delta headings. `findSection` returns the **first** match, so
   renaming both yields a second, ignored `## Requirements` whose requirements
   stay invisible — a repair that reports success and changes nothing:

   | Spec | Headings |
   |---|---|
   | `app-decomposition` | `ADDED Requirements` ×2 |
   | `browser-gateway-decomposition` | `ADDED Requirements` ×2 |
   | `command-executor` | `ADDED Requirements`, `ADDED Requirements — Tool Modules` |
   | `auto-shutdown` | `MODIFIED Requirements`, `ADDED Requirements` |

   The first becomes `## Requirements`; every subsequent one is deleted so its
   requirements re-parent to the single surviving section.

2. **`## REMOVED Requirements` is not a rename candidate — it is a delete signal.**
   `event-persistence` (cohort G) uses it. Promoting those 9 requirements to
   `## Requirements` would **resurrect retired requirements as current spec**.

   Investigated and settled: the file has **9 `### Requirement:` headers and 9
   `**Reason**:` blocks** — every requirement is retired, none is current. The
   capability (SQLite event store) was wholly replaced, and all named successors
   exist as live specs: `in-memory-event-buffer`, `json-file-persistence`,
   `on-demand-session-replay`, `session-history-sync`. The only remaining SQLite
   in source is `packages/kb/` — an unrelated knowledge-base store.

   **`event-persistence` is therefore deleted, not repaired.** The repair script
   must still *refuse* `REMOVED` blocks generically, because the next such spec
   may be a partial removal where deletion would be wrong.

## What Changes

- **Add `scripts/repair-main-specs.mjs`** — idempotent structural repair, kept in
  `scripts/` for future drift (the archive bug may not be fixed upstream):
  - Promote the **first** delta heading to `## Requirements`; **delete** every
    subsequent one (trap 1).
  - Insert `## Purpose` with a `TODO(repair):`-marked placeholder when absent.
  - Insert the `# <name> Specification` h1 when absent.
  - **Refuse** to touch `## REMOVED Requirements` — exit non-zero naming the spec
    for manual handling (trap 2).
  - Re-run `validate` after the write and report **phase-two** errors, so masked
    defects surface in the same run.
- **Author a real `## Purpose` for all 71 specs missing one** (cohorts A, B, D),
  derived from each spec's own requirement text. The script's placeholder is
  scaffolding, not the deliverable — **no `TODO(repair):` marker may survive**.
  This is the bulk of the work and is per-spec judgement, not scripted.
- **Hand-repair `interactive-renderers`** (cohort E) — delete the mid-file
  `## ADDED Requirements` at line 75; its 2 orphaned requirements re-parent into
  the existing section, taking the spec from 3 visible requirements to 5.
- **Retire three capabilities holding zero current requirements**, each with a
  live successor verified to carry the behaviour. Disposition differs by whether
  the spec already carries an authored deprecation pointer (settled during
  `doubt-driven-review`):

  | Spec | Cohort | Disposition | Successor |
  |---|---|---|---|
  | `openspec-polling` | F | tombstone — authored `**DEPRECATED**` Purpose | `server-openspec-polling` |
  | `session-history-sync` | F | tombstone — authored `**DEPRECATED**` Purpose | `server-session-reader` |
  | `event-persistence` | G | **delete** — no authored pointer, 9 of 9 retired | `in-memory-event-buffer`, `json-file-persistence`, `on-demand-session-replay` |

  A tombstone gets exactly one requirement recording the retirement; an empty
  `## Requirements` does not validate.
- **Add a CI gate** to `.github/workflows/ci.yml`:
  `openspec validate --specs --no-interactive`. This is the change's durable
  half — it converts spec integrity from an invisible property into a blocking
  one, repo-wide, for every future archive.
- **Add `npm run spec:validate`** so the gate is reproducible locally without
  guessing CI's invocation.

## Capabilities

### New Capabilities

- `openspec-spec-integrity` — the structural contract every main spec must
  satisfy (`## Purpose` + `## Requirements`, no delta headers), the CI gate that
  enforces it, and the repair tool's guarantees (idempotence, REMOVED refusal,
  two-phase validation).

### Modified Capabilities

- `ci-cd-pipeline` — gains a spec-integrity job.

## Non-Goals

- **Fixing the upstream archive bug.** The delta→main copy defect lives in
  `@fission-ai/openspec`. This change repairs the damage and gates recurrence;
  an upstream fix or a pre-archive hook is separate work.
- **Rewriting the 119 valid specs that carry the `TBD - created by archiving
  change` placeholder.** They parse and validate. Authoring real Purposes for
  them is a documentation debt, tracked separately — this change only guarantees
  no *newly written* placeholder survives.
- **Resolving the `[INFO] Requirement text is very long (>500 characters)`
  advisories.** Non-blocking, widespread, orthogonal.
- **Changing requirement or scenario content.** Except the two trap specs, this
  is heading surgery plus Purpose authoring. No requirement text is edited.
- **`--strict` mode.** The gate runs default validation; strict adds advisory
  classes the repo has not triaged.

## Impact

- `openspec/specs/**/spec.md` — 77 repaired, 2 tombstoned, 1 deleted.
- `scripts/repair-main-specs.mjs` — new.
- `.github/workflows/ci.yml`, `package.json` — new gate + script.
- **Every future archive** — a corrupt spec now fails CI instead of rotting. That
  is the point, and the risk: a spec that archives into an invalid state will
  block `develop`. **`openspec-archive-change` and `ship-change` should therefore
  run `npm run spec:validate` before pushing**, so a corrupt archive is caught
  locally in seconds rather than as a red `develop` after the fact. The gate
  takes ~3.6s over 544 specs, so this costs nothing at either site.
- **`kb`/docs surfaces that read specs** — 384 requirements become visible for the
  first time. Any consumer that counted requirements will see its numbers jump;
  this is a correction, not a regression.

## Open Questions

- **Does authoring 71 Purposes belong in one change?** It is ~71 independent
  judgement calls with no shared risk. Splitting structural repair + gate (fast,
  mechanical, high value) from Purpose authoring (slow, reviewable) would let the
  gate land in days rather than weeks — but the gate cannot go green until the
  Purposes exist, so a split needs the gate gated on the authoring change.
- ~~Should `event-persistence`'s 9 REMOVED requirements be restored?~~
  **Resolved:** no. All 9 are retired with documented successors that exist as
  live specs; the spec is deleted.
- ~~Is deleting the three retired specs right, or should they remain as
  deprecation tombstones?~~ **Resolved during `doubt-driven-review`:** the two
  specs carrying an authored `**DEPRECATED** — see <successor>` Purpose are
  deliberate pointers that live specs still lead readers toward, so they are
  tombstoned with one retirement requirement each. `event-persistence` has no
  such pointer and is deleted.
- **Is `--no-interactive` sufficient in CI, or is `--concurrency` tuning needed?**
  546 specs at default concurrency 6; the sweep above took minutes locally, which
  may be material for PR latency.

## Discipline Skills

- `doubt-driven-review` — 80 spec files rewritten at once is effectively
  irreversible in review (nobody reads an 80-file diff carefully); and the
  REMOVED-requirements decision changes what the project claims to do. Stress
  both before they stand.
- `review-code` — the repair script's idempotence and its REMOVED refusal are the
  two properties whose failure is silent and destructive.
- `scenario-design` — the traps above (multi-delta, REMOVED, masked phase-two
  errors) are exactly the cases a naive test suite misses; derive scenarios
  before writing the script.
