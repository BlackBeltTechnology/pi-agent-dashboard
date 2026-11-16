# Design

## Context

- **Requirement breached.** `openspec/specs/shell-overlay-route/spec.md:357-374` already requires "Route-backed overlay content SHALL be reachable": overlay content is either bounded or scrollable. #1158 is a conformance bug against that requirement, not a missing feature.
- **Presentation.** The automations claims declare no `presentation`, so the effective presentation is `"dialog"` (`packages/dashboard-plugin-runtime/src/slot-consumers.tsx:1075`; claims in `packages/automation-plugin/package.json:55-71`).
- **Desktop host.** `RouteBackedOverlay` renders a flush `Dialog` with no container close control, so the in-content Back is the dismiss affordance. Its chain is `<div className="flex flex-col h-[92vh] min-h-0">` (`packages/client/src/App.tsx:3649`) → `ShellOverlayRouteSlot`. The flush panel surface is `--bg-secondary` (`packages/client-utils/src/Dialog.tsx:124`).
- **Mobile host.** The `MobileShell` detail panel is `absolute inset-0 ... bg-[var(--bg-primary)] flex flex-col` with no overflow, plus an inline `transform` (`packages/client/src/components/shell/MobileShell.tsx:33-39,64-69`). The slot is mounted at `App.tsx:3398`.
- **Slot chain.** `<div className="flex-1 min-h-0 relative">` (`slot-consumers.tsx:1255`) → `<div className="absolute inset-0 flex flex-col overflow-hidden">{claim}</div>` (`slot-consumers.tsx:1324`). The claim's direct parent is a flex column that clips overflow, and nothing above it scrolls. The spec text at `shell-overlay-route/spec.md:155` describes this wrapper differently and is stale; that is noted here and not fixed.
- **Dialog sizing rule.** `openspec/specs/dialog-system/spec.md` ("Dialog flush (edge-to-edge) body") says a flush child SHALL size itself with `flex-1 min-h-0`, not `h-full`. A percentage height can resolve against an indefinite parent and silently fall back to `auto`.
- **Board.** The main-branch root is `flex flex-col gap-3 p-3 text-sm` with no overflow or height (`packages/automation-plugin/src/client/AutomationBoard.tsx:257`). Its header row (Back + title + cwd crumb) is at `:258-270`; the crumb has no `min-w-0`/`truncate`. The definitions `<ul>` is at `:318`. Cards are `overflow-hidden` with no inner scroller (`:437`, `:441`). The invalid-scope branch (`:241`) renders only Back + one line of error text.
- **Run monitor.** Root has the same shape (`packages/automation-plugin/src/client/AutomationRunMonitor.tsx:113`). Header at `:114-123`; its Back button has no `data-testid`/`title`/`aria-label`. Below it come a status line, an optional archived link, a live hint and a Markdown findings block (`:124-158`). There are no list rows.
- **Precedent.** The KB plugin page root is `flex flex-col h-full overflow-y-auto`, with an unpadded root and a `sticky top-0 z-10 flex-shrink-0 bg-[var(--bg-primary)] border-b` header (`packages/kb-plugin/src/client/KbSettingsPanel.tsx:468-470`).
- **CreateAutomationDialog.** Not a slot claim and not the shared `Dialog`. It is its own `fixed inset-0` backdrop with a `max-h-[90vh] overflow-auto` panel (`CreateAutomationDialog.tsx:500-507`). On mobile, the detail panel's `transform` makes that panel the containing block for `position: fixed`, so the backdrop is confined to the panel while `90vh` stays relative to the viewport. Whether this clips is unverified, and a task checks it.

## Goals / Non-Goals

**Goals:**
- Board and run monitor conform to "Route-backed overlay content SHALL be reachable" at desktop (1440x900) and mobile widths.
- Back stays visible while the content is scrolled.
- No horizontal scrollbar and no nested vertical scroller.
- Regression tests that would have caught #1158.

**Non-Goals:**
- Changing `ShellOverlayRouteSlot`, `RouteBackedOverlay`, `MobileShell`, or the 92vh pin.
- Pre-existing spec drift. `automation-content-view` says board `depth: 1` and run route `/automation/run/:sid`, but the manifest has `depth: 2` and `/folder/:encodedCwd/automations/run/:sid` (`package.json:60,67-70`). Separately, the `shell-overlay-route/spec.md:155` wrapper text is stale. Both are follow-ups.
- Issue #1153.

## Decisions

1. **The claim owns its scroll, sized per dialog-system.** The board main-branch root and the run-monitor root become `flex flex-col flex-1 min-h-0 overflow-y-auto text-sm`. `flex-1 min-h-0` fills the flex-column parent at `slot-consumers.tsx:1324` in both hosts and does not rely on a definite percentage height.
   - Alternative: `h-full` (the KB precedent). Rejected because `dialog-system` mandates `flex-1 min-h-0`, and `h-full` would silently depend on the 92vh pin. This is compatible with `shell-overlay-route/spec.md:151-156`: that scenario guarantees an `h-full` root *would* resolve, but it does not require claims to use `h-full`.
   - The invalid-scope root (`:241`) gets the same root classes (no restructure), so the requirement holds on both branches without adding a special case.
   - Alternative: scroll in the slot wrapper or the host. Rejected because it changes every plugin and nests scrollers.
2. **Unpadded scroller, sticky header, padded body.** This follows the KB layout: root (scroller, no padding) → header `sticky top-0 z-10 shrink-0 px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-primary)]` → body `flex flex-col gap-3 p-3` holding the rest. With no root padding there is no strip above the sticky header for content to show through, and no negative-margin trick is needed.
3. **Header token = `--bg-primary`, the same as KB.** On mobile it matches the panel. On desktop it reads as a toolbar strip over the `--bg-secondary` flush panel, which is the same look as the KB page in the same host. Trade-off accepted for consistency across plugins. All colours stay tokens.
4. **No horizontal scroller on the root.** `overflow-y: auto` forces `overflow-x: auto`, so every flex level down to the text needs `min-w-0`. On the board, the title group (`:259`, a nested flex) gets `min-w-0`, and the `h2` and crumb get `truncate`. The crumb is only the folder basename (`:109`), so the hazard is a long folder name, not a path. On the run monitor, the header `h2`, which embeds `run.name` (`:115-118`), gets `min-w-0 truncate`, and `runId` wraps. `MarkdownContent` can render wide tables (`TableWrapper` has no overflow, `packages/client/src/components/preview/MarkdownContent.tsx:229-231,575-579`) and `pre` blocks, so the findings block sits in its own `min-w-0 overflow-x-auto` wrapper. Wide markdown scrolls horizontally inside that wrapper, never on the root. The E2E asserts root `scrollWidth <= clientWidth`.
5. **Testable run-monitor Back.** Add `data-testid="automation-run-monitor-back"`, mirroring `automation-board-back`.

## Test strategy notes (input to scenario-design)

- Geometry needs L3 (Playwright), because jsdom has no layout. A unit test can only pin the class tokens.
- The existing E8 gate asserts `clipped <= EPS` only; the scroller count appears only in its failure message (`tests/e2e/overlay-layout.spec.ts:150-185`). New cases must assert the scroller count and `scrollWidth`, and must scroll to the end before asserting that the last card and Back are inside the panel.
- Seeding: more than 6 definitions through `POST /api/plugins/automation/create`, with unique names and a cron that can never match (`0 0 31 2 *`, i.e. Feb 31; not `NEVER_CRON`, which fires on Jan 1). Delete them in `afterAll` via `DELETE /api/plugins/automation` (`packages/automation-plugin/src/server/routes.ts:517`). The suite runs serially (`playwright.config.ts:57-60`), but the cleanup must still run even when the test fails, so it does not leak definitions into `automation-fanout`/`automation-orphan-stop`.
- CreateAutomationDialog pass criterion: at 375x667 and 1440x900, with every optional section expanded, the last form field and the Save/Cancel buttons can be scrolled into view inside the viewport.
- Run monitor tall content needs a run record with a long findings result. The only producer is a real run (`POST /api/plugins/automation/run`, as in `automation-orphan-stop.spec.ts`). scenario-design decides whether that is feasible on the faux model or whether the case is manual-only.

## Risks / Trade-offs

- [Risk] The sticky header covers content at a non-zero scroll offset. This is normal sticky behaviour: the content scrolls out from under it and stays reachable. It is not the "occluded by the close control" case in `shell-overlay-route`.
- [Risk] Popover menus inside the scroller can clip. → Already mitigated: the overflow menu portals to `document.body` (`AutomationBoard.tsx:509-513`).
- [Risk] `CreateAutomationDialog` is clipped on mobile: the transformed panel is its containing block while `max-h-[90vh]` is measured against the viewport. → The E2E pass criterion above decides. If it is red, portal it to `document.body`. Its raw `z-50` then ties `--z-dialog` (50), where the later mount wins (`docs/architecture.md`), which is correct for a dialog opened over the board.
- [Trade-off] A per-card run-history scroller added later would nest inside the board scroller. The spec pins a single scroller, so that would need a deliberate spec change.
