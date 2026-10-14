# Add Local CodeQL Ratchet

## Why

GitHub CodeQL (default setup: `actions`, `javascript-typescript`, `python`;
default suite; `remote` threat model; weekly + push + PR) reports its findings
only **after** a change is pushed, and nothing in the ship path reacts to them:
`develop` carries ~190 open alerts, most of them noise (tests, scripts,
mockups) or accepted by design (operator APIs behind the universal network
guard), so a new real finding is invisible in the pile.

A spike (CLI 2.27.2, the version GitHub uses) showed a local run is practical
and comparable:

- JS/TS database 95 s + analysis 87 s; actions 2 s + 6 s (18-CPU machine).
- Every local SARIF result carries `partialFingerprints.primaryLocationLineHash`,
  stable when code above it shifts (23/23 alerts in a shifted file kept their
  hash); 196 results collapse to 188 `(rule, file, hash)` keys, so a key needs a
  **count**.
- Local results matched GitHub alerts by `(rule, path, start line)` 221/222 in
  the spike, so GitHub dismissal comments can seed baseline reasons; a later
  run found a gap (28 local-only results), so seeding is gated on re-measuring
  it.
- The `cwd-guard` model extension changes nothing: CodeQL infers the
  `admissionAllows` / `admitCwd` barrier from source (removing one guard call
  produced 9 new path-injection alerts without the model).

This change makes CodeQL a ship-time ratchet: a new alert must be fixed or
accepted with a reason before the change lands, and the accepted debt can only
shrink. It follows `fix-codeql-small-findings` and
`sanitize-untrusted-rendered-content` so the seed is as small as possible;
whatever of those has not landed is seeded and shrinks when it does.

## What Changes

- **Advanced setup with one shared config.** New
  `.github/workflows/codeql.yml` (push to `develop`, PRs, weekly) analyzing
  `actions`, `javascript-typescript` and `python` with build mode `none` and
  categories exactly `/language:<lang>` (the default-setup categories, which the
  38 existing dismissals are recorded under). New `.github/codeql/codeql-config.yml`
  with `paths-ignore` for tests (including script tests), e2e, QA, mockups and
  OpenSpec change mockups — non-test scripts stay analyzed, since some run in CI
  with publish-scope tokens; the local script reads the same file and passes its
  `paths-ignore` to the extractor.
  Default setup is switched off in the same rollout (GitHub rejects
  advanced-setup uploads while it is on).
- **Local analysis + ratchet script** `scripts/codeql-local.mjs`
  (`npm run codeql`): snapshots the worktree's tracked and untracked-unignored
  files (content-addressed via a temporary git index), builds fresh
  `javascript-typescript` and `actions` databases with the shared config's
  exclusions (translated to extractor filters, so no network is needed), runs
  the code-scanning suites pinned to the baseline's pack versions with the
  `remote` threat model, and compares results to the committed
  `codeql-baseline.json` (`{ruleId, file, lineHash, count, reason}`). Fails on
  any key whose count exceeds the baseline. Missing `codeql` binary, or packs
  neither cached nor downloadable → loud `SKIPPED` warning, exit 0; cached packs
  run offline. CLI version differing from the baseline's → warning. Modes:
  `--json`; `--prune` (lowers/removes stale entries, never raises); `--accept`
  (sets a key with excess results to its current count, with a prefixed reason
  that differs from the entry's current one, from the recorded last run);
  `--triage` (replaces an `untriaged` reason at the same count);
  `--check-baseline-diff <ref>` (static: per rule and file the `untriaged`
  total never rises; growth needs a real reason and is printed for review;
  `--no-growth`, used headless, refuses any growth; the introducing change's
  seed must equal a recorded run; an unknown ref fails closed); `--write-baseline` (seed only:
  runs the analysis with built-in pack pins; refuses to overwrite).
- **Seed baseline** on `develop` at implementation time, gated on re-measuring
  local vs GitHub agreement: reasons (via `--triage`) from matching GitHub
  dismissals, a shared `operator-authz` reason for path-injection behind the
  network guard (recording the trusted-CIDR caveat), measured false-positive
  reasons (e.g. the `skill-block-parser` regex), everything else `untriaged`.
- **ship-it step 4.4b** between 4.4 and 4.5: run the script; prune stale entries
  (`--prune`, staged with the change); on new alerts ask per alert — fix, or
  accept with a typed reason (`--accept`; an `operator-authz` preset only for
  path and command injection); headless writes `SHIP_IT_BLOCKED.md` listing the
  alerts and stops; a closing `--check-baseline-diff` gates step 4.5 (headless:
  `--no-growth`, so unattended runs never grow the baseline).
  `--check-baseline-diff origin/develop` also joins step 4.4 (static, instant).

## Non-Goals

- Python locally (CI only), CI gating on the baseline (the PR's GitHub
  analysis remains the backstop), the `cwd-guard` model extension (left as-is;
  measured redundant) and new model entries such as `isValidNpmPackageName`,
  a git hook, dismissing alerts on GitHub, and changing `quality:changed`.

## Capabilities

### New Capabilities
- `codeql-local-ratchet`: shared CodeQL configuration for CI and local runs,
  the local analysis script, the per-alert baseline ratchet and its
  growth/prune/accept rules.

### Modified Capabilities
- `ship-it-orchestrator`: "Steps 4.4 and 4.5 sit between the harness gate and
  the inline ship-change drive" gains step 4.4b and the static baseline-diff
  check in 4.4; "Boundary-reverse escape hatch" covers the headless CodeQL stop.
- `local-review-gate`: "A semantic review runs before push, on the integrated
  green tree" — the review also waits for step 4.4b, and unresolved new CodeQL
  alerts stop the run before review.

## Impact

- New: `.github/workflows/codeql.yml`, `.github/codeql/codeql-config.yml`,
  `.github/codeql/AGENTS.md`, `.github/codeql/extensions/AGENTS.md`,
  `scripts/codeql-local.mjs` (+ `.AGENTS.md` sidecar), `codeql-baseline.json`,
  `openspec/changes/add-local-codeql-ratchet/evidence/` (dismissal export,
  local-vs-GitHub comparison).
- Modified: `package.json` (`codeql` script), `.pi/skills/ship-it/SKILL.md`,
  `docs/code-quality.md`, `docs/AGENTS.md`, `scripts/AGENTS.md`,
  `.github/workflows/AGENTS.md`.
- Repository setting: code-scanning default setup → `not-configured` (needs
  repo admin; done in the rollout task).
- ship-it gets 1–3 minutes slower per enforcer pass when `codeql` is installed.
- Compatibility: keeping default setup's categories is necessary for
  dismissals to carry over but not proven sufficient (the analysis key changes);
  the export + re-dismiss step is the guarantee. Alerts in newly ignored paths close as fixed on the first
  advanced analysis.
- Dismissals: the 38 are exported before the switch and re-applied if any
  reappear open after the first advanced analysis.
- PR-path scanning is not new: default setup already analyzes every PR.
- Rollback: delete the workflow first (GitHub refuses default setup while an
  advanced workflow is active), then re-enable default setup with its previous
  parameters; the script and baseline are inert without callers.

## Discipline Skills

- `security-hardening` — the change decides which security findings may land;
  baseline reasons are security acceptances.
- `doubt-driven-review` — the default-setup switch and category choice are
  irreversible for dismissal history once analyses upload.
- `observability-instrumentation` — the gate's skip/warn/fail outcomes must be
  visible in ship-it output, not silent.
