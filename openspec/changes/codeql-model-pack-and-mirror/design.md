# Design

## Context

See proposal.md (Why). Current state:

- **Model file.**
  - `.github/codeql/extensions/` holds `cwd-guard.model.yml` (a `barrierGuardModel` block and a `barrierModel` block) and `AGENTS.md`. There is no `codeql-pack.yml`.
  - `.github/workflows/codeql.yml:38-45` uses `github/codeql-action/init@v4` with only `config-file:` and no `packs:` input.
- **GitHub Docs** ("Extending CodeQL coverage with CodeQL model packs", fetched 2026-10-21) describe what is auto-detected:
  - a *model pack directory* under `.github/codeql/extensions` that includes a `codeql-pack.yml` and its model `.yml` files;
  - this also holds after switching to advanced setup;
  - published packs go through `with: packs:`.
- **Local analyze command.** `scripts/codeql-local.mjs:670` runs:

  ```
  database analyze <db> <pack>@<ver>:<suite> --threat-model=remote --format=sarif-latest --output=… --threads=0
  ```

  - No pack search path.
  - Query packs come from `SEED_PACKS` (`:49`) / the baseline header and are resolved offline (`:684`).
  - The CLI is 2.27.2. Cached query packs are `codeql/{actions,javascript,python}-queries`.
- **Snapshot.** `takeSnapshot` (`:396`) materialises tracked plus untracked-unignored files into `<run>/src/`. A pack inside the repo is therefore present in the snapshot.
- **`modeTriage`** (`:837`) is the template for a reason-rewrite mode: lock, key lookup, reason predicate, write, and conditional hash re-record.

## Goals / Non-Goals

**Goals:**
- The existing model provably applies in CI and locally.
- A mirror mode exists for the later dismissal work.

**Non-Goals:** see proposal.

## Decisions

### D1 — Pack directory `.github/codeql/extensions/pi-dashboard-models/`
It contains:

```yaml
name: pi-dashboard/models
version: 0.0.0
library: true
extensionTargets:
  codeql/javascript-all: "*"
dataExtensions:
  - "*.model.yml"
```

`cwd-guard.model.yml` is `git mv`'d inside, unchanged.

- *Alternative:* the `packs:` input on `init`. Rejected because it needs a published pack (GitHub Container registry), while the docs name directory auto-detection for repo-local packs.
- *Why `"*"`:* `extensionTargets` as a version range lets the pack follow whatever `javascript-all` the pinned query pack brings.

### D2 — Local: `--additional-packs <snapshot>/.github/codeql/extensions --model-packs pi-dashboard/models`
Both flags are added to the `database analyze` argv. The snapshot already contains the directory, so no wrapper and no `$TMPDIR` copy are needed, and the working tree is untouched.

- Resolution is offline: `javascript-all` comes with the cached `javascript-queries` dependency closure.
- If resolution fails ("could not resolve", pack not found) → `CODEQL SKIPPED: model pack pi-dashboard/models unavailable (<cli message>)`, exit 0, `--json` `{status:"skipped", cause}`. This matches the existing pack-unavailable handling (`:684` loop).
- *Alternative:* passing the `.model.yml` files via a generated pack under `$TMPDIR`. Rejected because the in-snapshot pack avoids a second copy that could drift.

### D3 — Spike on a throwaway branch (never merged)
The probe file is `packages/server/src/codeql-probe-routes.ts`. It is not under an ignored path and is not imported by production code; it lives on the throwaway branch only. It contains a Fastify route pair:

- `GET /probe/guarded`: `if (!isAllowedCwd(q.cwd, known)) return; fs.readFileSync(q.cwd + "/x")`.
- `GET /probe/unguarded`: the same without the guard.

The guard is imported from `@blackbelt-technology/pi-dashboard-shared/cwd-guard.js`, the exact package path the model names.

- **Pass condition:** in both the PR's CodeQL analysis and `npm run codeql -- --json` on that branch, the unguarded sink is reported and the guarded one is not.
- **Control:** the same probe on a branch *without* D1/D2 must report both. This proves the model, not something else, removes the guarded one.
- **Recording:** the run URLs and the local JSON excerpts go into `evidence/spike.md` in this change, which is committed with the change on `develop`.
- **Fail path:** `systematic-debugging`. Check the model's package-name rows (`.js` vs bare) against how the probe imports, and `codeql resolve extensions`. If it is still failing, stop and re-plan `core-cwd-admission` and `triage-codeql-alert-debt` (both depend on this).

### D4 — `--mirror-dismissal`
Implemented next to `modeTriage`, sharing its lock and hash-binding helpers.

- **Reason grammar:** `github-dismissed (#<n>[, #<n>…], <false positive|won't fix|used in tests>): <original>`.
- **Validation:** the existing reason validator must accept the multi-number form. It is extended, and existing single-number entries remain valid.
- **No `--accept`/`--prune` interplay.** The mode never changes counts.

### D5 — Re-measure local vs CI parity
After merge, run the `docs/code-quality.md` "Known limitation" protocol: multiset equality on (rule, file, `primaryLocationLineHash`) between the local run and the `develop` analysis at the same commit.

- Record before (the 2026-10-17 numbers) and after.
- If the unmatched share grows by more than 5 percentage points, stop for a decision (the doc's existing threshold).

## Risks / Trade-offs

- **[Auto-detection does not pick up the pack in advanced setup]** (doc claim, not yet observed here) → D3 control/probe pair. The fallback is a `packs:` input with a local path, if the action accepts one; otherwise publish the pack (out of scope, re-plan).
- **[Loading the model closes plugin-route alerts and makes baseline entries stale]** → `--prune` in the merge PR. This is expected and desired; stale entries are listed in the PR body.
- **[Model pack resolution fails on a contributor machine]** → Loud skip (existing policy). `CODEQL_BIN`-less machines already skip.
- **[Reason-grammar change breaks an existing baseline entry]** → A test runs the validator over the current `codeql-baseline.json`.

## Migration Plan

- Merge.
- The first CI scan on `develop` loads the pack. Plugin alerts may close.
- Run `--prune` on the next local run.
- **Rollback:** revert. The model stops loading and closed alerts may re-open on the next scan. Nothing was dismissed by this change.
