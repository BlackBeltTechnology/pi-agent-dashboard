# Folder tools overflow menu

## Why

Folder groups should prioritize the frequent creation actions: New Session and
New Worktree. The current expanded folder card also presents several lower-use
folder integrations inline (plugin folder sections and OpenSpec). At sidebar
scale this adds persistent visual density even when the operator is only
creating or scanning sessions.

## What Changes

- Keep `FolderSpawnButtons` visible as the primary folder actions.
- Add an accessible `⋯` overflow trigger to the expanded folder action area.
- Move secondary folder integrations into the overflow surface: registered
  folder plugin sections (including Knowledge Base when enabled) and the
  existing `FolderOpenSpecSection` when the folder has OpenSpec data.
- Preserve each existing integration's callbacks, loading/pending behaviour,
  and absence when unavailable.
- Use the project's established anchored-menu/mobile-sheet behaviour rather
  than adding a new popover dependency.

## Non-goals

- No new Knowledge Base, Super OpenSpec, git, or backend actions.
- No change to New Session/New Worktree availability, worktree gating, or
  folder-collapse behaviour.
- No change to plugin slot registration contracts or OpenSpec data polling.

## Affected areas

- `packages/client/src/components/session/SessionList.tsx`
- `packages/client/src/components/folder/FolderToolsMenu.tsx` (new)
- `packages/client/src/components/__tests__/SessionList*.test.tsx` and/or a
  focused menu component test
- `openspec/specs/directory-card-layout/spec.md`
