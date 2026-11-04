# CI anchor proof (task 3.20, test-plan X2) — 2026-11-03

## PR #1109 CodeQL run (run 41741458538, CLI 2.27.4)

- Anchor extracted in CI (build-mode none, no `node_modules`): log `Extracting …/scripts/codeql-anchor/plugin-routes.mjs` → `Done extracting … (35 ms)`.
- PR analyses (`refs/pull/1109/merge`, commit `cdba0debe`): `results_count` js 0, actions 0, python 0. Open PR alerts: 0.
- Cause: codeql-action runs DIFF-INFORMED on pull requests ("Computing PR diff ranges… Persisted 76 diff range(s) across 27 file(s)", "Generating diff range extension pack"). PR results are restricted to changed lines.
- The anchored sinks live in files this PR does not change (team-plugin `paths.ts`/`records.ts`, automation `run-store.ts`/`automation-writer.ts`). By construction a PR run cannot show them, so the design's pre-merge gate (≥1 team-plugin `js/path-injection` PR alert) can't be met.
- Develop for comparison (`fb9a5af35`): js `results_count` 63.

## Decision (owner, 2026-11-03)

- Pre-merge proof = local run on a snapshot WITHOUT `node_modules`. The snapshot excludes git-ignored files, the same condition as CI build-mode none.
  - Local result: 17 recovered, incl. team-plugin `js/path-injection` at `paths.ts:150-153` and `records.ts:65/79/99/109`. See `spike-hidden-results.md` "Implementation run".
  - Local CLI 2.27.2 vs CI 2.27.4; packs pinned locally (`javascript-queries` 2.4.7).
- CI confirmation moves post-merge to #1059: the first `develop` push analysis after merge must show ≥1 team-plugin `js/path-injection` alert. Record the full set there and compare to the 17.
- If develop recovers 0 → D2 fallback as a follow-up change (remove the anchor, its contract test and the anchor baseline entries; drop the ADDED requirement). #1062 is unaffected.
