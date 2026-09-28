# UX test — add-acp-session-driver mockups

Mockup: `mockups/index.html` (+ `mockup.css`, `mockup.js`, `tokens.css` = verbatim `packages/client/src/index.css` theme blocks). Serve: `serve_mockup{dir: openspec/changes/add-acp-session-driver/mockups}`.
Probe: `NODE_PATH=$PWD/node_modules node openspec/changes/add-acp-session-driver/mockups/ux-probe.cjs <url> <outDir>` (Playwright + axe; scores computed in code).
Run: 2026-09-26, Chromium, widths 375 / 768 / 900 / 1440, dark + light.

## 1. Accessibility floor (gate) — PASS

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Contrast ≥ 4.5:1 text / 3:1 UI | PASS (after fix F1) | axe `wcag2a/2aa/21aa/22aa` 0 violations dark + light, menu open; primary buttons `--accent-solid` + white (5.17:1 per token comment) |
| 2 | Targets ≥ 24 px, primary ≥ 44 px mobile | PASS | probe T1 at 375 px: split main, chevron, kebab, all buttons ≥ 44×44 |
| 3 | Visible focus | PASS | `:focus-visible` outline `--focus-ring`; menu items inset ring |
| 4 | State not colour-only | PASS | driver chip icon + "ACP · name"; status shape (diamond/circle/square) + word; menu check icon + `aria-checked` |
| 5 | Reduced motion | PASS | global `prefers-reduced-motion` guard; no motion carries meaning |

`validate_mockup{system:shadcn}`: L2 axe gate PASS. L1 token-lint flags hex **only in `tokens.css`**, the verbatim theme-layer copy (where literals belong); mockup rules use `var(--…)` only (verified: every referenced var exists in the theme layer). Accepted false positive.

## 2. Heuristic rubric (ux-best-practices §5, applicable items)

| # | Rule | Result | Note |
|---|---|---|---|
| 6 | One dominant primary action per view | PASS | tray: New Session; prompt card: Allow once; form: Save automation |
| 7 | Status < 1 s for async actions | PASS | probe K10/K11: "Starting Claude Agent session…" + disabled main immediately (`role=status`) |
| 8 | Destructive/multi-step reversible or gated | N/A | no destructive action introduced |
| 9 | Consistent patterns/terms | PASS | "ACP · <agent>" identical on chip, menu meta, callouts; split button reuses tray button recipe |
| 10 | Proximity / common region | PASS | chip row gap-1.5, card gap-3; menu items grouped in one card surface |
| 11 | No element off-goal | PASS | picker absent when no agents (probe K12/K13) |
| 12 | Platform conventions | PASS | WAI-ARIA APG menu button: probe K2–K7 (open on ArrowDown, focus on checked item, wrap, Enter selects, focus returns, Escape keeps selection) |
| 13 | Persistent labels | PASS | Agent/Model/Action/Prompt labels above fields |
| 14 | Single-column form at mobile | PASS | 375 screenshot |
| 15 | CTA starts with a verb | PASS | "Save automation", "Allow once", "Open agent settings", "New querymt session" |
| 18 | Error text states a fix | PASS | startup failure names the cause and the config key to change; ended-session callout offers one recovery action |
| 19 | Zero-data: one primary CTA | PASS | no-agents state = today's single button |

Score (applicable items): **11 / 11**. Probe: **33 / 33** (incl. S7 worktree dialog W1–W5, S8 goal detail G1–G4).

## 3. PURE friction — task "start a querymt session in this folder"

| Step | Rating | Why |
|---|---|---|
| 1 Recognise which agent will start | green | label "New Session · querymt" (recognition over recall, H6) |
| 2 Switch agent (first time) | yellow | two actions (chevron → item); acceptable, then remembered per folder |
| 3 Start | green | one click, immediate status |
| 4 Next time in same folder | green | preselected (probe K8) |
Worst step: yellow (first-time switch) → task rating **yellow**, by design (Hick's Law: choice only when needed).

## 4. Defects found and fixed (Nielsen severity)

| id | Sev | Defect | Rule | Fix |
|---|---|---|---|---|
| F1 | 4 | Primary buttons light-blue text on blue (`--accent-text` on `--accent-primary`) unreadable | WCAG 1.4.3 | `bg var(--accent-solid)` + white — house pattern (`GatewayPage.tsx`, `SpreadsheetPreview.tsx`) |
| F2 | 3 | Long agent names wrapped split button to 4 lines in 2-column tray | Aesthetic/minimalist (H8), scannability | `nowrap` + ellipsis on agent label, full name in `aria-label`/`title` (probe L1) |
| F3 | 2 | Menu anchored right overflowed viewport left edge, clipping "pi" | Visibility (H1), WCAG 1.4.10 reflow | anchor left, `max-width: calc(100vw - 2rem)` (probe L2/L3) |
| F5 | 2 | S7 dialog 8 px wider than 375 viewport (grid `1fr` = `minmax(auto,1fr)` held the long `<select>` option width) → page scrolled sideways, agent menu pushed off-screen | WCAG 1.4.10 reflow | `.panel { min-width: 0 }`, `select { width: 100% }` (probe T2/L3) |
| F6 | 2 | S8 "ACP sessions hidden" line stayed visible with no agents: `.link-list .note { display:flex }` beat the `hidden` attribute | Consistency (H4), no off-goal element | global `[hidden] { display:none !important }` (probe G4); carry to impl: prefer conditional render over `hidden` |
| F4 | 1 | "Run `scripts/setup.sh` ?" stray space before `?` | microcopy | "Run this script: `scripts/setup.sh`" |

Open: none ≥ severity 2.

## 5. Decisions confirmed by the test (carry into implementation)

- Split button (APG menu button) over a modal chooser or dropdown-in-label: one click in the common case, keyboard-complete.
- Menu item meta line states the restart behaviour ("ends when the dashboard restarts" / "survives dashboard restart") — the only place `durable` becomes user-visible besides the card chip.
- Pi row meta "Default · flows, subagents, extensions" gives information scent for what ACP sessions lack, instead of a warning dialog.
- Ended ACP session: remove pi-only actions from the card menu and offer "New <agent> session here" (error prevention H5 + recovery H9).
- Worktree dialog: one Agent select at the top, not a split button per existing-worktree row (one decision, many targets; avoids N menus). Inherits the parent folder's remembered agent; labels name the agent so the row action is unambiguous.
- Goals stay pi (D17): `+ New pi session` label only when agents exist (disambiguates from the folder's ACP memory); link picker omits ACP sessions but states the count and reason, so a missing session isn't a mystery.
- Automation editor: Model row becomes a note; Skill radio disabled with an adjacent reason (not hidden) so the constraint is learnable.

## 6. LEARN

- `ui-contract.md` primary-button recipe (`bg-[var(--accent-primary)]`, no text colour) is stale versus the shipped house pattern `bg-[var(--accent-solid)] text-white` — propose contract patch (repo-wide file, separate from this change).
- `validate_mockup` L1 scans the theme-layer copy; keep tokens in `tokens.css` and treat those hits as expected.
- axe passed the original low-contrast primary buttons; always eyeball screenshots in both themes (don't trust axe alone for buttons).
