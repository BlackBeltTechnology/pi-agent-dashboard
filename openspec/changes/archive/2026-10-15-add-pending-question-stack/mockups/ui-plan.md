# UI plan — add-pending-question-stack

Mode: **greenfield inside a preserved shell** (`anti-slop-redesign`: new pill +
panel + dialog; every existing sidebar-header control, `data-testid` and the
inline ask renderers are protected). Profile: `product-ui`. Contract: root
`ui-contract.md`.

Tokens: `tokens.css` is GENERATED from `packages/client/src/index.css`
(`:root`, `[data-theme="light"]`) and `THEMES` nord dark
(`packages/client/src/lib/theme/themes.ts`). Do not hand-edit. Icons: `icons.js`
GENERATED from `@mdi/js`.

Board: `question-stack.html` — interactive shell with theme switch (base dark /
base light / nord dark), frame switch (375 / 768 / 1440) and a scenario switch.

## Grounding (as-built sources)

| Fact | Source |
|---|---|
| Header row 1 (`header-app-bar`): π logo, ThemePicker, ThemeToggle ‖ Install, Tunnel, **YoloPill** (conditional), Focus, headerExtra, Discord, Settings | `packages/client/src/components/session/SessionList.tsx:2757`; spec `sidebar-header` |
| Conditional header pill recipe: `inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] leading-none tabular-nums` + tone | `packages/client/src/components/access-grant/YoloIndicators.tsx:92` |
| Needs-you glyph + word: `mdiCommentQuestion` + "Needs you", colour `--status-needs-you` on the glyph only, word in `--text-secondary` | `packages/client/src/components/session/SessionCard.tsx:115` |
| Select renderer: option rows answer on click (no Submit), `min-h-[44px] sm:min-h-[36px]`, hover `--tint-blue-*`, cancel row dashed + `--tint-red-*` hover | `packages/client/src/components/interactive-renderers/SelectRenderer.tsx:59-118` |
| Multi-ask heading "Needs you" | `packages/client/src/components/chat/MultiAskPanel.tsx:31` |
| Floating corners taken: toasts bottom-right, canvas chip tray bottom-right above composer, recovery + spawn-error top-right | specs `toast-notifications`, `auto-canvas`; `SpawnErrorToastHost.tsx` |

## Surfaces → tokens → states

| Surface | Recipe (tokens) | States |
|---|---|---|
| **Question pill** (header row 1, after `YoloPill`) | identity-pill tint triple `--tint-purple-{bg,fg,border}` (needs-you identity = purple, `--status-needs-you`); glyph `CommentQuestion` + count, `tabular-nums`; `focus-ring`; ≥ 24×24 hit area desktop, 44×44 mobile; `aria-expanded`, `aria-controls`, `aria-label="3 open questions"` | absent (0) · 1 · many · panel open · new-arrival (one 600 ms ring, suppressed under `prefers-reduced-motion`) |
| **Panel** (anchored below row 1, left-aligned to the sidebar, width = sidebar) | card recipe (`--bg-secondary`, `--border-secondary`, `rounded-lg`, raised elevation); heading = section heading recipe "Needs you · 7"; rows on `--bg-tertiary` hover `--bg-hover` | 1–5 rows · >5 → newest 5 + "+N more" · expanded (scroll, max 60vh) · row removed live |
| **Row** | 2 lines: title (`text-[12px] font-semibold --text-primary`: session label + change chip) / preview (`text-[12px] --text-secondary`, clamp 2); meta right: age (`text-[11px] --text-secondary`, `tabular-nums`); **route hint** at row end: "Go to session" (`ArrowRight`) for visible, "Answer here" (`CommentQuestionOutline`) for hidden; origin badges (chip recipe): Hidden run (`EyeOffOutline`), Automation (`RobotOutline`), Goal (`Target`), File access (severity-warning pill, `ShieldAlertOutline`), Chat gateway (`ForumOutline`), Flow slot (`ViewDashboardOutline`) | default · focus · hover · summarizing (brief pending, `Loading` glyph + "Summarizing…") |
| **Question dialog** | dialog recipe: scrim `--bg-overlay` + card panel `max-w-xl`; header: title `text-lg` (session label), meta line (kind, change, branch, age); **Brief** inset panel `--bg-tertiary` + label "Summary" + provenance chip "Generated · @fast" or "From the agent"; **Question** = reused renderer markup (as-built classes); **Context** = `<details>` disclosure (last assistant message, recent tools, workflow run); footer: secondary "Open session", secondary "Later" (Esc) | brief ready · summarizing · on-demand failed (severity-error inline + Retry) · provided + "Summarize" · limited context label · answered elsewhere (severity-info callout, inputs disabled) · file access read-only (severity-warning callout + "Open Access") · input type (textarea + Send primary) |
| **Mobile (375)** | pill stays in row 1 (44×44 hit area); panel → bottom sheet (`rounded-t-lg`, drag handle `aria-hidden`, max 80vh); dialog full-screen with sticky footer | same as desktop |

## Decisions → cited rule

| # | Decision | Rule (public source) |
|---|---|---|
| D1 | Header pill next to `YoloPill`, not a floating corner element | Consistency & standards — Nielsen #4 (nngroup.com/articles/ten-usability-heuristics); spatial memory / Jakob's Law (lawsofux.com/jakobs-law): the row already holds persistent app-level indicators; corners are occupied (toasts, canvas tray, recovery) |
| D2 | Pill shows glyph + count; absent at 0 | Visibility of system status — Nielsen #1; WCAG 1.4.1 (shape + text, not colour only); Von Restorff (lawsofux.com/von-restorff-effect) — one salient element, so no pill at zero |
| D3 | Newest 5 + "+N more" | Hick's Law (lawsofux.com/hicks-law); progressive disclosure (nngroup.com/articles/progressive-disclosure) |
| D4 | Each row states what activation does ("Go to session" / "Answer here") | Recognition rather than recall — Nielsen #6; Match between system and real world — Nielsen #2 |
| D5 | Hidden/automation/goal/file/chat/flow shown as icon + word badges | WCAG 1.4.1; GOV.UK tag pattern (design-system.service.gov.uk/components/tag) |
| D6 | Dialog order: summary → question → context (collapsed) | Inverted pyramid (nngroup.com/articles/inverted-pyramid); progressive disclosure |
| D7 | Generated summary labelled with provenance; raw context one click away | Google People + AI Guidebook — "Explainability + Trust" (pair.withgoogle.com/guidebook); Nielsen #1 |
| D8 | Summary failure keeps the current text, inline error + Retry | Help users recover from errors — Nielsen #9; GOV.UK error message pattern |
| D9 | Answered elsewhere → callout, inputs disabled, no silent close | Nielsen #1; Error prevention — Nielsen #5 |
| D10 | File-access prompt read-only with route to Access | Error prevention — Nielsen #5; consistency with the existing operate-tier approval — Nielsen #4 |
| D11 | Select options answer on click (as-built); footer has no competing primary | Consistency — Nielsen #4; one primary action per view (`ui-contract.md` anti-slop) |
| D12 | Esc closes panel/dialog, focus returns to the trigger; dialog traps focus | WAI-ARIA APG disclosure + modal dialog (w3.org/WAI/ARIA/apg/patterns/dialog-modal); WCAG 2.1.2, 2.4.3 |
| D13 | Mobile: bottom sheet + full-screen dialog, 44×44 targets | Fitts's Law (lawsofux.com/fittss-law); WCAG 2.5.8; Material bottom sheets (m3.material.io/components/bottom-sheets) |
| D14 | New-arrival ring once, never a loop; off under reduced motion | WCAG 2.2.2, 2.3.3; `ui-contract.md` Motion |

## Protected (must not change)

`header-app-bar` control order and every existing `data-testid` in row 1;
`yolo-pill`; inline ask renderers and their answer-on-click behaviour; the
folder needs-you rollup; card pulse suppression for widget-bar prompts.

## New test ids

`question-pill`, `question-panel`, `question-row-<id>`, `question-more`,
`question-dialog`, `question-brief`, `question-brief-summarize`,
`question-brief-retry`, `question-context`, `question-open-session`,
`question-later`.

## Score (TEST step — derived, not "looks good")

Captured with `score_mockup` (Playwright) via URL-addressable states
(`?theme=&w=&n=&panel=&more=&dlg=&summarize=&hold=&elsewhere=`):
panel (1440/768/375, base dark) · dialog ready (1440/375, base dark) ·
summarize failed (1440, base light) · file access (1440, nord dark) ·
summarizing + context open (768, base light) · expanded sheet (375, base light).
`validate_mockup` L2 (axe-core contrast floor) run on base dark, base light and
nord dark.

| Check | Result | Evidence / reason |
|---|---|---|
| Contrast (WCAG AA) light + dark + nord | PASS | axe L2 gate PASS on all three palettes |
| Responsive / touch ≥ 44 px on mobile | PASS (after fix) | FIX 1: Summarize / Retry / close were < 44 px at 375 → `.frame[data-w=375]` floor added |
| Hierarchy — one focal point | PASS | pill is the only purple element in row 1 (Von Restorff); dialog focal = question block, no competing primary |
| Spacing from scale | PASS | gaps 2/4/6/8/12/16 px only (Tailwind 0.5–4) |
| Token fidelity | PASS w/ documented exceptions | L1 hits = `tokens.css` (generated definitions, excluded like `index.css`) and the contract's `text-white` on `--accent-solid` |
| Anti-slop | PASS | no gradient/glow; purple = existing `--status-needs-you` identity; real nouns (real change names, paths, branches) |
| Console clean | UNVERIFIED | `agent-browser` daemon failed to start; Playwright captures raised no page error but console was not inspected |

Score: 6/7 PASS, 1 unverified. FIX 2: panel `max-height: 60%` clipped the 5th
row before "+N more" — cap now applies only when expanded (spec: newest 5 then
"+N more" → ≤ 60vh scroll).
