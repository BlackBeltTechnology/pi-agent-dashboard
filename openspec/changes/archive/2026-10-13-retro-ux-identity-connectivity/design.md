## Context

Oct 2026 PR sweep (#806–#876): 34 PRs touched client UI. 9 shipped visible UI without a mockup. They are grouped into four retro changes:

| Change | PRs | Surfaces |
|---|---|---|
| `retro-ux-identity-connectivity` (this) | #848 #867 | Users / invite / passkey note; server selector, known servers, discovery |
| `retro-ux-plugin-settings-forms` | #827 #813 #829 | context-mode, hermes-memory, Gmail settings; KB folder section |
| `retro-ux-chat-rendering` | #847 #868 | MermaidBlock (auto-repair badge); web-search card; custom-entry fallback |
| `retro-ux-model-selector` | #834 | ModelSelector Role tab and about 8 host pickers |

#875 is folded into `addons-hub-folder-view` (Issues tab).

This design is the shared method for all four. The sibling changes reference it instead of repeating it.

Grounding:
- `ui-contract.md`: token roles, semantic families, type floor, and the ban on palette classes and hex/`rgba(` (`ui-contract.md:56-69`). State is never carried by colour alone (`ui-contract.md:193`).
- `tests/e2e/helpers/computed-contrast.ts`: `contrastFailures`, `sizeFailures`, `buttonsWithoutFocusIndicator`, `setThemeMode`.
- `tests/e2e/helpers/evidence-path.ts`: `resolveEvidencePath(change)` resolves the active or archived change folder without creating it.
- 49 E2E specs already stub REST with `page.route(` (e.g. `tests/e2e/blackhole-settings.spec.ts`).
- `scripts/theme-token-guard.mjs` checks fallback-form, undeclared and accent-as-text only. It does not check palette classes.

## Goals / Non-Goals

**Goals:** every documented state of every in-scope surface is reachable on demand, captured, audited against the contract, redesigned in preserve mode with user approval, and implemented. The capture is repeatable for later regressions.

**Non-goals:** behaviour changes; new routes; guard extension; visual-diff gating in CI (captures are evidence, not pixel assertions).

## Decisions

### D1. Two phases split at the worktree boundary
1. Develop, interactive. The mockup loop: an as-built HTML replica built from component source (classes and tokens taken from the TSX), the proposed version next to it, and every state shown on one board. The board is served for review, and the user approves with `ask_user`. Approved decisions go into `specs/` and `tasks.md` (`openspec-update-change`). Then `plan-proposal` runs doubt-review, scenario-design and the fold, and commits.
2. Worktree, headless (`ship-it`): fixtures, capture spec, implementation of the approved decisions, and after-captures.

*Why:* approval needs a person, and `ship-it` is headless. A replica built from source needs no running server, so the "before" evidence exists before any code is written.
*Rejected:* screenshotting the live `:8000` server. It runs main-repo code and cannot reach edge states (`frontend-mockup-loop-dashboard` PROMOTE binding).

### D2. Fixtures are `page.route` stubs, not server seeding
Each surface's states come from stubbing its REST responses (`tests/e2e/fixtures/retro-ux/<surface>.ts` exports `{ id, label, install(page) }[]`).
*Why:* client-only, deterministic, no temp HOME. 49 specs already use the pattern.
*Rejected:* seeding `config.json` or `packages[]` in an isolated HOME. That is slow, can't produce error states such as 403, 410 or scan errors, and couples the capture to server internals.

### D3. Capture helper contract (`tests/e2e/helpers/ui-capture.ts`)
`captureStates(page, { change, surface, states, only?, themes?, widths? })`:
- `states`: the fixture list `{ id, label, stubs, install(page), open(page), root(page) }[]` (D2). `stubs` names at least one endpoint; `open` brings the surface into view (settings tab, or a trigger click for a menu); `root` returns the probe scope (the trigger for a closed selector; `role="menu"` located from the page for an open portalled menu). `only` filters by id and throws on an unknown id.
- defaults: `RETRO_UX_THEMES` = `{base,dark}`, `{base,light}`, `{nord,dark}` (ids from `packages/client/src/lib/theme/themes.ts:763`); widths = 375, 768, 1440.
- each state, theme and width, in order: `install(page)` (route stubs; `page.route` handlers persist across reloads), `page.goto`, `setThemeMode(page, mode, theme)` (`computed-contrast.ts`, reloads the page and re-fires the stubbed requests), set the viewport, `open(page)` (re-opened per width, because a resize can move or close a portalled menu), then a screenshot to `<dirname(resolveEvidencePath(change))>/mockups/after/<surface>/<state>--<theme>-<mode>--<width>.png`.
- runs the probes on `root(page)` (`measureText` fed into `contrastFailures` and `sizeFailures`, plus `buttonsWithoutFocusIndicator`) and returns `{ state, theme, mode, width, contrast, size, focus }[]`. The spec asserts every list is empty. `sizeFailures` treats text inside `button`/`label`/`a` as interactive (12 px floor), so pills inside controls are 12 px.
- screenshot writing is opt-in through `RETRO_UX_CAPTURE=1`, and refused when `dirname(resolveEvidencePath(change))` lies under `openspec/changes/archive/` (evidence belongs to the active change; `resolveEvidencePath` itself returns archived dirs without marking them). Only `mockups/after/<surface>/` is created, inside an existing change dir. Without the flag the spec runs the probe assertions only.
- runs inside the standard E2E docker harness (`docker/test-up.sh` / `test-down.sh`); the stubs replace only the endpoints a state names.
- `measureText` skips `[disabled]` subtrees but not `aria-disabled` ones, so blocked selector entries become probed text. That is intended: their reason text must meet contrast.
- the matrix samples 3 of the 18 palettes. Accepted trade-off: `theme-gallery` already gates every palette's token floor; these probes check component usage.

### D4. Audit rubric (`mockups/audit.md`)
Per surface × state:
1. contract: tokens and families, no palette classes or literals, type floor.
2. a11y: contrast, focus indicator, accessible name, keyboard path, state not shown by colour alone.
3. `anti-slop-frontend` checklist (`product-ui` profile).
4. Nielsen heuristics: visibility of status, error recovery, consistency with sibling surfaces.

Verdict per surface: `ok` / `polish` / `redesign`. Even an `ok` surface gets a mockup (user decision: a mockup for every group).

### D5. Preserve mode, protected list
Never changed: routes, section and nav labels, field names, shortcuts, existing `data-testid`s. New testids may be added (the #867 files have none).

## Risks / Trade-offs

- [Replica drifts from the real render] → the after-captures in phase 2 are the real render. A mismatch between replica and capture is logged in `audit.md` and fixed before archive.
- [Palette classes come from older code in the same files] → scope covers the whole file for the in-scope components, not just lines the PR added. That is cheaper than a second pass later.
- [Sibling changes depend on D3] → they start their phase 2 only after this change's harness task lands (each has a precondition task 0.1). Accepted trade-off: there is no API version pin. Once landed, `captureStates` is specified by the `ui-state-capture` capability, so a later signature change must go through a MODIFIED delta that the siblings' planning would see.

## Migration Plan

None. Styling and markup only. Rollback is a revert.

## Open Questions

None. The third palette is `nord` dark, settled in the mockup loop because it exposed the severity-fg-on-surface and accent-text failures (`mockups/audit.md` A1, A2) that base dark and light do not.
