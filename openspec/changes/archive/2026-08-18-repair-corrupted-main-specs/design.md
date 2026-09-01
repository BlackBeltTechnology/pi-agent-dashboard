# Design — repair-corrupted-main-specs

## Context

`openspec/specs/` holds 546 main specs. 80 of them do not parse:
`MarkdownParser.parseSpec` requires an h2 titled exactly `Purpose` and an h2
titled exactly `Requirements`, and throws otherwise. The corruption is an
archive-path artifact — a change's delta spec (which legitimately uses
`## ADDED Requirements`) was copied to `openspec/specs/<cap>/spec.md` without the
delta→main transformation. 384 live requirement blocks are consequently invisible
to `validate`, `list`, `show`, and `archive`.

Constraints that shape the design:

- **The parse is fail-fast.** The `no-purpose` throw short-circuits before the
  delta-header check. A spec can report exactly one error before repair and a
  *different* error after it. Any repair is inherently two-phase.
- **`findSection` returns the first match.** Four specs carry two delta headers;
  renaming both produces a second, ignored `## Requirements`.
- **`## REMOVED Requirements` is semantic, not structural.** Promoting it
  resurrects retired behaviour as current spec — undetectable by any structural
  check.
- **The upstream bug is not ours to fix.** It lives in `@fission-ai/openspec`;
  drift will recur, so the repair tool is a retained artifact, not a throwaway.
- **The survey is a moving target.** It read 85/531 when the proposal was
  written and 80/546 at re-check — 15 valid additions, 5 incidental repairs.
  Nothing in the design may hard-code a census count.

## Goals / Non-Goals

**Goals:**

- Every spec under `openspec/specs/**` parses; `openspec validate --specs
  --no-interactive` exits zero.
- The structural contract becomes a blocking CI property rather than an
  invisible one, for every future archive.
- Structural repair is scripted, idempotent, and re-runnable against future
  drift.
- The two destructive traps (multi-delta rename, REMOVED promotion) are
  impossible to hit accidentally — the tool refuses rather than guesses.
- Every repaired spec carries a Purpose describing its own capability.

**Non-Goals:**

- Fixing the upstream archive bug, or adding a pre-archive hook.
- Rewriting the 119 valid specs carrying the archive's `TBD - created by
  archiving change` placeholder.
- Resolving `[INFO] Requirement text is very long` advisories, or enabling
  `--strict`.
- Editing any requirement or scenario text. Except the two hand-fixed specs this
  is heading surgery plus Purpose authoring.

## Decisions

### D1 — Script the structure, hand-author the prose

The 80 files split cleanly into a mechanical part (headings, h1, section
insertion) and a judgement part (what each capability is *for*). Scripting the
first makes it reviewable as a diff with one shape repeated 80 times; scripting
the second would produce 71 plausible-sounding lies.

*Alternative — script everything with a generated Purpose:* rejected. A generated
Purpose is indistinguishable from an authored one in review, so the debt becomes
permanent and invisible. The `TODO(repair):` marker exists specifically to make
the scaffold **loud** and to give the change a grep-able completion test.

*Alternative — hand-fix all 80:* rejected. Non-idempotent, unrepeatable against
future drift, and the multi-delta trap is exactly what a human doing 80 repetitive
edits gets wrong.

### D2 — Delete subsequent delta headers instead of renaming them

Forced by `findSection` returning the first match. The failure mode of renaming
is the dangerous one: the tool reports success, `validate` goes green, and the
requirements under the second heading remain invisible. Deletion re-parents them
into the single surviving section.

Verification cannot be "validate passes" — it must be *requirement count from
`openspec show` equals the file's `### Requirement:` count*. That equality is the
only assertion that distinguishes a real repair from a green-but-empty one.

### D3 — Refuse `## REMOVED Requirements`; never promote it

The tool exits non-zero and leaves the file byte-identical. Generic refusal, not
a special-case for the one known instance (`event-persistence`), because the next
such spec may be a *partial* removal where deletion is the wrong answer and only
a human can tell.

*Alternative — auto-drop REMOVED blocks:* rejected. Silent deletion of retired
requirements destroys the `**Reason**` / `**Migration**` annotations that explain
why a capability went away.

### D4 — Tombstone the deprecated specs, delete only the fully-retired corpse

All three candidates carry zero current requirements, but they are not the same
artifact:

| Spec | State | Disposition |
|---|---|---|
| `event-persistence` | no Purpose; 9 requirements, **all 9** under `## REMOVED Requirements` with `**Reason**`/`**Migration**` | **delete** |
| `openspec-polling` | authored `## Purpose` reading `**DEPRECATED** — see \`server-openspec-polling\``; no `## Requirements` at all | **tombstone** |
| `session-history-sync` | authored `**DEPRECATED**` pointer to `server-session-reader` | **tombstone** |

The latter two are not corruption — they are deliberate deprecation pointers
someone wrote on purpose, which happen to miss the `## Requirements` section the
parser demands. Deleting them destroys a pointer that live specs still lead a
reader toward (`server-session-hydration` and `settings-panel` reference the old
names). `event-persistence` has no such authored pointer and every one of its
requirements is retired with a documented successor.

A tombstone cannot be an empty `## Requirements`: **a zero-requirement spec fails
validation** (verified against the CLI). Each tombstone therefore carries exactly
one requirement stating the capability is retired and naming its successor.

*Alternative — delete all three:* rejected on review. Cheapest tree, but it
discards two hand-authored pointers and leaves live cross-references dangling.

*Alternative — delete all three, adding "supersedes X" notes to the successors:*
rejected. It edits three healthy specs to compensate for deleting two, and the
reader who greps the old name still finds nothing.

*Cost accepted:* a tombstone requirement is a requirement the system does not
behaviourally have. It is explicitly a documentation marker, and the retirement
is stated in the requirement text itself so it cannot be mistaken for live
behaviour.

### D5 — Validate twice inside the tool, in one run

The tool re-validates each modified spec after writing and exits non-zero if any
still fails. This turns the fail-fast parser from a trap into a reporting
mechanism: masked phase-two errors surface in the same run that caused them
rather than in a later, seemingly unrelated invocation.

### D6 — Gate in the existing `ci` job, not a new one

`openspec validate --specs --no-interactive` runs as a step in the existing `ci`
job, reusing its checkout and `pnpm install --frozen-lockfile`. A new job costs a
runner and a new required-status-check configuration for a check that takes
seconds. `npm run spec:validate` mirrors it so a contributor reproduces a CI
failure without reading the workflow.

### D7 — Land the repair and the gate together

The gate cannot go green until the Purposes exist, so splitting them requires the
gate change to be blocked on the authoring change — the coordination cost of the
split exceeds its benefit. Ordering within the change is nonetheless strict:
structure → Purposes → deletions → gate, with the gate added last so CI never
goes red on `develop` mid-change.

## Risks / Trade-offs

- **An 80-file diff is not reviewable line-by-line** → the script makes 77 of
  them one repeated mechanical shape; the 3 semantically-loaded files (the two
  deletions plus `interactive-renderers`) are called out individually in
  `tasks.md` for focused review. `doubt-driven-review` is invoked before the bulk
  write.
- **The repair reports success while changing nothing observable** (multi-delta
  rename trap) → the acceptance assertion is requirement-count equality via
  `openspec show`, not validation exit code. Explicitly covered by the four known
  multi-delta specs.
- **Retired requirements resurrected as current spec** (REMOVED trap) → generic
  refusal with non-zero exit; no auto-promotion path exists in the tool.
- **71 authored Purposes drift into generic filler** ("This capability handles
  X") → each must be derived from that spec's own requirement text; the
  `TODO(repair):` grep is the mechanical gate, review is the semantic one.
- **The gate makes a future bad archive block `develop`** → this is the intended
  behaviour, but it moves the failure from invisible-forever to
  blocking-at-the-worst-moment. Mitigation: `openspec-archive-change` /
  `ship-change` should validate before pushing.
- **CI latency on 546 specs** → measured before enabling; if material, tune
  `--concurrency` rather than dropping the gate.
- **The census moves again before this lands** → no count is load-bearing. The
  tool discovers cohorts at runtime; the acceptance criterion is
  `validate --specs` exiting zero, not "80 files changed".

## Migration Plan

1. Write the tool + its tests (traps first — scenarios exist before the script).
2. Run structural repair; verify idempotence via a second run producing an empty
   `git diff`.
3. Author the 71 Purposes; `grep -r 'TODO(repair):' openspec/specs/` returns
   nothing.
4. Verify successors; delete `event-persistence`; convert `openspec-polling` and
   `session-history-sync` into one-requirement tombstones.
5. Hand-fix `interactive-renderers`; assert it reports 5 requirements, not 3.
6. Add the CI step + `npm run spec:validate` last, once the tree is already
   clean.

**Rollback:** every step is a git revert. The tool is additive; the gate is one
workflow step. No runtime code, no data migration, no deploy.

## Open Questions

- ~~Tombstones vs deletion for the three retired capabilities (D4)?~~
  **Resolved during `doubt-driven-review`:** tombstone the two authored
  `**DEPRECATED**` specs, delete `event-persistence` only.
- Is `--no-interactive` sufficient in CI, or does 546-spec validation need
  `--concurrency` tuning to keep PR latency acceptable?
- Should the tool eventually run as a pre-archive hook rather than a manual
  script, once the upstream defect is understood?
