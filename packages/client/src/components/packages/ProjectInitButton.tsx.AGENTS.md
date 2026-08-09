# ProjectInitButton.tsx — index

Presentational "Set up project" scaffold button (indigo, `mdiFolderPlusOutline`, testid `project-init-btn`). Props `{ cwd, status, onInitializeProject? }`. Renders iff `status.hasHook===false && status.configured===false && !!onInitializeProject` (strict `===false`; absent `configured`/state ③ → nothing). Click → `onInitializeProject(cwd)` spawns interactive project-init session. Split out of `WorktreeInitButton`'s polymorphic no-hook branch. See change: distinguish-initialize-actions.

See change: add-folder-actions-menu — the render predicate is extracted as an exported pure fn `shouldShowProjectInit(status, onInitializeProject)` and the component now delegates to it. `FolderActionBar` imports it to decide it holds nothing and render `null`, so the emptiness test cannot drift from what this button actually renders.
