# UI plan — add-agent-teams-ui

Mock-loop output for tasks 1.1–1.8 and 1.10 (task 1.9 is the human's: decide each variant below from the live
mock site with `mock-decide`, then record the copy defaults). Production components are promoted from the decided
mock in section 8; nothing under `packages/agent-teams-plugin/src/client` exists yet.

Bindings followed: `frontend-mockup-loop-dashboard` PLUGIN SURFACE binding (runtime kit + `ui:*` primitives, mock
inside the real host, identical `surroundings` in both panes, rings on changed divs); anti-slop Design Read profile
`product-ui`, redesign mode `preserve`, image direction OFF; colours by token name only (no hex, no palette class,
no `--text-muted` / `--text-tertiary` as information).

## Mock pages (site: `npm run mocks` or `serve_mock_site{}`, port 5299, never 8000)

| Page id (`openspec/changes/add-agent-teams-ui/mockups/<id>/mock.tsx`) | Covers | Decision? |
|---|---|---|
| `2026-11-25-agent-teams-team-view-layout` | Team view in the real shell: desktop A (three regions) vs B (tabs everywhere), lead and teammate session, phone tablist steps, keyboard script | **Desktop layout** |
| `2026-11-25-agent-teams-members-cards-vs-table` | Members as cards (A) vs `SettingsTable` (B), 9 members, 10-member stress, phone | **Cards vs table** |
| `2026-11-25-agent-teams-board-mobile` | Board on a phone: columns (A) vs grouped list (B), 12 tasks, details open, 50-task stress | **Columns vs grouped list** |
| `2026-11-25-agent-teams-session-badge` | Real `SessionCard` + real badge slot: lead, teammates, long name, plain, cleared stamp; compact (A) vs fuller (B) | **Badge density** |
| `2026-11-25-agent-teams-card-load-look` | Lazy first paint (generic card) vs eager (team card); lazy swap played in one pane | **Eager vs lazy look** |
| `2026-11-25-agent-teams-mail-cards` | Real `ChatView`: 11 mail states collapsed / expanded / phone, next to real user messages; spoofing and markup | — |
| `2026-11-25-agent-teams-tool-cards` | Real `ToolCallStep`: four families × running / success / error / unknown code / elided / foreign details | — |
| `2026-11-25-agent-teams-team-states` | Loading, no team, not found, error (cold and stale), starting, orphaned, closing, closed, `persist_degraded`, degraded member, empty sections, inline Stop errors, shutdown confirmation, no-control viewer, 50×10 stress, long text | — |

Shared mock-only support files (not pages, loose files so `check:mockups` ignores them, imported as `../teams-*`):
`teams-fixtures.ts` (typed fixtures, core's own `formatMail` / `formatNoticeItem`), `teams-status.tsx` (D12 table),
`teams-view.tsx` (Team view), `teams-cards.tsx` (badge, mail cards, tool renderers), `teams-host.tsx` (real host paths
and a throw-away slot registry). Mock-only aliases added to `mockups/mock-site.config.ts` and `mockups/tsconfig.json`:
`@teams` (agent-teams-plugin `src`, shared contracts only) and `@rt` (this checkout's `dashboard-plugin-runtime`; in a git
worktree the bare specifier resolves to a second copy and splits the slot-registry context).

## D12 status table (single source on promotion: `status-map.ts`)

Glyph is an `aria-hidden` shape; text is the accessible name; pill state picks the severity family. Mock draws the
pill with `SettingsStatusPill icon={null}` (the implementation behind `ui:status-pill`): `ui:status-pill` adds its own
icon for `running` (spinner) and `muted` (minus) which would double the glyph. `busy` glyph pulses, `motion-reduce`
stops it.

| Member status | Glyph | Text | Pill state | Tone token family |
|---|---|---|---|---|
| `spawning` | ◌ | Starting | `info` | `--severity-info-*` |
| `idle` | ○ | Idle | `muted` | `--severity-neutral-*` |
| `busy` | ● (pulse) | Working | `running` | `--severity-info-*` |
| `shutdown_pending` | ◐ | Shutting down | `warn` | `--severity-warning-*` |
| `disconnected` | ⚠ | Disconnected | `warn` | `--severity-warning-*` |
| `gone` | ✕ | Gone | `muted` | `--severity-neutral-*` |
| `failed` | ✖ | Failed | `error` | `--severity-error-*` |

Extension of the same rules (shape + text + state): team lifecycle `starting` ◌ info · `active` ● success ·
`orphaned` ⚠ "Lead ended" warn · `closing` ◐ warn · `closed` ■ muted; task `pending` ○ muted · `in_progress` ● info ·
`completed` ✓ success; markers `⊘ Blocked` warning, `▲ Urgent` warning. No status is colour-only; grayscale still reads.

## Surfaces → tokens → states

| Surface | Tokens (by name) | States rendered |
|---|---|---|
| Team view frame | `--bg-primary`, `--text-primary`, `--border-primary` | ready, loading, no team, not found, error, error+stale |
| Header | `--text-primary`, `--text-secondary`, `--border-primary`; Back = secondary button (`--bg-tertiary`, `--border-secondary`); Shut down = `tint-action-red` (`--tint-red-*`) | active, starting, orphaned, closing (disabled "Closing…"), closed (no controls), viewed-from-teammate, no control |
| Banners (`SettingsNotice`) | `--severity-{info,warning,error}-{bg,fg,border}` | stale+Retry, `persist_degraded`, orphaned, starting, closing, closed |
| Member card | `--bg-secondary`, `--border-secondary`, `--elevation-rim`, `--shadow-card`, `--text-*`, `--link` / `--link-hover`, chips `--bg-tertiary` | 7 statuses, degraded notice, current task + "+N more", "No current task", session removed, Stop, inline Stop error |
| Members table (`SettingsTable`) | `--bg-tertiary` header, `--border-secondary`, `--text-*` | same data, scrolls sideways on a phone |
| Task board | cards `--bg-secondary`; columns `--bg-tertiary`; dependency chip border `--severity-warning-border` when open; `--link` | pending / in progress / completed, blocked, unblocked, dangling ("waits for #42 — missing"), details open, empty |
| Message log | rows `--bg-secondary`, `--border-subtle`; filter chip = contract recipe (`--severity-info-*` when on, plus a ✓ shape) | all kinds, urgent, not yet acknowledged, `lock_grant` generic row, 400-char bound + Show more, tail "Showing last 100 of 5000", vanished-member reset note, New messages |
| Tablist (contract "tabs" recipe) | `--accent-primary` bar, `--text-primary` / `--text-secondary`, count chip `--bg-tertiary` | selected, roving tabindex, wraps |
| Shutdown dialog (drawn inline) | `--bg-overlay`, card recipe, danger `tint-action-red` | open (Cancel / Shut down team) |
| Mail card (lazy) | `--bg-secondary`, `--border-subtle`, left rule `--border-strong`, `--bg-tertiary` body, `--link` | message, broadcast+urgent, task assigned, shutdown request / response, idle, notice (5 items, quoted continuation, empty), unknown kind, header truncated, unrecognised, collapsed, expanded, generic fallback while loading |
| Tool card body (lazy) | `--severity-*` for errors / delivery, `--bg-tertiary`, `--bg-code` for raw result | running, success, error (known sentence + code), unknown code ("Unexpected error (<code>)"), elided, `{op}`-only details, foreign details |
| Session badge (eager) | `--severity-neutral-{bg,fg,border}` | lead, teammate, long name (truncates), both refs → lead, cleared `teamId:null` → none, plain → none and no empty STATUS subcard |

Every control: `focus-ring`; below `sm` buttons and tabs ≥ 44 px (`min-h-[44px] sm:min-h-[32px]`); text ≥ 11 px;
agent text as React text children with `whitespace-pre-wrap [overflow-wrap:anywhere]`, no markdown / HTML / links.

## Decisions to take (task 1.9, human; `mock-decide accept <ref> "<variant>"`)

| # | Decision | Refs (A = Current pane, B = Proposed pane) | What the mock shows |
|---|---|---|---|
| 1 | Desktop layout | `#2026-11-25-agent-teams-team-view-layout/1` (also `/2`, `/3`) | A: three regions at once, members area capped at 44 % so 9 members scroll inside it; B: one section at a time, full panel height, tab counts visible |
| 2 | Members: cards vs table | `#2026-11-25-agent-teams-members-cards-vs-table/1` (`/2` stress, `/3` phone) | A: roomy, Stop and task readable; B: denser, task cell cramped, sideways scroll on a phone |
| 3 | Board on mobile | `#2026-11-25-agent-teams-board-mobile/1` (`/2` details, `/3` stress) | A: columns, two of three hidden; B: counts for all, Completed folded |
| 4 | Badge density | `#2026-11-25-agent-teams-session-badge/1` (`/2` phone) | A: `Lead` / name; B: `◆ Team │ Lead`, `◇ Team │ name` |
| 5 | Entry card eager vs lazy | `#2026-11-25-agent-teams-card-load-look/1` (`/2` plays the swap) | A (lazy): generic extension card for one chunk fetch, then swap; B (eager): team card at first paint, costs cold-chunk budget (task 9.5) |

Record: accept the page with the variant as the note (`"A"` / `"B"`, `"lazy"` / `"eager"`); to refuse both, reject with a
reason. After the decisions, task 1.10 lists them in the **Decisions** section at the end of this file.

### Copy defaults of design D14 (shown as proposed; confirm or amend at 1.9)

| Item | Proposed default | Where visible |
|---|---|---|
| Empty notice | "Team notice (empty)", no "+N" | mail-cards, the "notice (empty)" row |
| Toggle always rendered | "Show more" / "Show less" is rendered on every mail card, even for one-line text (a stable control; `aria-expanded`, `aria-controls`) | mail-cards |
| Unknown error code | "Unexpected error (<code>)", code verbatim | tool-cards frame 1 (4th row) |
| cwd display | `.` when equal to the lead cwd, relative path when inside, absolute otherwise | members cards / table |
| Unassigned | "unassigned" chip | task cards |
| Tablist wrap | `flex flex-wrap`; wraps instead of scrolling | layout frame 4 (phone) |
| User copy vs terminology | "Starting", "Start teammate"; never "spawn" in visible text (identifiers keep `TeammateSpawn`) | everywhere |

## Fidelity record (R1–R4) and deliberate approximations

- R1: both panes of every pair render the identical `surroundings` (real `ResizableSidebar` + real `SessionCard`s with the real
  badge slot, or the phone shell); only the ringed part differs.
- R2: there is no shipped Team view, so for layout / members / board / badge / load-look the Current pane holds variant A;
  for mail and tool cards Current is today (the host's generic extension card and generic tool renderer, via an empty registry).
- R3: rings (`Issue` = A, `Fix` = B, same number both sides) sit only on the changed div; a ring wraps in a grid, so
  full-height regions are ringed through the grid layout of `TeamView` (rows `auto auto minmax(0,1fr)`).
- R4: fixtures follow `TeamSnapshot` / `TeamUiSnapshot` / `Mail`; chat bodies come from core's `formatMail` and
  `formatNoticeItem`; real product nouns (this repo's paths, real model ids).
- Approximations: `SessionList` needs a live socket, so the sidebar is a column of real `SessionCard`s; `ui:confirm-dialog`
  portals to `document.body` and escapes the pane, so the shutdown dialog is drawn inline with the contract's dialog recipe;
  panes are not viewports, so `lg:` variants are explicit props (`layout`, `narrow`) and the production component switches on `lg:`.
- Contract rows used that still say `Adoption: pending (plugin wave)`: tabs, filter chip, loading / empty. This change adopts them.

## Findings for later sections (not mock decisions)

- Core's bridge returns `details: { op }` plus the JSON result text today (`bridge/tools.ts`). The renderers' `toolDetails` shape
  (`{op, ok, member|team|task|…, error?}`) is assumed in the mock; the fallback rows ("foreign details") show what ships today.
  Task 8.3 must validate the shape and §2/§4 should ask core for the enriched `details` or the card stays on the fallback.
- Host-owned contrast debt visible in the mock panes, present today and out of scope here: user bubble (`bg-blue-500/10`,
  2.2–2.8:1 for its timestamp), tool-row elapsed badge (`--text-muted`, 2.78:1), `CustomEntryCard` `<pre>` scroller not focusable.
- `--link` on `--bg-secondary` in `nord` light measures 3.3:1 and `--severity-success-fg` on its bg 4.44:1: both pass the repo's
  3:1 floor, below the 4.5:1 advisory; owned by the palette, not by this change.

## Promotion map (section 8)

| Mock file | Production file |
|---|---|
| `teams-status.tsx` | `client/status-map.ts` (+ pill component) |
| `teams-view.tsx` | `client/TeamView.tsx`, `MembersGrid`, `TaskBoard`, `MessageLog`, `TeamHeader` (winning variants only) |
| `teams-cards.tsx` badge | `client/TeamBadge.tsx` (eager, `isTeamSession`), mail card → `MailEntryCard.tsx`, renderers → `TeamToolRenderers.tsx` |
| `teams-fixtures.ts` | L1 / L3 fixtures (S92 to S99) |

## Verification record

Isolated pass: the mock site only (port 5299, started and stopped by the agent); `:8000` was never contacted. Every pane
(`?pane=<ref>`, so media queries are real) in base dark, base light, nord dark and nord light: 70 panes × 4 = 280, desktop at the
frame width and phones at 375 px, plus Playwright with axe-core (wcag2a/aa, 2.1 AA, 2.2 AA, best-practice).

| Check | Result |
|---|---|
| Page errors, failed requests | none (host APIs answered by `hostFixtures`, no "Missing fixtures") |
| Contrast of this change's own elements | 0 below the repo 3:1 floor in all 4 modes; 0 below 4.5:1 in base dark / light; 472 node-hits between 3:1 and 4.5:1 only in `nord` (`--link` 3.3:1, `--severity-success-fg` 4.44:1: palette tokens, advisory) |
| Horizontal page scroll at 375 px, incl. 400-character unbroken tokens (S96) | none |
| axe (rules other than page-level landmark / heading / region, which do not apply to an isolated pane) | clean for every pane of this change; remaining hits are host-owned (`CustomEntryCard` `<pre>` focus, user-bubble and elapsed-badge contrast) and the mock site's own ring badge (22 px) |
| Targets | all ≥ 44 px below `sm` in this change's controls; the one 32 px control is the runtime kit's `SettingsNotice` "Copy details" (contract recipe) |
| Keyboard pass | Tab order logical, visible focus ring on every stop; tablist roving tabindex with ←/→/Home/End and wrap; shutdown dialog: Cancel focused, Tab trapped, Escape closes only the dialog and returns focus to "Shut down team", the route stays open; mail toggle works with Enter and Space, focus kept; badge is a focusable link named "Open team view, lead"; Stop's inline errors are `role="alert"` and `aria-describedby` of their button |
| Reduced motion | skeleton pulse, busy glyph pulse and spinners compute `animation-name: none` under `prefers-reduced-motion: reduce` (Playwright emulation), animated in the control run |
| Static guards | `npm run check:mockups -- --base origin/develop` → ok; `node scripts/theme-token-guard.mjs` → no new violations; no raw hex, palette class or `--text-muted` as information in the mock files; `tsc -p mockups` reports nothing in this change |

Not covered here (human or later sections): a real screen reader (test-plan S106), visual judgement and the five decisions
(S105 / task 1.9), and a LAN phone check. `mock-check` on the scripted keyboard frame (`#2026-11-25-agent-teams-team-view-layout/5`): completed 3, failed 0.

## Decisions

Decided by the owner on 2026-11-25 (task 1.9), recorded with `mock-decide accept`:

| Decision | Choice | Consequence for §8 |
|---|---|---|
| Desktop layout | **B** — one section at a time behind tabs, on every width | one tablist (Members, Tasks, Messages) at all widths; no three-region grid |
| Members | **B** — table | `MembersGrid` renders a table (still ≥ 44 px row targets, wraps on phone) |
| Board on mobile | **B** — grouped list | `TaskBoard` renders a grouped list on narrow viewports |
| Badge density | **B** (Proposed pane of `#…-session-badge`) | `TeamBadge` follows the Proposed frame |
| Mail card look | **eager** | card module is eager only if task 10.4 measures it inside the cold-chunk budget **including its strings**; otherwise it stays lazy and this decision is reported as budget-blocked |

D14 copy defaults stay as drafted in this file (not changed by the owner).
