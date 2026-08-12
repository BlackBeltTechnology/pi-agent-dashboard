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

- **63/63 `unlisted` findings are true positives** (exhaustive check against each
  owning `package.json` and the root manifest): 7 phantom dependencies across 63
  import sites, incl. `node-pty`, `jszip`, `@testing-library/react`.
- **~18/20 of a random `exports`/`types` sample are true positives** (15 with no
  consumer anywhere; 3 more whose apparent "consumers" are independent
  re-declarations, not imports).
- Genuinely orphaned scripts (`scripts/heap-probe.mjs`,
  `scripts/i18n-migrate-auto-keys.mjs`) and an unresolved import in `site/`.

The phantom-dependency class matters most. `nodeLinker: hoisted` is **mandatory**
here (electron-forge hard-fails otherwise), which lets a package import a
dependency it never declared and still resolve — until it is published or
consumed standalone. This is a publishing monorepo; Knip is the only tool in the
ladder that detects this.

The same spike **rejected Semgrep**, which this change originally also proposed.
Semgrep produced 8 findings on 3773 files with a **0/8 true-positive rate**, and
missed the repo's one known, still-open command-injection RCE
(`execSync(\`git checkout ${branch}\`)`, `git-operations.ts:391`) — the exact
vulnerability class it was justified by. Per the original proposal's own exit
criterion, it is dropped rather than adopted for the narrative. Full evidence:
`spike-results.md`.

## What Changes

- **Add Knip** for unused files, exports, types, and dependencies across the
  workspace.
- **Whole-graph, not per-change.** Knip does **not** join the `quality:changed`
  loop; it runs in CI/nightly where its runtime is free and findings batch.
- **Advisory before blocking.** The baseline is not clean, so Knip lands
  non-blocking and gates only after the baseline is resolved.
- **Two distinct remediation paths — never conflated.** The 63 `unlisted`
  findings are true positives and get **fixed in the manifests**; they must not
  be configured away. Separately, genuine graph-blindness (plugin client entries
  making `react-dom` look unused, `.pi/skills/**` scripts, `vitest.config.ts`,
  `public/sw.js`) is taught to Knip via config.
- **Feed Knip's orphans back to the doc tree.** An orphan module and an orphan
  `AGENTS.md` row are the same drift measured from opposite ends. Knip's output
  should be reconcilable with `kb dox lint`'s orphan report rather than being a
  second, unrelated list.
- **Phantom dependencies are fixed here.** Deliberate exception to the
  "cleanup lands separately" ratchet: the 63 `unlisted` findings are true
  positives and a supply-chain hazard, and leaving them would pin the gate to
  advisory forever. The remaining baseline (orphan files, unused exports) still
  lands in its own follow-up cleanup change.
- **Gate blocks on a clean baseline.** Once findings reach zero, Knip flips from
  `continue-on-error` to blocking — the same ratchet shape the other rungs use.

## Capabilities

### New Capabilities

- `dead-code-detection` — the Knip gate: scope, where it runs, its config
  exceptions, when it escalates from advisory to blocking, and how its findings
  reconcile with the documentation tree.

### Modified Capabilities

- `code-quality-loop` — the oracle gains a whole-graph check that deliberately
  does not run per-change.
- `ci-cd-pipeline` — the whole-graph Knip pass needs a home in CI or nightly.
- `kb-dox-tree` — a cross-check script reconciles Knip's orphan-file list against
  `kb dox lint`'s orphan-row report, so module-graph drift and doc-tree drift are
  measured as one thing.

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
  `ci.yml`**, and runs report-only (`continue-on-error: true`) until the
  escalation trigger is met. This is the mechanism that enforces the
  "not blocking on day one" non-goal.
- **Runtime cost measured: 5.59s** whole-workspace (`/usr/bin/time -p`, warm).
  Zero added cost to the local per-change loop.
- Manifest fixes across ~7 packages to resolve the phantom dependencies.
- New cross-check script reconciling Knip orphans with `kb dox lint` orphan rows.
- `docker/` harness gains the Knip pass.
- No new language runtime or non-Node toolchain prerequisite.

## Decisions

Settled before spec deltas were written:

- **Phantom-dependency fixes land in this change**, not the follow-up cleanup.
- **Escalation trigger = clean baseline.** Knip runs `continue-on-error` until
  findings reach zero, then becomes blocking.
- **Reconciliation = a cross-check script** comparing Knip's orphan list against
  `kb dox lint`'s orphan rows (not a manual pass).
- **Knip runs in the Docker harness** as well as nightly CI.

## Open Questions

- **Can Knip's config reach an acceptable signal-to-noise ratio**, or does the
  config grow into a fight? The graph-blindness shapes are enumerated and each
  looks addressable, but if the config balloons that is evidence to drop Knip,
  not to keep tuning.

## Discipline Skills

- `doubt-driven-review` — a new dependency and a new class of CI failure; and the
  advisory→blocking escalation is the kind of decision worth stress-testing
  before it stands.
- `code-simplification` — if Knip's config grows to fight false positives, that
  is evidence to drop it, not to keep tuning.
- `security-hardening` — phantom dependencies are a supply-chain surface
  (an undeclared import resolves to whatever the hoist provides); worth the
  skill's framing when fixing the 63 sites.
