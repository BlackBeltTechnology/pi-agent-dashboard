## 1. Unblock the pipeline

- [ ] 1.1 Regenerate `site/package-lock.json` via `cd site && npm install`, then verify `npm ci` resolves from a clean `node_modules`
- [ ] 1.2 Record which dependencies floated forward in the regeneration (the lock was last written 2026-04-19), so a later failure can be attributed rather than guessed
- [ ] 1.3 Run `cd site && npm run build` and confirm `astro build` succeeds against the floated dependency set
- [ ] 1.4 Run `cd site && npm run size` and record the actual gzipped total — if it exceeds 50 KB the change is no longer mechanical and must pause for a budget decision before proceeding
- [ ] 1.5 Pin any specific dependency that proves hostile in 1.3/1.4, in reaction to observed evidence rather than pre-emptively (design D6)

## 1b. Restore the release-triggered redeploy (design D8)

- [ ] 1b.1 Add a terminal job to `.github/workflows/publish.yml` gated on `needs: github-release` that dispatches `sync-release-version.yml --ref develop`, waits for that run to complete, then dispatches `deploy-site.yml --ref develop`
- [ ] 1b.2 Delete the `release:` trigger, the `redispatch-on-release` job, and the now-dead `if: github.event_name != 'release'` guard on the `build` job in `.github/workflows/deploy-site.yml`; keep `workflow_dispatch` and the `push` path filters
- [ ] 1b.3 Correct the stale docstring in `site/src/lib/github-release.ts`, which tells the reader "The deploy-site workflow also triggers on `release: { types: [published] }` so each new release rebuilds and redeploys the site" — the mechanism it names is exactly the one being deleted
- [ ] 1b.4 Confirm the sequencing is real rather than assumed: the cache commit lands on `develop` before the deploy run checks it out (a back-to-back dispatch races, and the failure is silent because the live API fetch masks a stale cache)

## 2. Scope the JS budget to the marketing site

- [ ] 2.1 Exclude everything under `dist/app/` from the recursive walk in `site/scripts/check-js-size.mjs` (design D1)
- [ ] 2.2 Author test: budget excludes the shell artifact — see `packages/shared/src/__tests__/pnpm-migration-contract.test.ts` for fixture+parse harness glue. Triple: fixture `site/dist/` with a 1.00 KB gz site chunk plus a 67.77 KB gz `dist/app/index-*.js` · run the JS budget check · reported total ≈ 1.00 KB and exit zero, shell chunk uncounted (test-plan #E6)
- [ ] 2.3 Author test: budget is order-independent — see `packages/shared/src/__tests__/pnpm-migration-contract.test.ts`. Triple: the E6 fixture evaluated with `dist/app/` absent, then present · run the budget check in both states · both runs report an identical total (test-plan #E7)
- [ ] 2.4 Author test: budget boundary — see `packages/shared/src/__tests__/pnpm-migration-contract.test.ts`. Triple: site chunks gzipping to exactly 51200 B, then 51201 B · run the budget check · 51200 B exits zero, 51201 B exits non-zero (test-plan #E8)
- [ ] 2.5 Author test: exclusion tolerates an absent directory — see `packages/shared/src/__tests__/pnpm-migration-contract.test.ts`. Triple: `site/dist/` built with no `app/` subdirectory · run the JS budget check · exit zero, no crash, total equals the site chunks alone (test-plan #X3)

## 3. Site lockfile drift guard

- [ ] 3.1 Write `scripts/check-site-lockfile.mjs` doing a structural compare of `packages[""]`'s dependency maps against `site/package.json` — no semver evaluation, no new dependency (design D3)
- [ ] 3.2 Cover `dependencies`, `devDependencies` and `optionalDependencies`; a guard scoped to `dependencies` alone would pass on the `vitest` drift that caused this outage
- [ ] 3.3 Fail closed on any lockfile shape the check cannot verify — invalid JSON, missing `packages[""]`, or an unreadable `lockfileVersion` (clarification C1)
- [ ] 3.4 Wire one step invoking it into `.github/workflows/ci.yml`, beside the existing `verify-release-deps.mjs` / `check-skill-frontmatter.mjs` / `verify-published-imports.mjs` gates
- [ ] 3.5 Author test: devDependency drift is caught — see `packages/shared/src/__tests__/pnpm-migration-contract.test.ts`. Triple: manifest declares `vitest ^4.0.0` under devDependencies, lock `packages[""].devDependencies` omits it · run the check · exit non-zero naming `vitest` (test-plan #E1)
- [ ] 3.6 Author test: range-only drift is caught — see `packages/shared/src/__tests__/pnpm-migration-contract.test.ts`. Triple: manifest declares `astro ^5.2.0`, lock records `astro ^5.1.1` · run the check · exit non-zero naming `astro` (test-plan #E2)
- [ ] 3.7 Author test: removal drift is caught in the reverse direction — see `packages/shared/src/__tests__/pnpm-migration-contract.test.ts`. Triple: lock records `motion ^11.15.0`, manifest no longer declares it · run the check · exit non-zero naming `motion` (test-plan #E3)
- [ ] 3.8 Author test: a synchronized pair passes — see `packages/shared/src/__tests__/pnpm-migration-contract.test.ts`. Triple: manifest and lock regenerated together, all three dep maps agreeing · run the check · exit zero with no diagnostics (test-plan #E4)
- [ ] 3.9 Author test: optionalDependencies are covered — see `packages/shared/src/__tests__/pnpm-migration-contract.test.ts`. Triple: an `optionalDependencies` entry present in the manifest but absent from the lock · run the check · exit non-zero naming the entry (test-plan #E5)
- [ ] 3.10 Author test: malformed lockfile fails closed — see `packages/shared/src/__tests__/pnpm-migration-contract.test.ts`. Triple: lockfile that is invalid JSON, or lacks `packages[""]`, or declares an unreadable `lockfileVersion` · run the check · exit non-zero naming the unsupported format, never exit zero (test-plan #X1)
- [ ] 3.11 Author test: missing lockfile fails legibly — see `packages/shared/src/__tests__/pnpm-migration-contract.test.ts`. Triple: `site/package-lock.json` absent entirely · run the check · exit non-zero with an explicit missing-file message, not a stack trace (test-plan #X2)
- [ ] 3.12 Verify the guard end to end: deliberately drift the lockfile, confirm CI fails; restore it, confirm CI passes

## 4. Workflow contract assertions

- [ ] 4.1 Author test: deploy triggers on site and shell paths — see `packages/shared/src/__tests__/pnpm-migration-contract.test.ts`, which already parses `deploy-site.yml`. Triple: `.github/workflows/deploy-site.yml` · parse the `push` trigger · `branches` is `[develop]` and never `main`, `paths` includes both `site/**` and `packages/shell/**` (test-plan #E9)
- [ ] 4.2 Author test: the dead release path is absent — see `packages/shared/src/__tests__/pnpm-migration-contract.test.ts`. Triple: `deploy-site.yml` · parse triggers and the job graph · no `release:` trigger, no `redispatch-on-release` job, no job gated on `github.event_name != 'release'` (test-plan #E10)
- [ ] 4.2a Author test: the release pipeline dispatches the redeploy — see `packages/shared/src/__tests__/publish-workflow-contract.test.ts`, which already parses `publish.yml`. Triple: `publish.yml` · parse the job graph · a terminal job carries `needs: github-release` and invokes `gh workflow run` for both `sync-release-version.yml` and `deploy-site.yml`, each with `--ref develop` (test-plan #E10a)
- [ ] 4.2b Author test: the dispatches are sequenced, not raced — see `packages/shared/src/__tests__/publish-workflow-contract.test.ts`. Triple: `publish.yml` · parse the dispatch step body · the `deploy-site.yml` dispatch is preceded by a wait on the `sync-release-version` run, so the build cannot observe a pre-sync cache (test-plan #E10b)
- [ ] 4.3 Author test: release-version sync targets develop — see `packages/shared/src/__tests__/pnpm-migration-contract.test.ts`. Triple: `.github/workflows/sync-release-version.yml` · parse the push step · pushes `HEAD:develop`, never `main` (test-plan #E11)
- [ ] 4.4 Author test: shell is composed into the artifact — see `packages/shared/src/__tests__/pnpm-migration-contract.test.ts`. Triple: `deploy-site.yml` · parse step order and targets · a step copies the shell build into `site/dist/app/` and precedes the Pages artifact upload (test-plan #E12)
- [ ] 4.5 Author test: custom domain file is present — see `packages/shared/src/__tests__/pnpm-migration-contract.test.ts`. Triple: `site/public/CNAME` · read the file · contents are exactly `pi-dashboard.dev` (test-plan #E13)
- [ ] 4.6 Author test: manual redeploy stays available — see `packages/shared/src/__tests__/pnpm-migration-contract.test.ts`. Triple: `deploy-site.yml` · parse triggers · `workflow_dispatch` is present (test-plan #E14)

## 5. Specs

- [ ] 5.1 Land the `marketing-site` delta correcting all five stale scenarios and scoping the JS budget
- [ ] 5.2 Land the new `neutral-shell-publication` capability spec
- [ ] 5.3 Land the `ci-cd-pipeline` delta adding the site-lockfile requirement
- [ ] 5.4 Confirm no requirement duplicates `server-cors`'s ownership of the neutral-shell CORS origin (design D4)

## 6. Deploy and verify

- [ ] 6.1 Merge to `develop` and confirm `Deploy Site` fires on the `site/**` path filter
- [ ] 6.2 Watch the run past step 4 — steps 5–12 have never executed in their current form, so treat the first green attempt as a debugging session, not a formality (design Risks)
- [ ] 6.3 Verify the shell is reachable after deploy (test-plan: manual-only) — `GET https://pi-dashboard.dev/app/` returns 200 serving the shell's `index.html` (test-plan #F1)
- [ ] 6.4 Verify assets resolve beneath the subpath (test-plan: manual-only) — every shell script/stylesheet URL resolves under `/app/` and returns 200, none against the apex (test-plan #F2)
- [ ] 6.5 Verify a hash deep link loads the shell (test-plan: manual-only) — opening `https://pi-dashboard.dev/app/#/pair` renders the Pair view (test-plan #F3)
- [ ] 6.6 Verify the 404 fallthrough is as specified (test-plan: manual-only) — `GET https://pi-dashboard.dev/app/does-not-exist` renders the marketing root 404, not the shell (test-plan #F4)
- [ ] 6.7 Verify the apex is unaffected (test-plan: manual-only) — `GET https://pi-dashboard.dev/` renders the marketing site (test-plan #F5)
- [ ] 6.8 Pair a real device against the deployed shell over an https endpoint, confirming the change achieved its actual goal rather than merely turning CI green
- [ ] 6.9 Close the verification gap on the next real release: every release-redeploy assertion in section 4 is an L1 workflow-file parse, which cannot prove a release actually redeploys the site. On the next `vX.Y.Z` tag, confirm without manual intervention that a `sync-release-version` run and a `deploy-site` run both appear, and that `pi-dashboard.dev` advertises the new version (test-plan #F6)

## 7. Follow-ups to file, not fix here

- [ ] 7.1 File the one-line correction to the `spa404Fallback` docstring in `packages/shell/vite.config.ts`, which claims Pages serves the SPA shell for any unknown path — false for this subpath deployment (design D5)
- [ ] 7.2 File the correction of `ci-cd-pipeline`'s own stale CI scenarios, which still assert `npm ci` / `npm run lint` / `npm test` / `npm run build` in order after the 2026-07-21 pnpm adoption
- [ ] 7.3 File the investigation of why `d773f20a5` touched `site/**` on 2026-06-22 without triggering a `Deploy Site` run until 07-04 — a path filter that misses changes is its own silent-rot vector
