# Headless-browser probes and ship traps: the method half of the pi-dashboard.dev session

Research dossier. The METHOD half of the 2026-08-26/27 marketing-site session: how every visual and UI claim on pi-dashboard.dev was verified with headless-browser probes, plus the tooling and ship traps that cost real time. Reusable HOW — applies to any future static-site change. Sibling WHAT docs: `docs/research/marketing-site-static-rewrite.md` (what shipped) and `docs/research/webgl-field-and-glass-bands.md` (the visual system). No OpenSpec change.

## Framing

Originating work: one hand-written landing page over a WebGL field. Every visual claim — sticky header, zero overflow, contrast over a moving backdrop, production fallbacks — had to be MEASURED, not eyeballed. Session produced two permanent scripts, a set of probe rules, and a stack of git/deploy traps. This doc records the reusable method: what a screenshot can and cannot prove, how to sample moving pixels, and how to ship without sweeping in other agents' work.

## Finding 1 — two permanent scripts replaced the throwaway probes

- `site/design-scratch/scripts/serve.mjs` — zero-dependency static server. Default root `site/`, default port `8791`, flags `--port` / `--root`.
- Required because `field.js` is an ES module and module imports are BLOCKED under `file://` (CORS).
- `cache-control: no-store` — always re-read; this is an edit-refresh loop.
- Path-traversal guard: `normalize()` first, then confirm result still inside `ROOT` — `/../../.ssh/id_rsa` is otherwise a working file read.
- `site/design-scratch/scripts/shoot.mjs` — screenshot + layout-audit driver. Flags `--themes` / `--widths` / `--sections` / `--page` / `--base` / `--out` / `--settle` / `--audit` / `--links`.
- Every assertion in it is a defect this page ACTUALLY shipped: doc/nav overflow (`scrollWidth - clientWidth`, only ever visible at 900px and 1024px), `position:sticky` silently overwritten to `relative`, dead in-page anchors after a section was deleted, broken `<img>`, any `pageerror`.
- `process.exit(failures ? 1 : 0)` — exits NON-ZERO on failure, so it works as a gate.
- `--links` checks anchors ONLY: `<link rel=preconnect>` targets are origins, not pages, and answer 404 by design — `fonts.googleapis.com` / `fonts.gstatic.com` both do.

## Finding 2 — a screenshot proves paint, not behaviour

- Assertions a picture cannot make:
  - header still `position: sticky` AFTER scrolling to page bottom — `window.scrollTo(0, document.body.scrollHeight)`, wait 600ms, re-measure;
  - `document.elementFromPoint` at an element's centre actually hits that element's own `href` — proves a click target, not a decoration under an overlay;
  - `scrollWidth - clientWidth` on BOTH `.nav` and `documentElement`;
  - `naturalWidth > 0` per `<img>`.
- Prefer a measured predicate over a rendered pixel wherever one exists.
- `--audit` = numbers only, no PNGs. The audit half is the half that matters.

## Finding 3 — headless Chromium reports the LIGHT colour scheme regardless of host OS

- Theme left on "system" silently shoots light every time.
- Probes MUST set the storage key explicitly: `localStorage.setItem('pi-theme', 'dark'|'light'|'system')` via `page.addInitScript` — i.e. BEFORE first paint.
- Clicking the UI control is NOT a substitute: the lab panel and some header controls are `display:none` at ≤720px.
- "System" path: Playwright `newPage({ colorScheme })` and `page.emulateMedia({ colorScheme })` for a LIVE OS flip.
- `waitUntil:"commit"` proves the no-flash inline script resolved before first paint.

## Finding 4 — probe scripts must run from the repo root

- Running a Playwright script from `/tmp` fails with `ERR_MODULE_NOT_FOUND: playwright`.
- Either place the script in the project tree, or resolve the dependency explicitly: `createRequire('/abs/path/in/repo/x.js')('playwright')`.
- Launch with `--enable-unsafe-swiftshader` for WebGL under headless software raster — without it the canvas silently renders nothing and every shot is blank.

## Finding 5 — a probe that never closes the browser HANGS the tool call

- One throwaway FPS script omitted `await browser.close()`. Chromium stayed alive; the call had to be aborted — which also killed the backgrounded static server in the same process group.
- ALWAYS wrap probe bodies in `try { … } finally { await browser.close(); }`.
- Recovery: `pkill -f <script>.mjs`, then restart the server with `nohup … & disown`. Note: `setsid` does NOT exist on macOS.

## Finding 6 — pixel-level assertions are available in-repo

- `pngjs`, `pixelmatch`, `sharp` and `jimp` all present in root `node_modules`.
- Decode a Playwright screenshot buffer with `PNG.sync.read()` — that is how the WCAG contrast sampling in the sibling glass doc was done.
- Animation proof: screenshot twice ~1.2s apart, assert `Buffer.compare` differs.

## Finding 7 — contrast over a moving backdrop needs multi-frame sampling and per-element boxes

- First attempt sampled the WHOLE band rectangle with children hidden → meaningless `1.00:1`. The rect included regions where opaque cards normally sit, exposing raw field pixels no text ever sits on.
- Correct method: enumerate text runs that sit DIRECTLY on the translucent surface (walk ancestors, skip any with a background alpha > 0.9), hide only those elements, then sample inside each element's own bounding box across SIX frames.
- Result in the sibling glass doc — `webgl-field-and-glass-bands.md` Finding H.

## Finding 8 — audit the BUILT artifact and then the LIVE URL, not just the working tree

- `shoot.mjs --base` accepts any origin.
- Ran: 21 runs against `site/dist` served locally, then 9 runs against `https://pi-dashboard.dev` after deploy.
- Live pass caught nothing this time but is the ONLY check that covers the build's allowlist, the `CNAME`, and the `/app/` neutral-shell subpath.
- Post-deploy probes should assert deployed-only facts: computed `backdrop-filter` is `url("#chroma")` at 1440px and `none` at 390px — proves the mobile fallback is real in production, not just in local CSS.

## Finding 9 — `git` loses `.git/index.lock` to the dashboard's own polling

- `git stash push` and `git pull --rebase` failed twice with "Unable to create '.git/index.lock': File exists" while `ps` showed a background `git status --porcelain` (the dashboard polls the repo).
- Retry with backoff — a loop of ~8 attempts, 2s apart, succeeded on attempt 2.
- Do NOT delete a lock you did not place — removing another process's lock is how an index gets corrupted.

## Finding 10 — stage by path when the tree holds other agents' work

- Working tree carried uncommitted work from other sessions: `.dockerignore`, `openspec/changes/…`, `docs/features.md`, `docs/user-features.md`, `docs/AGENTS.md` rows.
- `git add -A` would have swept it into a site commit. Stage explicit paths, then verify with `git diff --cached --name-only`.
- Check `git rev-list --left-right --count origin/<branch>...HEAD` BEFORE pushing: the first push carried an unrelated local commit (`plan(fix-runaway-keeper-log-growth)`) that another session had left on `develop`.
- Publishing someone else's commit is a decision for the human, not a side effect.

## Finding 11 — deploy path-filter maintenance

- `deploy-site.yml` triggers on `paths: ["site/**"]`.
- Moving the design scratch tree under `site/` would have made every mockup tweak deploy production for zero change in output.
- Fix: `- "!site/design-scratch/**"` added to the filter.

## Sources

- Repo: `site/design-scratch/scripts/serve.mjs`, `site/design-scratch/scripts/shoot.mjs`, `.github/workflows/deploy-site.yml`.
- Session 2026-08-26/27. 21 local audit runs (`site/dist`), 9 live runs (`https://pi-dashboard.dev`).
- Siblings: `docs/research/marketing-site-static-rewrite.md`, `docs/research/webgl-field-and-glass-bands.md`.
