# Stop `kb dox lint` from silently skipping rows it cannot see

> Sibling of `fix-kb-eval-measurement-integrity`: same class of defect, different
> instrument. A lint that reports zero findings for a file it never read is worse
> than no lint, because the clean verdict is taken as evidence.

## Why

`kb dox lint` decides whether a table row is a DOX file row with one boolean, set
by every heading it walks (`packages/kb/src/dox.ts:441-443`):

```ts
const h = line.match(/^#{1,6}\s+(.*)$/);
if (h) { inDox = /^DOX\b/.test(h[1].trim()); ... }
const m = inDox ? line.match(/^\|\s*`([^`]+)`\s*\|/) : null;
```

The intent is real and must be preserved: prose tables must not be mistaken for
file rows. The root `AGENTS.md` has a `| Agent | Use for |` routing table whose
cells are backticked, and `kb.test.ts` pins that as "Defect B". But the boolean
over-fires in two ways.

**Cause A — a subheading closes the DOX section.** `inDox` is reset by *any*
heading, including a deeper one. A file shaped

```
# DOX — packages/foo
## Local contracts
## Files
| `a.md` | ... |
```

has every row invisible. 33 rows across `packages/pi-forms-bpmn/AGENTS.md` (19)
and `packages/cost-estimator/AGENTS.md` (14).

**Cause B — no `# DOX` heading means the whole file is skipped.** Six files never
set `inDox` true at all, so no row in them is ever scanned: `packages/bus-client`
(28), `packages/shell` (15), `packages/server/src/attachments` (8), root
`AGENTS.md` (8), `packages/electron/resources/bundled-extensions/pi-flows` (7),
`packages/server/src/tunnel-providers` (5).

Root `AGENTS.md` is a true negative — its 8 backticked cells are prose-table
cells and must stay unscanned. The other five are real per-file records.

**Blast radius: 96 rows are unaudited, against 2046 scanned — 4.5% of the tree.**
This is not confined to the `missing` arm. `stale`, `orphan` and `broken-ref` all
read the same `rowPaths`, so those five files have never been checked for source
drift, deleted targets, or rotted cross-references since the tree was created.
Their clean lint result is vacuous.

Discovered while clearing the backlog to zero: two packages kept reporting
`missing` for files whose rows were plainly present in the table, including their
own `README.md`.

**A third, related gap:** the md walk does not honour `.gitignore`. `.pi/.gitignore`
excludes `prompts/opsx-*.md` and `skills/openspec-*/**` (vendored by the openspec
CLI, absent from a fresh clone), yet lint demands rows for all 16. This already
caused rows to be authored and then reverted (`36a5f1ad1` → `5ae3d5661`), and
`.pytest_cache/README.md` surfaced the same way despite a nested `.gitignore`.

## What Changes

- **Replace the heading-state heuristic with a table-header one.** A row counts
  when it sits in a table whose header is `| File | Purpose |`. Repo-wide census:
  **214 tables use that exact header**; the only other headers are 5 prose tables
  (`Agent | Use for`, `Kind of update | Goes in`, `Task | Command | Notes`,
  `You're about to… | Do this first instead`, `Path | Purpose`). This fixes both
  causes at once and is independent of heading depth, heading text, and whether
  the file opens with `# DOX`.
  - Decide explicitly whether `| Path | Purpose |`
    (`packages/electron/resources/bundled-extensions/pi-flows/AGENTS.md`) is an
    accepted synonym or should be normalized to `File`.
- **Keep the Defect-B guarantee.** The existing `kb.test.ts` case must stay green:
  a `| Agent | Use |` table under `## Subagent Routing` yields no row and no
  orphan. Header-matching satisfies it structurally rather than positionally.
- **Honour `.gitignore` in the md walk**, consistent with `respectGitignore: true`
  in `packages/kb/src/config.ts:111` for the indexer. Nested `.gitignore` files
  must count — `.pytest_cache/.gitignore` and `.pi/.gitignore` both failed today.
- **Report scan coverage.** `kb dox lint` prints rows scanned and files scanned,
  so a file contributing zero rows is visible instead of silently absent. A file
  with a `| File | Purpose |` table but zero recognized rows is itself a finding.

## Capabilities

### Modified Capabilities

- `markdown-knowledge-base` — the DOX lint gains a defined row-recognition contract
  (table header, not heading state), gitignore awareness, and coverage reporting.

## Impact

- Expect a one-time jump in findings when the 96 newly-visible rows are audited
  for the first time. That backlog is pre-existing, not a regression.
- Expect `missing` to *drop* by 16 once `.gitignore` is honoured (the vendored
  openspec prompts and skills).
- No change to indexing, retrieval, or ranking. `kb dox triage --apply/--ack`
  consumes `{agentsFile,row}` pairs and is unaffected in shape, but will start
  seeing rows from the five previously-blind files.
- The five affected files need no edit under the header-based fix. If the
  heading-based approach is chosen instead, all six must be reshaped to `# DOX —`,
  which is churn without a durable guarantee — the next file authored without the
  magic heading goes blind again.

## Discipline Skills

- `doubt-driven-review` — the whole change exists because a green lint was trusted
  without asking what it had actually read. Before landing, verify the new rule on
  a file that should NOT be scanned, not only on files that should.
- `systematic-debugging` — two distinct causes hid behind one symptom ("row present
  but reported missing"); the second was found only after the first fix failed to
  clear `bus-client`. Confirm each remaining discrepancy has a named cause rather
  than assuming one fix covers all.
- `review-code` — row recognition is the single gate every lint arm depends on.
  Review the replacement for false negatives (a real row that stops counting) as
  carefully as for false positives.
