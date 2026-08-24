## Context

`Deploy Site` (`.github/workflows/deploy-site.yml`) has failed on all 8 runs since 2026-07-04; last
success 2026-05-30. `npm ci` in `site/` aborts at step 4 of 12 with 23 `Missing: … from lock file`
lines because `site/package.json` gained `vitest ^4.0.0` (2026-06-22) while `site/package-lock.json`
was last regenerated 2026-04-19. Steps 5–12 therefore never execute.

Three of those steps — root `pnpm install --frozen-lockfile`, `pnpm exec vite build` in
`packages/shell`, and the copy into `site/dist/app/` — were added 2026-07-04 and rewritten into their
current pnpm form 2026-07-21. Both dates are after the last green run, so **the shell has never been
built or published by CI in any form**. `https://pi-dashboard.dev/app/` returns 404 while the apex
returns a 2.5-month-stale 200.

Structural constraints that shape every decision below:

- GitHub Pages allows one site per repo. `site/` owns the apex, so the shell must live at a subpath.
- `site/` is deliberately **not** a pnpm workspace member (`pnpm-workspace.yaml` lists `packages/*`
  only). It installs with `npm ci` against its own lockfile, so no root pnpm check covers it.
- `check-js-size.mjs` walks `site/dist` **recursively** with a 50 KB gzipped budget, and the shell is
  copied *into* `site/dist/app/`.
- `server-cors` already owns the requirement "Neutral shell origin trusted by default"
  (`https://pi-dashboard.dev` as a built-in allowed origin).

## Goals / Non-Goals

**Goals:**
- `https://pi-dashboard.dev/app/` serves the neutral shell, so pairing can be tested from a real device.
- `Deploy Site` cannot silently rot on lockfile drift again — drift fails on the PR, not at deploy.
- The JS budget measures what it claims to measure, independent of workflow step order.
- `marketing-site` scenarios describe the workflow that actually exists.

**Non-Goals:**
- No shell UI behaviour change; no application code.
- Keyring URL staleness (frozen `urls[]`, no refresh route, dead URL misreported as identity
  mismatch) — deferred to `refresh-keyring-urls`, not yet created.
- Correcting `ci-cd-pipeline`'s stale `npm ci` CI scenarios (see Risks).
- Reviewing the 2.5 months of marketing-site content this unblocks.
- Making the shell reachable from plain-http LAN servers — barred by the secure-context rule (D4 of
  `add-server-keypair-pairing`), unrelated to deployment.

## Decisions

### D1 — Scope the budget walk, do not pin the step order

`npm run size` (step 7) runs before the shell copy (step 10), so the shell's React bundle escapes the
50 KB budget **by accident**. React + react-dom alone exceed 50 KB gzipped, so a reorder converts a
passing budget into a hard failure.

Measured 2026-08-13 (`pnpm exec vite build` in `packages/shell`): the shell emits a single
`index-*.js` chunk at **67.77 KB gzipped**. That exceeds the entire 50 KB site budget on its own, so
a reorder is not a marginal risk — it is a guaranteed hard failure regardless of what the marketing
site contributes.

Chosen: exclude `dist/app/` from the walk in `check-js-size.mjs`. The measurement becomes correct
regardless of order.

Rejected — *pin the order and assert it*: an ordering invariant is fragile (any future step
insertion can violate it) and a YAML comment asserts nothing. A real assertion would need a
workflow-parsing contract test; `packages/shared/src/__tests__/pnpm-migration-contract.test.ts`
already parses `deploy-site.yml`, so that machinery is cheaper than first assumed — but it would
still be defending a fragile invariant instead of removing it. Scoping the walk eliminates the
hazard rather than documenting it.

**This decision was reversed during doubt-driven review**; the original proposal pinned the order.

### D2 — New `scripts/check-site-lockfile.mjs`, wired into `ci.yml`

Rejected — *extend `scripts/check-conventions.mjs`*: the `repo-convention-checks` spec requires it to
cover "exactly four rules", the script declares "Four rules is the ceiling. Growth pressure here is a
signal to write a different script, not to add a plugin system", **and no workflow runs it** (it
fires only in `ship-it` step 4.4 and the `code-quality` skill). It could neither host the rule nor
fail fast on a PR.

Rejected — *extend `scripts/verify-lockfile-versions.mjs`*: it parses `pnpm-lock.yaml`'s `importers`
map for workspace cross-ref versions, and runs only in `publish.yml` / `_electron-build.yml`. Wrong
lockfile format, wrong trigger.

Chosen: a new `scripts/*.mjs` invoked from `ci.yml`, which already runs `verify-release-deps.mjs`,
`check-skill-frontmatter.mjs`, and `verify-published-imports.mjs` on push to `develop` and on PRs.

**This decision was also reversed during doubt-driven review**; the original proposal claimed it
would "extend an existing script", which was impossible.

### D3 — The guard matches npm's sync semantics, not name presence

A name-presence check ("is every `dependencies` key present in the lock?") would have caught *this*
drift but misses range-only drift (`^4.0.0` → `^4.1.0` with no lock regen), which `npm ci` still
rejects. The guard must compare the declared range against the locked version and fail when the
locked version falls outside it.

Chosen mechanism — **structural compare, no semver logic**: lockfile v3's `packages[""]` entry
mirrors `site/package.json`'s dependency maps verbatim, *including the range strings*
(`"astro": "^5.1.1"`, and a separate `devDependencies` map). Comparing those maps against
`site/package.json` catches addition, **removal**, and range-only drift in one bidirectional check
with zero semver evaluation and no new dependency.

Rejected — *`satisfies(lockedVersion, declaredRange)` per dependency*: needs `semver`, evaluates one
direction only (it passes when `package.json` *removes* a dep), and inherits edge cases the
structural compare never meets — `npm:` aliases, git and URL specifiers, prerelease ordering.

**Scope is explicitly `dependencies` + `devDependencies` + `optionalDependencies`.** `vitest` — the
dependency whose drift caused this entire outage — lives in **devDependencies**
(`site/package.json:28`). A guard scoped to `dependencies` alone would pass on the exact drift it
exists to catch: a vacuous check, the failure class this decision is meant to eliminate.

### D4 — `neutral-shell-publication` references `server-cors`, never restates it

The `/app/` subpath preserves the apex origin (path is not part of a web origin), which is exactly
why the built-in `https://pi-dashboard.dev` CORS entry keeps working. That CORS requirement is
already owned by `server-cors`. The new spec asserts the *origin-preserving property of the subpath*
and points at `server-cors`; duplicating the CORS rule would create two owners and guaranteed drift.

### D5 — Record the 404 behaviour as-is; do not claim an SPA fallback

`packages/shell/vite.config.ts`'s `spa404Fallback` writes `site/dist/app/404.html`, but GitHub Pages
serves the **root** `404.html` for any missing path and `site/src/pages/404.astro` supplies one. A
stray non-hash path under `/app/` therefore renders the marketing 404, not the shell.

Hash routing (`useHashLocation`, `packages/shell/src/main.tsx:5`) means real deep links never reach
the server, so this is inert, not broken. The spec records actual behaviour rather than asserting a
fallback the pipeline does not deliver — a spec that claims otherwise would be false the day it
lands.

**Known contradiction left in place:** the `spa404Fallback` docstring in
`packages/shell/vite.config.ts:9-13` claims the opposite — "so Pages serves the SPA shell for any
unknown path". That comment is wrong for a subpath deployment under a site that ships its own root
`404.html`. The no-shell-source-changes non-goal keeps this change from correcting it, which means a
misleading comment will sit beside a spec recording the opposite. Correcting the comment is a
one-line follow-up; leaving it undocumented would be worse than naming it here.

### D7 — Correct all five stale `marketing-site` scenarios in one delta

The five corrections are mechanical but easy to re-get-wrong, so the delta pins what each corrected
scenario asserts: the deploy trigger is `develop`; manual `workflow_dispatch` publishes `develop`
content; `sync-release-version` pushes `HEAD:develop`; a published release does **not** build inline
but re-dispatches the workflow on `develop` (because the `github-pages` environment rejects deploys
from a tag ref); and the custom domain is active via `site/public/CNAME`.

The release-redispatch behaviour is the subtle one — a future reader who sees `release: published`
in the trigger list will assume an inline build unless the scenario says otherwise.

### D6 — Regenerate the lockfile wholesale, then verify; pin only if the float bites

The lock is ~4 months old, so regeneration floats every site dependency forward (`astro`,
`@astrojs/*`, `tailwindcss`, `motion`, `playwright`) in one deploy. Selectively hand-editing a
lockfile to add only vitest's tree is error-prone and leaves the rest stale anyway.

Chosen: regenerate, then verify `astro build` + the budget locally **before** pushing. Pin
deliberately only if a specific upgrade proves hostile, so pinning is a reaction to evidence rather
than pre-emptive guesswork.

## Risks / Trade-offs

- **The lockfile is the first blocker, not a proven sole blocker** → steps 5–12 are unexercised in
  their current form. Verify the full workflow locally before relying on a green run;
  `systematic-debugging` is listed as expected, not conditional.
- **Wholesale dependency float may break `astro build` or the budget** (D6) → verify locally first;
  pin the specific offender if it bites.
- **The 50 KB budget has never been measured against 2.5 months of site changes** → it may fail on
  the first honest run, independent of the shell. That is a real finding, not a regression from this
  change.
- **First green deploy publishes 2.5 months of content in one shot** → that content passed PR review
  but has never been production-verified. Accepted: withholding the deploy indefinitely is worse.
- **`dist/app/` exclusion assumes that path is shell-only** (D1) → a future Astro page under `/app/`
  would silently escape the budget. Stated as an explicit assumption in the spec delta.
- **`ci-cd-pipeline` is itself stale** — its "CI workflow on push and PR" scenarios still assert
  `npm ci` / `npm run lint` / `npm test` / `npm run build` in order, which the 2026-07-21 pnpm
  adoption falsified. This change adds a requirement beside those stale neighbours without endorsing
  them → correcting them is its own change, deliberately out of scope.
- **The guard cannot catch drift that never opens a PR** → a direct push to `develop` still reaches
  `npm ci` unguarded. Accepted; `ci.yml` runs on push to `develop` as well, which closes most of it.

## Migration Plan

1. Regenerate `site/package-lock.json`; verify `npm ci`, `astro build`, and `npm run size` locally.
2. Scope the budget walk; confirm the shell bundle is excluded and the site total still reports.
3. Add the guard + its `ci.yml` step; confirm it fails on a deliberately drifted lockfile and passes
   on the fixed one.
4. Land the spec deltas.
5. Merge to `develop` → `Deploy Site` fires on the `site/**` path filter.
6. Verify `https://pi-dashboard.dev/app/` serves the shell and the apex still renders.

Rollback — **a plain revert of this change does NOT roll back**. The drift originates in a different
commit (`d773f20a5`, 2026-06-22, which added `vitest` to `site/package.json`). Reverting only this
change restores the stale lockfile *against a `package.json` that still declares vitest*, so
`npm ci` fails again, the `deploy` job never runs, and Pages keeps serving the newly-published
artifact. That is a freeze, not a rollback.

To actually restore the previous artifact, deploy from a self-consistent state: either
`workflow_dispatch` the workflow at the last-green commit, or revert this change *together with*
`d773f20a5`'s `package.json` edit so lockfile and manifest agree again.

No data migration, no persisted state, no consumer contract — the risk is purely "which artifact is
live", but the naive rollback path is a trap and is recorded here as such.

## Open Questions

- Does the site's current JS output still fit 50 KB gzipped after 2.5 months of changes plus a
  dependency float? Unknown until measured — this determines whether the change stays mechanical.
- Did the PR that introduced the drift (`d773f20a5`) land through the ship gate? If it did, a
  ship-time guard would have caught it and the CI placement is belt-and-braces; if it bypassed the
  gate, `ci.yml` placement is load-bearing. Affects confidence, not the design.
- `d773f20a5` touched `site/**` on 2026-06-22 but produced no `Deploy Site` run until 07-04 — likely
  a paths-filter/merge-commit blind spot. Worth understanding, since a path filter that misses
  changes is its own silent-rot vector.
