## Why

> **Status update (2026-08-26).** The two blockers below were resolved out-of-band before this
> change was started: `site/package-lock.json` was regenerated 2026-08-25, `Deploy Site` has since
> run green three consecutive times, and `https://pi-dashboard.dev/app/` now returns 200 — the shell
> is live. What remains live in this change is the **spec correction** work, plus one newly
> discovered defect (see "Release-triggered redeploy is dead code", below) that the original
> scenarios actively encode as working behaviour. The historical narrative is kept for provenance.
>
> **Re-scope (2026-08-31).** Commit `c52745af0` (2026-08-27) replaced the Astro site with a
> hand-written static page and deleted the subjects of the lockfile and budget work: no
> `site/package-lock.json`, no `site/scripts/check-js-size.mjs` ("no bundle budget (there is no
> bundle)"), zero-dependency `site/package.json`, `npm run build` = `node build.mjs`. The lockfile
> work was already done out-of-band (`1504b6d7f`); the budget-scope work is void (its subject is
> gone). Re-derived and kept: the release-triggered-redeploy fix, the workflow contract pins, and
> the spec corrections — now against the static page (inline download block rewritten by
> `sync-release.mjs`, no build-time fetch). The `ci-cd-pipeline` delta is REPLACED with a
> dependency-free pin (site manifest stays zero-dep; deploy runs no site install). Two explicit
> decisions (2026-08-31): `sync-release-version.yml`'s own dead `release: [published, edited]`
> trigger is deliberately left for a separate change; the `site/src/lib/github-release.ts`
> docstring fix (task 1b.3) is retired — the file was deleted with `site/src/`.

`https://pi-dashboard.dev/app/` returns 404 — the neutral shell, the intended public entry point for
pairing a phone to a dashboard server, has never been live, and the marketing site has served a
stale build since 2026-05-30.

`Deploy Site` has failed on all 8 runs since 2026-07-04. `site/package.json` gained `vitest ^4.0.0`
(2026-06-22) but `site/package-lock.json` was last regenerated 2026-04-19, so `npm ci` aborts with 23
`Missing: … from lock file` lines (`vitest@4.1.10` first) at step 4 of 12 — before the site build,
the shell build, the artifact copy, or the Pages deploy. The shell's own workflow steps were added
2026-07-04 and rewritten into their current pnpm form 2026-07-21 — both after the last green run, so
they have **never** executed in any form. No release can fix this: shell publication rides the site
pipeline, not the npm/Electron release pipeline.

## What Changes

- *(Re-scoped away 2026-08-31.)* The original first four bullets — lockfile regen, first-green
  verification, JS-budget scoping, and the `site/` lockfile drift guard — described the Astro site
  and are retired: the regen landed out-of-band (`1504b6d7f`), and `c52745af0` deleted the
  lockfile, the budget check, and every site dependency. In their place: pin the dependency-free
  reality (site manifest stays zero-dep; deploy runs no site install — test-plan E15).
- Correct five stale `marketing-site` scenarios: the deploy trigger branch and the manual-dispatch
  branch are `develop` (spec says `main`, twice); `sync-release-version` pushes to `develop` (spec
  says it commits back to `main`); the release-published path is rewritten per the defect below
  rather than merely re-described; and the custom domain is active — `site/public/CNAME` exists, so the
  "Custom-domain ready but not active" scenario, which posits the site served from
  `username.github.io/pi-agent-dashboard`, is false end to end.
- Specify the shell's publication contract at the `/app/` subpath: relative asset base (`base:"./"`),
  artifact composition alongside the marketing site, and the fact that the subpath preserves the
  apex origin. It documents — and does not restate — the existing `server-cors` requirement
  "Neutral shell origin trusted by default", which already owns the CORS behaviour.

- **Release-triggered redeploy is dead code — replace the trigger, delete the corpse.** The site is
  supposed to redeploy itself whenever a release is published. It never has. `publish.yml` creates
  the GitHub Release with `softprops/action-gh-release` using the default Actions token, and GitHub
  suppresses workflow runs from events raised by that token. Confirmed empirically: `event=release`
  has **never** triggered a run in this repository. Two workflows are therefore inert —
  `sync-release-version.yml` (gated solely on `release` + manual), which is why
  `site/src/data/latest-release.json` sat frozen at `v0.5.4` from 2026-05-26 until a manual dispatch
  on 2026-08-26; and `deploy-site.yml`'s `release:` trigger together with its `redispatch-on-release`
  job, which has never executed once. The v0.8.0 symptom: the live site advertised 0.7.0 until both
  workflows were dispatched by hand.

  The fix is not a new mechanism. `workflow_dispatch` is an explicit documented exception to the
  token rule — it *always* creates a run — so the existing dispatch body
  (`gh workflow run deploy-site.yml --ref develop`) was correct all along and merely hung off an
  event that cannot fire. Move it to a `publish.yml` job gated on `needs: github-release`, which runs
  on a real tag-push event, and delete the `release:` trigger plus the orphaned job. `--ref develop`
  is load-bearing and preserved: the `github-pages` environment rejects deploys from a tag ref.

  Rejected: invoking `deploy-site.yml` via `workflow_call` from `publish.yml`. A called workflow
  inherits the **caller's** ref, and `publish.yml` runs on the tag — reintroducing exactly the
  non-default-ref rejection that D7 documents. Also rejected: authoring the Release with a PAT to
  revive `release:` triggers repo-wide, which buys a secret to rotate for no behaviour this change
  needs.

Not in scope: the keyring URL-staleness gap (frozen `urls[]`, no read-only refresh route, dead URL
misreported as identity mismatch). Deferred to a separate change, `refresh-keyring-urls`, which does
not exist yet. No shell UI behaviour changes.

## Capabilities

### New Capabilities

- `neutral-shell-publication`: how the neutral shell ships as a static artifact at the
  `pi-dashboard.dev/app/` subpath — relative build base, artifact composition with the marketing
  site, and the origin property that `server-cors` depends on. Distinct from
  `neutral-shell-app`, which covers in-app routing behaviour, not publication. References
  `server-cors` for the CORS requirement rather than duplicating it. (Re-scoped 2026-08-31: the
  original budget-exclusion requirement is dropped — the budget check it excluded the shell from
  no longer exists.)

  This spec MUST NOT claim an SPA 404 fallback at the subpath. `packages/shell/vite.config.ts` writes
  `site/dist/app/404.html`, but GitHub Pages serves the **root** `404.html` for any missing path and
  the marketing site supplies one — so a stray non-hash path under `/app/` renders the marketing 404,
  not the shell. Hash routing means real deep links never reach the server, so this is inert rather
  than broken; the spec records actual behaviour.

### Modified Capabilities

- `marketing-site`: the "GitHub Pages deployment via GitHub Actions" requirement gains the shell
  artifact composition; four scenarios are corrected against the current workflow; and the JS bundle
  budget requirement is scoped to exclude the shell artifact. (Re-scoped 2026-08-31: the budget check was deleted with the Astro site — the live requirement records its removal instead.)
- `ci-cd-pipeline`: gains a requirement that the marketing site stays dependency-free —
  `site/package.json` declares no dependency maps and the deploy workflow runs no site install —
  so the Astro-era `npm ci`-vs-lockfile failure class cannot silently return. (Replaces the
  original site-lockfile-sync requirement, whose subject `c52745af0` deleted.)

`repo-convention-checks` is deliberately NOT modified: its spec requires `check-conventions.mjs` to
cover "exactly four rules", the script itself declares "Four rules is the ceiling. Growth pressure
here is a signal to write a different script, not to add a plugin system", and it is not wired into
any workflow — so it can neither host this rule nor fail fast on a PR.

Known adjacent drift, deliberately NOT fixed here: `ci-cd-pipeline`'s "CI workflow on push and PR"
scenarios still assert CI runs `npm ci`, `npm run lint`, `npm test`, `npm run build` in that order,
which the 2026-07-21 pnpm adoption made false. This change adds a requirement beside those stale
neighbours without inheriting or endorsing them; correcting them is its own change.

## Impact

- `.github/workflows/publish.yml` — **new** terminal job (`needs: github-release`) dispatching
  `sync-release-version.yml` then `deploy-site.yml` on `develop`, sequenced so the site build sees
  the committed download block.
- `.github/workflows/deploy-site.yml` — remove the `release:` trigger, the `redispatch-on-release`
  job, and both now-dead `if: github.event_name != 'release'` guards (`build` and `deploy`).
- `packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts` — **new** test file pinning
  E9–E15 (deploy triggers, dead-path absence, sync target, artifact composition, CNAME, manual
  dispatch, dependency-free manifest).
- `packages/shared/src/__tests__/publish-workflow-contract.test.ts` — extended with E10a/E10b (the
  publish.yml site-redeploy dispatch contract).
- Verification limit worth stating plainly: every assertion here is an L1 workflow-file parse, which
  can prove the dead path is gone and the dispatch job exists, but **cannot** prove a release
  actually redeploys the site. Only the next real release closes that loop; a task covers it.
- No application code: no server, client, extension, or shell source changes.
- First green run publishes ~2.5 months of accumulated marketing-site content as a side effect, plus
  the shell's first-ever appearance at `/app/`. That content passed normal PR review; what it has
  never had is production verification.
- Downstream unblock: `packages/shell` becomes testable from a real device — the precondition for
  exercising the pairing handshake end to end.

## Discipline Skills

- `doubt-driven-review` — the change rewrites four spec scenarios as stale and asserts a budget-scope
  invariant; those claims must survive adversarial review before they stand. Mandatory at this
  planning stage.
- `review-code` — the lockfile-drift guard carries real logic (npm sync semantics, not name
  presence) and lands before commit.
- `systematic-debugging` — expected, not merely conditional: eight workflow steps are unexercised in
  their current form and three have never run at all, so the first green attempt is likely to surface
  a second failure behind the `npm ci` abort.

`security-hardening` is not triggered — no auth, secrets, untrusted input, or PII is touched; the
CORS surface is documented, not modified. `performance-optimization` is not triggered — the budget
work corrects *what the existing measurement covers*, and ships no optimization.
`observability-instrumentation` is not triggered — the new CI gate is a build-time lint, not a
runtime endpoint, job, or external call.
