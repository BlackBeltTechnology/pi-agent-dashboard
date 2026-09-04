# Marketing site static rewrite: `site/` drops Astro for one hand-written page

Implementation record. Shipped 2026-08-27, commits `c52745af0` + `e305c361b`. Live at https://pi-dashboard.dev. No OpenSpec change. Record of what shipped, the one real loss (build-time release data) and its replacement, and the standing risk the loss leaves behind.

## Framing

Originating decision: replace the Astro site with ONE hand-written static page. User chose this explicitly over "port the mockup INTO Astro" — knowing it costs build-time release data. Also chose: delete the dropped sections (WhatIsPi, BigIdea, Why, HowItWorks) rather than keep them unused. This doc records the new tree, the copy+gated build, the release-data replacement, the workflow rewiring, the inherited theme, and the verification method. It supersedes `docs/research/neutral-shell-deploy-and-pairing-durability.md` Finding 1, now stale.

## Finding 1 — Astro framework replaced by one hand-written page, no port

- Old stack: Astro 5 + Tailwind 3 + Preact + MDX. New: ONE static page.
- Replacement chosen over "port the mockup INTO Astro" — explicit user decision.
- Cost of static accepted: no build-time release fetch.
- Dropped sections (WhatIsPi, BigIdea, Why, HowItWorks) DELETED, not kept unused — user decision.

## Finding 2 — new tree vs deleted tree

- `site/index.html` — the page: markup + ALL CSS + ~150 lines vanilla JS.
- `site/404.html`, `site/field.js` (three.js background), `site/vendor/three.module.min.js`.
- `site/media/` — hero film dark + light (webm + mp4) + posters (`hero-dark-poster.jpg`, `hero-light-poster.jpg`).
- `site/public/` — `CNAME`, `favicon.png`, `og-card.png`, `app-icon.png`. Copied to dist root by build.
- `site/build.mjs` — the build (copy + gate, Finding 4).
- `site/design-scratch/` — design source, NOT deployed.
- `site/package.json` — ZERO dependencies. Type `module`.
- Deleted: `site/src/` (all components/layouts/lib/content + 2 test files), `astro.config.mjs`, `tailwind.config.cjs`, `tsconfig.json`, `vitest.config.ts`, `package-lock.json`.
- Deleted: `site/scripts/` — older product-screenshot pipeline feeding `public/screenshots/`, orphaned because only deleted Astro components rendered it.

## Finding 3 — the page was promoted, not copied

- Page iterated as mockup under `design-scratch/mockup/`.
- MOVED to site root. File under test == file that deploys.
- `bg3d.html` lab became `design-scratch/field-lab.html`, importing `../field.js` — same module the page runs.

## Finding 4 — build = copy + gate

- `node site/build.mjs`: wipes `dist/`, copies explicit ALLOWLIST (`index.html`, `404.html`, `field.js`, `media`, `vendor`), then `public/*` to dist root.
- FAILS if any local `src=`/`href=` in `index.html` does not resolve in dist.
- Allowlist, not ignore-list: `design-scratch/` is 236 MB one level down.
- `public/` copy carries `CNAME` — losing it takes the `pi-dashboard.dev` apex down.
- Artifact contract `site/dist` unchanged → `deploy-site.yml` still uploads it, still copies `packages/shell` into `site/dist/app`.
- Artifact 37.2 MB → **7.5 MB** after pruning unreferenced media (`hero-web.*`, `promo-web.mp4`, `themes-web.*`, `hero-poster.jpg`) and orphaned `public/screenshots` (24 MB) + `kraken-brain.png`.

## Finding 5 — release data: the one real loss, and its replacement

- Old path: Astro fetched latest GitHub release AT BUILD TIME via `site/src/lib/github-release.ts` + cache `site/src/data/latest-release.json`.
- Static page cannot. Replacement: `site/design-scratch/scripts/sync-release.mjs`.
- Script rewrites download block in `index.html` from `api.github.com/repos/BlackBeltTechnology/pi-agent-dashboard/releases/latest`.
- Anchors carry `data-asset="<key>"`: `mac-arm64`, `mac-x64`, `linux-appimage-x64`, `linux-appimage-arm64`, `linux-deb-x64`, `linux-deb-arm64`, `win-exe-x64`, `win-exe-arm64`, `win-zip-x64`, `win-zip-arm64`.
- Release line carries `data-rel-tag`, `data-rel-date`, `data-rel-notes`.
- **KEY RULE:** assets matched by SHAPE (extension + arch suffix), never by filename. electron-builder puts the version in every name → literal match breaks on exactly the release the script tracks.
- `.blockmap` and `.yml` assets MUST be filtered: they share those suffixes, are update metadata, not downloads.
- `formatBytes` semantics copied from the Astro lib: binary units, 1 decimal.
- `--check` mode: exit 1 = stale, exit 2 = network/API failure. Distinct on purpose.
- Run: `npm run sync-release` / `npm run check-release` from `site/`.

## Finding 6 — workflow rewiring

- `.github/workflows/deploy-site.yml`: dropped `npm ci`, `astro check`, `astro build`, `npm run size` (no bundle exists now).
- Now runs `npm run build` + `npm run check-release` with `continue-on-error: true`. Stale page still beats no page; drift lands in the log.
- `pnpm/action-setup` KEPT — for the ROOT workspace install that builds `packages/shell`.
- `.github/workflows/sync-release-version.yml`: no longer writes `site/src/data/latest-release.json` (gone).
- Runs `node site/design-scratch/scripts/sync-release.mjs` on `release: published` (and `edited`), commits `site/index.html` to develop.

## Finding 7 — theme inherited wholesale

- Same storage key `pi-theme`, same three modes System/Light/Dark, same aria shape (`role="radiogroup"` + `aria-checked`).
- From deleted `ThemeScript.astro` + `ThemeToggle.tsx`. Preact island there, ~30 lines vanilla JS here.
- ONE difference: Astro signalled dark with `class="dark"` (Tailwind selector); static page signals light with `data-theme="light"`, treats dark as the absence.
- That is what `field.js` already observes via `MutationObserver` (attributeFilter `['data-theme']`).
- Inline `<head>` script runs FIRST, before any stylesheet, or the page flashes.
- Second `matchMedia` listener in the body script swaps the hero film source (dark/light variants).
- MEASURED: fresh visitor on dark OS → dark; on light OS → light; click Dark on light OS → survives reload; back to System → follows a live OS flip both ways; at Playwright `waitUntil:"commit"` the attribute is ALREADY correct (no flash).

## Finding 8 — `site/` is NOT a pnpm workspace member

- `pnpm-workspace.yaml` lists `packages/*` only.
- `npm run build -w site` FAILS. Commands run FROM `site/`.
- Nothing to install first — zero dependencies.

## Finding 9 — verification method (reusable)

- `site/design-scratch/scripts/serve.mjs` — zero-dep static server, default root `site/`, port 8791.
- `shoot.mjs --audit [--links]` — exit non-zero on defect.
- Ran against the BUILT artifact, then against the LIVE domain.
- 21 audit runs: system/light/dark × 320/390/768/860/1024/1080/1440.
- Zero doc/nav overflow; sticky header measured after scrolling to page bottom; no dead anchors; no broken images; no page errors.
- 18/18 external links returned 200, every download URL included.
- Live checks: `/`, `/404.html`, `/field.js`, `/media/*`, `/vendor/*`, `/og-card.png` and **`/app/`** (neutral shell subpath — the thing a bad allowlist would silently break) all 200.

## Finding 10 — given up with the framework

- MDX content collections, Preact islands, the Tailwind class layer, `astro check` type checking, the 50 KB gzipped JS bundle budget (`scripts/check-js-size.mjs`) — all gone.
- Re-adding any of it is a RE-INTRODUCTION, not a revert. The components exist only in git history.

## Finding 11 — standing risk: the page cannot discover new versions

- Page cannot discover a new version by itself anymore.
- `sync-release-version.yml` is now LOAD-BEARING.
- If it fails, the site advertises the previous release's links; only the non-blocking `check-release` line in the deploy log says so.

## Supersedes: `neutral-shell-deploy-and-pairing-durability.md` Finding 1 is STALE

- That doc describes `site/` as Astro with `npm ci` / `npm run check` / `npm run size`, and says a stale `site/package-lock.json` blocks Deploy Site.
- `site/package-lock.json` NO LONGER EXISTS — deleted with the framework.
- Stale-lockfile blockage obsolete. Deploy Site now runs the copy+gated build (Finding 4) plus non-blocking `check-release`.
- Cross-reference only. That doc itself not edited.

## Sources

- Repo: `site/` (index.html, 404.html, field.js, build.mjs, package.json, public/, media/, vendor/, design-scratch/scripts/{serve,shoot,sync-release}.mjs), `.github/workflows/deploy-site.yml`, `.github/workflows/sync-release-version.yml`, `pnpm-workspace.yaml`.
- Commits `c52745af0`, `e305c361b` (2026-08-27).
- Measurements: 21 audit runs via `shoot.mjs --audit` (system/light/dark × 7 viewports) against built artifact + live domain; live HTTP checks incl. `/app/`; theme persistence checks incl. Playwright `waitUntil:"commit"`.
