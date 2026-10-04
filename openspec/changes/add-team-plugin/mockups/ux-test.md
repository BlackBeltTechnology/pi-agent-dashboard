# UX test — add-team-plugin (team-app) mockups

Mockup: `index.html` + `mockup.css` + `mockup.js` + `tokens.css` (verbatim `packages/client/src/index.css` theme blocks). Plan: `ui-plan.md`.
Serve: `serve_mockup{dir: openspec/changes/add-team-plugin/mockups}` → open `/index.html`. The dashed "Mockup controls" strip switches screen / role / mode / projects / conversation limit / grid state / conversation state; it is not part of the app.
Probe: `NODE_PATH=$PWD/node_modules node openspec/changes/add-team-plugin/mockups/ux-probe.cjs <url> <outDir>` (Playwright + axe; scores computed in code).
Run 4 (2026-10-04, project-scoped teams + conversation lists + two hosts): Chromium, widths 375 / 768 / 1024+ / 1440, dark + light. **Probe score 181 / 181** (H0–H8 board-style embedded host, FD0–FD10 folder-entry checks).

## 1. Accessibility floor (gate) — PASS

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Contrast ≥ 4.5:1 text / 3:1 UI | PASS (after F1) | axe `wcag2a/2aa/21aa/22aa`: 0 violations on 11 screens + card menu, persona-delete dialog, project selector open, rename dialog, dark + light (30/30) |
| 2 | Targets ≥ 44 px at 375 | PASS (after F3) | probe T1 on grid, conversation list, conversation, editor |
| 3 | Visible focus | PASS | global `:focus-visible` `--focus-ring`; menu items inset ring; avatar radios outline |
| 4 | State not colour-only | PASS | status shape + word on cards, list items, chat header; unconfined icon + text |
| 5 | Reduced motion | PASS | `prefers-reduced-motion` kills the busy pulse |
| 6 | Reflow (WCAG 1.4.10) | PASS (after F6, F15) | probe R1: 11 screens × 3 widths (33/33) |
| 7 | Icon-only controls named | PASS | probe F18: grid, agent view, editor |
| 7b | Embedded host (D16, board-style) | PASS | H0 axe 0 on embedded grid + conversation, dark + light; H6 no h-scroll at 375; H7 top-bar targets ≥ 44 px at 375 |
| 7c | Folder placement (D17) | PASS (after F18) | FD0 axe 0 on folder view, folder menu open, enable dialog, dark + light; FD10 no h-scroll at 375 |
| 8 | Focus order | PASS (after F5, F12) | focus stays on the selector after switching (F24), returns to opener after menus and dialogs (K4, K7) |

`validate_mockup{system:shadcn}`: L2 PASS. L1 flags hex **only in `tokens.css`** (the verbatim theme-layer copy). Same accepted false positive as `add-acp-session-driver`.

## 2. Heuristic rubric (ux-best-practices §5, applicable items)

| # | Rule | Result | Note |
|---|---|---|---|
| 6 | One dominant primary action per view | PASS | grid: "Új persona"; card: "Beszélgetés" (+ secondary "Új"); agent view: "Új beszélgetés"; editor: "Mentés"; chat: Send |
| 7 | Status < 1 s for async actions | PASS | create/resume ("Ügynök indítása…" / "Előző beszélgetés folytatása…"), saving, reconnect, sign-in redirect, target switch announcement |
| 8 | Destructive gated + consequence stated | PASS | delete persona, delete conversation (K6, E45); archive is the reversible path |
| 9 | Consistent patterns/terms | PASS | one menu pattern; the same status words on cards, list and chat; "beszélgetés" everywhere |
| 10 | Proximity / common region | PASS | header selector scopes the page; two persona sections; list | chat panes |
| 11 | No element off-goal | PASS | actions only where allowed (F11); no new conversation where it would be refused (F20, E43) |
| 12 | Platform conventions | PASS | WAI-ARIA APG menu button (K1–K4, F24), native modal dialog with focus return (K5, K7, E44) |
| 13 | Persistent labels | PASS | labels above every field; rename dialog labelled with hint |
| 14 | Single-column form | PASS | editor ≤ 40rem |
| 15 | CTA starts with a verb / names the object | PASS | "Új beszélgetés", "Beszélgetés törlése", "Visszaállítás", "Saját persona ide" |
| 17 | Errors next to field + summary | PASS | name length, "at least one place" (F12, F25) |
| 18 | Error text states a fix | PASS | limit → "archive one"; unassigned / retired → archive or delete; spawn errors → retry / admin |
| 19 | Zero-data: one primary CTA | PASS | empty target: one CTA (+ admin hint); empty conversation list: "Új beszélgetés" |

Score (applicable items): **13 / 13**.

## 3. PURE friction

- **Task A — "continue yesterday's backend work on billing-api":** open the app (green, `billing-api` remembered) → "Beszélgetés" on the card (green, opens the newest conversation) → type (green). **Green.**
- **Task B — "start a separate thread about pagination":** "+ Új" on the card (green) → spawn status at once (green) → type; the title comes from the first prompt (green). **Green.**
- **Task C — "switch to my own workspace and use my writer":** selector (green, statuses not needed here) → own workspace (green, grid rescoped, focus kept) → card → conversation (green). **Green.**
- **Task D — "make my own variant of a shared persona for billing-api":** card ⋮ (yellow: one hidden step) → "Másolat" (green) → editor with usable projects kept (green) → Save. **Yellow**, by design (Hick's Law).
- **Task E — "tidy up old conversations":** agent view → conversation ⋮ → Archiválás (green) or Beszélgetés törlése + confirm (green). **Green.**

## 4. Defects found and fixed (Nielsen severity)

| id | Sev | Defect | Rule | Fix |
|---|---|---|---|---|
| F1 | 4 | Retired/unavailable card descriptions dimmed with `opacity` → 3.9:1 | WCAG 1.4.3 | dashed border + greyscale avatar; text keeps full contrast |
| F2 | 3 | "nullnull" printed in the editor | H8 | filter falsy children; **impl:** conditional render |
| F3 | 3 | Brand link 28×28 at 375 | WCAG 2.5.8 | brand min 44×44 |
| F4 | 3 | Stale callout squeezed into a narrow column inside a card | H8 | `.callout.stack` |
| F5 | 2 | Focus lost after a dialog opened from a menu closed | WCAG 2.4.3 | menu refocuses its button before acting |
| F6 | 2 | Header 4 px wider than 375 | WCAG 1.4.10 | decorative initials hidden < 640 px |
| F7 | 2 | Initials avatar "S(" | H8 | letters/digits only |
| F8 | 2 | Both transcript dividers said "Earlier session" | H4, H1 | single "Folytatva · <time>" divider |
| F9 | 1 | Avatar radios named by internal ids | WCAG 4.1.2 | localized names |
| F10 | 1 | `aria-label` on a `<span>` | ARIA in HTML | `sr-only` text |
| F11 | 4 | Blank app inside a sandboxed iframe (dashboard canvas): `localStorage` threw | robustness | `store` wrapper; **impl:** must not crash without storage |
| F12 | 2 | Focus dropped to `<body>` after a project switch | WCAG 2.4.3 | focus restored to the selector after navigation and after the spawn/resume re-render |
| F13 | 1 | Selector meta line wrapped to 3 lines | H8 | "Közös mappa a csapattal" |
| F14 | 3 | Restoring an archived conversation left the list on the archived filter (and navigating to the current URL did not re-render), so the restored conversation vanished from view | H1, H3 | restore switches to the active list; same-URL navigation re-renders. **Impl:** after restore, show the active list |
| F15 | 2 | Header up to 65 px wider than 375 with the project selector | WCAG 1.4.10 | below 640 px the selector takes its own full-width header row |
| F16 | 1 | Card link-button ("Beszélgetések (n)") rendered underlined | H4 | `a.btn { text-decoration: none }` |
| F18 | 2 | Locked project chip named via `aria-label` on a `<span>` (axe aria-prohibited-attr), same class as F10 | ARIA in HTML | `sr-only` text "Projekt: <name> (ehhez a mappához kötve)" |
| F17 | 1 | Tool descriptions still said "in its own workspace" after targets became project or own workspace | H2 (match the real world) | "a kiválasztott mappában" / "in the selected folder" |

Open: none ≥ severity 2.

Embedded host (like the OpenSpec board): sidebar stays, the selector appears as `HeaderContext` in the `EmbeddedApp` top bar (H1); Back + Open standalone, no folder crumb globally (H2b); the sidebar's global "Csapat →" row opens it (H8); the app draws no sign-in, user, language or theme control of its own (H2); switching target keeps focus (H3); "Megnyitás a dashboardon" only embedded (H4, H5).

## 5. Decisions confirmed by the test (carry into implementation)

- **Folder entry:** a subfolder (`billing-api/packages/core`) resolves to its project (FD1); only matched folders get a row and an OPEN item (FD2, FD3); settings/disable only on folder-enabled projects for admins (FD3, FD4); the enable dialog validates in place and lands on the new project (FD5, FD6); an empty project offers "Ügynökök hozzáadása" (FD7); disable keeps conversations and re-offers enable (FD8); "Teljes csapat" leaves the folder lock (FD9).

- **The project selector is the app's top-level context.** It always shows the current target, is remembered per browser, starts at the last target → first available project → own workspace, and becomes a plain label when only the own workspace exists. Unavailable projects stay listed with a reason. Below 640 px it gets its own header row.
- **The grid is per target.** It lists personas whose `projects` include the target, plus retired and unassigned personas the user still has conversations with there. Retired and unassigned cards show their conversations for tidying but offer no new conversation.
- **Card actions:** "Beszélgetés" opens the newest active conversation or creates the first; "+ Új" always creates a new one. The activity line shows the count and recency, so the user sees which agents are in use before opening them.
- **The agent view is list | chat** from 1024 px (the list route opens the newest conversation) and two routes below. Archived conversations sit behind one toggle; they are read-only until restored, and restoring returns to the active list.
- **Conversation menu:** rename, archive / restore, delete, restart when stale; delete states the transcript stays on the server but cannot be reopened in the app.
- **Limit (50 active per agent × target):** "Új beszélgetés" and the card's "+ Új" are disabled with the reason "archive one first".
- **Editor `projects` field:** a checklist of own workspace + assignable projects, at least one; a new persona opened from a target preselects the own workspace + that target; a fork keeps only usable projects.
- **Language switch** keeps form values and focus; persona content and conversation titles are user data and are never translated.
- **Avatars:** an original 8-mark geometric gallery on identity tints, plus initials.

## 6. LEARN

- axe passes layout and content defects (F2, F4, F7, F8, F14); keep reviewing screenshots in both themes and walking state transitions (archive → restore found F14).
- Navigating to the URL you are already on is a no-op in hash routers; actions that change state must re-render even then.
- A top-level context selector in a header needs a narrow-screen plan from the start (F15).
- Test the mockup in a sandboxed iframe as well as a normal tab; reviewers open it in the dashboard canvas.
- `opacity` on text is a contrast trap for "inactive" cards.
- A menu action that opens a dialog must return focus to the menu button before acting.
