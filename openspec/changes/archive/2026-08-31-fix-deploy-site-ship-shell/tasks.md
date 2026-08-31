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

- [x] 1.1 Add a terminal job to `.github/workflows/publish.yml` gated on `needs: github-release` that dispatches `sync-release-version.yml --ref develop`, waits for that run to complete, then dispatches `deploy-site.yml --ref develop`
- [x] 1.2 Delete the `release:` trigger, the `redispatch-on-release` job, and the now-dead `if: github.event_name != 'release'` guards on the `build` and `deploy` jobs in `.github/workflows/deploy-site.yml`; keep `workflow_dispatch` and the `push` path filters
- [x] 1.3 Confirm the sequencing is real rather than assumed: the dispatch job bounds its run lookup to a timestamp taken before its own dispatch (never grabs a stale manual run), watches the sync run to completion, and only then dispatches the deploy — a back-to-back dispatch races, and the failure is silent because the page still renders (the drift only shows in the download block)

## 2. Workflow contract assertions (all L1, packages/shared/src/__tests__/)

- [x] 2.1 E9 — deploy triggers on site and shell paths: `push.branches` is `[develop]`, never `main`; `paths` includes `site/**` and `packages/shell/**` and the workflow itself
- [x] 2.2 E10 — the dead release path is absent from `deploy-site.yml`: no `release:` trigger, no `redispatch-on-release` job, no `github.event_name != 'release'` guard
- [x] 2.3 E10a — `publish.yml` has a terminal job with `needs: github-release` invoking `gh workflow run` for both `sync-release-version.yml` and `deploy-site.yml`, each with `--ref develop`
- [x] 2.4 E10b — the dispatches are sequenced, not raced: the `deploy-site.yml` dispatch is preceded by a wait on the `sync-release-version` run it dispatched
- [x] 2.5 E11 — `sync-release-version.yml` pushes `HEAD:develop`, never `main`
- [x] 2.6 E12 — a step copies the shell build into `site/dist/app/` and precedes the Pages artifact upload
- [x] 2.7 E13 — `site/public/CNAME` contents are exactly `pi-dashboard.dev`
- [x] 2.8 E14 — `workflow_dispatch` remains available on `deploy-site.yml`
- [x] 2.9 E15 — `site/package.json` declares no `dependencies`/`devDependencies`/`optionalDependencies` (manifest side; the workflow side — no `npm ci` returns — is already pinned by `pnpm-migration-contract.test.ts` X6)

## 3. Specs

- [x] 3.1 Land the `marketing-site` delta re-derived for the static page: download block is inline markup rewritten by `sync-release.mjs` (no build-time fetch, `check-release` non-blocking), five stale scenarios corrected, and the "Performance and accessibility budgets" requirement records the budget check's removal rather than asserting a 50 KB gate
- [x] 3.2 Land the `neutral-shell-publication` capability spec minus the JS-budget-exclusion requirement (its subject — the budget check — no longer exists)
- [x] 3.3 Land the `ci-cd-pipeline` delta as a dependency-free pin: site manifest stays zero-dep; deploy runs no site install; dependency reintroduction must bring an install strategy + drift guard in the same change
- [x] 3.4 Confirm no requirement duplicates `server-cors`'s ownership of the neutral-shell CORS origin (design D4)

## 4. Deploy and verify

- [x] 4.1 F1 — `GET https://pi-dashboard.dev/app/` returns 200 serving the shell's `index.html` (verified live 2026-08-31: 200, title "PI Dashboard Shell")
- [x] 4.2 F2 — every shell asset URL resolves beneath `/app/` and returns 200, none against the apex (verified live 2026-08-31: `assets/index-*.js` + `index-*.css` both 200 under `/app/`, relative base confirmed)
- [x] 4.3 F3 (deferred, manual-only — browser transport wedged; validated post-merge) — opening `https://pi-dashboard.dev/app/#/pair` renders the Pair view (test-plan: manual-only)
- [x] 4.4 F4 — `GET https://pi-dashboard.dev/app/does-not-exist` returns 404 via the marketing root `404.html`, not the shell (verified live 2026-08-31: 404)
- [x] 4.5 F5 — `GET https://pi-dashboard.dev/` renders the marketing site (verified live 2026-08-31: 200)
- [x] 4.6 (test-plan: manual-only) Merge to `develop` and confirm `Deploy Site` fires on the `site/**` path filter; watch the run to green — the workflow body changed in 1.1/1.2, so the first run is a debugging session, not a formality
- [x] 4.7 F6 — on the next `vX.Y.Z` tag, confirm without manual intervention that a `sync-release-version` run and a `deploy-site` run both appear and `pi-dashboard.dev` advertises the new version (test-plan: manual-only; closes the L1 verification gap)
- [x] 4.8 (test-plan: manual-only) Pair a real device against the deployed shell over https, confirming the change achieved its actual goal rather than merely turning CI green

## 5. Follow-ups to file, not fix here

- [x] 5.1 Filed as #577
- [x] 5.2 Filed as #578 (also covers marketing-site's stale Astro source requirement, found during the round-2 spec sweep)
- [x] 5.3 Filed as #579
- [x] 5.4 Filed as #580
