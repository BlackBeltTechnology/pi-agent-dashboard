## Why

The per-folder-card "add to workspace" affordance in `SessionList.tsx` renders as a `text-[10px]`, borderless, gray `+ws` label absolutely positioned in the card's top-right corner. It is cryptic (the abbreviation is not self-explanatory), visually low-contrast, easy to miss, and falls below a comfortable touch target. Users overlook the primary gesture for organizing folders into workspaces.

## What Changes

- Replace the tiny `+ws` text label on top-level folder cards with a clearly-labelled pill button: `mdiViewGridPlus` icon + "Workspace" text, using the soft-blue tint + border treatment already used by the sidebar "New Workspace" button (`text-blue-500 border-blue-500/40 bg-blue-500/5`).
- The button becomes visually well-defined (fill + border), self-explanatory (icon + word), and a comfortable target — while staying compact enough to repeat on every folder card.
- Behavior is unchanged: same click target opens the existing `AddToWorkspaceMenu`; same gating (rendered only when a workspace exists or `onCreateWorkspace` is available).

## Capabilities

### New Capabilities
- `add-to-workspace-affordance`: The visual affordance on a top-level folder card that opens the add-to-workspace menu — its labelling, styling, target size, and visibility gating.

### Modified Capabilities
<!-- None — folder-workspaces (data) and dashboard-add-buttons (sidebar pair) are unaffected; behavior is identical. -->

## Discipline Skills

- `review-code`: run inline before commit once tests pass (non-trivial-enough client change touching a shared list component).

## Impact

- `packages/client/src/components/session/SessionList.tsx` — `renderGroupWithWorkspaceMenu`: restyle the `+ws` button; add `mdiViewGridPlus` to the `@mdi/js` import.
- Existing test `packages/client/src/components/__tests__/SessionList.test.tsx` — the `add-to-workspace-btn-*` testid is preserved, so behavior tests continue to pass; add/adjust an assertion for the new label.
- No server, protocol, or data-model changes.
