# Test Plan — composer-dock-collapse-and-file-open

Stage: design   Generated: 2026-10-22

No clarifications are open. Every Triple below resolves from the delta specs and `design.md` (dwell 300 ms, speed 0.4 px/ms over 100 ms, grace 300 ms, bar 44 px, compact threshold 32.5rem).

Harness exemplars:
- L1 dock: `packages/client/src/components/chat/__tests__/ComposerDock.test.tsx` + `dock-harness.tsx`
- L1 lanes: `ComposerDock.lanes.test.tsx`
- L1 hover: `packages/client/src/components/session/__tests__/session-hover-intent.test.ts`
- L1 storage: `packages/client/src/lib/__tests__/tree-visible.test.ts`
- L1 rows: `packages/client/src/lib/layout/__tests__/chat-pane-row-class.test.ts`
- L1 runtime: `packages/dashboard-plugin-runtime/src/__tests__/ComposerDockRow.test.tsx`
- L1 editor: `packages/client/src/components/editor-pane/__tests__/EditorPane.test.tsx`
- L3: `tests/e2e/composer-dock.spec.ts`

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Dock collapses to a one-line summary bar | decision-table | L1 | automated | main-checkout session; Changes (3 files +1 −0), OpenSpec, Context lanes | click `composer-dock-hide` | `composer-dock-scroll` has `hidden`; `composer-dock-bar` text = the 3 lanes' `summaryText` in order; `aria-expanded="false"`; `aria-controls` = the region id; name starts "Session context" |
| E2 | Dock collapses… (empty lane) | decision-table | L1 | automated | Context lane whose claims render `null` (`emptyLanes` has `context`) | collapse | bar has no Context segment and no trailing separator |
| E3 | Dock collapses… (nothing to collapse) | decision-table | L1 | automated | (a) YOLO live, no lanes; (b) lanes registered but every lane in `emptyLanes` | render | no `composer-dock-hide`, no `composer-dock-bar` in both cases |
| E4 | Dock collapses… / identity carve-out | EP | L1 | automated | worktree session `os/x`, 4 files +120 −33, `gitStatus` dirty 3 ↑2 | collapse | bar Changes segment = `os/x 4 files +120 −33`; no `←`, dirty or `↑` marker inside the bar |
| E5 | Bar never wraps | BVA | L3 | automated | 375 px viewport, summaries wider than the bar | collapse | bar bounding box height = 44 px; single line (`scrollHeight` ≤ `clientHeight`); no horizontal overflow of the dock |
| E6 | Collapse state persists per session | state-transition | L1 | automated | `s1` collapsed, `s2` no stored key | bind `s1` → `s2` → `s1` | `s2` first render expanded; `s1` first render collapsed (no one-frame flash) |
| E7 | Collapse state persists… (storage) | fault-injection (abort) | L1 | automated | `localStorage.getItem` throws | mount the dock for `s1` | dock renders expanded; no error surface; no throw |
| E8 | Collapse state persists… (no session / non-live) | decision-table | L1 | automated | (a) folder-home dock (no session); (b) `live=false` with a stored collapsed key | interact / render | (a) no `localStorage` read or write; (b) renders collapsed read-only, no Hide/Pin, no write |
| E9 | Dock is a shrinkable row (collapsed entries) | BVA | L1 | automated | `CHAT_PANE_ROW_TABLE` | read `composer-dock:collapsed` and `composer-dock:collapsed-yolo` | both shrinkable; bounds = 44 and 44 + `YOLO_FOOTER_HEIGHT`; floor = bound + 1 |
| E10 | Dock is a shrinkable row (collapsed short pane) | BVA | L1 | automated | collapsed dock, YOLO on and off, pane shorter than transcript floor | render | root `minHeight` = bound + `DOCK_CHROME_PX` (non-zero without YOLO); `data-pane-row` = the collapsed key |
| E11 | Changes lane — Open | EP | L1 | automated | row `packages/client/src/App.tsx` in `diff.files` | click `composer-dock-file-open` | `openInSplit` called once with `packages/client/src/App.tsx`; `openDiffTab` and `navigate` not called |
| E12 | Changes lane — File name opens the file | EP | L1 | automated | same row | click the title button (name "Open packages/client/src/App.tsx in editor") | identical call to E11 |
| E13 | Changes lane — File opens its diff | EP | L1 | automated | same row | click `composer-dock-file-diff` | `openDiffTab("packages/client/src/App.tsx")` once; no `navigate(buildSessionDiffUrl)` |
| E14 | Changes lane — Review | EP | L1 | automated | Changes lane header | click `composer-dock-review` | `navigate(buildSessionDiffUrl(id))` once |
| E15 | Changes lane — out-of-cwd row | EP | L1 | automated | 4 in-cwd files + 1 `previewable:false` absolute entry | expand lane | header count/totals cover the same 4; out-of-cwd row has no Open, no Diff, no activatable title |
| E16 | Changes lane — non-live dock | decision-table | L1 | automated | (a) `live=false`; (b) split context `sessionId` ≠ dock session | expand lane | no row targets render |
| E17 | Changes lane — phone fit | BVA | L3 | automated | 375 px viewport, row path `packages/client/src/components/chat/very/long/dir/ChangesLane.tsx` | expand Changes | Open and Diff visible, each ≥ 44×44 CSS px; folder text has ellipsis; dock `scrollWidth` ≤ `clientWidth` |
| E18 | Process group rows use the dock row primitive (activatable title) | EP | L1 | automated | `ComposerDockRow` with `title="App.tsx"`, `titleLabel`, `onTitleActivate` | click the title | it is a `button` named by `titleLabel`; handler called once; title keeps the `truncate` class |
| E19 | Process group rows… (plain title) | EP | L1 | automated | `ComposerDockRow` without `onTitleActivate` (existing Processes row) | render | title is a non-interactive `span`; DOM is identical to the pre-change snapshot |
| E20 | Compact dock below 520 px (collapsed) | state-transition | L1 | automated | column 480 px, Changes lane open, dock collapsed | render, then activate the bar | collapsed: no chips, bar shown; after activation: chips shown with the Changes sheet open |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Resting on the collapsed bar peeks (refs-only listener) | invariant | L1 | automated | 200 synthetic `pointermove` events over the bar within the dwell window | React commits of `ComposerDock` during the moves = 0 (Profiler `onRender` count); exactly one commit at peek | one dwell window (300 ms, fake timers) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Resting on the collapsed bar peeks | state-transition | L1 | automated | collapsed dock, `(hover: hover) and (pointer: fine)` | pointer enters the bar, 0 px/ms for 300 ms (fake timers) | state = peek; lane region visible, `position: absolute`; `document.activeElement` unchanged |
| F2 | Resting… (just below dwell) | BVA | L1 | automated | same | rest 299 ms then leave | never peeks |
| F3 | Resting… (fast pass) | BVA | L1 | automated | same | moves at 1.5 px/ms across the bar for 400 ms, then leaves | never peeks |
| F4 | Resting… (speed boundary) | BVA | L1 | automated | same | 300 ms at 0.39 px/ms vs at 0.41 px/ms over the last 100 ms | 0.39 → peek; 0.41 → no peek until the speed drops |
| F5 | Resting… (suppressed arming) | decision-table | L1 | automated | (a) pointer button pressed; (b) `[role=dialog][aria-modal=true]` open; (c) a dock popover opened by click; (d) `(hover: none)`; (e) `live=false` | rest on the bar 400 ms | no peek in every case |
| F6 | A peek closes on leave (grace) | BVA | L1 | automated | peeked dock | pointer leaves bar ∪ overlay for 299 ms, then 301 ms | still peeked at 299 ms; collapsed at 301 ms |
| F7 | A peek closes… (open menu holds) | state-transition | L1 | automated | peeked dock; OpenSpec `⋯` trigger `aria-haspopup` + `aria-expanded="true"`, menu portaled to `body` | pointer moves onto the portaled menu > 300 ms | stays peeked; collapses 300 ms after the menu closes with the pointer outside |
| F8 | A peek closes… (disclosure does not hold) | state-transition | L1 | automated | compact peek with a chip `aria-expanded="true"` (no `aria-haspopup`) | pointer leaves > 300 ms | collapsed |
| F9 | A peek closes… (focus holds) | state-transition | L1 | automated | peeked; focus on Review inside the overlay | pointer leaves > 300 ms | stays peeked while `overlay.contains(activeElement)` |
| F10 | A peek closes… (Escape order) | state-transition | L1 | automated | peeked; (a) focus in an open dock menu; (b) focus on a control in the overlay, no menu; (c) focus in the composer textarea | press Escape | (a) menu closes, still peeked; (b) collapsed, focus on `composer-dock-bar`; (c) event not stopped by the dock (composer's handler sees it), dock stays peeked |
| F11 | A peek closes… (modal dialog) | state-transition | L1 | automated | peeked dock | a modal dialog mounts | state = collapsed |
| F12 | Pin and the bar expand the dock | state-transition | L1 | automated | (a) peeked → click `composer-dock-pin`; (b) peeked → click the bar; (c) collapsed → Enter on the focused bar | activate | expanded in flow; Hide shown; bar gone; focus on `composer-dock-hide` in (a) and (c); pointer away 400 ms does not collapse |
| F13 | Peek ends on rebind / is not persisted | state-transition | L1 | automated | peeked `s1` | (a) rebind to `s2` then back; (b) remount | `s1` shows collapsed; storage value unchanged (`collapsed`) |
| F14 | Peek does not refetch | invariant | L1 | automated | collapsed dock with the Changes lane open (body mounted, hidden) | peek, leave, peek again | `refreshOnExpand` / session-diff fetch called 0 extra times |
| F15 | Changes lane — Open from a peek collapses | state-transition | L1 | automated | peeked dock, Changes open | click `composer-dock-file-open` | `openInSplit` called; state = collapsed |
| F16 | Collapsed dock keeps live signals | async-convergence | L1 | automated | collapsed dock, 2 background processes | a third process appears | bar Processes segment shows 3 with the `--status-working` dot; live region announces the new count once; no live-region change on an elapsed tick |
| F17 | Collapsed dock keeps the YOLO footer + composer in place | invariant | L3 | automated | session with YOLO active, expanded dock ~220 px | click Hide, then hover the bar 400 ms | footer `boundingBox` visible between bar and composer in both states; composer card `bottom` offset to the pane bottom unchanged across expanded → collapsed → peek (±1 px); transcript `clientHeight` grows on collapse and is unchanged on peek; transcript `scrollTop` unchanged on peek |
| F18 | Dock renders above the composer card (connected panel) | invariant | L3 | automated | expanded, collapsed and peeked dock | read computed style | `[data-testid=composer-root]` `border-top-width` = 0 in all three states (the `composer-dock + composer-root` join still matches) |
| F19 | Resting… (fast pass, rendered) | state-transition | L3 | automated | collapsed dock, desktop viewport | `page.mouse.move` from the transcript to the composer input across the bar in 5 steps (≥ 1.5 px/ms) | the overlay never becomes visible (`toBeHidden` throughout); then rest on the bar → visible within 300–800 ms |
| F20 | Collapse state persists per session (rendered) | state-transition | L3 | automated | two sessions on the harness | collapse `s1`, reload, open `s2`, open `s1` | `s1` collapsed after reload; `s2` expanded |
| F21 | Changes lane Open / Diff land in the editor pane (rendered) | state-transition | L3 | automated | session with one changed in-cwd file `notes.md` | click Open, then Diff | active editor tab `notes.md` shows the file content; then the active tab is `diff:notes.md`; URL never becomes `/session/:id/diff` |
| F22 | Peek overlay with portaled popover (rendered) | state-transition | L3 | automated | peeked dock with the OpenSpec lane | open the `⋯` menu, move the pointer onto it | menu fully visible (not clipped by the overlay); dock stays peeked |
| F23 | Visual quality of Hide handle, bar and overlay | visual/subjective | — | manual-only | base dark, base light, nord dark | human looks at expanded / collapsed / peek | [judgment: handle straddles the edge cleanly, rounded corners intact after the clipping moved to `composer-dock-scroll`, overlay shadow reads as floating] |
| F24 | Accidental peek while typing | visual/subjective | — | manual-only | real trackpad and mouse on macOS | user moves from the transcript to the input repeatedly while working | [judgment: peek does not fire unintentionally in normal use] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Changes lane — File missing on disk (text) | fault-injection (abort) | L1 | automated | `/api/file` metadata for `src/gone.ts` → 404 | Open on the row | editor tab shows `File no longer exists: src/gone.ts`; no viewer mounted; no thrown error |
| X2 | Changes lane — Missing image | fault-injection (abort) | L1 | automated | `/api/file` metadata for `docs/logo.png` → 404 | Open on the row | same message naming `docs/logo.png` (image viewer not mounted) |
| X3 | Changes lane — missing file Diff | fault-injection (abort) | L1 | automated | `src/gone.ts` 404 on disk; session diff has its `gitDiff` | Diff on the row | `diff:src/gone.ts` tab renders the deletion hunk from `SessionDiffProvider`; no `/api/file` read made by the diff tab |
| X4 | File-missing probe uses no prompt | invariant | L1 | automated | grant channel installed (stub) | open any file tab | the metadata request carries no `X-Pi-Grant-Channel` header (`fetchWithoutGrantPrompt`) |
| X5 | Existing file unaffected by the probe | EP | L1 | automated | `/api/file` metadata 200 for `src/ok.ts`, size under the cap | Open | the viewer mounts as before; no missing message |

---

## Coverage summary

- Requirements covered: 12/12. ADDED: summary bar, live signals, YOLO/composer in place, peek, peek close, Pin, persistence. MODIFIED: shrinkable row, Changes lane, Compact dock, identity segment, `dashboard-shell-slots` dock row primitive.
- Scenarios by class: edge 20 · perf 1 · frontend 24 · error 5
- Scenarios by level: L1 40 · L2 0 · L3 8
- Scenarios by disposition: automated 48 · manual-only 2

## New infra needed

- none (extends the existing dock harness, hover-intent tests and `tests/e2e/composer-dock.spec.ts`)
