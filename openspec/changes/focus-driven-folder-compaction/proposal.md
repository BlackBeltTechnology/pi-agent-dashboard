## Why

Each folder group in the session sidebar renders a heavy header (folder name + git info + action bar + plugin slots + OpenSpec section) plus all session cards, even when the user is not working in that folder. With 6+ pinned directories the sidebar fills before any session is visible, and the existing chevron toggle is binary (all cards or none) so the user must manually collapse every inactive folder to recover space — and then loses sight of sessions that need attention.

We want inactive folders to compact themselves automatically while still surfacing sessions that demand attention (awaiting input, processing, unread), so the user can scan many folders at once and only the focused folder shows full detail.

## What Changes

- Add a global **folder list mode** setting (`config.folderListMode: "classic" | "accordion"`, **default `"classic"`**). Classic preserves today's binary-collapse behavior verbatim; Accordion is opt-in and enables everything below. All focus-driven render logic is gated behind `mode === "accordion"` — when Classic, `SessionList` renders exactly as it does today.
- Introduce a **focused folder** concept (`activeCwd`) derived from the currently selected session's `cwd`, falling back to the most-recent folder-header click. At most one folder is focused at a time (accordion-style). *(Accordion mode only.)*
- Render rules become focus-driven:
  - **Focused folder** → behaves exactly as today; the chevron toggle controls full-list vs. hidden.
  - **Unfocused folder** → ignore the chevron toggle. Always render the header. Render only session cards that match the **attention predicate**.
  - **Unfocused folder with no attention** → header only, plus a compact "N sessions — click to view" affordance.
- Define the attention predicate as a pure derivation: `currentTool === "ask_user" || status ∈ {"streaming","active"} || unread === true`.
- Folder-header click sets `activeCwd` (focuses the folder) but does NOT toggle the chevron. The chevron remains the explicit collapse/expand control inside the focused folder.
- The existing user-collapsed set (localStorage) keeps its meaning for focused folders. A new optional user-expanded set lets users pin a second folder open even when it isn't focused.
- Apply uniformly to pinned and unpinned (Other) groups.
- Reactivity: when a session's attention state clears, its card disappears from an unfocused folder immediately on the next render.

## Capabilities

### New Capabilities
- `folder-focus`: defines `activeCwd` derivation, accordion behavior, header-click-to-focus gesture, and the "user-expanded" override.

### Modified Capabilities
- `session-filtering`: adds the per-folder attention filter that applies only when the folder is unfocused.
- `collapsible-groups`: clarifies that the chevron toggle's effect is scoped to the focused folder (and to user-expanded overrides); unfocused folders are governed by `folder-focus` + the attention filter, not by the persisted collapse bit.

## Drift reconciliation — 2026-07-13

`condense-collapsed-folder-header` (archived 2026-07-07) already shipped a foundational subset:

- `FolderStatusRollup.tsx` — compact working/idle dot-counts rendered when a folder is collapsed.
- `countStatusRollup` helper in `session-status-visuals.ts`.
- Collapsed-folder headers now hide heavy header slots (`GroupGitInfo`, `FolderActionBar`, `SidebarFolderSectionSlot`, `FolderOpenSpecSection`, `FolderSpawnButtons`) behind `{!isCollapsed && ...}`.
- `FolderNeedsYouPill` + `FolderStatusRollup` render in the collapsed header.

**Impact on this proposal**: the "collapsed folder renders heavy header" premise is outdated — collapsed folders are already compact. The focus-driven model now builds ON TOP of this foundation. The innovation shifts from "make collapsed folders lighter" (done) to "attention-driven partial expansion of unfocused folders" (the new additive layer). All references to "collapse behavior unchanged" throughout this document should be read with the understanding that the collapsed-state render is already compact; the focus-driven model adds compact render modes for *unfocused* folders as an additional layer.

## Impact

- **Code**:
  - `packages/client/src/components/SessionList.tsx` — new `activeCwd` state, focus-resolution effect, render-rule branch per group.
  - `packages/client/src/lib/session-grouping.ts` (or sibling helper) — pure `demandsAttention(session)` predicate; pure `resolveActiveCwd(selectedId, lastClickedCwd, sessions)`.
  - `packages/client/src/lib/session-filter-storage.ts` — home of the existing `getCollapsedGroups`/`setCollapsedGroups` (there is no `collapsed-groups.ts`); add a parallel user-expanded set here or in a sibling `user-expanded-groups.ts` (additive, backward-compatible localStorage key).
  - Folder-header `onClick` split: chevron handler vs. header-body focus handler (stop-propagation discipline).
- **APIs / protocol**: one additive server-config field `folderListMode` (default `"classic"`), persisted in `~/.pi/dashboard/config.json`, exposed via the existing config GET/PATCH path and the Settings → Sessions page. All render behavior is otherwise pure client-side derivation over existing `Session` fields (`status`, `currentTool`, `unread`, `cwd`).
- **Settings UI**: a `SelectField` “Folder list mode” (Classic / Accordion) + a nested `ToggleField` “Keep unfocused folders showing attention cards” on the Settings → Sessions page. Mockup: `mockups/accordion-setting.html`.
- **Persistence**: `activeCwd` is ephemeral (not persisted); user-expanded overrides persist alongside the existing collapsed set.
- **Tests**: pure helpers (`demandsAttention`, `resolveActiveCwd`) get unit tests; component tests cover the four-cell matrix (focused × {expanded, collapsed}) and (unfocused × {has-attention, no-attention}).
- **Plugins / mobile**: same rules apply on mobile shell. `SidebarFolderSectionSlot` and `FolderOpenSpecSection` continue to render only inside the focused folder's expanded header (unchanged from today).
