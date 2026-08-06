## Context

The add-to-workspace affordance lives in `renderGroupWithWorkspaceMenu` (`SessionList.tsx`), which wraps `renderGroup` and overlays an absolutely-positioned container (`absolute top-1 right-7`) holding the `+ws` button and the `AddToWorkspaceMenu` popover. Only top-level (non-workspace-tier) groups use this wrapper. A mockup (`mockups/add-to-workspace-button/`) compared the current control against three redesigns; Option A (labelled pill) was selected.

## Goals

- Make the affordance legible, self-explanatory, and comfortably targetable.
- Keep it compact enough to repeat on every top-level folder card without visual heaviness.
- Zero behavior change; reuse existing tokens and the existing menu.

## Decisions

- **Option A — labelled pill.** Icon (`mdiViewGridPlus`) + "Workspace" text. Chosen over the icon-only square (B, meaning not self-evident) and the solid primary (C, too heavy repeated per card).
- **Reuse the existing "New Workspace" button treatment** from `DashboardSpawnButtons.tsx`: `text-blue-500 border-blue-500/40 bg-blue-500/5 hover:text-blue-400 hover:border-blue-500/70`. This keeps one visual language for workspace add-gestures and is already theme-verified.
- **`mdiViewGridPlus`** matches the icon the sidebar "New Workspace" button already uses — consistent iconography for the workspace concept.
- **Keep the absolute-overlay structure.** The button + `AddToWorkspaceMenu` stay in the overlay container. Only the button's className/content changes, plus repositioning the overlay so the wider pill does not overlap the pin/open-home icons. This is the minimal, surgical diff — no props threaded into `renderGroup`.
- **Preserve `add-to-workspace-btn-<cwd>` test id** and the `stopPropagation` click guard so existing behavior tests hold.

## Risks / Trade-offs

- A wider pill could crowd the header on very narrow sidebars. Mitigation: the pill uses `text-xs` and short label ("Workspace"), matching the compact sidebar buttons; the header truncates the folder name, so the pill sits over slack space.

## Migration

None. Pure client-side restyle; no data, protocol, or API change.
