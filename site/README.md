# pi-dashboard.dev

The marketing site: **one hand-written static page**. No framework, no build
output to compile, no dependencies — `npm run build` is a copy plus a
reference check.

It replaced an Astro + Tailwind + Preact site. What that swap costs and buys is
recorded below, because both matter when deciding whether to add anything back.

```
site/
├── index.html        the page: markup, all CSS, ~150 lines of vanilla JS
├── 404.html          same tokens, same theme script
├── field.js          the 3D slab field behind the page (three.js)
├── vendor/           three.module.min.js, vendored so the page needs no install
├── media/            hero film (dark + light) and posters
├── public/           copied to the site root: CNAME, favicon.png, og-card.png
├── build.mjs         assembles dist/ from an allowlist
└── design-scratch/   design source — NOT deployed (see below)
```

## Commands

`site/` is NOT a pnpm workspace member (`pnpm-workspace.yaml` lists `packages/*`
only), so `-w site` does not resolve. Run these from `site/`:

```bash
cd site
npm run dev            # serve site/ at http://localhost:8791
npm run build          # -> site/dist (what GitHub Pages uploads)
npm run preview        # serve the built dist/
npm run audit          # layout/regression gate, exit 1 on a defect
npm run audit -- --links   # ...and every external link resolves
npm run shots          # screenshot matrix -> /tmp/mockup-shots
npm run sync-release   # rewrite the download block from the latest GH release
npm run check-release  # exit 1 if that block is stale
```

There is nothing to install first — `site/package.json` has no dependencies.
The audit/shot scripts borrow Playwright from the repo root.

## Release data is inline — and that is the one real cost

Astro fetched the latest GitHub release **at build time**, so download links and
byte sizes were always current. A static page cannot. The replacement is
`design-scratch/scripts/sync-release.mjs`, which rewrites the download block in
`index.html` from the GitHub API and is run automatically by
`.github/workflows/sync-release-version.yml` on every `release: published`,
committing the diff to develop. `deploy-site.yml` also runs `check-release` and
logs (without blocking) when the page is behind.

Assets are matched by **shape** — extension plus arch suffix — never by
filename, because electron-builder puts the version in every name and a literal
match would break on exactly the release the script exists to track.
`.blockmap` and `.yml` files are filtered out: they share those suffixes and
are update metadata, not downloads.

## Theme

Three modes — System / Light / Dark — carried over from the Astro site,
including its storage key `pi-theme`, so anyone who already picked a theme
there keeps it. An inline script in `<head>`, before any stylesheet, resolves
it before first paint; a `matchMedia` listener re-resolves live when the OS
flips, but only while the choice is still "system". Dark is signalled by the
*absence* of `data-theme="light"`, which is also what `field.js` observes.

## design-scratch/ is not deployed

The design source the site is drawn from: the `field.js` physics lab, the
screenshot/audit scripts, the hyperframes video projects, the product-shot
pipeline, and reference captures. `build.mjs` copies from an **allowlist**, so
none of it can reach the artifact by accident, and `deploy-site.yml` excludes
`site/design-scratch/**` from its path filter so iterating there never deploys.
Heavy machine output (`out/`, `renders/`) is gitignored.

Start with [`design-scratch/PLAYBOOK.md`](design-scratch/PLAYBOOK.md) — the
serve/shoot/audit loop and the traps that cost time once each.

## What the swap gave up

- Build-time release data (replaced by the sync script above).
- MDX content collections, the Preact islands, the Tailwind class layer.
- `astro check` type checking, and the 50 KB JS bundle budget — there is no
  bundle now; the only JS is inline plus `field.js`.

If any of that is needed again, it is a re-introduction, not a revert: the old
components are gone from the tree and live only in git history.
