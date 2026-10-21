## Why

The repo's CodeQL barrier-guard model, `.github/codeql/extensions/cwd-guard.model.yml` (#856, #870), **has never applied to any production call site**.

- **Cause.** JavaScript models-as-data parse the type column with `('[^']+'|[^.]+)(.*)` (`codeql/javascript-all@2.10.3`, `ApiGraphModelsSpecific.qll:45-50`). The package name ends at the first dot unless the type is single-quoted. The rows name `@blackbelt-technology/pi-dashboard-shared/cwd-guard.js` and `…/project-name.js` unquoted, so they parse as package `…/cwd-guard` with type `js`, which matches nothing.
- **Every production import uses the `.js` specifier**, e.g. `packages/server/src/routes/addons-routes.ts:19`.
- **Proven on fresh CodeQL 2.27.2 databases** (`evidence/model-match-probe.md`), including a mini-monorepo with the real `packages/shared/package.json`: unquoted rows suppress nothing, quoted rows suppress the guarded sink and keep the unguarded twin.
- **This explains the recorded "no observable effect"** (archived `harden-codeql-ratchet-followups` evidence, row g).

Two planned changes rely on this model working:

- `core-cwd-admission` closes route path-injection alerts through it.
- `triage-codeql-alert-debt` dismisses the remainder and records each dismissal in `codeql-baseline.json`.

Two further gaps:

- The local ratchet does not load the model at all (`scripts/codeql-local.mjs:670` has no pack flags).
- `--triage` refuses to record a GitHub dismissal of an entry that is already triaged (`:837-846`).

## What Changes

- **Fix the model.**
  - Single-quote every type string containing a dot in `cwd-guard.model.yml` (the `.js` rows).
  - A contract test rejects an unquoted dotted type in any `*.model.yml`.
  - Expected effect: CI and local stop reporting `js/path-injection` at sinks reached only through the modelled guards. Among current baseline entries this is at most `folder-project-routes.ts` (count 1), which is unverified. The fix mainly unblocks `core-cwd-admission`.
  - The fix *activates* five predicates for the first time: `isAllowedCwd`, `admissionAllows`, `tokenAllows` and `isPortableProjectName` (guards), and `admitCwd` (an unconditional barrier on its argument). Each is covered by the spike.
- **The local ratchet loads the model.**
  - A wrapper model pack is generated under the run directory from the snapshot's model files, i.e. the same bytes the analysis sees and CI sees once committed.
  - It applies to the JavaScript analysis only.
  - Any model-pack failure is an error (exit 2), never a skip.
- **Spike on throwaway branches, never merged.**
  - A probe route pair in the real repo: one route guarded by `isAllowedCwd`, an unguarded twin.
  - Two checks: CI and local both report the guarded sink with today's model, and neither reports it with the fixed model.
  - This must pass before merge.
- **New ratchet mode `--mirror-dismissal <rule> <file> <lineHash> --alert <n>[,<n>…]`.**
  - It reads each alert from GitHub (`gh api`).
  - It requires one alert per recorded result, matched by start line (as a multiset), at the recorded commit, with one shared dismissal reason.
  - It rewrites the entry's triaged reason to `github-dismissed (#n[, #m…], <reason>): <original>`.
  - It is lock- and hash-bound like `--triage`.
- **Ignore spike code.** `spike/**` (repository root) is added to `paths-ignore`. This lands first, with its own prune, after a real-analysis test proves a nested `spike/` directory stays analyzed. Root `spike/` holds experiments, some of which smoke tests and the docker harness use (`docker/test-entrypoint.sh:495`); CodeQL coverage of it is not wanted.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `codeql-local-ratchet`:
  - the shared configuration covers root `spike/**` (an explicit exception to "non-test scripts stay analyzed") and applies the model to JavaScript;
  - model type strings must parse to the intended package;
  - the dismissed-reason grammar allows several alert numbers;
  - `--json` reports the model files' digest;
  - local analysis loads the model;
  - new mirror-dismissal mode.

## Impact

- **Files.**
  - `.github/codeql/extensions/cwd-guard.model.yml` (quoting only).
  - `scripts/codeql-local.mjs` and `scripts/__tests__/codeql-local*.test.mjs`, plus their `*.AGENTS.md` sidecars.
  - `packages/shared/src/__tests__/codeql-workflow-contract.test.ts`, `.github/codeql/codeql-config.yml`, `codeql-baseline.json` (two prune commits).
  - `docs/code-quality.md` CodeQL section, `.github/codeql/AGENTS.md`.
- **Results.**
  - The fixed model is intended only to suppress sinks behind modelled guards. Tests pin the argv, the wrapper contents and the `spike/**` filter.
  - On GitHub, alerts at such sinks, and existing `spike/` alerts, will likely be marked fixed after the first `develop` scan. That is unverified GitHub behaviour; it will be observed and recorded.
- **ship-it.**
  - Step 4.4b keeps changing the baseline only through `--prune` / `--accept` (`openspec/specs/ship-it-orchestrator/spec.md:168`).
  - New blocking case: a broken local model pack (unparsable, or its files not resolved) exits 2, which 4.4b shows as retry/abort, or `SHIP_IT_BLOCKED.md` when headless. An uncommitted model edit is analyzed like any other uncommitted change; it does not block.
  - `--mirror-dismissal` is an operator tool, never run in 4.4b. It writes only what GitHub confirms for the exact key. Residual risk: a *hand* edit to a `github-dismissed (#n, …)` reason passes `--check-baseline-diff`, which allows same-count reason rewrites. That is unchanged from today and recorded in the docs.
- **Rollback.** Revert all commits in reverse order: docs, prune commit B (model-closed entries), code + model fix, `spike/**` config + prune commit A. Reverting the model fix without commit B makes the model-closed results NEW again. Nothing is dismissed on GitHub by this change.

## Non-goals

- Route or guard code changes (`core-cwd-admission`). Triage or dismissal of existing alerts (`triage-codeql-alert-debt`).
- Restructuring `.github/codeql/extensions/` into an explicit or published model pack.
- Closing the other local≠CI causes: `--threat-model=remote` and the plugin registrar coverage gap.
- Making a skip block ship-it. Appending numbers to entries that are already `github-dismissed`.

## Discipline Skills

- `doubt-driven-review`: the model fix is a CI-semantics claim that type-checking cannot verify. The spike and the probes are the evidence.
- `security-hardening`: the model fix *removes* alerts, so a wrong row could hide a real flow. `--mirror-dismissal` must never record a reason without GitHub's confirmation.
- `systematic-debugging`: if the spike disagrees with the probes.
- `review-code`: before commit.
