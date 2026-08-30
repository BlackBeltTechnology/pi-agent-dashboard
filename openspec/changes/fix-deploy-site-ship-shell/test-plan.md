# Test Plan — fix-deploy-site-ship-shell

Stage: design · Generated 2026-08-13 · **Re-scoped 2026-08-31** after `c52745af0`
replaced the Astro site with a hand-written static page.

Clarifications C1 (malformed-lockfile behaviour) and C2 (post-deploy disposition)
were resolved at the HARD gate before the original catalog was written.

- **C1 → fail closed — SUPERSEDED.** Its subject (the site lockfile and its drift
  guard) was deleted with the Astro site; there is no lockfile to fail closed on.
  The replacement guard is E15 (site stays dependency-free).
- **C2 → manual-only** for post-deploy behaviour. Still stands: F1–F6 observables
  exist only on GitHub Pages / pipeline infrastructure; a local static server
  does not reproduce Pages' root-`404.html` resolution, so automating F4 locally
  would pass for the wrong reason.

Retired with the Astro site (subjects deleted by `c52745af0`): E1–E5 and X1–X2
(site lockfile drift guard — no `site/package-lock.json` exists), E6–E8 and X3
(JS bundle budget — `check-js-size.mjs` deleted, "no bundle budget (there is no
bundle)"). The surviving workflow-parse rows keep their original ids.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E9 | marketing-site · deploy triggers | decision-table | L1 | automated | `.github/workflows/deploy-site.yml` | parse the `push` trigger | `branches` is `[develop]` and never `main`; `paths` includes `site/**`, `packages/shell/**`, and the workflow itself |
| E10 | marketing-site · dead release path absent | state-transition | L1 | automated | `.github/workflows/deploy-site.yml` | parse triggers and the job graph | no `release:` trigger, no `redispatch-on-release` job, and no job gated on `github.event_name != 'release'` — the default Actions token cannot raise a `release` event that starts a run, so all three are unreachable by construction |
| E10a | marketing-site · pipeline dispatches the redeploy | state-transition | L1 | automated | `.github/workflows/publish.yml` | parse the job graph | a terminal job carries `needs: github-release` and invokes `gh workflow run` for both `sync-release-version.yml` and `deploy-site.yml`, each with `--ref develop` (the ref is load-bearing: `github-pages` rejects a tag ref) |
| E10b | marketing-site · dispatches sequenced, not raced | state-transition | L1 | automated | `.github/workflows/publish.yml` | parse the dispatch step body | the `deploy-site.yml` dispatch is preceded by a wait on the `sync-release-version` run — a back-to-back dispatch would let the build check out `develop` before the download-block commit lands, and the page renders either way so nothing else would catch it |
| E11 | marketing-site · release publish updates the download block | decision-table | L1 | automated | `.github/workflows/sync-release-version.yml` | parse the push step | pushes `HEAD:develop`, never `main` |
| E12 | marketing-site · shell composed under /app | EP | L1 | automated | `.github/workflows/deploy-site.yml` | parse step order and targets | a step copies the shell build into `site/dist/app/`, and it precedes the Pages artifact upload |
| E13 | marketing-site · custom domain active | EP | L1 | automated | `site/public/CNAME` | read the file | contents are exactly `pi-dashboard.dev` — guards silent deletion, which would drop the domain without any build failing |
| E14 | marketing-site · manual redeploy | EP | L1 | automated | `.github/workflows/deploy-site.yml` | parse triggers | `workflow_dispatch` is present |
| E15 | ci-cd-pipeline · site stays dependency-free | EP | L1 | automated | `site/package.json` | inspect the dependency maps | `dependencies`, `devDependencies`, and `optionalDependencies` are all absent or empty — the manifest-side half of the dependency-free pin (the workflow side, no `npm ci` returns, is already pinned by `pnpm-migration-contract.test.ts` X6) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | neutral-shell-publication · subpath reachable | live-site verification | — | manual-only | the deployed Pages artifact | `GET https://pi-dashboard.dev/app/` | HTTP 200 serving the shell's `index.html` [Pages-only — C2; verified live 2026-08-31] |
| F2 | neutral-shell-publication · relative asset base | live-site verification | — | manual-only | the same deploy | inspect the shell's script/stylesheet URLs | every asset URL resolves beneath `/app/` and returns 200, none against the apex [Pages-only] |
| F3 | neutral-shell-publication · hash routing | live-site verification | — | manual-only | the same deploy | open `https://pi-dashboard.dev/app/#/pair` directly | the Pair view renders; the fragment never reaches the server [Pages-only] |
| F4 | neutral-shell-publication · no SPA fallback at subpath | live-site verification | — | manual-only | the same deploy | `GET https://pi-dashboard.dev/app/does-not-exist` | the marketing root `404.html` renders, not the shell — confirming the shell's own `404.html` is inert here [Pages-only; verified live 2026-08-31: 404] |
| F5 | marketing-site · apex unaffected | live-site verification | — | manual-only | the same deploy | `GET https://pi-dashboard.dev/` | the marketing site renders, unaffected by the shell under `/app/` [Pages-only; verified live 2026-08-31] |
| F6 | marketing-site · release actually redeploys the site | live-pipeline verification | — | manual-only | the next production `vX.Y.Z` tag | push the tag and take no manual action afterwards | a `sync-release-version` run and a `deploy-site` run both appear without intervention, and `pi-dashboard.dev` advertises the new version [pipeline-only observable: E10/E10a/E10b parse workflow *files* and cannot prove an event actually fired — this row closes that gap and is the reason the release-redeploy work is not "done" when CI is green] |

---

## Coverage summary

- Requirements covered: 6/6 (`neutral-shell-publication` ×4, `marketing-site` ×5 scenario groups across 3 requirements, `ci-cd-pipeline` ×1 dependency-free pin)
- Scenarios by class: edge 9 · perf 0 · frontend 6 · error 0
- Scenarios by level: L1 9 · L2 0 · L3 0 · manual-only 6
- Scenarios by disposition: automated 9 · manual-only 6
- Retired 2026-08-31 (subject deleted by `c52745af0`): E1–E8, X1–X3

## New infra needed

None. Every automated row lands in the existing vitest tier as L1 workflow/manifest
parses: E9–E15 in a new `packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts`
(glue per `pnpm-migration-contract.test.ts`), E10a/E10b extending
`packages/shared/src/__tests__/publish-workflow-contract.test.ts`, which already
parses `publish.yml`.

## Notes

- **`neutral-shell-publication` · "Subpath publication preserves the apex web
  origin" has no row by design.** The CORS behaviour is owned by `server-cors`
  ("Neutral shell origin trusted by default") and is already covered by
  `packages/server/src/__tests__/cors.test.ts`. Adding a row here would duplicate
  an assertion another capability owns — the drift risk D4 exists to prevent. The
  origin-preserving property itself is a browser invariant (a path is not part of
  an origin), not repo behaviour to test.
- **No performance class.** The static page ships vendored, pre-minified JS with
  no bundle and no budget check; the shell's bundle size is recorded in the specs
  as a fact but is not budgeted. Creating a shell-side budget is a separate
  change, not a gap in this one.
- E13 looks trivial and is not: deleting `site/public/CNAME` silently reverts the
  site to a `github.io` host with every build still green, which is precisely the
  kind of silent rot this change exists to stop.
