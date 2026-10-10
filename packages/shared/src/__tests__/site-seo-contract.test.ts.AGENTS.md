# __tests__/site-seo-contract.test.ts — index

Static contracts for change add-site-seo-foundation (test-plan E1–E23). Reads `site/` sources with `fs` + regex + `JSON.parse`; no DOM lib. Exemplar: `site-deploy-workflow-contract.test.ts`.
- E1: `<title>` ≤60 with "PI Dashboard" + "pi Coding Agent"; description ≤155 with "pi coding agent"; canonical apex; og/twitter title = `<title>`.
- E2–E3: `og:image`/`twitter:image` → `site/public/og-card.jpg`, ≤307200 bytes, 1200×630 via JPEG SOF0/SOF2 parse (`jpegSize`); `og:image:width/height/alt` declared; no `og-card.png` ref or file.
- E4–E5: one JSON-LD `SoftwareApplication`; `offers` price "0"/USD; https `license`; `sameAs` ⊇ GitHub, npm, pi-mono; no `softwareVersion`, no `/releases/download/`.
- E6–E7: hero lede links pi-mono with text "pi coding agent"; FAQ Claude Code item links pi-mono + names "Oh My Pi".
- E8–E11: `public/robots.txt` (`Disallow: /app/`, sitemap line, no `Disallow: /`); `sitemap.xml` one `<loc>`; `llms.txt` heading + links; `build.mjs` public/ copy loop.
- E12–E15: `#faq` after `#install`, `data-field="close"`, ≥6 `<details>`, topic keywords, `<!-- source:` per item, `#x` anchors resolve, no colour literals in markup or `faq` CSS rules.
- E16–E23: ≥9 feature cards; card phrase binding; `#control` h2 + statuses; `<video id="film">` attrs; canvases `aria-hidden` + `MutationObserver` on `data-theme` + `composeStill`; reveal early return/stagger/exit; head theme script before stylesheets; `shoot.mjs` default SECTIONS ⊇ `faq`, root `screenshots` = `npm --prefix site run shots`.
