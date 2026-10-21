# Design

## Context

See proposal.md (Why) and `evidence/model-match-probe.md`. Code facts:

- **Model file.** `.github/codeql/extensions/cwd-guard.model.yml:35-52` has:
  - a `barrierGuardModel` block of 4-tuples (`isPortableProjectName`, `isAllowedCwd`, `admissionAllows`, `tokenAllows`), each with an unquoted `….js` type and a bare type;
  - a `barrierModel` block of 3-tuples (`admitCwd`, `.js` and bare).

  `packages/shared/src/__tests__/bundled-plugins-complete.test.ts:157` reads it at that path.
- **Type parsing.** `parseTypeString` (`codeql/javascript-all@2.10.3`, `ApiGraphModelsSpecific.qll:45-50`): `('[^']+'|[^.]+)(.*)`.
  - It also supports `file:<path>` types for repo-local modules (`:56-61`). Not needed: the probes show package rows apply under workspace resolution.
- **CI.** `.github/workflows/codeql.yml:38-45` (`codeql-action/init@v4`, `config-file:` only) auto-loads the file as `generated/extension-pack@0.0.0` (archived evidence, row g). Its query/library packs are not pinned in the workflow.
- **Local analysis.**
  - `scripts/codeql-local.mjs:670` runs `database analyze … --threat-model=remote` with no pack flags.
  - `ensurePacks` (`:612`) resolves query packs offline; when unavailable it throws `Skip`.
  - `mustRun` (`:592`) gives exit 2 on any other failure.
- **Snapshot.** `takeSnapshot` (`:396`) builds the tree from a temporary index (`git add -A`), so it includes uncommitted and untracked-unignored bytes. `materializeSnapshot` writes `<run>/src` via `checkout-index`; that directory is not a git repository.
- **Reason validation.** `reasonError` (`:123-135`). `REASON_DISMISSED` already accepts `(#12, #13, won't fix)` but also `(#12, x)`.
- **Mirror template.** `modeTriage` (`:837-860`) and `parseArgs` (`:895-906`).
- **`resolve extensions` output.** JSON, one object per (predicate, file) with `rowCount`. It exits 0 even when no queries are given, so the exit code alone is meaningless (checked with CLI 2.27.2).

## Goals / Non-Goals

**Goals:**
- The model applies in CI and locally, proven on the real repository.
- Mirroring that GitHub verifies.

**Non-Goals:** see proposal.

## Decisions

### D0 — Quote dotted type strings in the model
Every type value containing a `.` is written as `"'<type>'"` (single quotes inside the YAML string). Bare (dot-free) rows stay, as they are harmless.

- **Contract test (syntactic).** For every `.github/codeql/extensions/*.model.yml`, any type value containing `.` must be wrapped in single quotes. The test comment cites `parseTypeString` at the pinned `javascript-all@2.10.3`, to be re-checked on library upgrade.
- **Proof.** `rowCount` from `resolve extensions` is identical for quoted and unquoted rows, so it proves only loading. Matching is proven behaviourally: `evidence/model-match-probe.md` and D3.
- **Existing test.** `packages/shared/src/__tests__/bundled-plugins-complete.test.ts:157-186` matches `r[0] === module`. Its matcher strips one pair of surrounding single quotes.
- **Namespace imports.** `import * as G` + `G.isAllowedCwd` was not suppressed with the rows tried (evidence). No production namespace import exists. Recorded as a limitation in the docs.
- *Alternative:* `file:<path>` types. Rejected: package rows work (probe), and file types would tie the model to repo paths.

### D1 — Local wrapper model pack from the committed model files
After snapshot materialisation, the script writes `<run>/model-pack/codeql-pack.yml`:

```yaml
name: pi-dashboard/local-models
version: 0.0.0
library: true
extensionTargets: { codeql/javascript-all: "*" }
dataExtensions: ["*.model.yml"]
```

- **Model file contents come from the snapshot** (`<run>/src/.github/codeql/extensions/*.model.yml`), the same tree the analysis sees.
  - An uncommitted model edit is analyzed locally like any uncommitted code, and CI applies the same bytes once committed.
  - *Rejected:* `HEAD`-only bytes with exit 2 on a dirty model. ship-it runs 4.4b before `ship-change` commits, so every change that edits the model (this one, `core-cwd-admission`) would block.
- **Only the `javascript-typescript` `database analyze`** gets `--additional-packs=<run>/model-pack --model-packs=pi-dashboard/local-models`.
- **The wrapper lives under `<run>/`**, outside `<run>/src`. The working tree and snapshot id are untouched.
- **A contract test asserts `.github/codeql/extensions/` holds no `.yml` other than `*.model.yml`** (and `codeql-pack.yml`, should one ever be added). CI's auto-detection of the bare file is observed (`generated/extension-pack@0.0.0`, archived row g); its exact file glob is unverified. Restricting the directory keeps the local copy and CI from diverging.
- **`--json` `versions.models`** = sha256 over the copied files, concatenated in byte-wise sorted path order.

### D2 — Model-pack pre-resolution; any failure is exit 2
After `ensurePacks`, run:

```
codeql resolve extensions --additional-packs=<run>/model-pack --model-packs=pi-dashboard/local-models -- codeql/javascript-queries@<ver>:<suite>
```

It runs offline. Parse the JSON. For every copied file, the summed `rowCount` across predicates must equal the number of data rows in that file's YAML; this is a presence check only (see D0). Otherwise exit 2 naming the pack. A non-zero exit or unparsable output is also exit 2.

- There is **no new skip cause**. `javascript-all` is vendored inside the cached query pack (`~/.codeql/packages/codeql/javascript-queries/2.4.7/.codeql/libraries/codeql/javascript-all/2.10.3`), so a resolvable query pack implies a resolvable library. A skip would disarm the whole JavaScript gate.
- Fake-`CODEQL_BIN` fixtures are captured from the real CLI output.

### D3 — Spike on the real repository (throwaway branches; must pass before merge)
The probe file `packages/server/src/codeql-probe-routes.ts` creates its **own** `Fastify()` and calls `app.get(...)` directly; a registrar's parameter is not resolvable (archived evidence, cause 2). It is not imported by production code. Routes:

- `GET /probe/guarded` reads `fs` only inside `if (isAllowedCwd(q.cwd, known))`. The guard is imported from `@blackbelt-technology/pi-dashboard-shared/cwd-guard.js`.
- `GET /probe/unguarded` is the same without the guard.
- **One guarded/unguarded pair per newly activated predicate:**
  - `isAllowedCwd`;
  - `admissionAllows` (after `await admitCwd`);
  - `tokenAllows`;
  - `isPortableProjectName` (joined name);
  - `admitCwd` as a barrier on its argument.
- **A negative case:** an `admitCwd(c)` result that is never branched on, followed by a sink on `c`. It must stay reported, which proves the barrier stops taint only at the argument node.
- **Nested fixture:** `packages/x/spike/b.mjs` with a flagged pattern. It must stay reported once `spike/**` is ignored, giving the CI proof of root-only exclusion.

| Branch | Contents | Expect CI | Expect local |
|---|---|---|---|
| control | `develop` + probe | every probe sink reported (unquoted model) | every probe sink reported (no model) |
| probe | control + this change's code and config commits. **No prune commit B.** | unguarded twins + negative case + nested spike only | same |

- **Pass:** every cell matches. **Inconclusive** (zero probe results, or the unguarded twin missing) fails the gate.
- **Recording.** `openspec/changes/codeql-model-pack-and-mirror/evidence/spike.md` records the probe source, run URLs, local `--json` excerpts, and both sides' SARIF tool and pack versions. The pass condition requires equal `javascript-all` versions on both sides; otherwise re-run. It is committed in this change's PR before the branches are deleted.
- After deletion, confirm the probe alerts on GitHub are closed or absent for `develop`.
- **On failure:** `systematic-debugging`. Compare against `evidence/model-match-probe.md`.

### D4 — `--mirror-dismissal` verifies against GitHub
Invocation: `--mirror-dismissal <ruleId> <file> <lineHash> --alert <n>[,<n>…]`. It refuses `--json`, `--reason`, `--prune`, `--accept`, `--triage`, `--write-baseline`, `--check-baseline-diff` and `--no-growth`. `--alert` without the mode is an error. It runs under the lock.

1. **Alert list.** Positive integers, no duplicates, exactly as many as the entry's count.
2. **Recorded run.** It must exist for the current snapshot and carry a baseline hash; a legacy record without a hash refuses. The run record (`scripts/codeql-local.mjs:723`) gains `headCommit` (`git rev-parse HEAD`) and `clean`: true iff `git status --porcelain` lists nothing other than `codeql-baseline.json`, untracked files included. Mirroring requires `clean: true`. The record gives the key's start-line multiset M and the commit `headCommit`. The commit compared is the **default-branch** analysis commit. In practice the operator checks out the `develop` commit GitHub last analysed (not a PR head), runs the analysis, then mirrors. The procedure is owned by `triage-codeql-alert-debt`.
3. **Entry.** It must exist with an `operator-authz:`, `false-positive:` or `accepted-risk:` reason.
4. **Repository.** owner/repo from `git remote get-url origin`, normalised (optional trailing `/` and `.git`). Accepted forms: `git@github.com:o/r`, `ssh://git@github.com/o/r`, `https://github.com/o/r`. owner and repo must match `^[A-Za-z0-9_.-]+$` and must not be `.` or `..`. Anything else refuses. Not reused: `parseRemoteUrl` (`packages/extension/src/git-link-builder.ts`, spec `bridge-session-state-poll`) is TypeScript that the plain-`.mjs` script cannot import, and it is lenient by design (display links); this parser is a security boundary for an API path. Alerts are read from the origin repository; with a fork origin the alert reads fail (404) and the mirror refuses, so the docs say to run it from an upstream clone.
5. **Per alert.** `execFileSync("gh", ["api", "repos/o/r/code-scanning/alerts/<n>"], {timeout})`, with `timeout` = `PI_CODEQL_GH_TIMEOUT_MS` (a positive integer; default 15000; any other value refuses), argv only and no shell. The test override is `PI_CODEQL_GH_BIN`, an explicit binary path trusted like `CODEQL_BIN` (operator-controlled environment) and checked for `X_OK` like `findCodeql` (`:563-580`). Require:
   - `state == "dismissed"`;
   - `rule.id == ruleId`;
   - `most_recent_instance.location.path == file`;
   - `most_recent_instance.commit_sha` == the recorded commit;
   - one shared `dismissed_reason`;
   - the multiset of `most_recent_instance.location.start_line` equal to M.

   The field shape is pinned by a recorded fixture; a missing field refuses.
6. **Write** `github-dismissed (#n[, #m…], <dismissed_reason>): <original reason>`. Re-record the hash only when the recorded run matches the pre-write baseline (as `modeTriage`).
7. **Every failed check is exit 2** with the baseline unchanged.

**Validator.** `REASON_DISMISSED` becomes `^github-dismissed \((#[1-9][0-9]*)(, #[1-9][0-9]*)*, (false positive|won't fix|used in tests)\): \S`. All 54 existing `github-dismissed` reasons match it (verified in review). A test sweeps the current `codeql-baseline.json`.

**Ownership.** This change owns the mirror CLI. The `core-cwd-admission` stub's older D6 is superseded.

### D5 — `spike/**` and the prune commits
- **Proof first.** The opt-in real-analysis test (`scripts/__tests__/codeql-local-real.test.mjs`) gains fixtures `spike/a.mjs` and `packages/x/spike/b.mjs` with a flagged pattern. It runs with an injected temporary config containing `spike/**` (the harness's `REAL_CONFIG`, `scripts/__tests__/fixtures/codeql-harness.mjs:15`, has none yet). Only `b.mjs` may be reported. The config edit is gated on it. The CI side is proven by D3's nested fixture.
- **Mapping.** `spike/**` becomes the extractor filter `exclude:spike` (`indexFilters`, `:353-356`). This is an explicit exception to "non-test scripts stay analyzed": root `spike/` holds throwaway experiments, including `spike/perchild-cost-spike.mjs`.
- **Prune sequence.** analysis run → `--prune` → `--check-baseline-diff origin/develop`.
- **Commit A lands first:** the `spike/**` config edit plus a prune run *before* the model fix and local loading exist. `--prune` cannot filter by path, but at that point only `spike/` entries can be stale.
- **Commit B:** entries the fixed model closes, with before/after counts in the message, only after the D3 gate passes. If none closed, record that in the PR body and skip the commit. GitHub-side alert state is observed and recorded in `evidence/spike.md`; it does not drive the local prune.

### D6 — Parity record (follow-up issue, not a task)
At merge, a follow-up issue is filed. This is a PR-body / migration step, not a `tasks.md` checkbox. It asks for the first post-merge `develop` analysis to be compared with a local run at the **same commit SHA**: share = unmatched local results ÷ local results, compared only when both sides' `javascript-all` versions match. Numbers go to `docs/code-quality.md`.

The doc's existing "> 5 % → stop" rule governs *seeding*, not this record; the doc states the distinction (task 5.1). A share more than 5 points above the post-switch value opens a further issue. Because this is an issue and not a `tasks.md` checkbox, ship-change's manifest-aware defer is unaffected.

## Risks / Trade-offs

- **[A corrected model hides a real flow]** The fix activates five predicates for the first time. The guards are the documented admission checks (`plugin-cwd-admission`, `kb-plugin-cwd-guard`). Mitigations:
  - D3 covers each predicate, plus the unchecked-`admitCwd` negative case.
  - Commit B lists every closed entry for review.
- **[Hand-edited `github-dismissed` reason]** It passes `--check-baseline-diff` (same-count rewrite). Unchanged from today; documented.
- **[CI's auto-generated pack differs from the local wrapper]** → Same bytes (`HEAD`). D3 requires equal `javascript-all` versions.
- **[`gh` missing]** → Mirror refuses. Analysis, prune and accept are unaffected.
- **[Validator tightening rejects an existing entry]** → A baseline-sweep test runs in group 2 before the validator change.
- **[Prune commits collide with other branches]** → Small separate commits that only lower entries, which the diff check always allows.

## Migration Plan

- **Order:**
  1. D5 proof test, then the `spike/**` config + prune commit A.
  2. Model fix, local loading and mirror commits.
  3. D3 spike passes.
  4. Prune commit B (if any).
  5. Docs.
  6. Merge; file the D6 follow-up issue (PR body).
- **Rollback:** revert all commits in reverse order. Nothing is dismissed on GitHub by this change.
