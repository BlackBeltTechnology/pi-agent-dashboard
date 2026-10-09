## Context

`site/` is a hand-written static page (`docs/research/marketing-site-static-rewrite.md`). `site/build.mjs` copies an allowlist plus every file in `site/public/` into `dist/`, and fails on unresolved `src=`/`href=` refs only; `content=` meta URLs are not checked. `deploy-site.yml` publishes `dist/` and copies `packages/shell` into `dist/app/`. Release data is inline and rewritten by `site/design-scratch/scripts/sync-release.mjs` via `data-asset`/`data-rel-tag` markers. Site contract tests live in `packages/shared/src/__tests__/site-*.test.ts` and read sources with `fs`. `site/` is not a workspace (root `package.json` `workspaces: ["packages/*"]`), so site scripts run via `npm --prefix site run <x>`. Motivation: see proposal.md.

## Goals / Non-Goals

**Goals:**
- Every SEO artifact is a static file or inline markup in `site/`; no build step is added.
- Every statically checkable scenario in the delta has an assertion in one contract test.
- `marketing-site/spec.md` describes the page that actually ships.

**Non-Goals:**
- New HTML pages, markdown rendering, comparison pages, font self-hosting.
- Off-site SEO (README, `package.json` keywords, topics, Search Console).
- `noindex` on `/app/`: that markup belongs to `packages/shell`.
- Fixing the missing `scroll-margin-top` under the sticky header (`site/index.html:163`). It is pre-existing and affects `#install` today.
- Pausing the hero film under reduced motion. The new "Hero product film" requirement records current behaviour only.
- Re-rendering the reduced-motion still frame on a theme change. `applyTheme` in `site/field.js:362-376` / `site/gol.js:600-612` does not call `renderer.render`, so the still frame keeps the old palette until the next render. The spec scenario is scoped to the animating case; the gap is recorded here for a follow-up fix.
- Racing `loadedmetadata` restores on rapid theme toggles (`site/index.html:1047`): existing behaviour, not addressed.

## Decisions

**D1: JSON-LD carries no release-specific fields.** `softwareVersion` and versioned download URLs would make `sync-release.mjs` own a second block. `downloadUrl` points at the releases index and the version is omitted. *Alternative:* extend `sync-release.mjs`. Rejected because it adds surface for no ranking benefit.

**D2: Crawler files are hand-written in `site/public/`.** With one canonical URL, `sitemap.xml` is fixed content. `lastmod` is omitted: a hand-kept date goes stale, and Google's sitemap docs say it uses `lastmod` only when it is consistently accurate (external source). *Alternative:* generate in `build.mjs`. Rejected until there is more than one page.

**D3: `/app/` is excluded via `robots.txt` only** (see Non-Goals). Crawling stops; an externally linked shell URL may still appear URL-only, which is acceptable for a pairing tool.

**D4: The pi entity link lives in the hero, FAQ and JSON-LD, not in a section.** The user reconfirmed the static rewrite's deletion of "What is pi?". The hero subhead's "pi coding agent" links pi-mono; the FAQ compatibility item repeats the link; JSON-LD `sameAs` names it for machines.

**D5: The FAQ uses native `<details>/<summary>`, no JS and no `FAQPage` schema.** Content is in the DOM and indexable while staying compact. Google's Aug 2023 Search Central announcement limited FAQ rich results to well-known government and health sites (external source), so the markup would add bytes with no benefit. The section uses `data-field="close"` (same mood as `#install`, a key `site/field.js` already handles). Styling uses existing tokens only. `site-design-tokens-contract.test.ts` does **not** guard raw literals; it checks token declarations. The new contract test therefore asserts no colour literals in the FAQ markup and CSS.

**D6: FAQ answers carry provenance.** Each `<details>` has an HTML comment naming its source (for example `<!-- source: README.md "only works with pi" -->`), because a test cannot verify truth. The compatibility item is asked as "Does it work with Claude Code or other coding agents?" (user decision: name Claude Code so the search phrase appears on the page). It is answered as "No: only the pi coding agent; Oh My Pi isn't supported either", which follows from README.md:20 ("only works with pi"). It then names the **model providers** that still work through pi (Anthropic, Codex, Copilot, Gemini; `site/index.html:775`). It doesn't name "Codex CLI", which would collide with the advertised Codex provider. The pi-prerequisite answer is per install route: Electron bundles pi, the pi-package route needs pi, and the npm route requires a working pi (as stated in the `#install` npm panel).

**D7: Copy edits keep titles and change the first body clause.** The H3 titles are the brand voice; the search phrases are bound per card (spec: "Capability phrases are bound to their cards").

**D8: One contract test, `site-seo-contract.test.ts`, following `site-deploy-workflow-contract.test.ts`.** It uses `fs`, regex and `JSON.parse`, with no DOM library. It covers every statically checkable scenario. SEO: head metadata, og file size and declared dimensions via the absolute-URL → `site/public/<file>` mapping, JSON-LD shape, entity link, FAQ order/count/keywords/source comments/anchor targets/no literals, card-phrase binding, crawler-file contents. Reconciled behaviour, as source facts: canvases `aria-hidden`, film attributes, `MutationObserver` on `data-theme`, the reveal stagger cap, reveal early return before tagging, `<h3>` count, Why h2 + statuses, head theme script placement, the root `screenshots` script string, and `faq` in `shoot.mjs` default sections. Runtime behaviour (theme swap, reduced-motion still frame, reveal reverse, `dist/` contents, rendered audit) stays as task-level verification. This test is the only enforcement of the og size cap; `build.mjs` does not inspect `content=`, and adding that would widen this change for one file.

**D9: Spec reconciliation records what ships; it does not change behaviour.** The REMOVED Astro requirements get replacement requirements written from the current code: `site/index.html` reveal script (~L1116) and film theme swap (~L1028); `site/field.js:615-620` and `site/gol.js:816-821` for the `data-theme` observer and the reduced-motion still frame; `site/design-scratch/scripts/shoot.mjs` (needs a page server at `:8791`, exits non-zero on audit failure); the head theme script and `applyTheme` (`site/index.html:12-35`, `:1063-1070`). "Theme selector" and "Performance and accessibility budgets" are MODIFIED in place: their scenario names are kept and their bodies corrected (`data-theme` instead of `class="dark"`, film swap instead of PNG mockups, `npm --prefix site run audit` instead of `-w site`). The code changes from reconciliation are the root `screenshots` script, `faq` added to `shoot.mjs`'s default `SECTIONS`, and `shoot.mjs` header comments that still name `site/design-scratch/mockup/scripts/`. The main spec's `## Purpose` (which still lists Astro-era sections) is edited directly, as `openspec instructions specs` directs ("To change an existing capability's Purpose … edit `openspec/specs/<capability-path>/spec.md` directly"), since a delta's Purpose is ignored.

**D9a: og-card becomes JPEG.** The source PNG is 1424×752 (aspect 1.894). It is resized to 1200 wide and centre-cropped to 630 high (aspect 1.905; about 4 px are lost). JPEG compresses a photographic card far better than PNG. `og-card.png` is deleted; `site/README.md` and the `site/build.mjs:45` comment are updated. `docs/research/*` are historical records and stay as written. Direct hotlinks to the old URL will 404; GitHub Pages has no redirects (accepted).

## Risks / Trade-offs

- [Copy edits blur the voice] → Titles stay; only four first clauses change. Review rendered shots in both themes.
- [Contract test brittle to wording] → It asserts short phrases and structure, not sentences.
- [Q1 reads as a negative for Claude Code users] → It answers honestly and immediately offers the provider list, so their models still work through pi.
- [Spec reconciliation scenarios mis-describe code] → Every replacement cites the source line it was written from; the doubt review re-verifies.
- [og size cap only enforced by vitest] → Accepted. Whether affected-test selection picks the new test on `site/**`-only diffs is unverified; the ship gate runs the full `site-*` contract tests (task 6.1) regardless.

## Migration Plan

Merge to `develop` → `deploy-site.yml` (`site/**`) deploys. Verify live: `/robots.txt`, `/sitemap.xml` and `/llms.txt` return 200; the Rich Results Test parses the JSON-LD; the og preview shows the new card. Rollback = revert; the next deploy restores the previous files.
