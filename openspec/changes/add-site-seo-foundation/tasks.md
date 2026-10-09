## 1. Crawler files

- [ ] 1.1 Add `site/public/robots.txt` with exactly `User-agent: *`, `Disallow: /app/` and `Sitemap: https://pi-dashboard.dev/sitemap.xml`; verify by reading the file.
- [ ] 1.2 Add `site/public/sitemap.xml`: `urlset` with `xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"` and one `<url><loc>https://pi-dashboard.dev/</loc></url>`, no `lastmod`; verify with `xmllint --noout site/public/sitemap.xml`.
- [ ] 1.3 Add `site/public/llms.txt`: first line `# PI Dashboard`, a summary containing "pi coding agent", and links to the site, GitHub repo and pi-mono (install pointers are free copy, not asserted); verify by reading it.

## 2. Head metadata

- [ ] 2.1 In `site/index.html`, set `<title>` to `PI Dashboard: Web & Mobile UI for the pi Coding Agent`. Set the meta description, og:description and twitter:description to `Open-source, self-hosted dashboard for the pi coding agent. Watch sessions live, answer prompts, run agents in parallel and take over from your phone.` Set og:title and twitter:title equal to `<title>`. Verify title ≤60 and description ≤155 chars.
- [ ] 2.2 Produce `site/public/og-card.jpg` from `og-card.png` (1424×752): resize to width 1200, centre-crop to 1200×630, JPEG ≤300 KB, using OS tools only (`sips`/ImageMagick). Delete `og-card.png`. Point `og:image`/`twitter:image` at `https://pi-dashboard.dev/og-card.jpg`. Add `og:image:width` 1200, `og:image:height` 630 and `og:image:alt`. Update `site/README.md` and the `site/build.mjs:45` comment. Verify with `sips -g pixelWidth -g pixelHeight` and `wc -c`.
- [ ] 2.3 Add the JSON-LD `SoftwareApplication` block (design D1: `downloadUrl` → releases index, no version; `offers` `{price:"0", priceCurrency:"USD"}`; `sameAs`: `https://github.com/BlackBeltTechnology/pi-agent-dashboard`, `https://www.npmjs.com/package/@blackbelt-technology/pi-agent-dashboard`, `https://github.com/badlogic/pi-mono`); verify it `JSON.parse`s and the contract-test JSON-LD assertions pass.

## 3. Content

- [ ] 3.1 Hero subhead: "Every pi session" becomes "Every <a href="https://github.com/badlogic/pi-mono">pi coding agent</a> session" (the full phrase is the link text); verify visually in both themes.
- [ ] 3.2 Retune the first body clause of the "Branches and worktrees" (git worktree + OpenSpec), "Watch multi-agent runs" (in parallel), "Cron and file triggers" (schedule) and "Phone in 10 seconds" (from your phone) cards; H3s unchanged. Verify with the contract-test card-phrase assertion.
- [ ] 3.3 Add `<section id="faq" data-field="close">` after `#install`, with six `<details>/<summary>` items per design D6. Each item gets a `<!-- source: … -->` comment. Style with existing tokens only. The compatibility item uses the agreed Q/A wording and links pi-mono; the unsigned-build item links `#install`. Verify with the contract-test FAQ assertions (order, ≥6 items, keywords, source comments, anchors, no literals).

## 4. Spec reconciliation + tooling

- [ ] 4.1 Repoint the root `package.json` `screenshots` script to `npm --prefix site run shots`; verify `npm pkg get scripts.screenshots` prints that.
- [ ] 4.2 In `site/design-scratch/scripts/shoot.mjs`, add `faq` to the default `SECTIONS` and fix the header comments that name `site/design-scratch/mockup/scripts/`; verify `grep -n 'SECTIONS = list.*faq' site/design-scratch/scripts/shoot.mjs` matches and `grep -c 'mockup/scripts' site/design-scratch/scripts/shoot.mjs` prints 0.
- [ ] 4.3 Rewrite `## Purpose` in `openspec/specs/marketing-site/spec.md` to describe the static page: source, theming, hero film, features grid, FAQ, SEO metadata/crawler files, release sync, Pages deploy, screenshot/audit driver. Verify the Purpose block has no output for `grep -iE 'bento|mission|kraken|what is pi|storytelling|TUI versus GUI'`, and `openspec validate --specs --strict` passes.

## 5. Tests

Author these first in `packages/shared/src/__tests__/site-seo-contract.test.ts` (one `describe` per row, id in the title) and verify they FAIL on the current tree before §1–4. Rows E16, E18–E22 pin existing behaviour and pass immediately.

- [ ] 5.1 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): `site/index.html` head · contract test reads it · title ≤60 with "PI Dashboard" + "pi Coding Agent", description ≤155 with "pi coding agent", canonical `https://pi-dashboard.dev/`, og/twitter title = `<title>` (test-plan #E1)
- [ ] 5.2 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): og/twitter image URLs · map to `site/public/<f>` + stat + JPEG header · file exists, ≤307200 bytes, 1200×630 matching `og:image:width/height`, `og:image:alt` non-empty (test-plan #E2)
- [ ] 5.3 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): `index.html` + `site/public/` · search `og-card.png` · zero references, file absent (test-plan #E3)
- [ ] 5.4 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): JSON-LD blocks · count + `JSON.parse` · exactly one `SoftwareApplication` with schema.org context, required fields, `offers` price "0"/USD, https `license` (test-plan #E4)
- [ ] 5.5 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): parsed JSON-LD · inspect `sameAs` + serialized JSON · GitHub/npm/pi-mono URLs present, no `softwareVersion`, no `/releases/download/` (test-plan #E5)
- [ ] 5.6 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): hero subhead · find pi-mono `<a>` · link text = "pi coding agent", no bare "pi" link (test-plan #E6)
- [ ] 5.7 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): `#faq` Claude Code item · inspect its `<details>` · links pi-mono and mentions "Oh My Pi" (test-plan #E7)
- [ ] 5.8 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): `site/public/robots.txt` · read lines · `User-agent: *`, `Disallow: /app/`, sitemap line present; no bare `Disallow: /` (test-plan #E8)
- [ ] 5.9 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): `site/public/sitemap.xml` · regex · sitemap-0.9 `urlset`, exactly one `<loc>` = `https://pi-dashboard.dev/` (test-plan #E9)
- [ ] 5.10 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): `site/public/llms.txt` · read · first line `# PI Dashboard`, "pi coding agent", site/GitHub/pi-mono links (test-plan #E10)
- [ ] 5.11 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): `site/build.mjs` source · assert public/ copy loop · every `site/public/` entry is copied to the dist root (test-plan #E11)
- [ ] 5.12 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): `#faq` section · position + `<details>` count + text · after `#install`, ≥6 items with summary+answer, all 7 topic keywords, `data-field="close"` (test-plan #E12)
- [ ] 5.13 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): each `#faq` `<details>` · regex · every block has `<!-- source:`; failure names the summary (test-plan #E13)
- [ ] 5.14 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): `#faq` in-page hrefs · id lookup · every `#x` target exists; unsigned-build item links `#install` (test-plan #E14)
- [ ] 5.15 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): `#faq` markup + its CSS · colour-literal regex · no hex/`rgb(`/`hsl(` literals (test-plan #E15)
- [ ] 5.16 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): `#features` · count cards · ≥9 `<h3>` each with a non-empty body (test-plan #E16)
- [ ] 5.17 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): four target cards split by `<h3>` · body text (ci) · each card holds its bound phrases; failure names card + phrase (test-plan #E17)
- [ ] 5.18 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): `#control` · strip h2 + scan chips · exact h2 text; "Working", "Needs you", "Idle" present (test-plan #E18)
- [ ] 5.19 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): `<video id="film">` · attribute regex · autoplay/muted/loop/playsinline/poster/aria-label + webm and mp4 sources (test-plan #E19)
- [ ] 5.20 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): `index.html`, `field.js`, `gol.js` · regex · both canvases `aria-hidden="true"`; both renderers observe `data-theme` and compose a still frame under reduced motion (test-plan #E20)
- [ ] 5.21 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): inline reveal script · regex · reduced-motion/no-IO early return precedes tagging; `Math.min(i, 5) * 70`; exit sets `--rv` + removes `in` (test-plan #E21)
- [ ] 5.22 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): `<head>` · script vs stylesheet order · first head script reads `pi-theme` and sets `data-theme` light before any stylesheet; no `class="dark"` theming (test-plan #E22)
- [ ] 5.23 L1 contract test (see packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts): `shoot.mjs`, root + site `package.json` · regex/JSON · `faq` in default SECTIONS, non-zero exit on failure, no `mockup/scripts` paths, root `screenshots` = `npm --prefix site run shots` (test-plan #E23)

## 6. Verification

- [ ] 6.1 `npx vitest run packages/shared/src/__tests__/site-` passes (all site contract tests green, incl. the new file, `site-deploy-workflow-contract` E13/E15 and `site-design-tokens-contract`).
- [ ] 6.2 `npm --prefix site run build` succeeds and `site/dist/` contains `robots.txt`, `sitemap.xml`, `llms.txt`, `og-card.jpg`, and no `og-card.png`.
- [ ] 6.3 Update AGENTS.md rows: `site/` (new `public/` files, `index.html` purpose), `packages/shared/src/__tests__/` (new test), and `site/design-scratch/scripts/` if a row exists for `shoot.mjs`.

## 7. Manual verification

- [ ] 7.1 Theme first paint: with storage cleared and emulated light OS, `data-theme="light"` on first paint and no dark flash; with dark OS the attribute is absent (test-plan: manual-only, #F1).
- [ ] 7.2 Click Light and reload: `data-theme="light"`, `localStorage['pi-theme']==='light'`, Light `aria-checked="true"` (test-plan: manual-only, #F2).
- [ ] 7.3 In System mode, flip the emulated OS scheme: the theme follows without a reload (test-plan: manual-only, #F3).
- [ ] 7.4 Switch theme at film t≈5 s: sources/poster swap to the light files and `currentTime` stays within ±1 s (test-plan: manual-only, #F4).
- [ ] 7.5 Emulated reduced motion: the background renders once, with no recurring rAF loop (test-plan: manual-only, #F5).
- [ ] 7.6 Animating background: a theme switch recolours the next frames without a reload (test-plan: manual-only, #F6).
- [ ] 7.7 Scroll a revealed card out above and back: `in` is removed with `--rv=-34px`, then re-added (test-plan: manual-only, #F7).
- [ ] 7.8 Review `npm --prefix site run shots` PNGs (dark+light, 390/1440) for the hero link, the four cards and the FAQ (test-plan: manual-only, #F8).
- [ ] 7.9 With `npm --prefix site run dev` running, `npm --prefix site run audit` exits 0 across all themes and widths (test-plan: manual-only, #X1).
- [ ] 7.10 Post-deploy: the Rich Results Test detects SoftwareApplication with no errors (test-plan: manual-only, #X2).
- [ ] 7.11 Post-deploy: `/robots.txt`, `/sitemap.xml`, `/llms.txt` and `/app/` each return 200, and the og preview shows the new card (test-plan: manual-only, #X3).
