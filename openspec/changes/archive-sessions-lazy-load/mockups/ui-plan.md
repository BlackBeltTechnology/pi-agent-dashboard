# UI plan — archive-sessions-lazy-load

Mockup: `archive-ux.html` (serve dir, toggle dark/light in topbar). Tokens: `tokens.css` = verbatim copy of `:root` + `[data-theme="light"]` blocks from `packages/client/src/index.css`.

## Surfaces

| Surface | Source file | Change |
|---|---|---|
| Session card action cluster | `packages/client/src/components/session/SessionCard.tsx` ~L883 | Remove `session-hide-btn` / `session-unhide-btn` (eye-off/eye). Add `session-archive-btn` (`mdiArchiveOutline`) — rendered only when `status === "ended"` or idle (`isAlive && !isRunning`). Never on running. No confirm dialog. |
| Archived row (lazy) | new `ArchivedSessionRow.tsx` | Dashed border, no shadow, no drag grip, `opacity .62`, pill `archived`. Actions: `session-unarchive-btn` (`mdiRestore`, hover `--accent-green`), delete (`mdiDeleteOutline`, hover `--accent-red`). Click = read-only open; transcript loaded on demand. NOT a `SessionCard` — separate lightweight component; not in `sessions` Map. |
| Folder archive fold | `SessionList.tsx` ~L1784 (below ended fold) | `folder-archive-toggle-${cwd}`: `mdiArchiveOutline` + `Archive (N)` + right-aligned age hint `> {archiveAfterDays}d`. Dashed top separator. Hidden when N = 0. Left-aligned (reads as drawer, distinct from centered ended fold). |
| Folder archive fold — expanded | same | Chevron down; hint becomes `showing X of N`. Fetch `GET /api/sessions/archived?cwd=&limit=50&before=` on first expand. 2 skeleton rows during flight. `Load 50 more` until exhausted. Sorted `endedAt` desc. |
| Search bar — include archive chip | `SessionList.tsx` ~L404 (`sessionSearch`) | Chip `search-include-archive` (`mdiArchiveOutline` + "archive"), `aria-pressed`, off by default, persisted in localStorage. On + query ≥ 3 chars → debounced 300 ms `GET /api/sessions/archived?q=&limit=50` (server-side substring on cached meta `name` / `firstMessage`, all folders). Results grouped per folder under an `Archive matches (N)` section rendered as archived rows. `activeOnly` / tag / phase axes not applied to archived rows. Chip off = today's behaviour (`filterByQuery` over resident pool). |
| Sidebar footer | `SessionList.tsx` ~L2137 | `sessionList.hiddenCount` → copy `N hidden workers`. Counts only `hidden===true` (auto-hidden headless). |
| Settings › Session list | `SettingsPanel.tsx` ~L1635 | `NumberField` `settings.archiveAfterDays` (default 30, min 0 = never) + `settings.archiveSweepIntervalMinutes` (default 60, min 1). |

## Tokens used (no raw hex)

- surfaces: `--bg-secondary` (folder), `--bg-tertiary` (card), `--bg-surface` (buttons), `--bg-hover`
- text: `--text-primary` title, `--text-secondary` ended title, `--text-tertiary` icons/labels, `--text-muted` folds/meta, `--text-faint` age hint
- borders: `--border-subtle` card, `--border-secondary` archived (dashed)
- shadow: `inset 0 1px 0 var(--elevation-rim), 0 4px 8px var(--shadow-card)` on live cards only; none on archived
- accents: `--accent-green` restore hover, `--accent-red` delete/shutdown hover
- radius: `rounded-xl` (12px) cards, `rounded-full` pills

## States

| Element | States |
|---|---|
| archive btn | idle/ended: visible; running: absent; hover: `--text-primary` + `--bg-hover` |
| archive fold | N=0 hidden · collapsed · loading (skeletons) · expanded · exhausted (no Load more) · error (inline `Retry`) |
| archived row | default · hover (border `--border-secondary` solid) · restoring (spinner in place of restore icon) |
| include-archive chip | off · on · on+searching (spinner in chip) · on+no matches (`Archive matches (0)` section hidden) |
| footer hidden toggle | N=0 hidden · `N hidden workers` |

## Rubric (manual, agent-browser screenshots dark + light @1280)

- [x] Contrast — dark + light both pass; muted text used only for hints, never for actionable labels
- [x] Responsive — 300px sidebar column; settings units `nowrap`; no overflow at 375 (single-column grid)
- [x] Hierarchy — live cards (shadow) > ended (opacity) > archived (dashed, no shadow)
- [x] Spacing — 4/6/8/12 gaps from card/fold classes
- [x] Token fidelity — all vars from `index.css`
- [x] Anti-slop — no gradients, no purple, system font as prod, real session names
- [x] Console — none

## i18n keys (en + hu)

`session.archiveSession`, `session.restoreSession`, `session.archived`, `sessionList.archiveFold` `{count}`, `sessionList.archiveShowing` `{shown,count}`, `sessionList.loadMoreArchived` `{count}`, `sessionList.hiddenWorkers` `{count}`, `sessionList.includeArchive`, `sessionList.archiveMatches` `{count}`, `settings.archiveAfterDays`, `settings.archiveAfterDaysHint`, `settings.archiveSweepInterval`.
