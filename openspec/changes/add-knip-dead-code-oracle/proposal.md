# Add Knip as the dead-code oracle

## Why

After the first four rungs, the local gate covers syntax, types, behaviour,
promise semantics, module structure, and semantic review. One blind spot has a
measured case for closing: **dead code**.

36 packages, heavy AI-authored churn, and a documentation doctrine that requires
a per-file row for every file. Orphaned modules and unused exports accumulate
silently, and each one costs twice: once in the tree, once in the `AGENTS.md`
row that must be maintained for it. Nothing currently detects them.

A measurement run (`spike-results.md`) confirms real signal, triaged with the
same standard used to reject Semgrep — not a raw count:

- **10/10 unused-file findings are true positives** (exhaustive, exact
  import-specifier resolution).
- **17/20 of a random `exports`/`types` sample are true positives** — and the 3
  apparent consumers are name *collisions* (independent re-declarations in other
  files), so effectively 20/20.
- Baseline: **10 unused files, 227 unused exports, 189 unused types,
  11 duplicates (437 total)**, measured at **9.78s** whole-workspace.

The first spike run was **invalid** and its numbers are withdrawn: it ran with no
`knip.json`, so the graph was never rooted and reachable files were reported dead.
Rooting it via the project's own manifest conventions moved the baseline
723 → 437 and the unused-file class 90 → 10, turning a 25%-precision class into a
100%-precision one. The measured config is preserved at `spike/knip.json`.

**Nothing in the ladder detects these.** Verified in `biome.json`:
`noUnusedImports` and `noUnusedVariables` are `warn` and **file-local only** —
Biome has no whole-graph unused-export or unused-file rule. Reachability across
a 36-package workspace is exactly the question a file-local linter cannot answer.

**Dependency hygiene is explicitly NOT the case for Knip.** That class is already
owned by Biome's `noUndeclaredDependencies` (`error`, repo-root scope, currently
zero findings) under the ratified `code-quality-loop` requirement
*"Undeclared-dependency findings reach zero at repo-root scope"*. An earlier
revision of this proposal argued the opposite and was wrong; see the correction
in `spike-results.md`.

The same spike **rejected Semgrep**, which this change originally also proposed.
Semgrep produced 8 findings on 3773 files with a **0/8 true-positive rate**, and
missed the repo's one known, still-open command-injection RCE
(`execSync(\`git checkout ${branch}\`)`, `git-operations.ts:391`) — the exact
vulnerability class it was justified by. Per the original proposal's own exit
criterion, it is dropped rather than adopted for the narrative. Full evidence:
`spike-results.md`.

## What Changes

- **Add Knip** for unused files, exports, and types across the workspace.
  Dependency classes are out of scope (see below).
- **Whole-graph, not per-change.** Knip does **not** join the `quality:changed`
  loop; it runs in CI/nightly where its runtime is free and findings batch.

- **Config teaches graph shape.** Genuine graph-blindness (plugin client entries
  making `react-dom` look unused, `.pi/skills/**` scripts, `vitest.config.ts`,
  `public/sw.js`) is resolved by declaring entry points — not by ignoring
  findings.
- **Feed Knip's orphans back to the doc tree.** An orphan module and an orphan
  `AGENTS.md` row are the same drift measured from opposite ends. Knip's output
  should be reconcilable with `kb dox lint`'s orphan report rather than being a
  second, unrelated list.
- **Every dependency class is disabled in `knip.json`.** Biome already gates
  undeclared dependencies; running both would re-report findings the project
  deliberately exempted. One rule, one owner.
- **Entry points are generated from the project's manifests**
  (`pi-dashboard-plugin.{client,server,bridge}`, `pi.extensions`, `bin`,
  `exports`) so the config cannot drift from reality — the defect that made the
  first measurement worthless.
- **Per-class baseline ratchet**, not a single total: a drop in one class must
  not mask a regression in another, and raising a baseline is rejected outright.
- **The gate runs in the `ship-it` enforcer step**, which is where this repo can
  actually prevent a regression from landing. Nightly also runs it, but nightly
  is after merge — detection, not prevention.
- **Cleanup lands separately.** The 437 baseline findings are fixed in their own
  follow-up change, not bundled into the change that installs the tool.

## Capabilities

### New Capabilities

- `dead-code-detection` — the Knip gate: scope, where it runs, its config
  exceptions, the baseline-ratchet gate, and how its findings reconcile with the
  documentation tree.

### Modified Capabilities

- `code-quality-loop` — the oracle gains a whole-graph check that deliberately
  does not run per-change.
- `ci-cd-pipeline` — the whole-graph Knip pass needs a home in CI or nightly.
(`kb-dox-tree` is intentionally not modified — see the cross-check decision below.)

## Non-Goals

- **Semgrep, SAST, or any taint analysis** — measured and rejected; see
  `spike-results.md`. The security gap it was meant to close is real, but
  Semgrep does not close it on this codebase. Addressing that gap is a separate,
  separately-measured change.
- Adding Knip to the per-change loop. It is whole-graph; forcing it into
  `--changed` scope would make it both slow and wrong.
- Fixing the baseline debt Knip surfaces (separate cleanup change).
- Making Knip blocking on day one, before its false-positive shapes are configured
  away.

## Impact

- `package.json` — one new devDependency plus scripts.
- New config: `knip.json` (workspace-aware, with documented exceptions for the
  pnpm-hoisting, plugin-entry, and skill-script shapes the spike found).
- `.github/workflows/nightly.yml` — the whole-graph pass lands in **nightly, not
  `ci.yml`**, invoking the ratchet check.
- **Runtime cost measured: 9.78s** whole-workspace (`/usr/bin/time -p`, warm),
  added to the ship enforcer step. Zero added cost to `quality:changed`.
- A committed per-class baseline alongside `knip.json`.
- `scripts/knip-config.mjs` generating entries from package manifests.
- A new ratchet enforcer wired into `ship-it` step 4.4.
- **No manifest edits** — dependency hygiene stays with Biome.
- Ongoing cost: the config must be regenerated whenever a package adds a
  `pi-dashboard-plugin` or `pi.extensions` entry.
- `docker/` harness gains the Knip pass.
- No new language runtime or non-Node toolchain prerequisite.

## Decisions

Settled before spec deltas were written:

- **Dependency classes disabled**, deferred entirely to Biome's
  `noUndeclaredDependencies`. No manifest edits in this change.
- **Gating = per-class baseline ratchet**, enforced at the `ship-it` enforcer
  step; nightly reports the same check.
- **The kb-dox orphan cross-check is dropped** from this change. `dox lint`'s
  `orphan` means a row pointing at a **deleted** file, while Knip's unused-file
  means the file **exists but nothing imports it** — disjoint sets, so the
  original scenarios were unconstructible. Deferred to its own change, to be
  defined against the `missing` category instead.
- **Reconciliation = a cross-check script** comparing Knip's orphan list against
  `kb dox lint`'s orphan rows (not a manual pass).
- **Knip runs in the Docker harness** as well as nightly CI.

## Open Questions

- **Can Knip's config reach an acceptable signal-to-noise ratio**, or does the
  config grow into a fight? The graph-blindness shapes are enumerated and each
  looks addressable, but if the config balloons that is evidence to drop Knip,
  not to keep tuning.

## Discipline Skills

- `doubt-driven-review` — a new dependency and a new class of CI failure; the
  ratchet's shape and the place the gate actually runs are worth stress-testing
  before they stand.
- `code-simplification` — if Knip's config grows to fight false positives, that
  is evidence to drop it, not to keep tuning.
- `performance-optimization` — the CI budget (measured 5.59s) should stay
  measured rather than assumed as the workspace grows.
