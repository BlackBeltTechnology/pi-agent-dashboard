## Why

`add-local-codeql-ratchet` (PR #917) shipped with two loose ends, both recorded
in its review and in the first advanced-setup analysis:

1. **A baseline hand-edit between a run and `--prune`/`--accept` is invisible.**
   `last-run.json` is bound to the snapshot id, which deliberately excludes
   `codeql-baseline.json`, so `--accept` reasons over counts recorded against a
   baseline that has since been edited by hand.
2. **Local and CI disagree on the same commit.** At `d681f5a27` (advanced
   setup, identical pack shas) CI reports 150 results and the local run 179:
   every CI result appears locally, and 29 local-only results sit in client code
   (`js/xss` 8, `js/request-forgery` 9, `js/client-side-unvalidated-url-redirection` 7,
   `js/resource-exhaustion` 2, `js/xml-bomb`, `js/unvalidated-dynamic-method-call`,
   `js/regex-injection` 1 each). The cause is unknown; ruled out: missing
   `node_modules`, the `cwd-guard` model extension, pack versions. Until it is
   understood, the local gate is stricter than the PR's backstop in an
   unexplained way.

## What Changes

- **Baseline binding.** `last-run.json` also records a hash of the baseline
  file the run was compared against; `--prune`/`--accept` refuse when the file
  no longer hashes to it, and re-record the hash after their own write (so
  repeated prunes/accepts after one run keep working). A record without a hash
  (written by the shipped version) is accepted once, fail-open, as today.
- **Local/CI gap investigation.** Find why 29 client-side results appear only
  locally (candidates: extraction of `.tsx`/client files under `build-mode: none`
  in CI, `LGTM_INDEX_FILTERS` vs the action's `paths-ignore` handling, the
  action's default query-suite or threat-model resolution, extractor version).
  Outcome is one of: (a) a config change that makes local equal CI, (b) a
  documented, measured explanation plus a decision whether the ratchet should
  keep gating results CI cannot see.
- Document the outcome in `docs/code-quality.md`.

## Capabilities

### Modified Capabilities
- `codeql-local-ratchet`: prune/accept bound to the baseline the run was
  compared against; documented local/CI relationship.

## Impact

`scripts/codeql-local.mjs` (+ tests), `docs/code-quality.md`; the investigation
may touch `.github/codeql/codeql-config.yml` / `.github/workflows/codeql.yml`.
No migration: the new `last-run.json` field is optional. Rollback: revert the
commit; an old script ignores the extra field.

## Discipline Skills

`systematic-debugging` (the gap investigation: evidence-first root-cause before
any config change); `doubt-driven-review` before choosing outcome (a) vs (b).
No auth, secrets, untrusted-input, latency or new-endpoint work, so no
`security-hardening`, `performance-optimization` or `observability-instrumentation`.
