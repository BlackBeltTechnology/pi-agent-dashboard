## Why

`packages/anti-slop` (`anti-slop-frontend`) is a distillation of `Leonxlnx/taste-skill`, but it records no upstream version, so it cannot be refreshed by diff. Upstream has since shipped v2 (brief inference, dark-mode protocol, redesign protocol, layout discipline, hard pre-flight) plus image-first and brandkit skills. We now want one install that serves three targets: the dashboard UI (`packages/client`), the marketing site (`site/`), and new sites. Today it only serves generic review, has no redesign discipline (most of our UI work redesigns existing surfaces), and no check that a change holds across the dashboard's 18 palettes (9 themes × dark/light, `packages/client/src/lib/theme/themes.ts`).

## What Changes

- **Pin upstream provenance.** Add `packages/anti-slop/UPSTREAM.md` recording the source repo, commit `18dfc928b135629e0eddfdd445a06400d04ed439` (2026-10-08), the license (MIT), and a per-section map of upstream section → our skill/section, or "dropped" with a reason. Future refreshes start from that diff.
- **Refresh `anti-slop-frontend` against v2.** Changes stay advisory and every rule stays countable or binary.
  - Add a mandatory **Design Read** (one line: surface kind, audience, mood, dial values) declared before review or generation.
  - Add **surface profiles** (`product-ui` | `marketing` | `new-site`) that select which parts fire.
  - Add **theme parity**: verify contrast and hierarchy in every theme the project ships, not only the default.
  - Add **layout discipline** from upstream §4.7 (nav on one line, nav height ≤ 80px, hero CTA visible without scrolling), applied to marketing surfaces only.
  - Add **z-index / DOM-cost restraint** from upstream §6.
  - Extend the grep-able pre-flight to match.
- **New skill `anti-slop-redesign`.** Comes from upstream §11 plus `redesign-skill`.
  - Detect the mode first: `greenfield` | `preserve` | `overhaul`.
  - Audit before touching anything.
  - Apply modernisation levers in priority order.
  - A **never-change-silently list**: routes/URLs, nav labels, form field names, brand wordmark, legal copy, plus keyboard shortcuts and `data-testid` hooks (our addition).
  - `product-ui` defaults to `preserve`.
- **New skill `anti-slop-image-direction`.** Comes from `image-to-code-skill` + `imagegen-frontend-web`. It is **opt-in** (explicit request or flag) and **never** applies to `product-ui`.
  - Generate one reference image per section through the in-repo `pi-nano-banana` CLI (`packages/nano-banana`, either backend).
  - Analyze each image and extract a direction: layout family, rhythm, palette, type character.
  - Feed that direction into frontend-mockup-loop step 1 (GROUND).
  - Images are **direction, not source**:
    - text rendered inside images is a placeholder and is never transcribed;
    - Part A tells are checked on the images themselves;
    - the loop's WCAG and cite-a-source gates still win.
  - If no image backend is available, fall back to a text-only direction brief instead of failing.
- **New skill `anti-slop-brandkit`.** Comes from upstream `brandkit`. It is opt-in, for `new-site` work with no existing brand, and produces a brand board (logo concept, palette, type, image direction) with `pi-nano-banana`. It uses the same paid-generation confirm gate as image direction. Output is a proposal for the user to approve, never an auto-applied identity.
- **Dashboard design: layered, data separate from procedure.**
  - **Data:** root `ui-contract.md` stays the single source of dashboard design facts; `host-design.md` (below) is a declared, derived subset for npm consumers. Reconcile its theme statement ("two themes ship") with the runtime palette set in `packages/client/src/lib/theme/themes.ts` (9 themes × dark/light). State which layer each describes.
  - **Procedure:** `.pi/skills/frontend-mockup-loop-dashboard/SKILL.md` becomes a thin pointer:
    - profile `product-ui`, redesign mode `preserve`, image direction off;
    - read `ui-contract.md` for tokens (this replaces the stale "4 themes: studio, earth, athlete, gradient" CONTRACT binding);
    - theme parity is checked by `scripts/theme-token-guard.mjs` plus the screenshot set.
  - **Third-party plugins:** `packages/dashboard-plugin-skill` (`dashboard-plugin-scaffold`) ships a `references/host-design.md` derived from `ui-contract.md`. It covers host tokens to use, severity/status tokens, coloured-text rule, both modes, no own theme/fonts/raw colours, and the `product-ui` anti-slop profile. The skill points to it from both modes' next-steps. A contract test keeps every token it names declared in `packages/client/src/index.css`.
- Package `pi.skills`, `files` (adds `UPSTREAM.md`), `README.md`, the package `AGENTS.md` and the `recommended-extensions.ts` description list the four skills. The README documents the image prerequisite: `pi install npm:@blackbelt-technology/pi-dashboard-nano-banana` (provides `pi-nano-banana`) plus `GEMINI_API_KEY` or the pi/OpenRouter backend.
- The `anti-slop-frontend` `description:` line stays byte-identical. It is digest-pinned by `scripts/__tests__/skill-frontmatter.test.mjs` and budget-exempt; new rules go in the body only. New skills get ≤ 400-char descriptions and are not added to the exempt set.
- Not doing: a dashboard-server design-contract endpoint. That is a possible later proposal, if plugin authors need live runtime palettes.
- Out of scope:
  - upstream GSAP code skeletons (§5);
  - the block library (§12);
  - style skills (`soft`/`minimalist`/`brutalist`);
  - `gpt-tasteskill`, `stitch-skill`, `imagegen-frontend-mobile`;
  - TasteCode;
  - any change to the mockup-loop extension's gates or tools.

## Capabilities

### New Capabilities
- `anti-slop-skill-suite`: the anti-slop package contract. Covers upstream provenance pin, surface profiles + Design Read, theme parity, redesign mode protocol, opt-in image direction (backend use, direction-not-source, fallback), opt-in brandkit, advisory-only authority under frontend-mockup-loop gates.

### Modified Capabilities
- `dashboard-plugin-skill`: ADDED requirement. The scaffold skill ships host-design guidance for plugin UI, kept in sync with the host token layer.
- (`skill-frontmatter-validity` is unchanged; new skills simply pass it.)

## Impact

- Files:
  - `packages/anti-slop/` (SKILL.md refresh, 3 new skill dirs, `UPSTREAM.md`, `package.json` `pi.skills`, README, AGENTS.md);
  - `.pi/skills/frontend-mockup-loop-dashboard/SKILL.md`;
  - root `ui-contract.md` (theme statement);
  - `packages/dashboard-plugin-skill/.pi/skills/dashboard-plugin-scaffold/` (`SKILL.md` pointer + `references/host-design.md`);
  - `packages/shared/src/recommended-extensions.ts` (one description string literal).
- Behavioural logic: unchanged. The only TS edit is a user-visible description string literal; the `pi.skills` manifest adds skills that load at run time. Skills are markdown; `pi-nano-banana` is invoked as an existing CLI.
- Dependency: soft, documented only. The `anti-slop-image-direction` and `anti-slop-brandkit` skills detect `pi-nano-banana` and credentials at run time and fall back to text-only when either is missing. No new `package.json` dependency. Whether the published `pi-nano-banana` bin (a `.ts` entry) runs from a global npm install is verified in tasks; if it doesn't, the README says so and the fallback covers it.
- Cost: image generation is paid. Opt-in only, and the per-section image count is stated before generating.
- Compatibility: the version follows the lockstep `release-cut` flow (no ad-hoc bump). The existing skill name and trigger phrases are kept.
- Rollback: revert the package and adapter files. No data or migration.

## Discipline Skills

- `doubt-driven-review`: re-scoping the advisory/gate split and adding paid image calls to a design loop is a decision to stress-test before it stands.
- `review-code`: before commit.
- No `security-hardening`, `performance-optimization` or `observability-instrumentation` trigger. The change adds no endpoint, no untrusted-input path and no runtime code; paid calls go through the existing `pi-nano-banana` CLI, whose controls already exist (`add-pi-runtime-image-generation`).
