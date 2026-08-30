# Tasks — fix-deploy-site-ship-shell

> **Re-scope (2026-08-31).** Commit `c52745af0` (2026-08-27) replaced the Astro
> site with a hand-written static page and invalidated the original sections 1–3
> of this file: `site/package-lock.json` and `site/scripts/check-js-size.mjs` no
> longer exist, `site/package.json` has zero dependencies, and `astro build` is
> `node build.mjs`. The lockfile regen itself had already landed out-of-band
> (`1504b6d7f`, 2026-08-25) and `Deploy Site` has run green since; the shell is
> live at `https://pi-dashboard.dev/app/`. Retired with the Astro site: original
> 1.1–1.5 (lockfile regen/float record/astro build/size/pins), 2.1–2.5 (JS
> budget scope + tests E6–E8/X3), 3.1–3.12 (site lockfile guard + tests
> E1–E5/X1/X2), and 1b.3 (stale docstring in `site/src/lib/github-release.ts`,
> deleted with `site/src/`). Surviving work, re-derived against the static-site
> reality, follows. Full rationale: proposal.md "Re-scope" note, design.md
> "Re-scope 2026-08-31".

## 1. Restore the release-triggered redeploy (design D8)

- [ ] 1.1 Add a terminal job to `.github/workflows/publish.yml` gated on `needs: github-release` that dispatches `sync-release-version.yml --ref develop`, waits for that run to complete, then dispatches `deploy-site.yml --ref develop`
- [ ] 1.2 Delete the `release:` trigger, the `redispatch-on-release` job, and the now-dead `if: github.event_name != 'release'` guards on the `build` and `deploy` jobs in `.github/workflows/deploy-site.yml`; keep `workflow_dispatch` and the `push` path filters
- [ ] 1.3 Confirm the sequencing is real rather than assumed: the dispatch job bounds its run lookup to a timestamp taken before its own dispatch (never grabs a stale manual run), watches the sync run to completion, and only then dispatches the deploy — a back-to-back dispatch races, and the failure is silent because the page still renders (the drift only shows in the download block)

## 2. Workflow contract assertions (all L1, packages/shared/src/__tests__/)

- [ ] 2.1 E9 — deploy triggers on site and shell paths: `push.branches` is `[develop]`, never `main`; `paths` includes `site/**` and `packages/shell/**` and the workflow itself
- [ ] 2.2 E10 — the dead release path is absent from `deploy-site.yml`: no `release:` trigger, no `redispatch-on-release` job, no `github.event_name != 'release'` guard
- [ ] 2.3 E10a — `publish.yml` has a terminal job with `needs: github-release` invoking `gh workflow run` for both `sync-release-version.yml` and `deploy-site.yml`, each with `--ref develop`
- [ ] 2.4 E10b — the dispatches are sequenced, not raced: the `deploy-site.yml` dispatch is preceded by a wait on the `sync-release-version` run it dispatched
- [ ] 2.5 E11 — `sync-release-version.yml` pushes `HEAD:develop`, never `main`
- [ ] 2.6 E12 — a step copies the shell build into `site/dist/app/` and precedes the Pages artifact upload
- [ ] 2.7 E13 — `site/public/CNAME` contents are exactly `pi-dashboard.dev`
- [ ] 2.8 E14 — `workflow_dispatch` remains available on `deploy-site.yml`
- [ ] 2.9 E15 — `site/package.json` declares no `dependencies`/`devDependencies`/`optionalDependencies` (manifest side; the workflow side — no `npm ci` returns — is already pinned by `pnpm-migration-contract.test.ts` X6)

## 3. Specs

- [ ] 3.1 Land the `marketing-site` delta re-derived for the static page: download block is inline markup rewritten by `sync-release.mjs` (no build-time fetch, `check-release` non-blocking), five stale scenarios corrected, and the "Performance and accessibility budgets" requirement records the budget check's removal rather than asserting a 50 KB gate
- [ ] 3.2 Land the `neutral-shell-publication` capability spec minus the JS-budget-exclusion requirement (its subject — the budget check — no longer exists)
- [ ] 3.3 Land the `ci-cd-pipeline` delta as a dependency-free pin: site manifest stays zero-dep; deploy runs no site install; dependency reintroduction must bring an install strategy + drift guard in the same change
- [ ] 3.4 Confirm no requirement duplicates `server-cors`'s ownership of the neutral-shell CORS origin (design D4)

## 4. Deploy and verify

- [x] 4.1 F1 — `GET https://pi-dashboard.dev/app/` returns 200 serving the shell's `index.html` (verified live 2026-08-31: 200, title "PI Dashboard Shell")
- [ ] 4.2 F2 — every shell asset URL resolves beneath `/app/` and returns 200, none against the apex (test-plan: manual-only)
- [ ] 4.3 F3 — opening `https://pi-dashboard.dev/app/#/pair` renders the Pair view (test-plan: manual-only)
- [x] 4.4 F4 — `GET https://pi-dashboard.dev/app/does-not-exist` returns 404 via the marketing root `404.html`, not the shell (verified live 2026-08-31: 404)
- [x] 4.5 F5 — `GET https://pi-dashboard.dev/` renders the marketing site (verified live 2026-08-31: 200)
- [ ] 4.6 Merge to `develop` and confirm `Deploy Site` fires on the `site/**` path filter; watch the run to green — the workflow body changed in 1.1/1.2, so the first run is a debugging session, not a formality
- [ ] 4.7 F6 — on the next `vX.Y.Z` tag, confirm without manual intervention that a `sync-release-version` run and a `deploy-site` run both appear and `pi-dashboard.dev` advertises the new version (test-plan: manual-only; closes the L1 verification gap)
- [ ] 4.8 Pair a real device against the deployed shell over https, confirming the change achieved its actual goal rather than merely turning CI green

## 5. Follow-ups to file, not fix here

- [ ] 5.1 File the one-line correction to the `spa404Fallback` docstring in `packages/shell/vite.config.ts:9-13`, which claims Pages serves the SPA shell for any unknown path — false for this subpath deployment (design D5)
- [ ] 5.2 File the correction of `ci-cd-pipeline`'s own stale CI scenarios, which still assert `npm ci` / `npm run lint` / `npm test` / `npm run build` in order after the 2026-07-21 pnpm adoption
- [ ] 5.3 File the investigation of why `d773f20a5` touched `site/**` on 2026-06-22 without triggering a `Deploy Site` run until 07-04 — a path filter that misses changes is its own silent-rot vector
- [ ] 5.4 File the removal of `sync-release-version.yml`'s dead `release: [published, edited]` trigger (user decision 2026-08-31: separate change — the rewritten docstring calls it "the normal path", which is exactly the D8 falsehood)
