# Test Plan — anti-slop-taste-v2

Stage: design   Generated: 2026-10-09

Skills are prose. Automated rows are static L1 contract tests that assert the
**normative sentences and artifacts exist** (design D9). Whether an agent
*obeys* them is manual-only. Homes:

- `scripts/__tests__/anti-slop-suite-contract.test.mjs` (new file in the
  existing `scripts` vitest project; exemplar `scripts/__tests__/skill-frontmatter.test.mjs`)
- `packages/dashboard-plugin-skill/src/__tests__/host-design-tokens.test.ts`
  (exemplar `packages/dashboard-plugin-skill/src/__tests__/render-new.test.ts`)

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Pinned upstream provenance | BVA (SHA format) | L1 | automated | `packages/anti-slop/UPSTREAM.md` | parse the commit line | exactly one 40-hex SHA; a 39-hex or 41-hex value fails; date `YYYY-MM-DD` and `MIT` present |
| E2 | Pinned upstream provenance | EP (map completeness) | L1 | automated | `UPSTREAM.md` section-map tables | parse rows per upstream skill (taste-skill, redesign-skill, image-to-code-skill, imagegen-frontend-web, brandkit) | each of the 5 has ≥1 row; every row's target cell is a package skill name or starts `dropped:` followed by a non-empty reason; zero cells equal `TBD`/empty |
| E3 | Pinned upstream provenance | decision table | L1 | automated | frontmatter of the 4 suite SKILL.md files | read `metadata.adapted_from` | all 4 name an upstream skill and contain a prefix (≥7 hex) of the SHA in `UPSTREAM.md`; a mismatched prefix fails |
| E4 | Package declares every shipped skill | set equality | L1 | automated | `packages/anti-slop/package.json` `pi.skills` + `packages/anti-slop/.pi/skills/*/` | compare sets | sets equal = {anti-slop-frontend, anti-slop-redesign, anti-slop-image-direction, anti-slop-brandkit}; an extra dir or missing entry fails |
| E5 | Package declares every shipped skill (publish) | EP | L1 | automated | `packages/anti-slop/package.json` `files` | check entries | `files` contains `UPSTREAM.md` and `.pi/skills/` |
| E6 | Package declares every shipped skill (frontmatter) | BVA (400 budget) | L1 | automated | 3 new SKILL.md descriptions | measure length; check `BUDGET_EXEMPT_SKILLS` | each ≤ 400 chars; none of the 3 new names in the exempt set |
| E7 | Package declares every shipped skill (pin) | invariant | L1 | automated | `anti-slop-frontend` description | existing digest test `scripts/__tests__/skill-frontmatter.test.mjs` | sha256 still `829c144c…` (test unchanged, stays green) |
| E8 | Design Read and surface profile | decision table | L1 | automated | `anti-slop-frontend/SKILL.md` profile table | parse rows `product-ui` / `marketing` / `new-site` | `product-ui` row: Part A ✓, Part B ✗, layout ✗, image direction forbidden; `marketing` + `new-site`: Part A, Part B, layout ✓ |
| E9 | Countable rules and grep-able pre-flight | EP | L1 | automated | pre-flight section of `anti-slop-frontend/SKILL.md` | grep checklist items | contains items for theme parity, layout discipline (marked marketing only), z-index, plus the existing em-dash, accent, font, fake-data, fake-screenshot, contrast, motion items; each item cites a rule id |
| E10 | Theme parity per profile | EP | L1 | automated | `anti-slop-frontend/SKILL.md` theme-parity section | grep | states diff-scoped added-literal rule with exclusions (tests, fixtures, stories, svg, token-definition files), the 3-screenshot set for `product-ui`, light+dark for `marketing`, "non-gating" for visual judgment |
| E11 | Redesign mode protocol | state-transition (illegal edge) | L1 | automated | `anti-slop-redesign/SKILL.md` | grep | names modes `greenfield`/`preserve`/`overhaul`, defaults per profile, "audit before" edit, `overhaul` requires confirmation, protected list contains routes, nav labels, form field names, wordmark, legal copy, keyboard shortcuts, `data-testid` |
| E12 | Image direction is opt-in … never for product UI | decision table | L1 | automated | `anti-slop-image-direction/SKILL.md` | grep | contains the forbidden-for-`product-ui` sentence; confirm step names image count, backend and paid; names `pi-nano-banana`; one image per section into `refs/` |
| E13 | Generated images are direction, not source | EP | L1 | automated | `anti-slop-image-direction/SKILL.md` | grep | states image text is placeholder and never transcribed; `direction.md` lists observed tells and excludes them; gates still win |
| E14 | Brandkit is opt-in and proposal-only | decision table | L1 | automated | `anti-slop-brandkit/SKILL.md` | grep | `new-site` + explicit request only; same confirm gate (count, backend, paid); never writes project tokens/contracts before approval; logos labelled concepts |
| E15 | Advisory authority under the mockup loop | EP | L1 | automated | all 4 suite SKILL.md | grep | each states advisory status, feeds the loop FIX step, never overrides a WCAG-AA or severity gate |
| E16 | Host-design guidance (ships) | EP | L1 | automated | `packages/dashboard-plugin-skill/.pi/skills/dashboard-plugin-scaffold/references/host-design.md` + package `files` | stat file; read `files` | file exists; `files` covers `.pi/skills/`; file states it is derived from `ui-contract.md` |
| E17 | Host-design guidance (next-steps) | EP | L1 | automated | `dashboard-plugin-scaffold/SKILL.md` sections 3a.4 and 3b.6 | grep each block | both blocks name `host-design.md` |
| E18 | Host-design guidance (token drift) | EP + negative | L1 | automated | code-span tokens in `host-design.md` matching `^--[a-z0-9-]+$` | look up each in `packages/client/src/index.css` declarations | every token declared; an injected fixture token `--not-a-real-token` makes the check fail (negative case via in-test string) |
| E19 | Dashboard layering (adapter) | invariant | L1 | automated | `.pi/skills/frontend-mockup-loop-dashboard/SKILL.md` | grep | no `studio`/`earth`/`athlete`/`gradient`; names `ui-contract.md`, `product-ui`, `preserve`, `theme-token-guard.mjs`, image direction off |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Image backend fallback | fault-injection (abort) | L1 | automated | `pi-nano-banana` absent / no credentials | grep image-direction + brandkit SKILL.md | both state: report the reason, write a text-only brief from the variation-axes section, do not fail the task |
| X2 | Image direction headless rule | fault-injection (capability missing) | L1 | automated | `ask_user` unavailable | grep image-direction + brandkit SKILL.md | both state: headless → generate nothing, text-only brief |
| X3 | Backend switch needs reconfirmation | fault-injection (dependency swap) | L1 | automated | Gemini key missing, pi backend present | grep image-direction SKILL.md | states that a backend change requires a new confirmation; never switches silently |
| X4 | Image backend fallback (real run) | fault-injection (abort) | — | manual-only | unset `GEMINI_API_KEY`, no OpenRouter login | run image direction on a `site/` section | agent reports the reason and writes `refs/direction.md` text-only; zero image files; no crash. [judgment: agent compliance, no deterministic harness] |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| F1 | Image direction never for product UI (behaviour) | decision table | — | manual-only | ask agent "generate design references for SessionCard" | skill loads | agent refuses image generation, cites `product-ui`, offers text direction. [judgment: agent behaviour] |
| F2 | Generated images are direction, not source (behaviour) | EP | — | manual-only | confirmed 3-section `site/` plan | image direction runs | 3 PNGs in `refs/`; `direction.md` lists palette hex + layout family; no headline string from an image appears verbatim in the mockup. [judgment: content comparison] |
| F3 | Theme parity (dashboard, behaviour) | visual | — | manual-only | a client surface changed via the adapter | mockup loop TEST step | screenshots for Base dark, Base light, one non-base palette exist; reviewer judges legibility. [judgment: visual] |
| F4 | Redesign preserve (behaviour) | state-transition | — | manual-only | "redesign the settings page" | skill loads | agent declares `preserve`, produces audit before edits, lists any protected-element change for confirmation. [judgment: agent behaviour] |
| F5 | pi-nano-banana reachable from npm install (task 4.2) | install probe | — | manual-only | clean HOME, `pi install npm:@blackbelt-technology/pi-dashboard-nano-banana` | run `pi-nano-banana --help` | outcome recorded; README matches outcome. [judgment: one-off packaging probe on the released artifact] |

---

## Coverage summary

- Requirements covered: 12/12 (anti-slop-skill-suite 11, dashboard-plugin-skill 1) + design D10 adapter invariant
- Scenarios by class: edge 19 · perf 0 · frontend 5 · error 4
- Scenarios by level: L1 22 · L2 0 · L3 0 · — 6
- Scenarios by disposition: automated 22 · manual-only 6

## New infra needed

- none (both test homes are existing vitest projects: `scripts`, `packages/dashboard-plugin-skill`)
