# Test Plan: add-site-seo-foundation

Stage: design   Generated: 2026-10-09

All L1 rows live in one file, `packages/shared/src/__tests__/site-seo-contract.test.ts` (vitest, `fs` + regex + `JSON.parse`, no DOM lib). The harness exemplar is `packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts` (its `read()` helper and repo-root resolution). "Section text" means the markup between `<section id="X"` and its closing `</section>`, tags stripped.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Search metadata › Title and description | BVA | L1 | automated | `<title>` and `meta[name=description]` content of `site/index.html` | contract test reads head | title length ≤60 and contains "PI Dashboard" + "pi Coding Agent" (ci); description ≤155 and contains "pi coding agent" (ci); `link[rel=canonical]` href = `https://pi-dashboard.dev/`; og:title/twitter:title equal `<title>` text |
| E2 | Search metadata › Social card | BVA + EP | L1 | automated | `og:image` / `twitter:image` content URLs | map `https://pi-dashboard.dev/<f>` → `site/public/<f>`; `statSync` | both URLs absolute on that origin; file exists; size ≤ 307200 bytes; `og:image:width`=1200, `og:image:height`=630, `og:image:alt` non-empty; JPEG SOF0/SOF2 header width/height bytes = 1200×630 |
| E3 | Search metadata › Social card (stale ref) | EP (invalid class) | L1 | automated | `site/index.html` + `site/public/` listing | search for `og-card.png` | zero occurrences in `index.html`; `site/public/og-card.png` absent |
| E4 | Search metadata › Structured data | EP | L1 | automated | the `script[type="application/ld+json"]` blocks | count, then `JSON.parse` | exactly 1 block; parses; `@context`=`https://schema.org`, `@type`=`SoftwareApplication`; non-empty `name`/`description`/`operatingSystem`/`applicationCategory`; `offers.price`=`"0"`, `offers.priceCurrency`=`"USD"`; `license` starts with `https://` |
| E5 | Search metadata › Structured data (entity + no staleness) | EP (invalid class) | L1 | automated | parsed JSON-LD | inspect `sameAs` + serialized JSON | `sameAs` ⊇ {GitHub repo URL, `https://www.npmjs.com/package/@blackbelt-technology/pi-agent-dashboard`, `https://github.com/badlogic/pi-mono`}; no `softwareVersion` key; serialized JSON contains no `/releases/download/` |
| E6 | pi entity › Hero subhead | EP | L1 | automated | hero `<p>` subhead (first `<p>` after `<h1>`) | find `<a>` with pi-mono href | anchor text (tags stripped, ci) = "pi coding agent"; no `<a>` in the subhead whose text is exactly "pi" |
| E7 | pi entity › FAQ link | EP | L1 | automated | `#faq` section markup | find the `<details>` whose `<summary>` contains "Claude Code" | that `<details>` contains `href="https://github.com/badlogic/pi-mono"` and the text "Oh My Pi" |
| E8 | Crawler files › robots.txt | EP (valid + invalid) | L1 | automated | `site/public/robots.txt` | read lines | contains `User-agent: *`, `Disallow: /app/`, `Sitemap: https://pi-dashboard.dev/sitemap.xml`; no line matching `^Disallow:\s*/\s*$` |
| E9 | Crawler files › sitemap | BVA (count = 1) | L1 | automated | `site/public/sitemap.xml` | regex `<urlset` + count `<loc>` | root `urlset` with `xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"`; exactly one `<loc>`, value `https://pi-dashboard.dev/` |
| E10 | Crawler files › llms.txt | EP | L1 | automated | `site/public/llms.txt` | read | first line `# PI Dashboard`; contains "pi coding agent" (ci); contains `https://pi-dashboard.dev/`, the GitHub repo URL, `https://github.com/badlogic/pi-mono` |
| E11 | Crawler files › Build ships | EP | L1 | automated | `site/build.mjs` source | assert copy loop | build copies every entry of `site/public/` to the dist root (pins `readdir(join(HERE, "public"))` + `cp(... join(DIST, name))`), so the three crawler files ship without an allowlist edit |
| E12 | On-page FAQ › present + order + topics | BVA (≥6) + EP | L1 | automated | `site/index.html` | index of `id="install"` vs `id="faq"`; count `<details>` in `#faq` | `#faq` index > `#install` index; ≥6 `<details>`, each with a non-empty `<summary>` and answer text outside it; section text contains "Claude Code", "Oh My Pi", "install", "MIT", "phone", "Anthropic", "SmartScreen"; `data-field="close"` on the section |
| E13 | On-page FAQ › provenance | EP (invalid class) | L1 | automated | each `<details>` block in `#faq` | regex per block | every block contains `<!-- source:`; a block without it fails the test with its summary text in the message |
| E14 | On-page FAQ › anchors resolve | EP | L1 | automated | all `href="#x"` inside `#faq` | lookup `id="x"` in `index.html` | each target id exists; the `<details>` whose summary mentions macOS/Windows/SmartScreen links `#install` |
| E15 | On-page FAQ › tokens only | EP (invalid class) | L1 | automated | `#faq` markup + CSS rules whose selector contains `#faq` or a class used only inside `#faq` | regex `#[0-9a-fA-F]{3,8}\b`, `rgb\(`, `hsl\(` (excluding `var(` usages and `href="#…"`) | zero matches |
| E16 | Static features grid › cards | BVA (≥9) | L1 | automated | `#features` section | count `<h3>` and bodies | ≥9 `<h3>`; each followed by a non-empty `<p>` within its card |
| E17 | Static features grid › phrase binding | decision table | L1 | automated | the four target cards, split by `<h3>` title | body text (ci) | "Branches and worktrees" ⊇ {"git worktree", "OpenSpec"}; "Watch multi-agent runs" ⊇ "in parallel"; "Cron and file triggers" ⊇ "schedule"; "Phone in 10 seconds" ⊇ "from your phone"; failure names the card + missing phrase |
| E18 | Why section | EP | L1 | automated | `#control` section | strip tags from `<h2>`; scan chips | h2 = "Agents run for hours. You should not have to sit there."; section text contains "Working", "Needs you", "Idle" |
| E19 | Hero product film | EP | L1 | automated | `<video id="film">` open tag + children | attribute regex | has `autoplay`, `muted`, `loop`, `playsinline`, `poster="media/hero-`, non-empty `aria-label`; `<source>` with `type="video/webm"` and `type="video/mp4"` |
| E20 | Ambient WebGL › decorative + observers (source pins) | EP | L1 | automated | `site/index.html`, `site/field.js`, `site/gol.js` | regex | `<canvas id="field"` and `<canvas id="life"` both carry `aria-hidden="true"`; both JS files contain `new MutationObserver(` observing `attributeFilter: ['data-theme']`, and `if (still.matches) composeStill()` |
| E21 | Script-applied reveal (source pins) | EP | L1 | automated | inline reveal script in `site/index.html` | regex | `if (still \|\| !('IntersectionObserver' in window)) return;` precedes the first `classList.add('reveal')`; stagger expression `Math.min(i, 5) * 70`; exit branch sets `--rv` and removes `in`; static CSS has no rule hiding content without `.reveal` (`.reveal{opacity:0` is the only `opacity:0` reveal rule) |
| E22 | Theme selector › first-paint script (source pin) | EP | L1 | automated | `site/index.html` `<head>` | position of first `<script>` vs first `<link rel="stylesheet"` / `<style>` | the first child script of `<head>` reads `pi-theme` and calls `setAttribute('data-theme','light')`, and appears before any stylesheet/`<style>`; the file contains no `classList.add('dark')` / `class="dark"` on `<html>` |
| E23 | Screenshot/audit driver (source pins) | EP | L1 | automated | `site/design-scratch/scripts/shoot.mjs`, root `package.json`, `site/package.json` | regex + JSON.parse | default `SECTIONS` list includes `faq` and the five prior sections; contains `process.exit(failures ? 1 : 0)`; no `mockup/scripts` path in the file; root `scripts.screenshots` = `npm --prefix site run shots`; `site/package.json` defines `shots` and `audit` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Theme selector › First paint | state-transition | — | manual-only | browser, `localStorage` cleared, emulated `prefers-color-scheme: light` (DevTools) | load `npm --prefix site run dev` page | `document.documentElement.dataset.theme === 'light'` on first paint, no dark flash; with emulated dark the attribute is absent [no static-site browser harness, see New infra] |
| F2 | Theme selector › Explicit choice persisted | state-transition | — | manual-only | page loaded in System mode | click Light, reload | `data-theme="light"`, `localStorage['pi-theme']==='light'`, Light button `aria-checked="true"` |
| F3 | Theme selector › System tracks OS live | state-transition | — | manual-only | System mode, emulated dark | flip emulation to light without reload | `data-theme` becomes `light` without navigation |
| F4 | Theme selector › film swap | state convergence | — | manual-only | film playing at t≈5 s, dark | switch to Light | `#film` `currentSrc` ends `hero-light-web.*`, poster `hero-light-poster.jpg`, `currentTime` within ±1 s of 5 s after `loadedmetadata` |
| F5 | Ambient WebGL › Reduced motion still frame | state-transition | — | manual-only | emulated `prefers-reduced-motion: reduce` | load page; record rAF calls for 2 s | background renders once; no recurring `requestAnimationFrame` from `field.js`/`gol.js` (Performance panel shows no frame loop) |
| F6 | Ambient WebGL › Animated bg follows theme | state convergence | — | manual-only | animating background, dark | switch to Light | next frames use the light palette with no reload |
| F7 | Script-applied reveal › reverse on exit | state-transition | — | manual-only | a revealed `.card` in viewport | scroll it out above, then back | on exit `in` removed and `--rv` = `-34px`; on re-entry `in` re-added |
| F8 | Visual review of new copy + FAQ | visual/subjective | — | manual-only | `npm --prefix site run shots` PNGs (dark+light, 390/1440) | human review | hero link, four retuned cards and FAQ read in brand voice, FAQ `<details>` legible in both themes [judgment] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Performance & a11y budgets › audit | fault surface | — | manual-only | any overflow / dead anchor / broken image / page error / non-sticky header introduced by the new sections | `npm --prefix site run audit` against `npm --prefix site run dev` | exit 0 across dark/light × 390/1440; any violation exits 1 with a `FAIL` line naming theme + width |
| X2 | Search metadata › Structured data (external validator) | external conformance | — | manual-only | Google Rich Results Test | paste live URL post-deploy | JSON-LD detected as SoftwareApplication with no errors (warnings acceptable) |
| X3 | Crawler files › deployed | fault surface | — | manual-only | Pages deploy | `curl -sI https://pi-dashboard.dev/{robots.txt,sitemap.xml,llms.txt}` post-deploy | each returns HTTP 200; `/app/` still returns 200 (neutral-shell-publication unaffected) |

---

## Coverage summary

- Requirements covered: 12/12 delta requirements (10 ADDED, 2 MODIFIED). The 8 REMOVED ones are covered by their replacement rows. Unchanged-scenario "No bundle budget is asserted" stays covered by existing workflow review, so no new row.
- Scenarios by class: edge 23 · perf 0 · frontend 8 · error 3
- Scenarios by level: L1 23 · L2 0 · L3 0 · — 11
- Scenarios by disposition: automated 23 · manual-only 11

## New infra needed

- A Playwright spec for the **static site** (served by `npm --prefix site run dev`) would automate F1–F7 and X1. `tests/e2e/` targets the dashboard docker harness, and `shoot.mjs` is a screenshot/audit driver, not a test runner. **Not created in this change**; the F-rows remain manual-only.
