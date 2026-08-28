## Why

> **Status update (2026-08-26).** The two blockers below were resolved out-of-band before this
> change was started: `site/package-lock.json` was regenerated 2026-08-25, `Deploy Site` has since
> run green three consecutive times, and `https://pi-dashboard.dev/app/` now returns 200 — the shell
> is live. What remains live in this change is the **spec correction** work, plus one newly
> discovered defect (see "Release-triggered redeploy is dead code", below) that the original
> scenarios actively encode as working behaviour. The historical narrative is kept for provenance.

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

- Regenerate `site/package-lock.json` so `npm ci` resolves. This is not a surgical vitest fix: the
  lock is ~4 months old, so regeneration floats **every** site dependency forward — `astro ^5.1.1`,
  `@astrojs/*`, `tailwindcss ^3.4.17`, `motion ^11`, `playwright ^1.49.1` — inside the same deploy.
  An Astro or Tailwind minor that breaks `astro build` is a live second-blocker candidate, and the
  budget will be measured against newer dependency output. Pin deliberately if the float proves
  hostile, rather than discovering it at deploy time.
- Verify the workflow actually reaches green. The lockfile is the *first* blocker, not a proven sole
  blocker: steps 5–12 have never run in their current form, so `pnpm install --frozen-lockfile` at
  the repo root, the shell build, and the artifact copy are all unexercised. The 50 KB JS budget in
  particular has not been measured against ~2.5 months of unshipped site changes.
- Scope the JS bundle budget to the marketing site: `check-js-size.mjs` walks `site/dist`
  recursively, and the shell is copied into `site/dist/app/`, so the shell's React bundle is only
  outside the budget because `npm run size` happens to run before the copy. Exclude `dist/app/` from
  the walk so the measurement is correct **regardless of step order**, rather than pinning the order
  and leaving a reorder able to break the build. The exclusion assumes `dist/app/` holds only shell
  output; the spec delta must state that assumption, since a future Astro page under `/app/` would
  silently escape the budget.
- Add a CI guard for `site/` lockfile drift. `site/` is not a pnpm workspace member and installs via
  `npm ci` against its own lockfile, so neither `verify-lockfile-versions.mjs` (pnpm importers only,
  and it runs in `publish.yml`/`_electron-build.yml`) nor any root pnpm check covers it. The guard
  must match npm's own sync semantics — a name-presence check would miss range-only drift
  (`^4.0.0` → `^4.1.0`) that `npm ci` still rejects.
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
  site, budget exclusion, and the origin property that `server-cors` depends on. Distinct from
  `neutral-shell-app`, which covers in-app routing behaviour, not publication. References
  `server-cors` for the CORS requirement rather than duplicating it.

  This spec MUST NOT claim an SPA 404 fallback at the subpath. `packages/shell/vite.config.ts` writes
  `site/dist/app/404.html`, but GitHub Pages serves the **root** `404.html` for any missing path and
  the marketing site supplies one — so a stray non-hash path under `/app/` renders the marketing 404,
  not the shell. Hash routing means real deep links never reach the server, so this is inert rather
  than broken; the spec records actual behaviour.

### Modified Capabilities

- `marketing-site`: the "GitHub Pages deployment via GitHub Actions" requirement gains the shell
  artifact composition; four scenarios are corrected against the current workflow; and the JS bundle
  budget requirement is scoped to exclude the shell artifact.
- `ci-cd-pipeline`: gains a requirement that `site/package-lock.json` stays in sync with
  `site/package.json`, enforced on push and PR, mirroring the existing "Release lockfile MUST mirror
  workspace versions" requirement while covering the npm-installed `site/` tree that one does not.

`repo-convention-checks` is deliberately NOT modified: its spec requires `check-conventions.mjs` to
cover "exactly four rules", the script itself declares "Four rules is the ceiling. Growth pressure
here is a signal to write a different script, not to add a plugin system", and it is not wired into
any workflow — so it can neither host this rule nor fail fast on a PR.

Known adjacent drift, deliberately NOT fixed here: `ci-cd-pipeline`'s "CI workflow on push and PR"
scenarios still assert CI runs `npm ci`, `npm run lint`, `npm test`, `npm run build` in that order,
which the 2026-07-21 pnpm adoption made false. This change adds a requirement beside those stale
neighbours without inheriting or endorsing them; correcting them is its own change.

## Impact

- `site/package-lock.json` — regenerated.
- `site/scripts/check-js-size.mjs` — exclude `dist/app/` from the walk.
- `scripts/check-site-lockfile.mjs` — **new** script, following the existing `scripts/*.mjs` pattern
  (no new dependency).
- `.github/workflows/ci.yml` — one step invoking it, alongside the existing
  `verify-release-deps.mjs` / `check-skill-frontmatter.mjs` / `verify-published-imports.mjs` gates,
  so drift fails on the PR rather than at deploy time.
- `.github/workflows/publish.yml` — **new** terminal job (`needs: github-release`) dispatching
  `sync-release-version.yml` then `deploy-site.yml` on `develop`, sequenced so the site build sees
  the committed cache.
- `.github/workflows/deploy-site.yml` — remove the `release:` trigger and the `redispatch-on-release`
  job; the `build` job's `if: github.event_name != 'release'` guard becomes dead and goes with them.
- Verification limit worth stating plainly: every assertion here is an L1 workflow-file parse, which
  can prove the dead path is gone and the dispatch job exists, but **cannot** prove a release
  actually redeploys the site. Only the next real release closes that loop; a task covers it.
- No application code: no server, client, extension, or shell source changes. If pinning the
  workflow contract in a test proves necessary, the precedent is
  `publish-workflow-contract.test.ts` — that would add a test file under `packages/shared/` and this
  Impact list must be updated to say so.
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
