# Test Plan — fix-deploy-site-ship-shell

Stage: design   Generated: 2026-08-13

Clarifications C1 (malformed-lockfile behaviour) and C2 (post-deploy disposition) were resolved at
the HARD gate before this catalog was written — no open markers.

- **C1 → fail closed.** The guard exits non-zero on any lockfile shape it cannot verify. A guard that
  passes on an unreadable lockfile would go green while `npm ci` still dies at deploy — the exact
  vacuous-check failure it exists to prevent. Pinned by X1.
- **C2 → manual-only** for post-deploy behaviour. F1–F5 observables exist only on GitHub Pages
  infrastructure; a local static server does not reproduce Pages' root-`404.html` resolution, so
  automating F4 locally would pass for the wrong reason.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | ci-cd-pipeline · Site lockfile sync | decision-table | L1 | automated | `site/package.json` declares `vitest ^4.0.0` under **devDependencies**; lock `packages[""].devDependencies` omits it | run the site-lockfile check | exit non-zero, message names `vitest` |
| E2 | ci-cd-pipeline · Site lockfile sync | BVA | L1 | automated | manifest declares `astro ^5.2.0`; lock `packages[""]` records `astro ^5.1.1` | run the check | exit non-zero, message names `astro` |
| E3 | ci-cd-pipeline · Site lockfile sync | decision-table (reverse direction) | L1 | automated | lock `packages[""]` records `motion ^11.15.0`; manifest no longer declares it | run the check | exit non-zero, message names `motion` |
| E4 | ci-cd-pipeline · Site lockfile sync | EP nominal | L1 | automated | manifest + lock regenerated together, all three dep maps agreeing | run the check | exit zero, no diagnostics |
| E5 | ci-cd-pipeline · Site lockfile sync | EP | L1 | automated | an `optionalDependencies` entry present in the manifest but absent from the lock | run the check | exit non-zero, message names the entry |
| E6 | neutral-shell-publication · budget exclusion; marketing-site · JS budget | EP | L1 | automated | fixture `site/dist/` holding a 1.00 KB gz site chunk plus a 67.77 KB gz `dist/app/index-*.js` | run the JS budget check | reported total ≈ 1.00 KB and exit zero — the 67.77 KB shell chunk is not counted |
| E7 | marketing-site · budget order independence | invariant | L1 | automated | the E6 fixture, evaluated twice: once with `dist/app/` absent, once present | run the budget check in both states | both runs report an identical total |
| E8 | marketing-site · JS bundle budget | BVA | L1 | automated | site chunks gzipping to exactly 51200 B, then 51201 B | run the budget check | 51200 B exits zero; 51201 B exits non-zero |
| E9 | marketing-site · deploy triggers | decision-table | L1 | automated | `.github/workflows/deploy-site.yml` | parse the `push` trigger | `branches` is `[develop]` and never `main`; `paths` includes both `site/**` and `packages/shell/**` |
| E10 | marketing-site · dead release path absent | state-transition | L1 | automated | `.github/workflows/deploy-site.yml` | parse triggers and the job graph | no `release:` trigger, no `redispatch-on-release` job, and no job gated on `github.event_name != 'release'` — the default Actions token cannot raise a `release` event that starts a run, so all three are unreachable by construction |
| E10a | marketing-site · pipeline dispatches the redeploy | state-transition | L1 | automated | `.github/workflows/publish.yml` | parse the job graph | a terminal job carries `needs: github-release` and invokes `gh workflow run` for both `sync-release-version.yml` and `deploy-site.yml`, each with `--ref develop` (the ref is load-bearing: `github-pages` rejects a tag ref) |
| E10b | marketing-site · dispatches sequenced, not raced | state-transition | L1 | automated | `.github/workflows/publish.yml` | parse the dispatch step body | the `deploy-site.yml` dispatch is preceded by a wait on the `sync-release-version` run — a back-to-back dispatch would let the build check out `develop` before the cache commit lands, and the live API fetch would mask it |
| E11 | marketing-site · release publish updates cache | decision-table | L1 | automated | `.github/workflows/sync-release-version.yml` | parse the push step | pushes `HEAD:develop`, never `main` |
| E12 | marketing-site · shell composed under /app | EP | L1 | automated | `.github/workflows/deploy-site.yml` | parse step order and targets | a step copies the shell build into `site/dist/app/`, and it precedes the Pages artifact upload |
| E13 | marketing-site · custom domain active | EP | L1 | automated | `site/public/CNAME` | read the file | contents are exactly `pi-dashboard.dev` — guards silent deletion, which would drop the domain without any build failing |
| E14 | marketing-site · manual redeploy | EP | L1 | automated | `.github/workflows/deploy-site.yml` | parse triggers | `workflow_dispatch` is present |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | ci-cd-pipeline · Site lockfile sync | fault-injection (corrupt input) | L1 | automated | lockfile that is invalid JSON, or lacks a `packages[""]` entry, or declares a `lockfileVersion` the check cannot read | run the check | exit **non-zero** naming the unsupported/unreadable format. It MUST NOT exit zero: passing on an unverifiable lockfile is the vacuous-guard failure mode (C1) |
| X2 | ci-cd-pipeline · Site lockfile sync | fault-injection (missing dependency) | L1 | automated | `site/package-lock.json` absent entirely | run the check | exit non-zero with an explicit missing-file message, not a stack trace |
| X3 | marketing-site · budget exclusion | fault-injection (missing path) | L1 | automated | `site/dist/` built with no `app/` subdirectory (a site-only local build) | run the JS budget check | exit zero, no crash; total equals the site chunks alone — the exclusion tolerates an absent directory |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | neutral-shell-publication · subpath reachable | live-site verification | — | manual-only | the deployed Pages artifact | `GET https://pi-dashboard.dev/app/` | HTTP 200 serving the shell's `index.html` [Pages-only observable — C2] |
| F2 | neutral-shell-publication · relative asset base | live-site verification | — | manual-only | the same deploy | inspect the shell's script/stylesheet URLs | every asset URL resolves beneath `/app/` and returns 200, none against the apex [Pages-only] |
| F3 | neutral-shell-publication · hash routing | live-site verification | — | manual-only | the same deploy | open `https://pi-dashboard.dev/app/#/pair` directly | the Pair view renders; the fragment never reaches the server [Pages-only] |
| F4 | neutral-shell-publication · no SPA fallback at subpath | live-site verification | — | manual-only | the same deploy | `GET https://pi-dashboard.dev/app/does-not-exist` | the marketing root `404.html` renders, not the shell — confirming the shell's own `404.html` is inert here [Pages-only; a local static server resolves 404s differently and would pass for the wrong reason] |
| F5 | marketing-site · apex unaffected | live-site verification | — | manual-only | the same deploy | `GET https://pi-dashboard.dev/` | the marketing site renders, unaffected by the shell under `/app/` [Pages-only] |
| F6 | marketing-site · release actually redeploys the site | live-pipeline verification | — | manual-only | the next production `vX.Y.Z` tag | push the tag and take no manual action afterwards | a `sync-release-version` run and a `deploy-site` run both appear without intervention, and `pi-dashboard.dev` advertises the new version [pipeline-only observable: E10/E10a/E10b parse workflow *files* and cannot prove an event actually fired — this is the row that closes that gap, and it is the reason the release-redeploy work is not "done" when CI is green] |

---

## Coverage summary

- Requirements covered: 9/9 (`neutral-shell-publication` ×5, `marketing-site` ×3, `ci-cd-pipeline` ×1)
- Scenarios by class: edge 16 · perf 0 · frontend 6 · error 3
- Scenarios by level: L1 19 · L2 0 · L3 0 · manual-only 6
- Scenarios by disposition: automated 19 · manual-only 6

## New infra needed

None. Every automated row lands in the existing vitest tier; the workflow-parsing rows follow
`packages/shared/src/__tests__/pnpm-migration-contract.test.ts`, which already parses
`deploy-site.yml`. E10a/E10b parse `publish.yml`, for which
`packages/shared/src/__tests__/publish-workflow-contract.test.ts` is the established precedent.

## Notes

- **`neutral-shell-publication` · "Subpath publication preserves the apex web origin" has no row by
  design.** The CORS behaviour is owned by `server-cors` ("Neutral shell origin trusted by default")
  and is already covered by `packages/server/src/__tests__/cors.test.ts`. Adding a row here would
  duplicate an assertion that another capability owns — the drift risk D4 exists to prevent. The
  origin-preserving property itself is a browser invariant (a path is not part of an origin), not
  repo behaviour to test.
- **No performance class.** No requirement in this change states a latency, throughput, or memory
  threshold. The shell's own bundle size (67.77 KB gz, measured 2026-08-13) is recorded in the specs
  as a fact but is not budgeted — there is no shell-side size requirement to test against. Creating
  one is a separate change, not a gap in this one.
- E13 looks trivial and is not: deleting `site/public/CNAME` silently reverts the site to a
  `github.io` host with every build still green, which is precisely the kind of silent rot this
  change exists to stop.
