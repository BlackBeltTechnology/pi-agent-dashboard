## Why

pi-dashboard.dev is a single static page that only ranks for its own brand name. "pi" collides with Raspberry Pi, Inflection's Pi and π, and the page never names or links the pi coding agent (`badlogic/pi-mono`). Search engines have nothing that ties it to that entity. The site also serves no `robots.txt`, `sitemap.xml`, structured data or `llms.txt`.

The `marketing-site` spec still describes the Astro-era page: bento-grid data files, kraken and mission-graph backdrops, a four-state hero, a "What is pi?" section that was deliberately deleted, and a screenshot pipeline that no longer exists. The SEO work touches those requirements, so they are reconciled in this change.

## What Changes

Scope is `site/`, with `index.html` staying the single HTML page. No new HTML pages, no framework, no dependencies.

- **Head metadata**: a keyword-bearing `<title>` ("PI Dashboard: Web & Mobile UI for the pi Coding Agent"), a ≤155-char meta description, aligned og/twitter text, and `og:image:width/height/alt`.
- **Structured data**: one inline JSON-LD `SoftwareApplication` (name, description, OS list, free offer, MIT license, `sameAs` → GitHub, npm, pi-mono). It has no release-version fields, so it cannot go stale.
- **Entity link**: the hero subhead says "pi coding agent" and links pi-mono. No "What is pi?" section is restored; its deletion is reconfirmed.
- **Feature-card copy**: keep the H3 titles and retune the first body clause of four cards so each names its capability in search language (git worktree + OpenSpec, in parallel, schedule, from your phone).
- **On-page FAQ** (`#faq` after `#install`, 6 `<details>` items, each with a source comment): coding-agent compatibility (pi only), pi prerequisite per install route, MIT/self-hosted, phone access, model providers, unsigned-build unblocking.
- **Crawler files** in `site/public/`: `robots.txt` (`Disallow: /app/` + sitemap pointer), `sitemap.xml` (apex only), `llms.txt`.
- **Social card**: `og-card.png` (~980 KB) is replaced by `og-card.jpg` (≤300 KB).
- **Spec reconciliation** in `marketing-site`: REMOVE the eight Astro-era requirements (What is pi, storytelling hero, two-card Why, bento grid, mission graph, kraken, `data-reveal` scroll reveal, dashboard-seeding screenshot pipeline); ADD static-page replacements written from the current code.
- **Root `screenshots` script** repointed to `npm --prefix site run shots`. Today it calls a script that `site/package.json` does not define.
- **Contract test** `site-seo-contract.test.ts` guarding the SEO requirements.

Out of scope: README link, root `package.json` keywords, GitHub topics, Search Console, backlinks, new HTML pages, font self-hosting, and the pre-existing missing `scroll-margin-top` under the sticky header.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `marketing-site`: ADD pi-entity linking, search metadata + JSON-LD, crawler files, on-page FAQ, static features grid, Why section, hero film, ambient WebGL background, script-applied scroll reveal, static-site screenshot/audit driver. REMOVE eight requirements that describe the deleted Astro page.

## Impact

- `site/index.html`: head, hero subhead, feature-card copy, new `#faq` section + its CSS.
- `site/public/`: new `robots.txt`, `sitemap.xml`, `llms.txt`, `og-card.jpg`; `og-card.png` deleted. `site/README.md` reference updated.
- Root `package.json`: `screenshots` script target (one line).
- `packages/shared/src/__tests__/site-seo-contract.test.ts`: new.
- `site/build.mjs`: comment-only edit (og-card rename at L45); its copy and ref-check logic are unchanged. `deploy-site.yml` is unchanged (`public/` is already copied; `site/**` already triggers deploys).
- `site/design-scratch/scripts/shoot.mjs`: `faq` added to default sections; header comment paths fixed.
- `/app/` stays served (neutral-shell-publication unaffected) and is only excluded from crawling.
- No runtime, server, client or extension impact. Rollback = revert the commit and redeploy. Direct hotlinks to `/og-card.png` will 404 after deploy (accepted).

## Discipline Skills

None apply. There is no auth, untrusted input or secrets, no runtime latency path, no new endpoint or job, and no irreversible step: it's a static content and spec edit that one revert rolls back. `review-code` runs at the normal pre-commit checkpoint.
