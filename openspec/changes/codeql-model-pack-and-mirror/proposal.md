## Why

The repo's CodeQL barrier-guard model (`.github/codeql/extensions/cwd-guard.model.yml`, added in #856 and #870) has most likely **never been loaded**, either in CI or locally:

- **CI.** GitHub auto-detects model packs only as a *pack directory* with a `codeql-pack.yml` under `.github/codeql/extensions/`. That holds for advanced setup too (GitHub Docs, "Extending CodeQL coverage with CodeQL model packs"). The repo has a bare `.model.yml` file with no pack.
- **Local.** `scripts/codeql-local.mjs` passes no `--additional-packs` / `--model-packs`.
- **Corroboration.** `docs/code-quality.md` records "identical results" with and without the model.

Two planned changes depend on models that actually load:

- `core-cwd-admission` closes route path-injection alerts through modelled guards.
- `triage-codeql-alert-debt` dismisses the remainder.

The latter also needs a way to mirror a GitHub dismissal into `codeql-baseline.json`. Today `--triage` refuses any entry that is already triaged (`scripts/codeql-local.mjs:839-846`).

## What Changes

- **Model pack.** `.github/codeql/extensions/` becomes a model pack directory: a `codeql-pack.yml` (library, `extensionTargets` for JavaScript, data extensions = `*.model.yml`), with the existing `cwd-guard.model.yml` moved inside it unchanged.
- **CI loads it** through GitHub's documented auto-detection. A contract test pins the pack layout.
- **The local ratchet loads the same pack** (`--additional-packs` + `--model-packs`). A model pack that cannot be resolved offline follows the existing loud-skip rule.
- **Spike (throwaway branch, never merged).** A probe route pair proves that a modelled guard suppresses `js/path-injection` in both CI and local runs. One route is guarded by `isAllowedCwd`; its twin is unguarded.
- **New ratchet mode `--mirror-dismissal`.** It rewrites a triaged entry's reason to `github-dismissed (#n[,#m…], <reason>): <original>`. It is lock- and hash-bound like `--triage`, and accepts one alert number per counted result.
- **Ignore throwaway code.** `spike/**` is added to `paths-ignore`, and the 4 `spike/` baseline entries are pruned.
- **Re-measure.** Local vs CI result parity is re-measured once the model loads, and `docs/code-quality.md` is updated.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `codeql-local-ratchet`:
  - the shared configuration includes a model pack loaded by both runners;
  - `paths-ignore` excludes `spike/**`;
  - new mirror-dismissal mode.

## Impact

- **Files.**
  - `.github/codeql/extensions/` is restructured: a pack directory, with the model file moved into it.
  - `scripts/codeql-local.mjs` and its tests change.
  - `packages/shared/src/__tests__/codeql-workflow-contract.test.ts` changes.
  - `.github/codeql/codeql-config.yml`, `codeql-baseline.json`, and the `docs/code-quality.md` CodeQL section change.
- **Analysis results may change.** With the model loaded, plugin-route alerts guarded by `isAllowedCwd` / `admissionAllows` may close. Baseline entries may become stale (`--prune`). Nothing new can appear: barrier models only remove results.
- **Snapshot.** The pack's files are tracked, so the snapshot id changes once. No re-seed is needed.
- **ship-it.** Step 4.4b keeps changing the baseline only through `--prune` / `--accept` (`ship-it-orchestrator` spec unchanged). `--mirror-dismissal` is an operator tool used post-merge by `triage-codeql-alert-debt`.
- **Rollback.** Revert. The model simply stops loading again. No alerts are dismissed by this change.

## Non-goals

- Route or guard code changes (`core-cwd-admission`).
- Triage or dismissal of existing alerts (`triage-codeql-alert-debt`).
- Changing loud-skip semantics, i.e. making a skip block ship-it. That is a pre-existing policy (`ship-it-orchestrator` step 4.4b logs a skip and continues).

## Discipline Skills

- `doubt-driven-review`: the pack layout is a CI-config change whose correctness cannot be type-checked. The spike is the evidence.
- `systematic-debugging`: if the probe shows the model is not applied on either side.
- `review-code`: before commit.
