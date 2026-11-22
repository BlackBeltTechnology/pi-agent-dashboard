# Test Plan — sidebar-folder-ux

Stage: design   Generated: 2026-11-20

Sources: proposal.md, design.md (D1–D5), specs/** (10 capability deltas), tasks.md, /tmp/issue-batch/decisions-final.md
(D2 live sessions → confirm + shutdown, default focus Cancel; D3 chips hidden only in Focus; hidden live sessions included).
Gap answers folded (all recommended answers accepted): G1 plural-aware count name (`1 session` / `N sessions`); G2 all live rows in a `max-h-32 overflow-y-auto` box; G3 P1 perf row dropped (no budget); G4 best-effort shutdown + item hidden when `onShutdown` absent and live sessions exist.

Harness exemplars (all verified to exist):
- X-DLG  `packages/client-utils/src/__tests__/{useFocusTrap,Dialog,Confirm}.test.tsx`
- X-MENU `packages/client/src/components/__tests__/SessionList.folder-menu.test.tsx`
- X-ACC  `packages/client/src/components/session/__tests__/SessionList.accordion.test.tsx`
- X-BLK  `packages/client/src/components/session/__tests__/SessionList.card-blocks.test.tsx`
- X-BAN  `packages/client/src/components/folder/__tests__/FolderActionBanner.test.tsx`
- X-GBY  `packages/client/src/components/__tests__/SessionList.group-by.test.tsx`
- X-GRP  `packages/client/src/__tests__/session-grouping-path-drift.test.ts` (+ `lib/__tests__/session-grouping-worktree.test.ts`)
- X-CWD  `packages/client/src/components/__tests__/CloseWorktreeDialog.test.tsx` (end-sessions-then-act precedent)
- X-FOC  `packages/client/src/lib/state/__tests__/CardSectionsContext.focus.test.tsx`
- X-E2EM `tests/e2e/folder-actions-menu.spec.ts` (menu, `test.use({viewport})`, focus-return F9)
- X-E2EF `tests/e2e/focus-mode.spec.ts` / `tests/e2e/folder-accordion.spec.ts` / `tests/e2e/folder-action-banner.spec.ts`
- X-E2EP `tests/e2e/pin-does-not-resurrect-archived.spec.ts` (pinned folder + session seed)

Note: SessionList chip tests live in `components/session/__tests__/SessionList.{card-blocks,accordion}.test.tsx` (not `components/folder/__tests__`) — use X-ACC / X-BLK for SessionList-level rows, X-BAN for the banner unit.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable | harness exemplar |
|----|----|----|----|----|----|----|----|----|
| S1 | folder-actions-menu: one-step removal | decision-table (pinned × inWorkspace × ownerWs) | L1 | automated | folders: {pinned+ws, pinned only, ws-owned unpinned, unpinned outside all ws}, ended sessions only | open folder menu | `remove-from-sidebar` item present for first three, absent for the fourth; no `data-action-tone` on it | X-MENU |
| S2 | same: pinned folder inside workspace | state-transition | L1 | automated | pinned folder in workspace W, only `ended` sessions | activate item | `onRemoveFolderFromWorkspace(W,cwd)` and `onUnpinDirectory(cwd)` each called once; `onShutdown` not called; no dialog in DOM | X-MENU |
| S3 | same: pinned top-level folder | state-transition | L1 | automated | pinned, no workspace, ended-only | activate item | only `onUnpinDirectory(cwd)` called; `onRemoveFolderFromWorkspace` never | X-MENU |
| S4 | same: workspace-owned but unpinned | state-transition | L1 | automated | in workspace W, not pinned, ended-only | activate item | only `onRemoveFolderFromWorkspace(W,cwd)` called; `onUnpinDirectory` never | X-MENU |
| S5 | same: live sessions require confirmation | state-transition | L1 | automated | pinned folder, 2 sessions status ≠ ended (e.g. `streaming`, `idle`) | activate item | `role="dialog"` opens listing both session names; no `onShutdown`/removal callback called yet | X-MENU + X-CWD |
| S6 | same: BVA on live count | BVA (0 / 1 / 2 live) | L1 | automated | folder with 0, 1, 2 live sessions (status `ended` vs `closing` vs `idle`) | activate item | 0 → no dialog, immediate removal; ≥1 → dialog (a `closing` session counts as live and is listed) | X-MENU |
| S7 | same: hidden live sessions | equivalence partitioning (visible/hidden) | L1 | automated | live headless/automation session excluded by "show hidden" off; plus a visible live one | activate item, confirm | hidden session is listed in dialog AND receives `onShutdown(id)`; decision "needs confirmation" also true when the ONLY live session is hidden | X-MENU + X-GRP |
| S8 | same: worktree session in folder's card | equivalence partitioning (group-key route) | L1 | automated | pinned `/repo`; live unpinned session `cwd=/repo/.worktrees/x`, `gitWorktree.mainPath=/repo` | activate, confirm | session listed and `onShutdown` called with its id | X-MENU + X-GRP (worktree test) |
| S9 | same: path-drift equivalence | BVA / error-guessing (separator, case) | L1 | automated | live session `cwd` = `/Repo/` vs folder `/repo` (trailing separator; case drift on case-insensitive platform) | activate, confirm | session listed + shut down; a live session in a sibling folder `/repo-other` (prefix-collision) is NOT listed/shut down | X-GRP |
| S10 | same: other-folder isolation | equivalence partitioning | L1 | automated | live sessions in `/a` (target) and `/b` (other) | confirm for `/a` | `onShutdown` only for `/a` sessions | X-MENU |
| S11 | same: confirm ordering | state-transition (sequence) | L1 | automated | folder pinned+ws with live sessions A,B | confirm | call order (spy log): `onShutdown(A)`, `onShutdown(B)` (any order among them) strictly before `onRemoveFolderFromWorkspace` then `onUnpinDirectory`; each called exactly once | X-MENU + X-CWD |
| S12 | same: set evaluated at confirm time | state-transition (rerender while open) | L1 | automated | dialog open with live A; rerender props so session C (same group) becomes live (and A becomes ended) | confirm | `onShutdown(C)` called, `onShutdown(A)` not called | X-MENU |
| S13 | same: cancel / Esc change nothing | state-transition | L1 | automated | dialog open | click Cancel; separately press Escape | no callback called; folder still rendered; dialog removed | X-MENU |
| S14 | same: dialog outlives the menu | state-transition | L1 | automated | dialog opened via menu (menu closes on select) | rerender with folder removed from `sessions`/pinned list while dialog open | dialog remains in DOM until confirm/cancel; confirm still dispatches shutdown+removal for the cwd | X-MENU |
| S15 | folder-actions-menu: not offered | decision-table | L1 | automated | unpinned, no workspace folder | open menu | no `remove-from-sidebar` item (covered by S1 row 4; assert explicitly incl. `queryByText`) | X-MENU |
| S16 | #1086 rule + D1: removal result | state-transition | L1 | automated | ended-only pinned folder; rerender with pin/ws membership cleared | after both messages reflected in props | folder absent from sidebar, no archive call; Folder-filter text = its path re-reveals it | `packages/client/src/components/__tests__/SessionList.folder-visibility.test.tsx` |
| S17 | D2: after shutdown folder leaves | state-transition | L1 | automated | live folder, confirm; rerender sessions `ended`, pin cleared | rerender | folder leaves by #1086 rule | SessionList.folder-visibility.test.tsx |
| S18 | D2 edge: selected session keeps folder | boundary (existing behaviour) | L1 | automated | after confirm+rerender all ended, but one ended session in the folder is `selectedId` | rerender | folder STILL visible until deselected (characterization of accepted behaviour) | SessionList.folder-visibility.test.tsx |
| S19 | confirm-dialog: defaultFocus | decision-table (defaultFocus set/unset × intent) | L1 | automated | `Confirm intent="danger" defaultFocus="cancel"` vs without prop vs `intent="danger"` alone | open | set → `document.activeElement` is Cancel and Enter fires cancel not confirm; unset → focus identical to pre-change (built-in ✕/first focusable) | X-DLG (Confirm.test.tsx) |
| S20 | dialog-primitive/dialog-system: data-autofocus | decision-table (marked / unmarked / multiple marked / marked-but-hidden) | L1 | automated | Dialog with Cancel `data-autofocus` + ✕ first; dialog with none marked; two marked; marked element `hidden`/`aria-hidden` | open | marked → that element focused; unmarked → first focusable (unchanged); two marked → first in DOM order; hidden-marked skipped → falls back to first focusable | X-DLG (useFocusTrap.test.tsx, Dialog.test.tsx) |
| S21 | dialog-primitive: `Dialog.Cancel autoFocus` | equivalence partitioning | L1 | automated | `<Dialog.Cancel autoFocus>` vs without | render | `data-autofocus` attribute present only when prop set | X-DLG |
| S22 | dialog-primitive: late-arriving + marked | state-transition | L1 | automated | dialog opens empty, then marked + unmarked controls appear | children mount | focus moves once, to marked control (or first focusable if none), never taken back afterwards | X-DLG (useFocusTrap.test.tsx) |
| S23 | dialog-primitive: Tab containment with default focus on Cancel | state-transition | L1 | automated | confirm dialog, focus on Cancel (not first element) | Tab to last then Tab; Shift+Tab from first | wraps within dialog both directions; focus never escapes | X-DLG |
| S24 | confirm dialog: Enter/Space keyboard path | state-transition | L1 | automated | folder menu item focused | Enter on item → Tab → Enter on Confirm (keyboard only) | dialog opens, focus on Cancel, Tab reaches Confirm, Enter sends shutdown+removal | X-MENU |
| S25 | focus return on close | state-transition | L1 | automated | trigger `[data-testid="folder-actions-menu-<cwd>"]` mounted; dialog confirmed/cancelled | close | `document.activeElement` is the trigger; if trigger unmounted (folder left list) no throw and focus not forced to body-error | X-MENU |
| S26 | session-card-section-visibility: Focus hides every rung | decision-table (rung × focus × compact-path) | L1 | automated | rungs {init-needed, setup, retrust, failed, running} × Focus {on,off} × path {accordion-compact, folder-banner hidden, expanded banner} | render `FolderActionBanner` (unit) / SessionList (integration) | Focus on + compact → no chip DOM for all 5 rungs in both compact paths; Focus off → chip renders for all 5 incl. init-needed (unchanged); expanded `compact={false}` banner unaffected by Focus-suppress prop | X-BAN + X-ACC + X-BLK |
| S27 | focus-mode/session-card-section-visibility: profile shows banner | decision-table | L1 | automated | Focus on, stored profile with `folder-banner` visible; folder requires re-trust / failed / running | render expanded | full banner renders (`folder-banner-<kind>-<cwd>`); no chip | X-BLK + X-FOC |
| S28 | worktree-init-feedback: Focus suppression | state-transition | L1 | automated | Focus on + built-in profile; init run running → failed | render across both | neither banner nor chip nor inline progress on the card; toggling Focus off → banner returns with Retry; toggling on with profile showing banner → banner shows | X-BLK |
| S29 | focus-mode: Safety cues survive (modified) | decision-table | L1 | automated | Focus on built-in profile; re-trust folder + session with background process, `process` hidden | render | PROCESS safety chip renders; folder compact chip does NOT | X-BLK + X-FOC |
| S30 | folder-focus: no Group-by row in compact | decision-table (mode × group-by setting) | L1 | automated | accordion; folder modes {compact-empty, compact-attention, full, collapsed}; group-by ∈ {none, status, non-default} | render | `folder-group-by-row-<cwd>` absent in both compact modes; present for `full`/`collapsed` when mode≠none; classic collapsed with same setting still renders it | X-ACC + X-GBY |
| S31 | session-list-group-by: compact has no indicator but menu does | state-transition | L1 | automated | compact folder with group-by `status` | open folder menu | no indicator row; menu shows Group-by radio items with current selection checked | X-GBY |
| S32 | session-filtering: compact-empty count | BVA (N = 0, 1, 2, 18) | L1 | automated | compact-empty folder with N visible sessions (post hidden/search filters) | render | N=0 → no count button, only header; N≥1 → `<button>` sibling of name `role="link"` (not descendant), plural-aware accessible name: `1 session` for N=1, `N sessions` for N≥2, no `folder-compact-row-<cwd>` | X-ACC |
| S33 | session-filtering: count a11y/contrast | equivalence partitioning | L1 | automated | N=18 compact-empty | inspect | link accessible name equals folder name only (no count); count button class/style uses `--text-secondary`+ not `--text-muted` | X-ACC |
| S34 | session-filtering: count activation | state-transition | L1 | automated | compact-empty `/foo`; a session in `/bar` selected (route /bar session) | click count button | `activateFolder('/foo')` called; `/foo` collapsed/pinnedOpen unchanged; route/`onSelect` not called; click does not propagate to header handler | X-ACC |
| S35 | session-filtering: header name link unchanged | state-transition | L1 | automated | compact-empty `/foo` | Enter on `folder-header-name-<cwd>` | `/foo` focused AND navigates to folder home (both effects) | X-ACC |
| S36 | session-filtering: count vs filters | BVA/equivalence | L1 | automated | 20 sessions, 2 hidden (headless), search/filter shrinks to 3 | render with each filter | N reflects post-filter count; with active search folder is `full` (no count) | X-ACC |
| S37 | folder-focus: mode table regression | decision-table (existing) | L1 | automated | focused/collapsed/pinned-open/attention combos | render | mode resolution unchanged (full/collapsed/compact-attn/compact-empty) apart from missing Group-by row; compact-attention = header + attention cards only | X-ACC |
| S38 | D4: relative slimness | comparison (boundary) | L3 | automated | accordion mode, compact-empty folder vs classic collapsed folder, same name/session count | read `boundingBox().height` of each card | compact-empty height ≤ classic collapsed height; exactly one header row (no `folder-group-by-row`, no `folder-compact-row`) | X-E2EF (folder-accordion.spec.ts) |
| S39 | #1134 end-to-end Focus | state-transition | L3 | automated | built-in Focus profile; folder in init-needed state (trusted init hook not run) | toggle Focus on then off | Focus on → no `folder-banner-*`/chip testid for folder; Focus off → chip returns | X-E2EF (focus-mode.spec.ts + folder-action-banner.spec.ts) |
| S40 | #1118 end-to-end remove w/ live session | state-transition | L3 | automated | pinned folder with a live (seeded) session; ended-only pinned folder | menu → Remove from sidebar → (dialog) Confirm | live: dialog visible, Cancel focused (`:focus`), Confirm → server receives shutdown, session ends, folder leaves sidebar; ended-only: folder gone immediately, session still in history/Folder-filter | X-E2EM + X-E2EP |
| S41 | #1118 keyboard/focus return in real browser | state-transition | L3 | automated | same as S40, Cancel path | open via keyboard, Esc | focus lands on `folder-actions-menu-<cwd>`; Tab is trapped in dialog | X-E2EM (F9 focus-return pattern) |
| S42 | #1118 new session restores folder | state-transition | L3 | automated | removed folder | start a session in it | folder reappears with its sessions intact | X-E2EP |
| S43 | folder-actions-menu: tone modified | equivalence | L1 | automated | folder menu for pinned folder | open | Remove from sidebar has no `data-action-tone`; existing tones (Disable team danger, Remove from workspace neutral, etc.) unchanged | `packages/client/src/components/__tests__/FolderActionsMenu.test.tsx` / X-MENU |
| S44 | folder-actions-menu: confirm dialog has accessible semantics | equivalence | L1 | automated | open confirm | inspect | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` resolves to non-empty title; Esc closes | X-DLG (Dialog.test.tsx) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window | harness exemplar |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|------------------|
| P2 | session-list render | render-count guard | L1 | automated | Focus toggled on/off with 14 folders | `FolderActionBanner` renders do not exceed 1 per Focus toggle per folder (no extra re-render loop from `useFocusState`) | n/a | X-FOC |

(Former P1 — confirm-time live-set derivation latency — dropped per accepted G3: client-only O(n) filter on a click, no stated budget. No other perf classes apply: no new server verb, no persistence, no polling.)

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable | harness exemplar |
|----|----|----|----|----|----|----|----|----|
| F1 | folder-actions-menu: menu content reachable at short heights | BVA on viewport (1280×720; 1280×600; 1280×599 sheet) | L3 | automated | 14 pinned folders; popover form; viewport 1280×720 and 1280×600 | open folder actions menu, wheel-scroll panel; keyboard-focus last item | `panel.bottom ≤ viewport height`; last item scrolled into view by wheel and by keyboard (`toBeInViewport`); at 599px height sheet form used (existing behaviour, still reachable) | X-E2EM (viewport `test.use`) |
| F2 | same: other directory-listing popovers | equivalence partitioning (surface) | L3 | automated | 14 pinned folders + workspaces at 1280×720 | open add-to-workspace menu, workspace header menu, Add-folders dialog | each panel bottom ≤ viewport; last item reachable (the surface found failing in 4.1 added first and shown failing before 4.3) | X-E2EM / `tests/e2e/add-folder-file-manager.spec.ts` |
| F3 | folder-menu: popover flip | state-transition | L3 | automated | folder card near bottom edge of 1280×720 sidebar | open menu | panel flips/bounds via `usePopoverFlip` `maxHeight`; no clipping; single positioning mechanism (no second inline `top`/`transform` override) | X-E2EM |
| F4 | confirm dialog focus quirk: opener unmounted | state-transition (menu `onOpenChange(false)` before `onSelect`) | L3 | automated | real browser: focused menu item unmounts on select | confirm/cancel | focus does not drop to `<body>`; lands on `folder-actions-menu-<cwd>` | X-E2EM |
| F5 | confirm dialog: long live-session list | BVA (1 / 12 / 60 sessions) | L1 | automated | folder with 60 live sessions, long names | open dialog | every live session is rendered (no row cap) in a scrollable container (`overflow-y-auto` + max-height class like CloseWorktreeDialog `max-h-32`), Cancel/Confirm buttons remain rendered; long names truncate, no horizontal overflow class missing | X-CWD |
| F6 | session-filtering: count button vs header click bubbling | state-transition | L1 | automated | compact header with count button | mousedown/click/keyboard Space on count | header's own click handler never fires (`stopPropagation`), no navigation | X-ACC |
| F7 | focus-mode: Focus toggle live | state-transition | L1 | automated | Focus toggled on/off while a folder is blocked (retrust) and while a chip was "revealed" into full banner by click | toggle | converges: Focus on → no chip/banner revealed state leaks; Focus off → chip returns, revealed-banner state not stuck | X-FOC + X-BLK |
| F8 | D4 / dark-light-palette rendering of compact card + count | visual/subjective | — | manual-only | live-component mock (`mockups/`) at 3 breakpoints, base dark/light + one palette | human reviews via `mock-decide` | [judgment: count suffix muted-but-legible, header row looks "slim" — final pixels are owner call; automatable invariants covered by S33/S38] | — |
| F9 | #1153 reporter confirmation | manual verification | — | manual-only | issue #1153 comment thread | maintainer asks reporter which menu/viewport; reporter answers | [judgment: external human answer, no automatable observable; if a surface is named it becomes F2 row] | — |
| F10 | #1153 repro on 13" physical display | manual verification | — | manual-only | real 13" laptop (≈1280×720–800) | open each directory-listing surface, scroll with trackpad | [judgment: trackpad/OS scrollbar feel not automatable; wheel/keyboard reachability covered by F1/F2] | — |
| F11 | a11y of confirm dialog with screen reader | visual/subjective | — | manual-only | VoiceOver on macOS | open Remove-from-sidebar confirm | [judgment: announces title + list + focused Cancel; role/aria-modal/title covered by S44] | — |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable | harness exemplar |
|----|----|----|----|----|----|----|----|----|
| X1 | D1 non-atomic removal | fault-injection (partial failure) | L1 | automated | `onRemoveFolderFromWorkspace` handler is a no-op/throws synchronously; `onUnpinDirectory` still wired | confirm / activate | handler does not throw out of the click; `onUnpinDirectory` still invoked, no unhandled rejection, dialog closes; no retry loop | X-MENU |
| X2 | D2 shutdown callback throws for one session | fault-injection | L1 | automated | `onShutdown` throws for session A (live A,B) | confirm | B still receives `onShutdown`; removal messages still sent; dialog closes (no stuck dialog) (best-effort: a throw does not abort the rest) | X-CWD (CloseWorktreeDialog end-sessions step) |
| X3 | D2 optional callbacks absent | error-guessing | L1 | automated | `onShutdown` undefined (prop optional in some mounts); one folder with live sessions, one folder with only ended sessions | open folder menu | live-session folder: no `remove-from-sidebar` item; ended-only folder: item still present and activates without crash | X-MENU |
| X4 | D2 server-side: shutdown of unresponsive session | fault-injection (delay) | L1 (server) | automated | pi unresponsive to polite `shutdown` | `shutdown` browser msg | existing terminator ladder (1.5 s → SIGTERM → SIGKILL) ends it; existing server test asserts it (extend only if the ladder step is uncovered) | `packages/server/src/spawn-process/__tests__/session-terminator.test.ts` |
| X5 | D1 trust/mirror failure | fault-injection | — | manual-only | `handleRemoveFolderFromWorkspace` mirror-revoke error (`reportMirrorError`) | confirm removal | [judgment: design accepts no client ack; folder stays visible and user may retry — observed via toast only, covered by existing server tests of directory-handler] | — |
| X6 | D5 #1153 no repro | error-guessing | L3 | automated | nothing reproduces at 1280×720 | run F1 | F1 stays green as regression guard (task 4.3 "close as not-reproducible") | X-E2EM |
| X7 | session ended during dialog | fault-injection (race) | L1 | automated | all live sessions end on their own while dialog open | confirm | no `onShutdown` calls; removal messages still sent; no error | X-MENU |
| X8 | Focus store missing provider | error-guessing | L1 | automated | `SessionList`/banner rendered without `CardSectionsContext` provider | render | `useFocusState().enabled` defaults false → chip behaviour unchanged (no throw) | X-FOC |

---

## Coverage summary

- Requirements covered: 17/17 (folder-actions-menu ×4 [removal, reachability, tone, badge-unchanged], confirm-dialog, dialog-primitive, dialog-system, focus-mode, session-card-section-visibility, worktree-init-feedback, session-list-group-by, folder-focus, session-filtering; badge/tone requirement unchanged sub-rules covered by existing tests)
- Scenarios by class: edge 44 · perf 1 · frontend 11 · error 8
- Scenarios by level: L1 49 · L2 0 · L3 10 · manual-only (—) 5
- Scenarios by disposition: automated 59 · manual-only 5

Total: 64 scenarios (S1–S44, P2, F1–F11, X1–X8; P1 dropped).

## New infra needed

- e2e seed of 14 pinned folders at 1280×720 (F1/F2) — extend existing e2e folder seeding helper; no new harness level.
- Mock site live-component mock under `openspec/changes/sidebar-folder-ux/mockups/` (task 4.2) — existing `frontend-mockup-loop-dashboard` tooling.
- Otherwise none.
