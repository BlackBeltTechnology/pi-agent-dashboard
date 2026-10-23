# folder-project-routes.ts — index

`GET /api/folder/project?cwd` → `FolderProject`. `admitCwd` first (400/403/503+`Retry-After`; 404 admitted-but-missing), never prompts, read-only, per-cwd in-flight de-dup, tier `observe`. `registerFolderProjectRoutes`. Token released on close AND `finally`. See change: add-project-scoped-apps, core-cwd-admission.
