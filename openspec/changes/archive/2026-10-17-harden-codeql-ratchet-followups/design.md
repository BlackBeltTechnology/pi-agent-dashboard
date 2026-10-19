## Context

- Shipped requirement: `openspec/specs/codeql-local-ratchet/spec.md`; shipped
  design D7 (`openspec/changes/archive/2026-10-14-add-local-codeql-ratchet/design.md:282`) says
  prune/accept "refuse when the current snapshot id differs" and that "any
  number of prunes and accepts can follow one run", because the snapshot
  excludes the baseline (`scripts/codeql-local.mjs:410`, `git rm --cached` of
  `BASELINE_FILE` before `write-tree`).
- `analyse` writes `last-run.json` as `{snapshotId, counts, results}`
  (`scripts/codeql-local.mjs:711`).
- `requireFreshRun` checks only the snapshot id (`scripts/codeql-local.mjs:772-776`).
- `modeAnalyse` reads the baseline before `analyse` takes the lock
  (`scripts/codeql-local.mjs:728` vs `:688`).
- `modeTriage` writes the baseline without touching the record
  (`scripts/codeql-local.mjs:816-830`).
- Gap evidence:
  - Pre-switch (`d739f4bd`): symmetric, 29 GitHub-only and 29 local-only
    (archived `add-local-codeql-ratchet/evidence/local-vs-github.md`).
  - Post-switch (`d681f5a27`): CI total verified at 150 via the code-scanning
    analyses API (js 124 + actions 26).
  - CI SARIF diff, pre-switch `1954189767` → post-switch `1955514654`:
    - 55 results lost, 0 gained.
    - 29 of the lost are in scope, with the same rule counts as the archived
      GitHub-only set (path-injection 23: automation-plugin 14, team-plugin 9).
    - At file level they differ from the files the archived evidence lists.
      The archive is immutable; step 1 of D2 records the SARIF-derived set.
    - Their sources are unchanged between the two commits.
  - The local 179 and the "0 CI-only" claim are unrecorded, and are re-measured in D2 step 0.

## Decisions

### D1 — Baseline hash in `last-run.json`
- **Field.** `last-run.json` gains `baselineHash` =
  sha256(`serializeBaseline(parsed)`) (`scripts/codeql-local.mjs:179`) of the
  very baseline object `modeAnalyse` parsed for the verdict.
  - Every non-seed run writes it: `analyse` already receives `baseline` (`:680`)
    and adds the hash to its `:711` record write.
  - It is the canonical form, so JSON formatting and entry-order changes do not
    invalidate a run. Any change to a field `serializeBaseline` emits does:
    entries, counts, reasons, `codeql`, `packs`, `_comment`. Unknown keys and a
    deleted `_comment` are outside the hash; neither affects the verdict.
  - `readBaseline`'s signature is unchanged; the hash is computed from the
    object it already returns.
  - A hand edit during the ~90 s analysis is caught at prune/accept time, because
    the file no longer canonicalizes to what the verdict used.
  - A hand edit that breaks JSON or the schema already fails in `readBaseline`
    (exit 2) before the hash check.
- **Seed.** `analyse` has no baseline to hash on the `--write-baseline` path, so it
  writes the record without a hash. The seed path then rewrites `last-run.json`
  after `writeBaseline`, adding the hash of the baseline it wrote.
- **Refusal.** `requireFreshRun` takes the baseline object the mode already parsed
  (the same object it then edits and writes) and compares the hash of its
  canonical form with `baselineHash`.
  A mismatch exits 2 with "baseline changed since the recorded run; re-run the
  analysis first".
- **Re-recording.**
  - After writing the baseline, `--prune` and `--accept` atomically rewrite
    `last-run.json` with `baselineHash` = hash of the in-memory serialized text
    they just wrote, under the existing lock.
  - `--triage` does the same only when a record exists and its hash equals the
    pre-triage baseline's hash. A hashless or mismatched record stays as it is:
    triage must not launder a hand edit.
  - A triage with no record writes no record.
- **Legacy records.** A missing `baselineHash` (record from the shipped version)
  is accepted by `--prune`/`--accept`, and a stderr note says the binding was not
  checked. Their write then binds the record to the baseline they wrote.
- **Rejected alternative:** include the baseline in the snapshot id. It makes
  every prune/accept invalidate the run, which undoes "repeatable after one run".
- **ship-it.** Step 4.4b writes the baseline only through `--prune`/`--accept`,
  and both re-record, so prune → accept chains never hit the new refusal. The
  exit-2 retry/abort contract is unchanged; a retry after this refusal means re-running step 4.4b's analysis, as the message says.

### D2 — Gap investigation (decision gate)
0. **Re-measure first.** At one post-switch commit, on one machine, run the local
   analysis and fetch that commit's CI SARIF (not alert counts). Commit
   `evidence/local-vs-ci.md` with the method, the pack shas from both SARIFs, and
   the (rule, file, line) sets. Python results are excluded.
1. **Diff the pre-switch default-setup CI SARIF against the post-switch one,**
   recording the 29 lost server results and their probable cause.
   **Re-run the pre-switch controls post-switch:** `node_modules`, the
   `cwd-guard` model, pack shas.
2. **Run every variation,** recording each one's set diff (no early stop):
   - (a) `database create` file counts per extension vs the CI SARIF `artifacts`;
   - (b) with/without `LGTM_INDEX_FILTERS`;
   - (c) query suite as the action resolves it (CI init log) vs the local pinned suite;
   - (d) `--threat-model` default vs `remote`;
   - (e) alerts API vs SARIF result count for the same analysis;
   - (f) SARIF tool and pack versions, CI vs local (`SEED_PACKS`);
   - (g) whether CI auto-loads `.github/codeql/extensions/cwd-guard.model.yml`.
     Neither `codeql-config.yml`, `codeql.yml` nor the script references it.
3. **Equality** = same keys by (rule, file, `lineHash`) with the same per-key counts,
   using SARIF `partialFingerprints.primaryLocationLineHash`; fall back to
   (rule, file, start line) only for results without one. Count equality alone
   is not enough.
4. **Ask the user** (a) align or (b) keep stricter. No config change before that
   answer.
   - Any (a) returns to planning as its own MODIFIED delta (or follow-up change)
     before implementation. Examples: a shared `paths-ignore` or `queries` edit, a
     local analysis argument (suite, threat model), the script's
     `LGTM_INDEX_FILTERS` translation.
   - Reason: each touches the unmodified "share one configuration" or
     "content-addressed snapshot" requirements.
   - An (a) also needs a dismissal re-check after its CI run.
   - (b) must record whether the local/CI asymmetry and the lost server
     coverage are accepted, and why.

## Risks / Trade-offs

- **[Hash churn: `git pull`/rebase/stash rewrites the baseline]** → a prune/accept
  after that asks for a re-run. This is intended: the counts were recorded
  against other bytes. The formatter cannot cause churn, because
  `biome.json` has `formatter.enabled: false`.
- **[Crash between the baseline write and the record write]** → the next
  prune/accept refuses until a re-run. This is fail-closed, and documented.
  "Repeatable after one run" holds absent such a crash.
- **[Lost update: an edit lands between the hash check and the atomic rename]**
  → the window is sub-second and in-process; it is accepted and documented.
  The lock excludes only other script runs.
- **[Same-trust bypass: delete `baselineHash` from the `$TMPDIR` record]** → out
  of scope. The binding guards against accidents, not adversaries.
- **[Legacy record + hand edit + prune]** → accepted with the note, then the record
  binds the edited baseline. This is a one-time window per upgrade.
  `--check-baseline-diff` still gates growth.
- **[`modeAnalyse` reads the baseline before `analyse` takes the lock]** → a
  concurrent script write in that window makes the next prune/accept refuse.
  That is fail-closed; documented.
- **[Investigation inconclusive]** → outcome (b), with the measurements recorded.
