# Test Plan — reorganize-session-header

Stage: design   Generated: 2026-10-21

Hard gate cleared. The user answered on 2026-10-21:
- Ring tiers use the rounded percentage shown: neutral 0–30, blue 31–50, green 51–70, orange 71–90, red 91+.
- Usage above the window displays 100% with the red arc, and the tooltip shows the real count.
- An ended clock with `lastActivityAt < startedAt` reads `ended · ran 0s`.

Exemplars:
- L1 header tests live in `packages/client/src/components/__tests__/SessionHeader.*.test.tsx`.
- The palette contrast exemplar is `packages/client/src/lib/__tests__/action-menu-tone-contrast.test.ts`.
- L3 specs run against the docker harness port from `.pi-test-harness.json`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | session-header: Context ring colours | BVA | L1 | automated | `ContextRing` with usage rounding to 30, 31, 50, 51, 70, 71, 90, 91% | render each | arc tier is neutral, blue, blue, green, green, orange, orange, red (stroke var `--text-secondary` / `--accent-blue-text` / `--accent-green-text` / `--accent-orange-text` / `--accent-red-text`) |
| E2 | session-header: Context ring shows usage | BVA | L1 | automated | 127,000 / 1,000,000 tokens; 1,020,000 / 1,000,000 tokens | render desktop ring | first: text `13%`, `aria-valuenow="13"`, tooltip `127.0k of 1.0M tokens`; second: text `100%`, `aria-valuenow="100"`, red arc, tooltip `1.02M of 1.0M tokens` |
| E3 | session-header: Context ring shows usage | EP | L1 | automated | context usage `undefined`; window 0; tokens `null` | render header | no element with `role="meter"` |
| E4 | session-header: Context ring shows usage (pref gate) | decision table | L1 | automated | effective `contextUsageBar` off via global pref, and off via session override, on desktop and on mobile | render header | no ring in any of the four cases; ring present when the pref is on |
| E5 | session-header: Header meta line labels the clock | decision table | L1 | automated | live, `startedAt` 332 s ago; live, `startedAt` 10 s in the future; ended, `lastActivityAt − startedAt` = 42 min; ended, `lastActivityAt < startedAt`; ended, no `lastActivityAt` | render `SessionClock` | `running 5m 32s`; `running 0s`; `ended · ran 42m`; `ended · ran 0s`; `ended` |
| E6 | session-header: Title menu | decision table | L1 | automated | live session with rename, reveal, tags, refresh callbacks; ended session; no `onSeekToCard`; no `onSetTags` | open the title menu | items in order Rename, Reveal in sidebar, Edit tags, Reload transcript; ended has no Rename; missing callbacks omit Reveal / Edit tags |
| E7 | session-header: Title menu (Escape) | state-transition | L1 | automated | title menu open | press Escape | menu closes; `document.activeElement` is the title button |
| E8 | session-header: Desktop header one row of three zones | EP | L1 | automated | live session with `attachedProposal: "add-auth"` and polled change data | render desktop header | no Attach button, no attached chip, no artifact letters, no pencil button, no standalone `refresh-chat` element before the menu opens |
| E9 | session-header: Desktop header one row of three zones (order) | EP | L1 | automated | ended resumable session with modules and changed files | render desktop header | trailing DOM order: Modules, Changed Files, Resume, Fork, `layout-mode-switch`, View trigger |
| E10 | chat-refresh: Refresh button in session header | state-transition | L1 | automated | live session, `onRefresh` spy | open title menu, activate "Reload transcript" | `onRefresh` called once; item carries `data-testid="refresh-chat"` and the `mdiHistory` icon; menu closes |
| E11 | session-card-seek: Seek control reveals the active session's card | EP | L1 | automated | desktop header with `onSeekToCard` spy | click the Reveal button; then the Reveal menu item | spy called twice; button has `data-testid="session-header-seek-card"`, accessible name "Reveal in sidebar", no `mdiCrosshairsGps` path in the header |
| E12 | session-rename: Inline rename UI | decision table | L1 | automated | header focused on the title button; focus in the tag editor input; ended session; rename input open | press F2 / F2 / F2 / Escape | input appears; no input; no input; input closes and focus returns to the title button |
| E13 | session-rename: Inline rename UI (double-click) | EP | L1 | automated | live desktop header | double-click the title | no rename input; title menu opens or stays closed, no `rename_session` sent |
| E14 | session-header: Mobile session header one row | EP | L1 | automated | `useMobile` true, live session with `piBelowFloor` and vault bindings | render header | one row with back, title, ring button, `layout-mode-switch` trigger, View, ⋯; pi-below-floor warning and vault chip below; no `mobile-attach-btn`, no `mobile-header-attached-chip`, no model / thinking / tool / cost strip |
| E15 | split-editor-workspace: Split unsplittable and re-splittable (mobile) | state-transition | L1 | automated | mobile header in `closed` mode | open layout menu, ArrowDown twice, Enter | three `menuitemradio` items (`layout-mode-closed/split/full`), Chat checked first, Split shows "Chat above, editor below"; after Enter mode is `full` and the trigger icon is the Editor icon |
| E16 | session-header: Mobile context ring popover | decision table | L1 | automated | 13% usage with cost 0.99; 13% usage with cost 0 | tap ring; then press Escape | popover `role="dialog"` `aria-modal="false"` reads `13% · 127.0k of 1.0M tokens · $0.99` / `13% · 127.0k of 1.0M tokens`; Escape closes and focuses the ring button |
| E17 | chat-refresh: Mobile refresh via action menu | EP | L1 | automated | `MobileActionMenu` with `onRefresh` | open menu | item label "Reload transcript" with the `mdiHistory` icon; click calls `onRefresh` |
| E18 | token-stats-bar: Independent visibility gating | decision table | L1 | automated | `TokenStatsBar` with turn stats and context usage, `showStats` on/off | render | no context progress bar in any case; turn chart renders only when `showStats` is on |
| E19 | session-header: Context ring colours (contrast) | decision table | L1 | automated | every palette in `THEMES` × dark/light, five arc tokens | compute contrast vs `--bg-primary` and vs `--border-secondary` | every ratio ≥ 3:1 |
| E20 | chat-display-preferences: Display-preferences menu mounts in the session header | EP | L1 | automated | desktop and mobile header for a selected session; composer strip rendered | render App shell slice | `ChatViewMenu` trigger sits immediately after the layout switch; no `ChatViewMenu` inside `composer-context-strip` (skip if `add-composer-dock` already owns this test) |
| E21 | mdi-icon-system: Changed files button has icon and text | EP | L1 | automated | header with file changes, wide and below 760 px container | render | `mdiFileCompare` icon + text "Changed Files"; narrow: text hidden, accessible name and title "Changed Files", counts visible |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | session-header: Clock tick does not re-render the header | threshold | L1 | automated | idle live session, `SessionHeader` wrapped in `React.Profiler`, fake timers | `SessionHeader` commits = 0 and `SessionClock` commits = 3 | 3,000 ms advanced |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | session-header: Collapse by priority in narrow containers | layout invariant | L3 | automated | 1,100 × 800 viewport with the sidebar open, session renamed to a 66-character name | load the session page | title `scrollWidth > clientWidth` with one line (`height` ≤ 1.5 × line-height); header height ≤ 96 px; each `layout-mode-*` segment ≥ 32 × 32 px and inside the header box; `pi` version hidden; `+ tag` visible |
| F2 | session-header: Keep trailing controls whole | layout invariant | L3 | automated | 900 px wide content, ended session with modules, changed files, three tags, long name | load page | Modules, Changed Files, Resume, Fork, switch and View bounding boxes all inside the header box; title ends in ellipsis |
| F3 | session-header: Desktop header one row | layout invariant | L3 | automated | 1,600 × 900, live session | load page | header row height 48–56 px; computed font-size ≥ 12 px for title-menu button, layout segments, View, Changed Files |
| F4 | session-header: Mobile session header one row | layout invariant | L3 | automated | 390 × 844, live session | load page | header height ≤ 56 px; title width ≥ 140 px; no element between header and transcript; ring, layout, View, ⋯ each ≥ 44 × 44 px |
| F5 | chat-refresh: Refresh restores an unanswered prompt | state-transition | L3 | automated | session with a pending prompt; existing `pending-prompt-recovery.spec.ts` / `replay-delta-on-reload.spec.ts` flows | open the title menu, activate Reload transcript (helper opens the menu before clicking `refresh-chat`) | pending dialog re-renders and survives the replay, as before |
| F6 | session-card-seek: Reveal a card buried under collapsed groups | state-transition | L3 | automated | existing `folder-collapse-seek.spec.ts` fixture | click the Reveal in sidebar button | ancestors expand and the card is selected, scrolled and flashed, as before |
| F7 | session-header: Approved board fidelity | visual/subjective | — | manual-only | desktop 2,000 px, 1,100 px and phone 390 px in base dark, base light, nord dark | compare with `mockups/session-header-reorg` state A | [judgment: matches the approved board, nothing feels cramped or oversized] |
| F8 | session-header: Mobile header on a real phone | visual/subjective | — | manual-only | iOS Safari and Android Chrome | use back, ring, layout menu, View, ⋯ one-handed | [judgment: targets comfortable, popover and bottom sheet readable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | session-header: Mobile context ring popover | fault-injection (abort) | L1 | automated | context usage becomes `undefined` (session switch / reconnect) while the popover is open | re-render with `undefined` usage | ring and popover unmount, no thrown error, focus moves to the ⋯ button or body, not lost to a detached node |
| X2 | session-header: Title menu | fault-injection (abort) | L1 | automated | `onRefresh` throws | activate Reload transcript | menu closes and the header stays mounted (no error boundary fallback renders) |

---

## Coverage summary

- Requirements covered: 21/21. Covered: the new `session-header` requirements and each MODIFIED or REMOVED requirement whose behaviour is observable. REMOVED attach/strip requirements are covered by E8, E14 and E18.
- Scenarios by class: edge 21 · perf 1 · frontend 8 · error 2
- Scenarios by level: L1 24 · L2 0 · L3 6
- Scenarios by disposition: automated 30 · manual-only 2

## New infra needed

- none. L1 uses existing RTL + vitest patterns. The L3 rows extend existing specs (`folder-collapse-seek`, `pending-prompt-recovery`, `replay-delta-on-reload`) or copy `split-composer-overflow.spec.ts` / `mobile-viewport-bound.spec.ts` geometry helpers.
