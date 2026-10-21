# folder-project.ts — index

Client folder-project cache. `useFolderProject`, `getFolderProject`, `invalidateFolderProject`, `clearFolderProjects`, `folderHasProjectType(type)`, `folderHasProjectId(id)` (sync claim predicates; miss → false + microtask-queued fetch of `/api/folder/project`). Entries `loading|ready|error`; landings coalesce to one `bumpSlotClaimsVersion()`; error fails closed, expires 60 s; per-folder generation + global epoch discard stale landings. See change: add-project-scoped-apps.
