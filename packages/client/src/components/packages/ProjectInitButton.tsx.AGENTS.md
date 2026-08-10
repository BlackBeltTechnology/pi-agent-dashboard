# ProjectInitButton.tsx — index

Presentational "Set up project" scaffold button (indigo, `mdiFolderPlusOutline`, testid `project-init-btn`). Props `{ cwd, status, onInitializeProject? }`. Renders iff `status.hasHook===false && status.configured===false && !!onInitializeProject` (strict `===false`; absent `configured`/state ③ → nothing). Click → `onInitializeProject(cwd)` spawns interactive project-init session. Split out of `WorktreeInitButton`'s polymorphic no-hook branch. See change: distinguish-initialize-actions.
