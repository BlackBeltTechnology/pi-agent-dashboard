## Why

`add-local-codeql-ratchet` (PR #917) shipped with two loose ends, both recorded
in its review and in the first advanced-setup analysis:

1. **A baseline hand-edit between a run and `--prune`/`--accept` is invisible.**
   `last-run.json` is bound to the snapshot id, which deliberately excludes
   `codeql-baseline.json`, so `--accept` reasons over counts recorded against a
   baseline that has since been edited by hand. Scope: only edits made *after*
   the run. An edit made *before* a run is compared honestly by that run, and
   baseline growth relative to `origin/develop` is already gated by
   `--check-baseline-diff` (ship-it step 4.4 / closing check of 4.4b).
2. **Local and CI disagree on the same commit, and the disagreement moved with
   the switch to advanced setup.**
   - Pre-switch, GitHub default setup at `d739f4bd`: 179 vs 179 results, 150 matched by
     (rule, file, line), 29 GitHub-only (`js/path-injection` ×23 in plugin server
     code, `js/missing-rate-limiting` ×5, `js/tainted-format-string` ×1) and 29
     local-only (client code). Evidence:
     `openspec/changes/archive/2026-10-14-add-local-codeql-ratchet/evidence/local-vs-github.md`.
   - Post-switch, advanced setup at `d681f5a27`: CI reports 150 results
     (javascript-typescript 124, analysis `1955514654`; actions 26, analysis
     `1955501125`; python 2 excluded, since the local run does not cover python). The local run
     in the planning session reported 179, with every CI result present locally and
     29 local-only results in client code (`js/xss` 8, `js/request-forgery` 9,
     `js/client-side-unvalidated-url-redirection` 7, `js/resource-exhaustion` 2,
     `js/xml-bomb`, `js/unvalidated-dynamic-method-call`, `js/regex-injection`
     1 each). That local measurement is **not yet recorded in the repo**; the
     investigation re-measures it first.
   - **The CI side changed too.** Diffing the two CI SARIFs shows the post-switch
     JavaScript analysis (`1955514654`, 124) lost 55 of the pre-switch default-setup
     results (`1954189767`, 179) and gained none.
     - 26 of the 55 sit in ignored paths, as expected.
     - 29 are in scope, with the same rule counts as the pre-switch GitHub-only set
       (`js/path-injection` 23 in automation-plugin and team-plugin server code).
     - Their source files are unchanged between `d739f4bd` and `d681f5a27`.
     - So advanced setup lost server-side coverage that default setup had. That
       may be a regression in its own right, not only a local quirk.
   - Ruled out pre-switch only, and locally only: missing `node_modules`, the
     `cwd-guard` model extension, pack content. Until the gap is understood, the
     local gate and the PR's backstop each cover results the other does not.
       - The local gate covers client results CI does not.
       - Default-setup CI used to cover server results that both now miss.

## What Changes

- **Baseline binding.** `last-run.json` also records the sha256 of the exact
  baseline bytes the run's verdict was computed from (or of the baseline a seed
  run wrote). `--prune`/`--accept` refuse (exit 2, "re-run the analysis") when
  the file no longer hashes to it. Every script write of the baseline
  (`--prune`, `--accept`, `--triage`, `--write-baseline`) re-records the hash
  so prunes, accepts and triages after one run keep working. `--triage`
  re-records only when the record's hash matches the baseline before the
  triage, so it never launders a hand edit. The hash covers the canonical
  serialization of the parsed baseline, not its raw bytes: whitespace and
  ordering changes do not invalidate a run. A record without a hash (written by
  the shipped version) is accepted, fail-open, with a stderr note.
- **Local/CI gap investigation.** Two questions:
  1. Why do the local-only client results appear?
  2. Why did the default→advanced switch drop the 29 server results?

  Re-measure at one post-switch commit first. Candidates:
  - alerts-API counts vs SARIF results;
  - query-suite resolution;
  - threat-model resolution;
  - data-extension (`cwd-guard`) application in CI;
  - pack/CLI version drift;
  - `LGTM_INDEX_FILTERS` vs the action's `paths-ignore` handling;
  - extractor file coverage.

  Both sides already use `build-mode: none`. Outcome is one of:
  - (a) a change to the **shared** configuration that makes local equal CI,
    possibly restoring the lost server coverage on both sides. It is planned as
    its own delta;
  - (b) a documented, measured explanation, plus a decision on whether the
    ratchet keeps gating results CI cannot see, what that asymmetry means on
    machines without CodeQL, and whether the lost server coverage is accepted.
- Document the outcome and the new `last-run.json` field in `docs/code-quality.md`.

## Capabilities

### Modified Capabilities
- `codeql-local-ratchet`: prune/accept bound to the baseline bytes the run
  compared against; every script baseline write keeps the binding current.

## Impact

`scripts/codeql-local.mjs` (+ tests), `scripts/codeql-local.mjs.AGENTS.md`,
`docs/code-quality.md` (the snapshot section's `last-run.json` shape and refusal
rule, and the known-limitation section). Outcome (a) may
touch `.github/codeql/codeql-config.yml` / `.github/workflows/codeql.yml`. Every
such config change touches unmodified `codeql-local-ratchet` requirements (the
shared configuration, the content-addressed snapshot), so it returns to planning
for its own MODIFIED delta before implementation. This change only records the
decision. Headless ship-it: a git operation
that rewrites the baseline between step 4.4b's run and its prune/accept now
stops with exit 2 until the analysis is re-run. No migration: the new `last-run.json` field is optional,
and the file is ephemeral `$TMPDIR` state. Rollback: revert the commit. An old
script ignores the extra field. A record left stale by an old-script prune makes
the new script ask for a re-run, which is recoverable.

## Discipline Skills

- `systematic-debugging`: the gap investigation. Evidence-first root cause
  before any config change.
- `doubt-driven-review`: before choosing outcome (a) vs (b).
- No `security-hardening`. The binding guards against accidental, same-trust
  edits only: whoever can edit the baseline can also edit `last-run.json`. The
  reason-quality rules on the accept path are unchanged.
- No auth, secrets, latency or new-endpoint work, so no
  `performance-optimization` or `observability-instrumentation`.
