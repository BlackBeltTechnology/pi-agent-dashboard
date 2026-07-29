# Design — folder tools overflow menu

## Information hierarchy

The expanded folder body keeps its “Create” tray and existing New Session / New
Worktree controls visible. A compact `⋯ Tools` control follows those primary
actions. The old inline grid of plugin folder sections and the OpenSpec folder
section moves into the controlled menu surface.

## Menu content

The menu is compositional rather than a hard-coded list. It renders the existing
`SidebarFolderSectionSlot` and, when initialized or pending, the existing
`FolderOpenSpecSection`. Consequently:

- Knowledge Base remains present only when its plugin claims the folder slot.
- Super OpenSpec / OpenSpec remains present only when the current folder data
  makes its section eligible.
- Existing callbacks and loading state remain owned by their existing
  components.

## Interaction and accessibility

- The trigger is a native button with a text or accessible name “Folder tools”,
  `aria-expanded`, and a controlled region.
- Opening it must stop propagation so it does not collapse/select the folder.
- Desktop uses an anchored menu within the folder body. It flips upward when
  needed to stay inside the clipping pane, following existing worktree menu
  conventions.
- Mobile uses the equivalent compact sheet/list presentation.
- Escape, outside click, and activation of a navigation/action item close the
  menu where the existing menu primitive supports them.

## Empty state

The trigger is omitted when neither a plugin folder section nor an eligible
OpenSpec section can render. This avoids a dead or empty menu.
